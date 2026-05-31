# 给 function-slot-restructure 的交接规则

`user-material-pack` 是素材供给侧证据，不是结构方案。`function-slot-restructure` 会用它做素材约束判断。

## 下游消费字段

- `proofCoverage`：对照 script atom 的 `proofNeed`，判断目标主张是否有真实素材支撑。
- `shotCards.proofAffordances`：对照 packaging atom 的 `proofType`，判断包装证明是否有画面承载。
- `materialGroups`：寻找可连续落地的过程、证明、桥接或收束素材。
- `sequenceRecommendations`：判断候选素材是否适合开头、中段、结尾结构位置。
- `globalConstraints`：约束不能过度承诺、不能错配证明、不能把弱素材包装成强证明。
- `restructureInputSummary`：给重组 skill 的压缩入口，用于快速理解强素材区、弱素材区、缺失区、推荐用法和禁止误用。

## 必须写清“不适合做什么”

重组最容易犯错的是把“有画面”误当成“有证明”。因此每个相关 shot、group、coverage 都要尽量写 `limits / constraints / doNotUseAs / notUsableForProofNeedClasses`。

常见边界：

- 有使用动作但无结果，不可写成 `result_evidence`。
- 有产品露出但无评价、记录或资质，不可写成 `trust_evidence`。
- 有人物反应但无因果证据，不可支撑强效果主张。
- 有结果画面但缺少前态，不可单独承担对比证明。
- 有字幕主张但画面没有对应证据，只能标记 `needs_caption_context` 或 `claim_risk`。
- 有视觉吸引力但无证明能力，只能帮助 `attention_entry`，不能提高 `proofAffordances.strength`。

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

- “适合开头候选，因为能快速建立问题对象”。
- “适合中段过程演示，但不能作为结果证明”。
- “结果证明缺失，重组时应降主张或提示补拍”。

## 缺口表达

缺口要给下游可执行选择：

- `safeUsage`：现有素材能安全承担到什么程度。
- `gapAdvice`：如果目标结构需要更强证明，应降主张、换槽位、加 adapter、用字幕补语义、或提示补拍。
- `needsRestructureAttention`：把影响结构成立的风险放到摘要层。
