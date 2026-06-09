请基于已完成的槽位方案和用户素材包生成“结构槽位素材缺口矩阵” JSON。

输入：
- restructureFinalPath: `{{restructureFinalPath}}`
- displayJsonPath: `{{displayJsonPath}}`
- materialPackPath: `{{materialPackPath}}`
- outputJsonPath: `{{outputJsonPath}}`
- artifactId: `{{artifactId}}`
- parentArtifactId: `{{parentArtifactId}}`
- sourceTurnId: `{{sourceTurnId}}`
- stageName: `{{stageName}}`
- slotAtomDisplayJson: {{slotAtomDisplayJson}}
- materialPackSummaryJson: {{materialPackSummaryJson}}

要求：
- 只返回 JSON object，不要 Markdown，不要解释。
- 同时把完整 JSON 写入 `{{outputJsonPath}}`。
- 不修改 restructureFinalPath、displayJsonPath、materialPackPath。
- 不生成 Shot 表、台词、分镜、时间轴或最终包装方案。
- `schemaVersion` 固定为 `material_gap_matrix.v1`。
- `status` 固定为 `processed`，除非输入无法读取或无法判断。
- `sourceRestructurePath` 使用输入的 restructureFinalPath。
- `sourceMaterialPackArtifactId` 优先使用 materialPackSummaryJson 中的 artifactId。
- `slotChainFingerprint` 可用 displayJsonPath 或 slotAtomDisplayJson 中的 fileFingerprint 摘要。
- `rows` 必须按槽位顺序输出。
- 每个槽位都必须判断是否直接满足当前素材；如果该槽位不需要某种典型镜头，不要硬写缺口。
- 必须显式覆盖这些典型缺口类别：`opening_hook_shot`、`product_closeup_shot`、`usage_process_shot`、`comparison_shot`、`ending_cta_shot`。它们可以出现在 `requiredMaterialTypes`、`missingMaterialTypes`，或通过 `directSatisfaction: "not_required"` 说明该槽位不承担此类需求。
- `directSatisfaction` 只能是：`satisfied`、`partial`、`missing`、`unsafe`、`not_required`。
- `suggestedCompensationTypes` 只能用：`structure_reorder`、`copy_or_caption_fill`、`packaging_overlay_fill`、`aigc_generate_fill`、`reuse_transform_fill`、`real_proof_reshoot_or_self_design`、`return_to_restructure_required`。
- `impact` 要说明对开头吸引、商品识别、过程证明、对比证明或 CTA 收束的具体影响。
- `handoffToShotDesign` 只写交接方向，不写最终镜头、台词、时长或剪法。

输出 JSON 形状：
{
  "schemaVersion": "material_gap_matrix.v1",
  "status": "processed",
  "sourceRestructurePath": "...",
  "sourceMaterialPackArtifactId": "...",
  "slotChainFingerprint": {},
  "summary": {
    "slotCount": 0,
    "satisfiedCount": 0,
    "partialCount": 0,
    "missingCount": 0,
    "unsafeCount": 0,
    "notRequiredCount": 0,
    "topMissingMaterialTypes": [],
    "overallImpact": ""
  },
  "rows": [
    {
      "slotId": "",
      "slotSubtype": "",
      "slotFunction": "",
      "requiredMaterialTypes": [],
      "directSatisfaction": "missing",
      "missingMaterialTypes": [],
      "impact": "",
      "availableEvidenceRefs": [],
      "suggestedCompensationTypes": [],
      "handoffToShotDesign": ""
    }
  ]
}
