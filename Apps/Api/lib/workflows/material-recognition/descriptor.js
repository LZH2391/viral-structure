const MATERIAL_RECOGNITION_WORKFLOW_DESCRIPTOR = {
  workflowId: "material-recognition",
  version: "material-recognition.v1",
  nodes: [
    { key: "upload", kind: "module", moduleId: "sample-ingest", blocking: true },
    { key: "shotBoundary", kind: "module", moduleId: "shot-boundary", after: ["upload"], rerunnable: true, blocking: true },
    { key: "aggregate", kind: "builtin", stageName: "workflow.aggregate", label: "汇总", artifactKey: "sampleVideo", after: ["shotBoundary"] },
  ],
  parallelGroups: {},
  aggregate: "aggregate",
};

module.exports = {
  MATERIAL_RECOGNITION_WORKFLOW_DESCRIPTOR,
};
