(function () {
  const { createId } = window.WorkbenchState;

  const PROMPT_TEMPLATE_VERSION = "workbench.transfer.v1";

  function createGeneratedPlan(profile, structureCards, parentArtifactId) {
    const generatedArtifactId = createId("artifact");
    const generatedPlan = {
      id: createId("generated"),
      artifactId: generatedArtifactId,
      parentArtifactId,
      title: `${profile.topic} 结构迁移方案`,
      coverTitle: `${profile.topic}：先给结果，再给理由`,
      shots: structureCards.map((card) => ({
        id: createId("shot"),
        sourceStructureId: card.id,
        start: card.start,
        end: card.end,
        beat: card.name,
        script: makeScriptLine(card, profile),
        subtitle: makeSubtitleLine(card, profile),
        camera: makeCameraLine(card),
      })),
    };
    const mappings = generatedPlan.shots.map((shot) => {
      const source = structureCards.find((item) => item.id === shot.sourceStructureId);
      return {
        id: createId("mapping"),
        sourceName: source?.name ?? "样例结构",
        targetName: shot.beat,
        sourceArtifactId: source?.artifactId ?? parentArtifactId,
        targetArtifactId: generatedArtifactId,
        explanation: `${source?.name ?? "结构"} 的节奏功能迁移为 ${profile.topic} 的内容表达`,
      };
    });
    return { generatedPlan, mappings, generatedArtifactId };
  }

  function makeScriptLine(card, profile) {
    const lines = {
      "开头 hook": `先抛出 ${profile.topic} 的高价值结果，让 ${profile.audience} 在第一秒知道为什么要看。`,
      "卖点推进": `围绕 ${profile.sellingPoints} 做连续解释，每个信息点都对应一个可见画面。`,
      "场景证明": `把 ${profile.topic} 放到 ${profile.platform} 的真实使用场景里，降低理解成本。`,
      "结尾转化": `用 ${profile.tone} 的语气收束，给出下一步行动和封面记忆点。`,
    };
    return lines[card.name] ?? `${card.name} 迁移到 ${profile.topic}`;
  }

  function makeSubtitleLine(card, profile) {
    if (card.name === "开头 hook") return `别先讲原理，先看 ${profile.topic} 的结果`;
    if (card.name === "结尾转化") return `${profile.topic} 的关键，是把价值讲得更快`;
    return `${profile.sellingPoints}`;
  }

  function makeCameraLine(card) {
    const lines = {
      "开头 hook": "快切结果画面，字幕前置。",
      "卖点推进": "中近景交替，保留节奏停顿。",
      "场景证明": "场景全景切到细节特写。",
      "结尾转化": "回到核心画面，封面标题同步出现。",
    };
    return lines[card.name] ?? "跟随结构节奏切换画面。";
  }

  window.WorkbenchTransferStrategy = { PROMPT_TEMPLATE_VERSION, createGeneratedPlan };
})();
