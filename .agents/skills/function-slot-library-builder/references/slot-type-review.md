# slotType 命名审查

用于判断新槽位应复用已有 `slotType`，还是新增更明确的 `slotType`。

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

## 复用已有 slotType

满足以下情况时优先复用：

- 观众状态跃迁相近
- 说服任务相近
- 所需证明功能相近
- 包装功能相近
- 差异主要是品类对象、表达方式或素材载体

## 新增 slotType

满足以下情况时可以新增：

- 观众状态跃迁不同
- 说服任务不同
- 在链路中的角色不同
- 证明功能不同
- 与已有类型混用会造成检索误判

## 注意

`slotTypeSupport` 目前是精确名称统计。

```text
problem_activation
scene_problem_activation
```

会被统计成两个不同类型。它只能回答“同名出现几次”，不能回答“功能是否同类”。

功能同类需要相似查询和人工 review。
