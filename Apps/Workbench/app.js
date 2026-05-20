(function () {
  const els = window.WorkbenchDom.collectElements();
  const runtime = { els };
  window.WorkbenchRuntime = runtime;

  const actionsRef = {};
  const audioWaveform = window.WorkbenchAudioWaveform.createAudioWaveform(els);
  const renderer = window.WorkbenchRender.createRenderer(els, {
    selectFrame: (frameId) => actionsRef.current.selectFrame(frameId),
    selectVideoTrack: () => actionsRef.current.selectVideoTrack(),
    selectAudioTrack: () => actionsRef.current.selectAudioTrack(),
    selectSegment: (segmentId) => actionsRef.current.selectSegment(segmentId),
  }, audioWaveform);
  const draftStore = window.WorkbenchDraft.createWorkspaceDraft(els, renderer);
  const observability = window.WorkbenchObservability.createObservability(renderer);
  const versioning = window.WorkbenchVersioning.createVersionStore(els, renderer.renderVersions);
  const actions = window.WorkbenchWorkflow.createWorkflow(els, renderer, observability, versioning, draftStore);

  actionsRef.current = actions;
  Object.assign(runtime, { renderer, observability, versioning, actions, audioWaveform, draftStore });
  window.WorkbenchEvents.bindEvents(els, actions, renderer);
  if (!draftStore.restore()) renderer.renderAll();
})();
