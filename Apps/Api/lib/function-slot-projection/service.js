const path = require("path");
const { createFunctionSlotProjectionStore } = require("../../../../Infrastructure/FunctionSlotProjection/function-slot-projection-store");

function createFunctionSlotProjectionService({ store, projectionStore = null } = {}) {
  const activeProjectionStore = projectionStore ?? createFunctionSlotProjectionStore({ store });

  async function projectArtifact(artifact) {
    if (!artifact?.functionSlotAtomizationAnalysis) return null;
    return activeProjectionStore.projectArtifact(artifact);
  }

  async function projectSampleCurrentArtifact(sampleVideoId, { mode = "replace" } = {}) {
    const artifact = await store.readJson(path.join(store.sampleDir(sampleVideoId), "artifact.json")).catch(() => null);
    if (!artifact?.functionSlotAtomizationAnalysis?.artifactId) return null;
    const artifactId = artifact.functionSlotAtomizationAnalysis.artifactId;
    const existing = await activeProjectionStore.getArtifactProjectionSummary(artifactId);
    if (existing && mode === "skip-existing") {
      return {
        projected: false,
        skipped: true,
        existedBefore: true,
        ...existing,
      };
    }
    const summary = await activeProjectionStore.projectArtifact(artifact);
    return {
      projected: true,
      skipped: false,
      existedBefore: Boolean(existing),
      ...summary,
    };
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

  async function getArtifactProjectionSummary(artifactId) {
    return activeProjectionStore.getArtifactProjectionSummary(artifactId);
  }

  async function deleteArtifactProjection(artifactId) {
    return activeProjectionStore.deleteArtifactProjection(artifactId);
  }

  return {
    store: activeProjectionStore,
    projectArtifact,
    projectSampleCurrentArtifact,
    querySlots,
    queryAtoms,
    queryBindings,
    queryRules,
    getArtifactProjectionSummary,
    deleteArtifactProjection,
  };
}

module.exports = {
  createFunctionSlotProjectionService,
};
