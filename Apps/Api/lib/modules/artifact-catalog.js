const MODULE_ARTIFACTS = [
  {
    moduleId: "sample-ingest",
    cacheKind: "sample",
    artifactKey: "sampleVideo",
    getArtifact: (artifact) => artifact?.sampleVideo ?? null,
  },
  {
    moduleId: "shot-boundary",
    cacheKind: "shot_boundary",
    artifactKey: "shotBoundaryAnalysis",
    getArtifact: (artifact) => artifact?.shotBoundaryAnalysis ?? null,
  },
  {
    moduleId: "script-segments",
    cacheKind: "script_segment",
    artifactKey: "scriptSegmentAnalysis",
    getArtifact: (artifact) => artifact?.scriptSegmentAnalysis ?? null,
  },
  {
    moduleId: "rhythm-structure",
    cacheKind: "rhythm_structure",
    artifactKey: "rhythmStructureAnalysis",
    getArtifact: (artifact) => artifact?.rhythmStructureAnalysis ?? null,
  },
  {
    moduleId: "packaging-structure",
    cacheKind: "packaging_structure",
    artifactKey: "packagingStructureAnalysis",
    getArtifact: (artifact) => artifact?.packagingStructureAnalysis ?? null,
  },
  {
    moduleId: "function-slot-atomization",
    cacheKind: null,
    artifactKey: "functionSlotAtomizationAnalysis",
    getArtifact: (artifact) => artifact?.functionSlotAtomizationAnalysis ?? null,
  },
];

module.exports = {
  MODULE_ARTIFACTS,
};
