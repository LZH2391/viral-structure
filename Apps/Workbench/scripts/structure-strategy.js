(function () {
  const { createId } = window.WorkbenchState;

  function createStructureCards(sample) {
    if (!sample) return [];
    const duration = Math.max(sample.duration, 12);
    const segments = [
      ["开头 hook", 0, Math.min(duration * 0.18, 4), "用冲突或强结果建立停留理由"],
      ["卖点推进", duration * 0.18, duration * 0.48, "用连续证据解释价值"],
      ["场景证明", duration * 0.48, duration * 0.76, "把卖点放进真实使用场景"],
      ["结尾转化", duration * 0.76, duration, "给出行动理由和记忆点"],
    ];
    return segments.map(([name, start, end, explanation], index) => ({
      id: createId("structure"),
      artifactId: createId("artifact"),
      parentArtifactId: sample.artifactId,
      name,
      start,
      end,
      order: index + 1,
      explanation,
      transferableRule: `${name} 保留节奏功能，替换为新主题证据`,
    }));
  }

  window.WorkbenchStructureStrategy = { createStructureCards };
})();
