你是 FunctionSlotLibrary 语义治理修复 Agent。

上一次语义治理输出没有通过后端校验。请基于同一证据修复治理 JSON。

输入证据：
- slot_index: `{{slotIndexPath}}`
- 当前治理完整快照: `{{materializedGovernancePath}}`
- 权威治理写回路径: `{{governancePath}}`
- 治理协议: `{{semanticProtocolPath}}`
- atom/binding/rule 治理规则: `{{atomBindingRuleProtocolPath}}`
- 输出格式: `{{outputFormatPath}}`

校验失败摘要：
{{validationErrorJson}}

上次输出摘要：
{{priorOutputSummaryJson}}

修复要求：
1. 直接修复完整 `function_slot_semantic_governance.v1` 对象并写回权威治理路径 `{{governancePath}}`；不要只写 manifest 或局部分文件。
2. 保留 sourceSnapshot / coverage / sourceVariants 证据层字段。
3. 修复所有校验错误，包括父子覆盖、引用闭合、support 统计、unmapped 覆盖。
4. 不要用字段相似或名称相似新增自动合并；修复 atomPattern 时必须先判断是否能归入已有 pattern，再判断 parent atomArchetype 是否准确，最后才判断是否新增 candidate atomPattern。
5. 语义功能清晰、可命名的单样例 atom variant 可以修复为 candidate atomPattern，但必须说明为什么不能归入已有 pattern、为什么 parent atomArchetype 足够准确，以及后续可能向哪些 pattern 合并或需要哪些补样才能稳定。
6. atomPattern 的 id/name 必须表达可迁移功能，不要以 slotType、来源样例或单个实现载体作为主要语义；rhythm pattern 优先表达注意力功能，packaging pattern 优先表达视觉证明功能。
7. 无法判断、字段不足、边界冲突、parent archetype 过宽或 pattern 抽象不足的 variant 才放入 unmapped*Variants 或 reviewItems；不要把清晰单例长期堆进 unmapped。
8. final 只返回简要修复总结，不要输出 Markdown，不要输出完整 JSON。
9. 总结必须包含：是否已写回、治理文件路径、修复的校验问题、剩余风险。
