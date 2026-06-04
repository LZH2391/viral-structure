const fs = require("fs/promises");
const path = require("path");

const GOVERNANCE_SCHEMA_VERSION = "function_slot_semantic_governance.v1";
const GOVERNANCE_FORMAT_SINGLE = "single_json.v1";
const GOVERNANCE_FORMAT_SPLIT = "split_manifest.v1";

const GOVERNANCE_COLLECTION_FIELDS = [
  "sourceVariants",
  "slotFamilies",
  "slotArchetypes",
  "slotSubtypes",
  "atomArchetypes",
  "atomPatterns",
  "bindingPatterns",
  "bindingPrinciples",
  "rulePatterns",
  "recompositionPolicies",
  "implementationBundles",
  "observedChainPatterns",
  "unmappedAtomVariants",
  "unmappedBindingVariants",
  "unmappedRuleVariants",
  "reviewItems",
  "openQuestions",
];

const GOVERNANCE_SPLIT_FILES = {
  source: {
    path: "source-variants.v1.json",
    fields: ["sourceVariants"],
  },
  slots: {
    path: "slot-governance.v1.json",
    fields: ["slotFamilies", "slotArchetypes", "slotSubtypes"],
  },
  atoms: {
    path: "atom-governance.v1.json",
    fields: ["atomArchetypes", "atomPatterns"],
  },
  bindingRules: {
    path: "binding-rule-governance.v1.json",
    fields: ["bindingPatterns", "bindingPrinciples", "rulePatterns", "recompositionPolicies"],
  },
  bundles: {
    path: "implementation-bundles.v1.json",
    fields: ["implementationBundles", "observedChainPatterns"],
  },
  review: {
    path: "review-and-unmapped.v1.json",
    fields: ["unmappedAtomVariants", "unmappedBindingVariants", "unmappedRuleVariants", "reviewItems", "openQuestions"],
  },
};

async function readGovernanceFile(filePath) {
  const manifest = await readJson(filePath);
  return materializeGovernance(filePath, manifest);
}

async function readGovernanceFileIfExists(filePath) {
  try {
    return await readGovernanceFile(filePath);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function materializeGovernance(filePath, manifest) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) return manifest;
  if (!isSplitGovernanceManifest(manifest)) return ensureGovernanceLists(manifest);

  const baseDir = path.dirname(filePath);
  const governance = { ...manifest };
  delete governance.files;
  governance.governanceFormat = GOVERNANCE_FORMAT_SPLIT;
  for (const field of GOVERNANCE_COLLECTION_FIELDS) governance[field] = [];

  for (const [sectionName, section] of Object.entries(manifest.files ?? {})) {
    const sectionPath = section?.path;
    const fields = Array.isArray(section?.fields) ? section.fields : [];
    if (!sectionPath || !fields.length) continue;
    const sectionValue = await readJson(resolveInside(baseDir, sectionPath));
    for (const field of fields) {
      governance[field] = Array.isArray(sectionValue?.[field]) ? sectionValue[field] : [];
    }
    governance._sectionVersions = {
      ...(governance._sectionVersions ?? {}),
      [sectionName]: sectionValue?.schemaVersion ?? null,
    };
  }
  return ensureGovernanceLists(governance);
}

async function writeSplitGovernanceFile(filePath, governance) {
  const normalized = ensureGovernanceLists(governance);
  const baseDir = path.dirname(filePath);
  await fs.mkdir(baseDir, { recursive: true });
  const files = {};

  for (const [sectionName, section] of Object.entries(GOVERNANCE_SPLIT_FILES)) {
    const sectionValue = {
      schemaVersion: `${GOVERNANCE_SCHEMA_VERSION}.${sectionName}`,
      governanceId: normalized.governanceId ?? null,
      updatedAt: new Date().toISOString(),
    };
    for (const field of section.fields) {
      sectionValue[field] = Array.isArray(normalized[field]) ? normalized[field] : [];
    }
    await writeJson(path.join(baseDir, section.path), sectionValue);
    files[sectionName] = {
      path: section.path,
      fields: section.fields,
    };
  }

  const manifest = buildSplitGovernanceManifest(normalized, files);
  await writeJson(filePath, manifest);
  return manifest;
}

async function readGovernanceFileSnapshot(filePath) {
  const files = new Map();
  await snapshotFile(files, filePath);
  const manifest = files.get(path.resolve(filePath))?.json;
  if (isSplitGovernanceManifest(manifest)) {
    const baseDir = path.dirname(filePath);
    for (const section of Object.values(manifest.files ?? {})) {
      if (section?.path) await snapshotFile(files, resolveInside(baseDir, section.path));
    }
  }
  return {
    rootPath: path.resolve(filePath),
    files: [...files.values()],
  };
}

async function restoreGovernanceFileSnapshot(snapshot) {
  if (!snapshot?.files) return;
  for (const file of snapshot.files) {
    if (!file.exists) continue;
    await fs.mkdir(path.dirname(file.path), { recursive: true });
    await fs.writeFile(file.path, file.text, "utf8");
  }
  const knownSplitPaths = Object.values(GOVERNANCE_SPLIT_FILES).map((section) => path.resolve(path.dirname(snapshot.rootPath), section.path));
  const snapshotted = new Set(snapshot.files.map((file) => path.resolve(file.path)));
  for (const filePath of knownSplitPaths) {
    if (!snapshotted.has(filePath)) await fs.rm(filePath, { force: true }).catch(() => undefined);
  }
}

function buildSplitGovernanceManifest(governance, files = GOVERNANCE_SPLIT_FILES) {
  const normalized = ensureGovernanceLists(governance);
  const manifest = {};
  for (const [key, value] of Object.entries(normalized)) {
    if (GOVERNANCE_COLLECTION_FIELDS.includes(key) || key === "_path" || key === "_sectionVersions") continue;
    manifest[key] = value;
  }
  manifest.schemaVersion = normalized.schemaVersion ?? GOVERNANCE_SCHEMA_VERSION;
  manifest.governanceFormat = GOVERNANCE_FORMAT_SPLIT;
  manifest.files = files;
  return manifest;
}

function isSplitGovernanceManifest(value) {
  return value?.schemaVersion === GOVERNANCE_SCHEMA_VERSION
    && value?.governanceFormat === GOVERNANCE_FORMAT_SPLIT
    && value.files
    && typeof value.files === "object"
    && !Array.isArray(value.files);
}

function ensureGovernanceLists(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const normalized = { ...value };
  normalized.schemaVersion = normalized.schemaVersion ?? GOVERNANCE_SCHEMA_VERSION;
  normalized.governanceFormat = normalized.governanceFormat ?? GOVERNANCE_FORMAT_SINGLE;
  for (const field of GOVERNANCE_COLLECTION_FIELDS) {
    if (!Array.isArray(normalized[field])) normalized[field] = [];
  }
  return normalized;
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function snapshotFile(files, filePath) {
  const resolved = path.resolve(filePath);
  if (files.has(resolved)) return;
  try {
    const text = await fs.readFile(resolved, "utf8");
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    files.set(resolved, { path: resolved, exists: true, text, json });
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    files.set(resolved, { path: resolved, exists: false, text: null, json: null });
  }
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function resolveInside(baseDir, relativePath) {
  const resolved = path.resolve(baseDir, String(relativePath ?? ""));
  const base = path.resolve(baseDir);
  if (resolved !== base && !resolved.startsWith(`${base}${path.sep}`)) {
    throw new Error(`governance split file path escapes _governance directory: ${relativePath}`);
  }
  return resolved;
}

module.exports = {
  GOVERNANCE_COLLECTION_FIELDS,
  GOVERNANCE_FORMAT_SINGLE,
  GOVERNANCE_FORMAT_SPLIT,
  GOVERNANCE_SCHEMA_VERSION,
  GOVERNANCE_SPLIT_FILES,
  buildSplitGovernanceManifest,
  ensureGovernanceLists,
  isSplitGovernanceManifest,
  materializeGovernance,
  readGovernanceFileSnapshot,
  readGovernanceFile,
  readGovernanceFileIfExists,
  restoreGovernanceFileSnapshot,
  writeSplitGovernanceFile,
};
