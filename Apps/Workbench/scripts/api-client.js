(function () {
  const API_BASE_URL = location.protocol.startsWith("http") ? location.origin : "http://127.0.0.1:5177";
  const WORKSPACE_ID = "default-workspace";

  async function uploadSampleVideo(file, options = {}) {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("frameSampleRateFps", String(options.frameSampleRateFps ?? 0.25));
    const response = await fetch(`${API_BASE_URL}/api/workspaces/${WORKSPACE_ID}/sample-videos`, {
      method: "POST",
      body: formData,
    });
    return readJson(response);
  }

  async function getProcessingJob(jobId) {
    return readJson(await fetch(`${API_BASE_URL}/api/processing-jobs/${jobId}`));
  }

  async function getSampleArtifact(sampleVideoId) {
    return readJson(await fetch(`${API_BASE_URL}/api/sample-videos/${sampleVideoId}/artifact`));
  }

  function runtimeUrl(uri) {
    if (!uri) return null;
    return `${API_BASE_URL}${uri}`;
  }

  async function readJson(response) {
    const json = await response.json();
    if (!response.ok) throw new Error(json.message || json.error || "API 请求失败");
    return json;
  }

  window.WorkbenchApiClient = {
    API_BASE_URL,
    uploadSampleVideo,
    getProcessingJob,
    getSampleArtifact,
    runtimeUrl,
  };
})();
