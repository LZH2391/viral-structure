(function () {
  const { createId } = window.WorkbenchState;

  function waitForVideoMetadata(video) {
    return new Promise((resolve, reject) => {
      if (Number.isFinite(video.duration) && video.duration > 0) {
        resolve();
        return;
      }
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error("视频元信息读取失败"));
    });
  }

  async function extractFrames(video, duration, parentArtifactId) {
    const canvas = document.createElement("canvas");
    const ratio = video.videoWidth && video.videoHeight ? video.videoWidth / video.videoHeight : 16 / 9;
    canvas.width = 192;
    canvas.height = Math.round(canvas.width / ratio);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    const count = Math.min(12, Math.max(4, Math.ceil(duration / 4)));
    const times = Array.from({ length: count }, (_, index) => {
      if (count === 1) return 0;
      return (duration * index) / (count - 1);
    });
    const frames = [];

    for (const time of times) {
      await seekVideo(video, Math.min(Math.max(time, 0), Math.max(duration - 0.1, 0)));
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      frames.push({
        id: createId("frame"),
        artifactId: createId("artifact"),
        parentArtifactId,
        time,
        thumbnail: canvas.toDataURL("image/jpeg", 0.74),
      });
    }
    await seekVideo(video, 0);
    return frames;
  }

  function seekVideo(video, time) {
    return new Promise((resolve, reject) => {
      const done = () => {
        video.removeEventListener("seeked", done);
        resolve();
      };
      video.addEventListener("seeked", done, { once: true });
      video.onerror = () => reject(new Error("视频定位失败"));
      video.currentTime = time;
    });
  }

  window.WorkbenchMedia = { waitForVideoMetadata, extractFrames };
})();
