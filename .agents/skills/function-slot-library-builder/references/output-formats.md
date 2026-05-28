# 输出格式

## 语料库审查

```markdown
# FunctionSlotLibrary 审查

## 范围
- 样例数：
- slot variants：
- atom variants：
- bindings：
- rules：
- templates：

## 校验结果
- ok：
- errors：
- warnings：

## slotType 覆盖
| slotType | support | 备注 |
|---|---:|---|

## 链路模式
| sequence | support |
|---|---:|

## 问题
| 严重度 | 问题 | 位置 | 建议 |
|---|---|---|---|

## 下一步
...
```

## 槽位相似检索

```markdown
# 槽位相似检索

## 查询目标
...

## 候选槽位
| 候选 | 来源 | 相似原因 | 差异 | 建议 |
|---|---|---|---|---|

## slotType 建议
- 复用：
- 新增：
- 需要 review：
```

## 语义治理审查

```markdown
# FunctionSlotLibrary 语义治理审查

## 证据范围
- sourceIndex：
- 样例数：
- slot variants：
- atom variants：
- bindings：
- rules：
- templates：

## slotFamilies
| family | status | support | 判断理由 | 风险 |
|---|---|---:|---|---|

## slotArchetypes
| archetype | family | status | sourceVariantIds | 判断理由 | 差异点 |
|---|---|---|---|---|---|

## slotSubtypes
| subtype | archetype | status | sourceSlotTypes | sourceVariantIds | 判断理由 | 误分风险 |
|---|---|---|---|---|---|---|

## atomPatterns
| pattern | layer | status | forSlotSubtype | sourceVariantIds | 判断理由 |
|---|---|---|---|---|---|

## bindingPatterns
| pattern | type | status | sourceVariantIds | 关系约束 | 风险 |
|---|---|---|---|---|---|

## rulePatterns
| pattern | type | status | condition | requirement | violation | fix |
|---|---|---|---|---|---|---|

## reviewItems
| severity | topic | sourceVariantIds | 问题 | 建议 |
|---|---|---|---|---|

## openQuestions
- ...
```

治理审查必须写清楚判断依据和来源 variant。不要只列 slotType 名称。
