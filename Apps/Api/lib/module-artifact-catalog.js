const MODULE_ARTIFACTS = [
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
];

module.exports = {
  MODULE_ARTIFACTS,
};
