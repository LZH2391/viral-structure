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

## 证据入口审查

```markdown
# slot_index 证据入口审查

## 来源
- sourceIndex：
- schemaVersion：
- createdAt：

## 证据覆盖
| 类型 | 数量 | 备注 |
|---|---:|---|
| samples |  |  |
| slotVariants |  |  |
| atomVariants |  |  |
| bindings |  |  |
| rules |  |  |
| templates |  |  |

## 优先治理入口
| topic | sourceVariantIds | 为什么需要 agent 审查 |
|---|---|---|

## 禁止自动归并提醒
- 不按字段一致归并。
- 不按文本相似归并。
- 不按 slotType 名称归并。
- 不让 script atom 归并结果带动 rhythm / packaging 归并。
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
| archetype | family | primaryProofObligationClass | chainDependencyClass | excludes | status | sourceVariantIds | 判断理由 |
|---|---|---|---|---|---|---|---|

## slotSubtypes
| subtype | archetype | subtypeBoundary | status | sourceSlotTypes | sourceVariantIds | 判断理由 | 误分风险 |
|---|---|---|---|---|---|---|---|

## atomArchetypes
| archetype | layer | status | sourcePatternIds | sourceVariantIds | 判断理由 | 误分风险 |
|---|---|---|---|---|---|---|

## atomPatterns
| pattern | layer | parentAtomArchetype | status | forSlotSubtypeIds | sourceVariantIds | 判断理由 |
|---|---|---|---|---|---|---|

## bindingPatterns
| pattern | type | status | sourceVariantIds | 关系约束 | 风险 |
|---|---|---|---|---|---|

## bindingPrinciples
| principle | status | sourcePatternIds | 判断理由 | 误分风险 |
|---|---|---|---|---|

## rulePatterns
| pattern | type | status | condition | requirement | violation | fix |
|---|---|---|---|---|---|---|

## recompositionPolicies
| policy | status | policyScope | sourceRulePatternIds | policy | 风险 |
|---|---|---|---|---|---|

## implementationBundles
| bundle | bundleType | useAs | notUseAs | sourceVariantIds | 风险 |
|---|---|---|---|---|---|

## observedChainPatterns
| chain | sequence | useAs | notUseAs | sourceVariantIds | 风险 |
|---|---|---|---|---|---|

## needReviewMap
| variantId | variantKind | affectedNodes | reviewReason |
|---|---|---|---|

## unmappedVariants
| type | variantId | reason | suggestedAction |
|---|---|---|---|

## reviewItems
| severity | topic | sourceVariantIds | 问题 | 建议 |
|---|---|---|---|---|

## openQuestions
- ...
```

治理审查必须写清楚判断依据和来源 variant。不要只列 slotType 名称。
