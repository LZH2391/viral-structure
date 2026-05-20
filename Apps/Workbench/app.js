(function () {
  const els = window.WorkbenchDom.collectElements();
  const runtime = { els };
  window.WorkbenchRuntime = runtime;

  const actionsRef = {};
  const renderer = window.WorkbenchRender.createRenderer(els, {
    selectFrame: (frameId) => actionsRef.current.selectFrame(frameId),
    selectSegment: (segmentId) => actionsRef.current.selectSegment(segmentId),
  });
  const observability = window.WorkbenchObservability.createObservability(renderer);
  const versioning = window.WorkbenchVersioning.createVersionStore(els, renderer.renderVersions);
  const actions = window.WorkbenchWorkflow.createWorkflow(els, renderer, observability, versioning);

  actionsRef.current = actions;
  Object.assign(runtime, { renderer, observability, versioning, actions });
  window.WorkbenchEvents.bindEvents(els, actions, renderer);
  renderer.renderAll();
})();
