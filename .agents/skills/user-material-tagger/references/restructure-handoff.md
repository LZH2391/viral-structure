# 给 function-slot-restructure 的交接规则

`user-material-pack.stable` 是素材供给侧证据，不是结构方案。`function-slot-restructure` 会用它判断目标槽位链和 atoms 能否被用户真实素材支撑。

## 下游消费字段

- `shotCards`：逐镜头素材卡，说明每个 shot 的素材形态、功能标签、实体、质量、位置适配。
- `materialGroups`：可连续取材的素材组，例如商品展示组、过程组、结果组、桥接组。
- `proofCoverage`：对全部 proofNeedClass 的覆盖判断，是下游判断主张能否成立的关键字段。
- `sequenceRecommendations`：开头、中段、结尾候选，只表示位置适配。
- `restructureInputSummary`：素材强项、弱项、缺口和重组注意事项。

## 必须写清“不适合做什么”

重组最容易犯错的是把“有画面”误当成“有证明”。因此相关字段要尽量写清：

- `proofCoverage.safeUsage`
- `proofCoverage.gapAdvice`
- `materialGroups.notUsableForProofNeedClasses`
- `shotCards[].proofAffordances[].limits`
- `sequenceRecommendations.*[].doNotUseAs`
- `restructureInputSummary.doNotUseFor`

常见边界：

- 有使用动作但无结果，不可写成强 `result_evidence`。
- 有产品露出但无评价、记录或资质，不可写成 `trust_evidence`。
- 有人物反应但无因果证据，不可支撑强效果主张。
- 有结果画面但缺少前态，不可单独承担对比证明。
- 有字幕主张但画面没有对应证据，只能标记限制或弱证明。
- 有视觉吸引力但无证明能力，只能帮助 `attention_entry`，不能提高证明强度。

## 与槽位/原子的关系

- 标签不是槽位。
- shot 不是原子。
- `proofNeedClass` 是连接素材供给和 atoms proof need 的中间层。
- `sequenceRecommendations` 是位置适配，不是最终槽位链。
- `materialGroups` 是可取材组合，不是新视频 shot 设计。

## 禁止替下游决策

不要输出：

- 最终 slotSubtype、slotArchetype 或 slotChain。
- script/rhythm/packaging atom 选择。
- 新脚本、新分镜、新视频结构。
- “这个 shot 必须用于某槽位”。

可以输出：

- “适合开头候选，因为能快速建立商品对象”。
- “适合中段过程演示，但不能作为结果证明”。
- “结果证明缺失，重组时应降主张或提示补拍”。

## 骨架边界

运行时会提供 `output-skeleton.json`。骨架只保证结构完整和 shot 事实字段准确：

- `shotRef / shotNo / timeRange / visualSummary`
- `type / schemaVersion / sampleVideoId / sourceArtifacts`
- 全部 proofNeedClass 的空 `proofCoverage` 条目

这些不是语义判断。你必须补全真正的标签、素材组、证明覆盖和缺口判断。
