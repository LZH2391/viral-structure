const fs = require("fs/promises");
const path = require("path");
const { createFunctionSlotProjectionStore } = require("../../../../Infrastructure/FunctionSlotProjection/function-slot-projection-store");

function createFunctionSlotProjectionService({ store, projectionStore = null } = {}) {
  const activeProjectionStore = projectionStore ?? createFunctionSlotProjectionStore({ store });

  async function projectArtifact(artifact) {
    if (!artifact?.functionSlotAtomizationAnalysis) return null;
    return activeProjectionStore.projectArtifact(artifact);
  }

  async function querySlots(filters = {}) {
    return activeProjectionStore.querySlots(filters);
  }

  async function queryAtoms(filters = {}) {
    return activeProjectionStore.queryAtoms(filters);
  }

  async function queryBindings(filters = {}) {
    return activeProjectionStore.queryBindings(filters);
  }

  async function queryRules(filters = {}) {
    return activeProjectionStore.queryRules(filters);
  }

  async function rebuildFromRuntimeArtifacts() {
    await activeProjectionStore.clearAll();
    const artifactsRoot = path.join(store.runtimeRoot, "Artifacts");
    const sampleDirs = await fs.readdir(artifactsRoot, { withFileTypes: true }).catch(() => []);
    const summaries = [];
    for (const entry of sampleDirs) {
      if (!entry.isDirectory()) continue;
      const artifactPath = path.join(artifactsRoot, entry.name, "artifact.json");
      const artifact = await store.readJson(artifactPath).catch(() => null);
      if (!artifact?.functionSlotAtomizationAnalysis) continue;
      summaries.push(await activeProjectionStore.projectArtifact(artifact));
    }
    return {
      projectedArtifactCount: summaries.length,
      summaries,
    };
  }

  return {
    store: activeProjectionStore,
    projectArtifact,
    querySlots,
    queryAtoms,
    queryBindings,
    queryRules,
    rebuildFromRuntimeArtifacts,
  };
}

module.exports = {
  createFunctionSlotProjectionService,
};
