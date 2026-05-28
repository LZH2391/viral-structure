# 质量检查

在最终确定重组短视频方案前，使用这些检查。

## 语料库级检查

- 是否读取并披露了 `semantic-governance.v1.json` 的状态？
- `sourceSnapshot` 是否与当前 index/corpus 的 contentHash 对齐？
- 是否区分了治理层结论和证据层事实？
- 方案是否过度依赖单一源样例？
- 单样例规则是否被标记为弱规则，而不是普遍真理？
- 重复模式和推断假设是否被区分开？
- 借用 variant 时是否考虑了源视频、品类和风格？
- 稀疏 slot type 是否被披露？
- `needReviewMap / reviewItems / unmapped*Variants` 是否被纳入风险说明？

## 治理层检查

- 选中的槽位是否有匹配的 `slotSubtype / slotArchetype`？
- `slotSubtype.proofObligation` 是否被目标证明资产满足？
- `slotArchetype.primaryProofObligationClass` 是否没有被 adapter 改坏？
- `subtypeBoundary.mustNotChange` 是否被保留？
- script / rhythm / packaging atom pattern 是否分别检查，而不是被 script pattern 统领？
- pattern 的 `forSlotSubtypeIds` 是否覆盖当前 subtype？
- `implementationBundles` 是否只作为 retrieval prior，而不是固定 template？
- `observedChainPatterns` 是否只作为历史顺序/承接证据？
- candidate 治理项是否被明确标注为候选，而不是当成稳定规则？

## 链路级检查

- 所选槽位链是否匹配目标观众状态推进？
- 可选槽位是否被有意删除，而不是遗漏？
- 调整顺序后是否仍保留因果关系和证明归因？
- 合并槽位后是否仍携带全部必要证明功能？
- 插入槽位是否由目标需求支撑？

## 槽位级检查

对每个槽位检查：

- script atom 是否提出正确类型的主张？
- rhythm atom 是否适配信息负载？
- packaging atom 是否提供所需证明功能？
- 必要同步点是否存在？
- 替换是否是功能性替换，而不是装饰性替换？

## 绑定检查

优先检查治理层：

- `bindingPatterns`：具体关系约束是否匹配。
- `bindingPrinciples`：跨槽组合原则是否通过。
- `rulePatterns`：condition -> requirement -> violation -> fix 是否触发。
- `recompositionPolicies`：组合安全政策是否通过。

再检查证据层原始 bindings/rules。

### 同步 / Sync

相关主张、视觉证明和注意力拍点应对齐。

失败示例：动作已经结束后，动作文字才出现。

### 依赖 / Require

主张不应在缺少必要证明支持时出现。

失败示例：说某个机制有效，却没有图解、演示证据或简单解释。

### 承接 / Carryover

后续槽位应兑现前面槽位的对象、关切或承诺。

失败示例：开头展示具体 dashboard 错误，后面却展示一个没有回应该错误的泛化成功屏。

### 替换 / Substitute

表层样式可以改变，但功能必须保留。

失败示例：把结果近景换成好看的产品镜头，导致结果证明丢失。

### 冲突 / Conflict

避免不兼容的原子组合。

失败示例：用快速连击节奏承载高密度机制解释。

## 证明功能清单

- problem claim：可见的问题对象、关切或证据
- action claim：可见的行动路径或界面步骤
- mechanism claim：可理解的原因、图解、对比或过程证明
- operation claim：最少步骤和完成动作
- result claim：与前置关切绑定的结果证据
- benefit claim：生活/工作场景翻译
- trust claim：时间证据、重复证明、使用痕迹、证言、评价或使用日志
- choice close：具体对象、服务、CTA 或决策记忆点

## 常见修复动作

- 把高密度机制从 hook 移到稳定解释槽。
- 增加一个回到开头关切的结果槽。
- 给只有口头表达的主张增加证明载体。
- 用证明包装替换装饰包装。
- 对高信息量槽位使用更慢节奏。
- 只有在动作到结果的关系仍视觉连续时，才合并 operation 和 result。
- 如果信任收束过载，把它拆成时间证明和最终选择。
- 如果选中 variant 没有治理覆盖，换成同需求下有 subtype/pattern 支持的候选，或显式降级为 fallback。
- 如果 bundle 暗示完整链路但目标 brief 不需要其中某槽，删除该槽并检查 policy，而不是保留整套模板。
