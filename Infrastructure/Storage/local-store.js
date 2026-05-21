const fs = require("fs/promises");
const path = require("path");

function createLocalStore(rootDir) {
  const runtimeRoot = path.join(rootDir, "Runtime");

  async function ensureRuntimeDirs() {
    await Promise.all([
      fs.mkdir(path.join(runtimeRoot, "Uploads"), { recursive: true }),
      fs.mkdir(path.join(runtimeRoot, "Artifacts"), { recursive: true }),
      fs.mkdir(path.join(runtimeRoot, "ArtifactIndex"), { recursive: true }),
      fs.mkdir(path.join(runtimeRoot, "DebugSnapshots"), { recursive: true }),
      fs.mkdir(path.join(runtimeRoot, "Temp"), { recursive: true }),
    ]);
  }

  function sampleDir(sampleVideoId) {
    return path.join(runtimeRoot, "Artifacts", sampleVideoId);
  }

  async function ensureSampleDirs(sampleVideoId) {
    const dir = sampleDir(sampleVideoId);
    await Promise.all([
      fs.mkdir(dir, { recursive: true }),
      fs.mkdir(path.join(dir, "frames"), { recursive: true }),
    ]);
    return dir;
  }

  async function writeJson(filePath, value) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
  }

  async function readJson(filePath) {
    const content = await fs.readFile(filePath, "utf8");
    return JSON.parse(content);
  }

  function runtimeUri(filePath) {
    const relative = path.relative(runtimeRoot, filePath).split(path.sep).join("/");
    return `/runtime/${relative}`;
  }

  return {
    runtimeRoot,
    ensureRuntimeDirs,
    sampleDir,
    ensureSampleDirs,
    writeJson,
    readJson,
    runtimeUri,
  };
}

module.exports = { createLocalStore };
