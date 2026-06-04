async function initializeServerRuntime({
  store,
  shotBoundaryService,
  activeTurnRuntime,
  rootDir,
} = {}) {
  await store.ensureRuntimeDirs();
  if (typeof shotBoundaryService.interruptActiveAgentRuns === "function") {
    await shotBoundaryService.interruptActiveAgentRuns("server-startup");
  } else {
    await shotBoundaryService.recoverActiveAgentRuns();
  }
  if (typeof activeTurnRuntime?.recoverActiveBindings === "function") {
    await activeTurnRuntime.recoverActiveBindings({
      workspaceRoot: rootDir,
      timeoutSeconds: 5,
    }).catch(() => undefined);
  }
}

module.exports = {
  initializeServerRuntime,
};
