const fs = require("fs/promises");
const path = require("path");
const { buildFunctionSlotProjectionRows } = require("./function-slot-projector");

function createFunctionSlotProjectionStore({ store, dbPath = null } = {}) {
  if (!store?.runtimeRoot && !dbPath) throw new Error("FunctionSlotProjectionStore requires store or dbPath");
  const projectionRoot = store?.runtimeRoot ? path.join(store.runtimeRoot, "Projection") : path.dirname(dbPath);
  const databasePath = dbPath ?? path.join(projectionRoot, "function-slot-projection.sqlite");

  async function ensureSchema() {
    await fs.mkdir(path.dirname(databasePath), { recursive: true });
    withDb(databasePath, (db) => {
      db.exec("PRAGMA foreign_keys = ON");
      db.exec(SCHEMA_SQL);
    });
  }

  async function projectArtifact(artifact) {
    const rows = buildFunctionSlotProjectionRows(artifact);
    await replaceArtifactProjection(rows);
    return summarizeRows(rows);
  }

  async function replaceArtifactProjection(rows) {
    await ensureSchema();
    withDb(databasePath, (db) => {
      db.exec("BEGIN");
      try {
        for (const root of rows.artifacts) deleteArtifactRows(db, root.artifactId);
        insertRows(db, rows);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    });
  }

  async function querySlots(filters = {}) {
    await ensureSchema();
    return withDb(databasePath, (db) => {
      const { sql, params } = buildQuery({
        base: `SELECT s.*, a.sampleVideoId, a.traceId
          FROM function_slots s
          JOIN function_slot_artifacts a ON a.artifactId = s.artifactId`,
        filters,
        columns: {
          artifactId: "s.artifactId",
          sampleVideoId: "a.sampleVideoId",
          slotType: "s.slotType",
          viewerStateBefore: "s.viewerStateBefore",
          viewerStateAfter: "s.viewerStateAfter",
          sourceArtifactId: "src.sourceArtifactId",
        },
        sourceJoin: "LEFT JOIN function_artifact_sources src ON src.artifactId = s.artifactId",
        orderBy: "ORDER BY s.artifactId, s.slotOrder",
      });
      return db.prepare(sql).all(...params).map(rowWithBoolean);
    });
  }

  async function queryAtoms(filters = {}) {
    await ensureSchema();
    return withDb(databasePath, (db) => {
      const { sql, params } = buildQuery({
        base: `SELECT atom.*, root.sampleVideoId, root.traceId, slot.slotType
          FROM function_atoms atom
          JOIN function_slot_artifacts root ON root.artifactId = atom.artifactId
          LEFT JOIN function_slots slot ON slot.artifactId = atom.artifactId AND slot.slotId = atom.slotId`,
        filters,
        columns: {
          artifactId: "atom.artifactId",
          sampleVideoId: "root.sampleVideoId",
          atomType: "atom.atomType",
          slotType: "slot.slotType",
          sourceArtifactId: "src.sourceArtifactId",
        },
        sourceJoin: "LEFT JOIN function_artifact_sources src ON src.artifactId = atom.artifactId",
        orderBy: "ORDER BY atom.artifactId, atom.atomType, atom.atomId",
      });
      return db.prepare(sql).all(...params).map(rowWithBoolean);
    });
  }

  async function queryBindings(filters = {}) {
    await ensureSchema();
    return withDb(databasePath, (db) => {
      const { sql, params } = buildQuery({
        base: `SELECT b.*, root.sampleVideoId, root.traceId
          FROM function_bindings b
          JOIN function_slot_artifacts root ON root.artifactId = b.artifactId`,
        filters,
        columns: {
          artifactId: "b.artifactId",
          sampleVideoId: "root.sampleVideoId",
          bindingType: "b.bindingType",
          sourceArtifactId: "src.sourceArtifactId",
        },
        sourceJoin: "LEFT JOIN function_artifact_sources src ON src.artifactId = b.artifactId",
        orderBy: "ORDER BY b.artifactId, b.bindingId",
      });
      return db.prepare(sql).all(...params);
    });
  }

  async function queryRules(filters = {}) {
    await ensureSchema();
    return withDb(databasePath, (db) => {
      const { sql, params } = buildQuery({
        base: `SELECT r.*, root.sampleVideoId, root.traceId
          FROM function_rules r
          JOIN function_slot_artifacts root ON root.artifactId = r.artifactId`,
        filters,
        columns: {
          artifactId: "r.artifactId",
          sampleVideoId: "root.sampleVideoId",
          ruleType: "r.ruleType",
          sourceArtifactId: "src.sourceArtifactId",
        },
        sourceJoin: "LEFT JOIN function_artifact_sources src ON src.artifactId = r.artifactId",
        orderBy: "ORDER BY r.artifactId, r.ruleType, r.ruleId",
      });
      return db.prepare(sql).all(...params);
    });
  }

  async function countRows() {
    await ensureSchema();
    return withDb(databasePath, (db) => ({
      artifacts: count(db, "function_slot_artifacts"),
      slots: count(db, "function_slots"),
      atoms: count(db, "function_atoms"),
      bindings: count(db, "function_bindings"),
      rules: count(db, "function_rules"),
      templates: count(db, "function_recomposition_templates"),
    }));
  }

  async function clearAll() {
    await ensureSchema();
    withDb(databasePath, (db) => {
      db.exec("BEGIN");
      try {
        for (const table of DELETE_ORDER) db.prepare(`DELETE FROM ${table}`).run();
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    });
  }

  return {
    projectionRoot,
    dbPath: databasePath,
    ensureSchema,
    projectArtifact,
    replaceArtifactProjection,
    querySlots,
    queryAtoms,
    queryBindings,
    queryRules,
    countRows,
    clearAll,
  };
}

function withDb(databasePath, action) {
  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync(databasePath);
  try {
    return action(db);
  } finally {
    db.close();
  }
}

function deleteArtifactRows(db, artifactId) {
  for (const table of DELETE_ORDER) {
    db.prepare(`DELETE FROM ${table} WHERE artifactId = ?`).run(artifactId);
  }
}

function insertRows(db, rows) {
  insertMany(db, "function_slot_artifacts", rows.artifacts);
  insertMany(db, "function_artifact_sources", rows.artifactSources);
  insertMany(db, "function_slots", rows.slots);
  insertMany(db, "function_atoms", rows.atoms);
  insertMany(db, "function_script_atoms", rows.scriptAtoms);
  insertMany(db, "function_rhythm_atoms", rows.rhythmAtoms);
  insertMany(db, "function_packaging_atoms", rows.packagingAtoms);
  insertMany(db, "function_bindings", rows.bindings);
  insertMany(db, "function_binding_refs", rows.bindingRefs);
  insertMany(db, "function_rules", rows.rules);
  insertMany(db, "function_recomposition_templates", rows.templates);
  insertMany(db, "function_slot_source_refs", rows.slotSourceRefs);
  insertMany(db, "function_atom_source_refs", rows.atomSourceRefs);
}

function insertMany(db, table, rows) {
  if (!rows?.length) return;
  const columns = Object.keys(rows[0]);
  const placeholders = columns.map(() => "?").join(", ");
  const statement = db.prepare(`INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders})`);
  for (const row of rows) {
    statement.run(...columns.map((column) => row[column] ?? null));
  }
}

function buildQuery({ base, filters, columns, sourceJoin, orderBy }) {
  const where = [];
  const params = [];
  let sql = base;
  if (filters.sourceArtifactId) sql += `\n${sourceJoin}`;
  for (const [key, column] of Object.entries(columns)) {
    if (filters[key] === undefined || filters[key] === null || filters[key] === "") continue;
    where.push(`${column} = ?`);
    params.push(filters[key]);
  }
  if (where.length) sql += `\nWHERE ${where.join(" AND ")}`;
  sql += `\n${orderBy}`;
  return { sql, params };
}

function summarizeRows(rows) {
  return {
    artifactId: rows.artifacts[0]?.artifactId ?? null,
    sampleVideoId: rows.artifacts[0]?.sampleVideoId ?? null,
    slotCount: rows.slots.length,
    atomCount: rows.atoms.length,
    bindingCount: rows.bindings.length,
    ruleCount: rows.rules.length,
    templateCount: rows.templates.length,
  };
}

function rowWithBoolean(row) {
  return { ...row, needReview: Boolean(row.needReview) };
}

function count(db, table) {
  return db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count;
}

const DELETE_ORDER = [
  "function_atom_source_refs",
  "function_slot_source_refs",
  "function_recomposition_templates",
  "function_rules",
  "function_binding_refs",
  "function_bindings",
  "function_packaging_atoms",
  "function_rhythm_atoms",
  "function_script_atoms",
  "function_atoms",
  "function_slots",
  "function_artifact_sources",
  "function_slot_artifacts",
];

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS function_slot_artifacts (
  artifactId TEXT PRIMARY KEY,
  sampleVideoId TEXT,
  traceId TEXT,
  parentArtifactId TEXT,
  sourceScriptSegmentArtifactId TEXT,
  sourceRhythmStructureArtifactId TEXT,
  sourcePackagingStructureArtifactId TEXT,
  createdAt TEXT,
  status TEXT
);
CREATE TABLE IF NOT EXISTS function_slots (
  artifactId TEXT NOT NULL,
  slotId TEXT NOT NULL,
  slotOrder INTEGER,
  slotType TEXT,
  slotName TEXT,
  viewerStateBefore TEXT,
  viewerStateAfter TEXT,
  persuasionTask TEXT,
  confidence REAL,
  needReview INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (artifactId, slotId)
);
CREATE TABLE IF NOT EXISTS function_atoms (
  artifactId TEXT NOT NULL,
  atomId TEXT NOT NULL,
  slotId TEXT,
  atomType TEXT,
  label TEXT,
  functionText TEXT,
  confidence REAL,
  needReview INTEGER NOT NULL DEFAULT 0,
  rawJson TEXT,
  PRIMARY KEY (artifactId, atomId)
);
CREATE TABLE IF NOT EXISTS function_script_atoms (
  artifactId TEXT NOT NULL,
  atomId TEXT NOT NULL,
  claimType TEXT,
  proofNeed TEXT,
  mustKeepJson TEXT,
  replaceableVariablesJson TEXT,
  PRIMARY KEY (artifactId, atomId)
);
CREATE TABLE IF NOT EXISTS function_rhythm_atoms (
  artifactId TEXT NOT NULL,
  atomId TEXT NOT NULL,
  pace TEXT,
  densityType TEXT,
  beatShape TEXT,
  avoidForJson TEXT,
  syncPointsJson TEXT,
  PRIMARY KEY (artifactId, atomId)
);
CREATE TABLE IF NOT EXISTS function_packaging_atoms (
  artifactId TEXT NOT NULL,
  atomId TEXT NOT NULL,
  proofType TEXT,
  visualHierarchy TEXT,
  risk TEXT,
  visualElementsJson TEXT,
  replaceableStyleJson TEXT,
  PRIMARY KEY (artifactId, atomId)
);
CREATE TABLE IF NOT EXISTS function_bindings (
  artifactId TEXT NOT NULL,
  bindingId TEXT NOT NULL,
  bindingType TEXT,
  rule TEXT,
  globalRiskIfBroken TEXT,
  confidence REAL,
  PRIMARY KEY (artifactId, bindingId)
);
CREATE TABLE IF NOT EXISTS function_binding_refs (
  artifactId TEXT NOT NULL,
  bindingId TEXT NOT NULL,
  refKind TEXT NOT NULL,
  refId TEXT NOT NULL,
  PRIMARY KEY (artifactId, bindingId, refKind, refId)
);
CREATE TABLE IF NOT EXISTS function_rules (
  artifactId TEXT NOT NULL,
  ruleId TEXT NOT NULL,
  ruleType TEXT NOT NULL,
  reasonOrRule TEXT,
  fix TEXT,
  appliesToJson TEXT,
  sourceBindingIdsJson TEXT,
  PRIMARY KEY (artifactId, ruleType, ruleId)
);
CREATE TABLE IF NOT EXISTS function_recomposition_templates (
  artifactId TEXT NOT NULL,
  templateId TEXT NOT NULL,
  templateName TEXT,
  sequenceJson TEXT,
  PRIMARY KEY (artifactId, templateId)
);
CREATE TABLE IF NOT EXISTS function_artifact_sources (
  artifactId TEXT NOT NULL,
  sourceArtifactId TEXT NOT NULL,
  sourceArtifactType TEXT,
  sourceTraceId TEXT,
  PRIMARY KEY (artifactId, sourceArtifactId)
);
CREATE TABLE IF NOT EXISTS function_slot_source_refs (
  artifactId TEXT NOT NULL,
  slotId TEXT NOT NULL,
  refType TEXT NOT NULL,
  refValue TEXT NOT NULL,
  PRIMARY KEY (artifactId, slotId, refType, refValue)
);
CREATE TABLE IF NOT EXISTS function_atom_source_refs (
  artifactId TEXT NOT NULL,
  atomId TEXT NOT NULL,
  refType TEXT NOT NULL,
  refValue TEXT NOT NULL,
  PRIMARY KEY (artifactId, atomId, refType, refValue)
);
CREATE INDEX IF NOT EXISTS idx_function_slots_type ON function_slots(slotType);
CREATE INDEX IF NOT EXISTS idx_function_slots_viewer_state ON function_slots(viewerStateBefore, viewerStateAfter);
CREATE INDEX IF NOT EXISTS idx_function_atoms_type ON function_atoms(atomType);
CREATE INDEX IF NOT EXISTS idx_function_bindings_type ON function_bindings(bindingType);
CREATE INDEX IF NOT EXISTS idx_function_artifact_sources_source ON function_artifact_sources(sourceArtifactId);
`;

module.exports = {
  createFunctionSlotProjectionStore,
};
