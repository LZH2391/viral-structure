const FULL_ANALYSIS_WORKFLOW_DESCRIPTOR = {
  workflowId: "full-analysis",
  version: "full-analysis.v1",
  nodes: [
    { key: "upload", kind: "module", moduleId: "sample-ingest", blocking: true },
    { key: "shotBoundary", kind: "module", moduleId: "shot-boundary", after: ["upload"], rerunnable: true, blocking: true },
    { key: "scriptSegment", kind: "module", moduleId: "script-segments", after: ["shotBoundary"], parallelGroup: "structure-analysis", rerunnable: true },
    { key: "rhythmStructure", kind: "module", moduleId: "rhythm-structure", after: ["shotBoundary"], parallelGroup: "structure-analysis", rerunnable: true },
    { key: "packagingStructure", kind: "module", moduleId: "packaging-structure", after: ["shotBoundary"], parallelGroup: "structure-analysis", rerunnable: true },
    { key: "aggregate", kind: "builtin", stageName: "workflow.aggregate", label: "汇总", artifactKey: "sampleVideo", after: ["structure-analysis"] },
  ],
  parallelGroups: {
    "structure-analysis": ["scriptSegment", "rhythmStructure", "packagingStructure"],
  },
  aggregate: "aggregate",
};

module.exports = {
  FULL_ANALYSIS_WORKFLOW_DESCRIPTOR,
};
