const fs = require("fs/promises");
const path = require("path");

async function resolveStoryboardPlanVersions({ rootDir, restructureFinalPath, shotDesignFinalPath = null }) {
  const root = path.resolve(rootDir);
  const rootRestructurePath = resolveInsideRoot(root, restructureFinalPath);
  if (!rootRestructurePath) return { mode: "single", defaultVersionId: null, versions: [] };
  const rootDirname = path.dirname(rootRestructurePath);
  const text = await readTextIfExists(rootRestructurePath);
  const versionCandidates = await collectVersionCandidates({ root, rootDirname, text });
  const versions = [];
  for (const candidate of versionCandidates) {
    const resolvedRestructurePath = resolveVersionPath(root, rootDirname, candidate.restructureFinalPath);
    if (!resolvedRestructurePath) continue;
    versions.push({
      versionId: candidate.versionId,
      versionName: candidate.versionName || candidate.versionId,
      restructureFinalPath: safeRelative(root, resolvedRestructurePath),
      shotDesignFinalPath: safeRelative(root, path.join(path.dirname(resolvedRestructurePath), "shot-design.final.md")),
    });
  }
  if (!versions.length) {
    return {
      mode: "single",
      defaultVersionId: null,
      versions: [{
        versionId: null,
        versionName: "默认方案",
        restructureFinalPath: safeRelative(root, rootRestructurePath),
        shotDesignFinalPath: safeRelative(root, resolveInsideRoot(root, shotDesignFinalPath) || path.join(rootDirname, "shot-design.final.md")),
      }],
    };
  }
  return {
    mode: "multi_version",
    defaultVersionId: versions.find((item) => item.versionId === "V2_conversion")?.versionId ?? versions[0]?.versionId ?? null,
    versions,
  };
}

function resolveVersionPath(root, baseDir, value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  if (path.isAbsolute(text) || /^[A-Za-z]:[\\/]/.test(text) || text.replaceAll("\\", "/").startsWith("Artifacts/")) {
    return resolveInsideRoot(root, text);
  }
  return resolveInsideRoot(root, path.resolve(baseDir, text));
}

async function validateStoryboardPlanVersions({ rootDir, plan }) {
  const root = path.resolve(rootDir);
  const missing = [];
  for (const version of Array.isArray(plan?.versions) ? plan.versions : []) {
    const restructurePath = resolveInsideRoot(root, version.restructureFinalPath);
    const shotDesignPath = resolveInsideRoot(root, version.shotDesignFinalPath);
    if (!restructurePath || !await pathExists(restructurePath)) {
      missing.push({ versionId: version.versionId ?? null, versionName: version.versionName ?? null, path: version.restructureFinalPath ?? null, kind: "restructureFinalPath" });
    }
    if (!shotDesignPath || !await pathExists(shotDesignPath)) {
      missing.push({ versionId: version.versionId ?? null, versionName: version.versionName ?? null, path: version.shotDesignFinalPath ?? null, kind: "shotDesignFinalPath" });
    }
  }
  return { ok: missing.length === 0, missing };
}

async function collectVersionCandidates({ root, rootDirname, text }) {
  const byId = new Map();
  const linkPattern = /\|\s*`?([A-Za-z0-9_.-]+)`?\s*\|\s*([^|]+?)\s*\|\s*\[?restructure\.final\.md\]?\(([^)]*versions\/([A-Za-z0-9_.-]+)\/restructure\.final\.md)\)/g;
  for (const match of text.matchAll(linkPattern)) {
    const versionId = normalizeVersionId(match[1]) || normalizeVersionId(match[4]);
    if (!versionId) continue;
    byId.set(versionId, {
      versionId,
      versionName: cleanMarkdownCell(match[2]) || versionId,
      restructureFinalPath: normalizeMarkdownPath(match[3]),
    });
  }
  const anyPathPattern = /versions\/([A-Za-z0-9_.-]+)\/restructure\.final\.md/g;
  for (const match of text.matchAll(anyPathPattern)) {
    const versionId = normalizeVersionId(match[1]);
    if (!versionId || byId.has(versionId)) continue;
    byId.set(versionId, {
      versionId,
      versionName: versionId,
      restructureFinalPath: `versions/${versionId}/restructure.final.md`,
    });
  }
  const versionsDir = path.join(rootDirname, "versions");
  try {
    const entries = await fs.readdir(versionsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const versionId = normalizeVersionId(entry.name);
      if (!versionId || byId.has(versionId)) continue;
      const candidatePath = path.join(versionsDir, entry.name, "restructure.final.md");
      if (!isInside(candidatePath, root) || !await pathExists(candidatePath)) continue;
      byId.set(versionId, {
        versionId,
        versionName: versionId,
        restructureFinalPath: path.relative(rootDirname, candidatePath).replaceAll(path.sep, "/"),
      });
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  return Array.from(byId.values()).sort((a, b) => a.versionId.localeCompare(b.versionId, undefined, { numeric: true }));
}

function normalizeMarkdownPath(value) {
  const text = String(value ?? "").trim().replace(/^<|>$/g, "");
  const windows = /^\/?([A-Za-z]:\/.*)$/u.exec(text);
  const normalized = (windows?.[1] ?? text).replaceAll("\\", "/");
  const artifactIndex = normalized.indexOf("/Artifacts/");
  if (artifactIndex >= 0) return normalized.slice(artifactIndex + 1);
  if (normalized.startsWith("Artifacts/")) return normalized;
  return normalized;
}

function cleanMarkdownCell(value) {
  return String(value ?? "")
    .replace(/\[[^\]]*\]\([^)]+\)/g, "")
    .replace(/`/g, "")
    .trim();
}

function normalizeVersionId(value) {
  const text = String(value ?? "").trim();
  return /^[A-Za-z0-9_.-]+$/.test(text) ? text : null;
}

async function readTextIfExists(filePath) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return "";
    throw error;
  }
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function resolveInsideRoot(rootDir, value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const resolved = path.isAbsolute(text) || /^[A-Za-z]:[\\/]/.test(text)
    ? path.resolve(text)
    : path.resolve(rootDir, text);
  return isInside(resolved, rootDir) ? resolved : null;
}

function isInside(filePath, rootDir) {
  const resolved = path.resolve(filePath);
  const root = path.resolve(rootDir);
  return resolved === root || resolved.startsWith(`${root}${path.sep}`);
}

function safeRelative(rootDir, filePath) {
  return filePath ? path.relative(rootDir, path.resolve(filePath)).replaceAll(path.sep, "/") : null;
}

module.exports = {
  resolveStoryboardPlanVersions,
  validateStoryboardPlanVersions,
};
