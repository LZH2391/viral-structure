const fs = require("fs");
const path = require("path");
const ts = require("typescript");

function allFilters() {
  return {
    slot: true,
    atom: true,
    binding: true,
    rule: true,
    bundle: true,
    unmapped: true,
    slotFamily: true,
    slotArchetype: true,
    slotSubtype: true,
    atomArchetype: true,
    atomPattern: true,
    sourceVariant: true,
  };
}

function distanceFromRoot(node, root) {
  return Math.hypot(node.x - root.x, (node.y - root.y) / (node.layoutYScale ?? 1));
}

function angularDistance(left, right) {
  const diff = Math.abs(left - right) % (Math.PI * 2);
  return Math.min(diff, Math.PI * 2 - diff);
}

function loadTsModule(relativePath) {
  const moduleCache = new Map();
  return loadTsModuleByPath(path.join(process.cwd(), relativePath), moduleCache);
}

function loadTsModuleByPath(sourcePath, moduleCache) {
  const normalizedPath = path.normalize(sourcePath);
  const cached = moduleCache.get(normalizedPath);
  if (cached) return cached.exports;

  const source = fs.readFileSync(sourcePath, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText;
  const module = { exports: {} };
  moduleCache.set(normalizedPath, module);
  const execute = new Function("module", "exports", "require", compiled);
  execute(module, module.exports, (specifier) => {
    if (specifier === "d3-force") {
      return {
        forceCenter: () => ({ strength: () => ({}) }),
        forceCollide: () => ({ radius: () => ({ strength: () => ({ iterations: () => ({}) }) }) }),
        forceLink: () => ({ id: () => ({ distance: () => ({ strength: () => ({}) }) }) }),
        forceManyBody: () => ({ strength: () => ({ distanceMin: () => ({ distanceMax: () => ({}) }) }) }),
        forceSimulation: () => ({ alpha: () => ({ alphaDecay: () => ({ velocityDecay: () => ({ force: () => ({ force: () => ({ force: () => ({ force: () => ({ force: () => ({}) }) }) }) }) }) }) }) }),
        forceX: () => ({ strength: () => ({}) }),
        forceY: () => ({ strength: () => ({}) }),
      };
    }
    if (specifier.startsWith(".")) {
      const resolved = resolveTsModulePath(path.dirname(sourcePath), specifier);
      return loadTsModuleByPath(resolved, moduleCache);
    }
    return {};
  });
  return module.exports;
}

function resolveTsModulePath(baseDir, specifier) {
  const basePath = path.resolve(baseDir, specifier);
  const candidates = [
    basePath,
    `${basePath}.ts`,
    `${basePath}.tsx`,
    path.join(basePath, "index.ts"),
  ];
  const resolved = candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
  if (!resolved) throw new Error(`Unable to resolve TS test module ${specifier} from ${baseDir}`);
  return resolved;
}

module.exports = {
  allFilters,
  angularDistance,
  distanceFromRoot,
  loadTsModule,
};
