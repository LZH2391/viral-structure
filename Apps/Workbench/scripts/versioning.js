(function () {
  const { state, createId } = window.WorkbenchState;

  function createVersionStore(els, renderVersions) {
    function addVersion(label, stageName, artifactId, parentArtifactId) {
      const version = {
        id: createId("version"),
        label,
        stageName,
        artifactId,
        parentArtifactId,
        createdAt: new Date().toLocaleString("zh-CN", { hour12: false }),
      };
      state.versions.unshift(version);
      state.workspace.currentVersionId = version.id;
      els.saveStatus.textContent = `已保存 ${label}`;
      renderVersions();
      return version;
    }

    return { addVersion };
  }

  window.WorkbenchVersioning = { createVersionStore };
})();
