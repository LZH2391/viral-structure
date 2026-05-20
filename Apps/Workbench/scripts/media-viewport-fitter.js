(function () {
  function fitMediaViewport(input) {
    const viewportWidth = positive(input.viewportWidth);
    const viewportHeight = positive(input.viewportHeight);
    const leftPanelWidth = nonNegative(input.leftPanelWidth);
    const rightPanelWidth = nonNegative(input.rightPanelWidth);
    const timelineHeight = nonNegative(input.timelineHeight);
    const mediaWidth = positive(input.mediaWidth, 16);
    const mediaHeight = positive(input.mediaHeight, 9);
    const stageWidth = Math.max(1, viewportWidth - leftPanelWidth - rightPanelWidth);
    const stageHeight = Math.max(1, viewportHeight - timelineHeight);
    const stageRatio = stageWidth / stageHeight;
    const mediaRatio = mediaWidth / mediaHeight;
    const contentWidth = mediaRatio > stageRatio ? stageWidth : stageHeight * mediaRatio;
    const contentHeight = mediaRatio > stageRatio ? stageWidth / mediaRatio : stageHeight;
    const horizontal = Math.max(0, (stageWidth - contentWidth) / 2);
    const vertical = Math.max(0, (stageHeight - contentHeight) / 2);
    return {
      stageWidth: round(stageWidth),
      stageHeight: round(stageHeight),
      contentWidth: round(contentWidth),
      contentHeight: round(contentHeight),
      letterboxInsets: {
        top: round(vertical),
        right: round(horizontal),
        bottom: round(vertical),
        left: round(horizontal),
      },
    };
  }

  function positive(value, fallback = 1) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : fallback;
  }

  function nonNegative(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : 0;
  }

  function round(value) {
    return Math.round(value * 100) / 100;
  }

  if (typeof module !== "undefined" && module.exports) module.exports = { fitMediaViewport };
  if (typeof window !== "undefined") window.WorkbenchMediaViewportFitter = { fitMediaViewport };
})();
