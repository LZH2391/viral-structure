# 给 function-slot-restructure / function-slot-shot-design 的交接规则

`user-material-pack.stable` 是素材供给侧证据，不是结构方案，也不是 Shot 设计方案。

- `function-slot-restructure` 用它判断素材供给类型、最佳成片路径、证明边界和结构级素材风险。
- `function-slot-shot-design` 用它判断每个已确认 slot 最终用现有素材、包装/字幕强化、自行设计、回重组，还是复用变形兜底。

## 下游消费字段

- `semanticDictionaries`：实体、所需支持、限制/缺口/安全边界字典。下游展示或推理前必须展开 `*Refs`。
- `shotCards`：逐镜头素材卡，说明每个 shot 的素材形态、功能标签、实体引用、质量、位置适配。
- `materialGroups`：可连续取材的素材组，例如商品展示组、过程组、结果组、桥接组。
- `proofCoverage`：对全部 proofNeedClass 的覆盖判断，是下游判断主张能否成立的关键字段。
- `sequenceRecommendations`：开头、中段、结尾候选，只表示位置适配，不表示最终成片顺序。
- `globalConstraintRefs`：全局不可误用边界引用。
- `restructureInputSummary`：素材强项、弱项、缺口和重组/shotDesign 注意事项，其中禁用边界和重组注意使用 `*Refs`。

## Ref 展开规则

- `E_` 引用从 `semanticDictionaries.entityDict` 展开。
- `SUP_` 引用从 `semanticDictionaries.supportDict` 展开。
- `G_` 引用从 `semanticDictionaries.guardrailDict` 展开。
- 如果下游遇到裸自然语言，允许直接使用；但新产物应优先使用引用。
- `semanticDictionaries` 只减少重复表达，不改变素材能力、证明边界或字段含义。

## 必须写清“不适合做什么”

下游最容易犯错的是把“有画面”误当成“有证明”，或把“输入顺序”误当成“新视频顺序”。因此相关字段要尽量写清：

- `proofCoverage.safeUsageRefs`
- `proofCoverage.gapAdviceRefs`
- `materialGroups.notUsableForProofNeedClasses`
- `shotCards[].proofAffordances[].limitRefs`
- `sequenceRecommendations.*[].doNotUseAs`
- `restructureInputSummary.doNotUseForRefs`

常见边界：

- 有使用动作但无结果，不可写成强 `result_evidence`。
- 有产品露出但无评价、记录或资质，不可写成 `trust_evidence`。
- 有人物反应但无因果证据，不可支撑强效果主张。
- 有结果画面但缺少前态，不可单独承担对比证明。
- 有字幕主张但画面没有对应证据，只能标记限制或弱证明。
- 有视觉吸引力但无证明能力，只能帮助 `attention_entry`，不能提高证明强度。

## 与槽位/原子/Shot 设计的关系

- 标签不是槽位。
- shot 不是原子。
- `proofNeedClass` 是连接素材供给和 atoms proof need 的中间层。
- `sequenceRecommendations` 是位置适配，不是最终槽位链，也不是最终成片顺序。
- `materialGroups` 是可取材组合，不是新视频 shot 设计。
- `shotCards` 必须保持原始输入顺序，但下游重组会按说服逻辑选择成片顺序；该顺序可以重排，也可以合理沿用输入顺序。

## 禁止替下游决策

不要输出：

- 最终 slotSubtype、slotArchetype 或 slotChain。
- script/rhythm/packaging atom 选择。
- 新脚本、新分镜、新视频结构。
- “这个 shot 必须用于某槽位”。
- “这个 slot 必须自行设计 / 包装字幕 / 复用”。
- 复用镜头的裁切、放大、冻结帧、变速等具体变形方案。

可以输出：

- “适合开头候选，因为能快速建立商品对象”。
- “适合中段过程演示，但不能作为结果证明”。
- “结果证明缺失，强效果主张需降级或补真实证据”。
- “该组有连续性，可供下游整体取材”。

## 骨架边界

运行时会提供 compact `output-skeleton.json`。骨架只保证结构完整和 shot 事实字段准确：

- `shotRef / shotNo / timeRange / visualSummary`
- `type / schemaVersion / sampleVideoId / sourceArtifacts`
- 空 `semanticDictionaries`
- 全部 proofNeedClass 的空 `proofCoverage` 条目

这些不是语义判断。你必须补全真正的标签、素材组、证明覆盖和缺口引用。
