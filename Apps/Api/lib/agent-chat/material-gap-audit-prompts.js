function renderMaterialGapAuditPrompt({ promptTemplateVersion }) {
  return {
    promptTemplateId: "internalMaterialGapAudit",
    promptTemplateVersion,
    text: [
      "你是当前 function-slot-restructure 会话内部 fork 出的只读旁路审计 turn。",
      "基于当前上下文中已完成的重组槽位方案和当前用户素材包，生成“结构槽位素材缺口矩阵” JSON。",
      "",
      "硬性边界：",
      "- 只返回 JSON object，不要 Markdown，不要解释。",
      "- 不修改任何重组方案、展示 JSON 或素材包文件。",
      "- 不生成 Shot 表、台词、分镜、时间轴或最终包装方案。",
      "- 不改变、不删除、不重排重组槽位链。",
      "- 这是 advisory-only 旁路审计，主重组方案不会消费你的结果。",
      "",
      "字段要求：",
      "- schemaVersion 固定为 material_gap_matrix.v1。",
      "- status 固定为 processed，除非输入无法读取或无法判断。",
      "- sourceRestructurePath 使用当前重组方案来源，未知可留空。",
      "- sourceMaterialPackArtifactId 使用当前素材包 artifactId，未知可留空。",
      "- rows 必须按槽位顺序输出。",
      "- 每个槽位都必须判断当前素材能否直接满足该槽位的画面/证明需要。",
      "- directSatisfaction 只能是 satisfied、partial、missing、unsafe、not_required。",
      "- 当 directSatisfaction 是 partial、missing 或 unsafe 时，missingMaterialTypes 必须至少包含 1 个枚举值。",
      "- missingMaterialTypes 只能使用：opening_hook_shot、product_closeup_shot、usage_process_shot、comparison_shot、ending_cta_shot、material_capability_insufficient、critical_material_missing、material_usage_risk。",
      "- 如果无法判断具体镜头类型：partial 用 material_capability_insufficient，missing 用 critical_material_missing，unsafe 用 material_usage_risk。",
      "",
      "输出 JSON 形状：",
      JSON.stringify({
        schemaVersion: "material_gap_matrix.v1",
        status: "processed",
        sourceRestructurePath: "",
        sourceMaterialPackArtifactId: "",
        slotChainFingerprint: {},
        summary: {
          slotCount: 0,
          satisfiedCount: 0,
          partialCount: 0,
          missingCount: 0,
          unsafeCount: 0,
          notRequiredCount: 0,
          topMissingMaterialTypes: [],
          overallImpact: "",
        },
        rows: [{
          slotId: "",
          slotSubtype: "",
          slotFunction: "",
          requiredMaterialTypes: [],
          directSatisfaction: "missing",
          missingMaterialTypes: [],
          impact: "",
          availableEvidenceRefs: [],
          handoffToShotDesign: "",
        }],
      }, null, 2),
    ].join("\n"),
  };
}

function renderMaterialGapRepairPrompt({
  priorMatrix,
  validation,
  repairAttemptCount,
  promptTemplateVersion,
}) {
  return {
    promptTemplateId: "internalMaterialGapAuditRepair",
    promptTemplateVersion,
    text: [
      "上一轮素材缺口矩阵 JSON 未通过结构校验。请只修复 JSON，不要解释，不要 Markdown。",
      `repairAttemptCount: ${repairAttemptCount}`,
      "",
      "必须修复的问题：",
      JSON.stringify(validation.issues.map((issue) => ({
        code: issue.code,
        path: issue.path,
        message: issue.message,
      })), null, 2),
      "",
      "修复规则：",
      "- 保留原 rows 顺序和已有判断语义。",
      "- directSatisfaction 只能是 satisfied、partial、missing、unsafe、not_required。",
      "- directSatisfaction 为 partial、missing、unsafe 时，missingMaterialTypes 必须至少有 1 个枚举值。",
      "- missingMaterialTypes 只能使用：opening_hook_shot、product_closeup_shot、usage_process_shot、comparison_shot、ending_cta_shot、material_capability_insufficient、critical_material_missing、material_usage_risk。",
      "- 若无法从原文判断具体镜头类型：partial 用 material_capability_insufficient，missing 用 critical_material_missing，unsafe 用 material_usage_risk。",
      "- 重新计算 summary 计数和 topMissingMaterialTypes。",
      "",
      "待修复 JSON：",
      JSON.stringify(priorMatrix, null, 2),
    ].join("\n"),
  };
}

module.exports = {
  renderMaterialGapAuditPrompt,
  renderMaterialGapRepairPrompt,
};
