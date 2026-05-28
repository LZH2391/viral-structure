# slotType 与槽位治理审查

用于基于 `slot_index.json` 审查 `slotType` 与 family/archetype/subtype 的关系。

## 基本原则

不要只看名称是否相同。

先比较：

- `viewerStateBefore`
- `viewerStateAfter`
- `persuasionTask`
- script atom 的 `claimType`
- script atom 的 `proofNeed`
- packaging atom 的 `packagingFunction`
- bindings/rules 中的承接和证明要求
- rhythm function
- chain dependency

`slotTypeSupport` 只能回答“同名出现几次”，不能回答“功能是否同类”。功能同类必须由 agent 根据证据层判断。

## 同一 subtype 时可复用 slotType

满足以下情况时优先复用：

- 观众状态跃迁相近
- 说服任务相近
- 所需证明功能相近
- 包装功能相近
- 差异主要是品类对象、表达方式或素材载体

复用不是脚本决策，必须由 agent 写明 `sourceVariantIds`、判断理由和误分风险。

## 不同 subtype 时新增或保留 slotType

满足以下情况时可以新增：

- 观众状态跃迁不同
- 说服任务不同
- 在链路中的角色不同
- 证明功能不同
- 与已有类型混用会造成检索误判

已有 `slotType` 如果已经表达了不同 subtype，也可以保留，不必为了统一命名强行合并。

## 挂父级而不合并

当两个 slot 的高层任务相近，但证明机制不同，不要强行复用同一 `slotType`。应挂到同一 archetype 或 family 下，并保留不同 subtype。

判断：

- 同 family：高层说服任务相近。
- 同 archetype：观众状态迁移和核心任务相近。
- 不同 subtype：证明义务、方案出现时机、节奏或包装证明方式不同。

例：`problem_activation` 和 `scene_problem_activation` 可以同属需求激活 archetype，但不要合并为同 subtype。

## 禁止项

- 不要按 `slotType` 名称相似自动合并。
- 不要按字段完全一致自动合并。
- 不要按文本相似度自动合并。
- 不要让 script atom 的归并结果决定 slot subtype。

## 输出要求

每个保留、复用、新增或挂父级建议都要写：

- 来源 `variantId`。
- 支持证据。
- 差异点。
- 推荐治理层级。
- 误分风险。
