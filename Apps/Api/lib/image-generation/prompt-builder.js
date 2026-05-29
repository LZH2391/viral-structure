function buildImagePrompt({ prompt, storyboard, groupId, selectedShots = [] } = {}) {
  const directPrompt = String(prompt ?? "").trim();
  if (directPrompt) {
    return {
      prompt: directPrompt,
      inputSummary: {
        mode: "direct",
        promptChars: directPrompt.length,
        groupId: groupId ?? null,
        selectedShotCount: selectedShots.length,
      },
    };
  }
  const storyboardPrompt = buildStoryboardPrompt(storyboard, groupId, selectedShots);
  return {
    prompt: storyboardPrompt,
    inputSummary: {
      mode: "storyboard",
      promptChars: storyboardPrompt.length,
      groupId: groupId ?? null,
      selectedShotCount: selectedShots.length,
    },
  };
}

function buildStoryboardPrompt(storyboard, groupId, selectedShots = []) {
  if (!storyboard || typeof storyboard !== "object") {
    throw imagePromptError("image_prompt_missing", "缺少生图 prompt");
  }
  const shots = Array.isArray(storyboard.shots) ? storyboard.shots : [];
  const selected = new Set(selectedShots.map((item) => String(item)));
  const lines = ["以故事板呈现以下镜头，比例为16:9"];
  for (const shot of shots) {
    const shotId = String(shot.shotId ?? shot.id ?? shot.shotNo ?? "").trim();
    if (selected.size && !selected.has(shotId) && !selected.has(String(shot.index ?? ""))) continue;
    const shotPrompt = String(shot.prompt ?? shot.positivePrompt ?? shot.imagePrompt ?? "").trim();
    if (!shotPrompt) continue;
    lines.push(`镜头${shotId || lines.length}：${shotPrompt}`);
  }
  if (lines.length === 1) {
    throw imagePromptError("image_prompt_missing", "未找到可用的镜头生图提示词", { groupId: groupId ?? null, selectedShotCount: selectedShots.length });
  }
  return lines.join("\n");
}

function imagePromptError(code, message, debugPayload = null) {
  const error = new Error(message);
  error.code = code;
  error.debugPayload = debugPayload;
  error.retryable = false;
  return error;
}

module.exports = {
  buildImagePrompt,
  imagePromptError,
};
