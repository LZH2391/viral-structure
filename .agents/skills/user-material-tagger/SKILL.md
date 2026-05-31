---
name: user-material-tagger
description: 将用户上传视频的 shot-boundary 切镜结果转成可供 function-slot-restructure 消费的 user-material-pack。用于需要镜头分类、商品/人物/场景识别、素材能力标签、证明能力判断、开头/中段/结尾候选推荐、素材缺口和使用限制分析时；不做样例结构原子化、不决定最终槽位链、不筛选娱乐化高光片段、不生成新脚本。
---

# SKILL: 用户素材打标签

你负责把用户上传视频的切镜结果转成 `user-material-pack`。这个产物是“素材供给侧证据”，供 `function-slot-restructure` 判断目标槽位链和 atoms 能否被用户真实素材支撑。

一句话边界：

> shot 是素材单位，标签是素材能力，槽位/原子是结构需求；你只描述供给，不替重组做最终结构决策。

## 何时读取 References

- 需要确认输出字段、JSON 结构或必填项时，读取 `references/output-contract.md`。
- 需要确认 `shotClass`、`shotFunctions`、`materialTags`、证明能力类型、质量枚举或推荐位置规则时，读取 `references/taxonomy.md`。
- 需要确认产物如何交给 `function-slot-restructure`、哪些字段会被下游消费、哪些误用必须避免时，读取 `references/restructure-handoff.md`。

## 输入

任务会提供一个 JSON 对象，通常包含：

- `sampleVideoId`
- `shotBoundaryAnalysis`
- `shots[]`
- 每个 shot 的 `shotId / shotNo / start / end / summary`
- 可能附带 `subtitleText / subtitleContextText / visualManifest / frame summaries / OCR / audio summary`
- 可选 `commerceBrief`，例如商品、品类、受众、使用场景、平台限制

只使用任务中提供的信息。不要读取无关文件，不要重新切镜头，不要推断未出现的商品效果、人物身份、品牌承诺或证明材料。

## 工作流

1. **通读 shots**
   - 按时间顺序理解视频素材库存。
   - 识别明显重复、过渡、低质、不可用镜头，但仍为每个输入 shot 输出 `shotCard`。

2. **建立 shot 素材卡**
   - 为每个 shot 判断 `shotClass`、`shotFunctions`、`detectedEntities`、`materialTags`、`quality`、`constraints`。
   - `detectedEntities` 只记录可见或由字幕/OCR明确支持的信息；无法确认则写空数组或 `unknown`。

3. **判断证明能力**
   - 为每个 shot 输出 `proofAffordances`，说明它能支撑哪些证明需求、强度如何、限制是什么。
   - 证明能力只看证据责任，不看镜头是否“好看”。

4. **推荐结构位置候选**
   - 输出 `openingCandidates / middleCandidates / endingCandidates`。
   - 推荐依据是结构位置适配，不是娱乐化高光、精彩程度或剪辑爆点。

5. **组合素材组**
   - 只在 shots 有明确连续性、共同对象或同一证明功能时输出 `materialGroups`。
   - 素材组不改变原始 shot 边界。

6. **汇总覆盖与缺口**
   - 输出完整 `proofCoverage`，即使某类证明能力为 `missing`。
   - 写清 `safeUsage` 和 `gapAdvice`，避免下游把弱素材包装成强证明。

7. **输出重组输入摘要**
   - `restructureInputSummary` 要压缩成给重组 skill 看的结论：强素材区、弱素材区、缺失区、推荐用法、禁止误用、需要重组注意的点。

## 输出

只返回一个 JSON object，不输出 Markdown，不输出 JSON 外解释。

输出类型固定为：

```json
{
  "type": "user-material-pack",
  "schemaVersion": "user-material-pack.stable"
}
```

完整结构见 `references/output-contract.md`。

## 核心规则

- `shotCards` 必须按原 shot 时间顺序输出。
- 每个输入 shot 都必须有一个 `shotCard`，低质或无关镜头也要标明原因。
- 标签必须来自素材能力，不来自目标槽位名称。
- 不把 shot 直接标成最终槽位。
- 不替 `function-slot-restructure` 选择 slotSubtype、slotArchetype 或 atoms。
- 不生成新脚本、新分镜、新视频方案。
- 不筛选“高光片段”，不输出娱乐化、情绪化或剪辑导向的 highlight list。
- 不把视觉吸引力当作证明能力。
- 不编造未出现的商品功效、人物身份、使用结果、数据、评价或资质。
- 不粘贴长段字幕、OCR 或隐私内容；只写安全摘要。
- 不修改 shot 边界，不要求重新切镜。
- 如果信息不足，输出 `unknown`、空数组或 `needReview: true`，不要猜。
