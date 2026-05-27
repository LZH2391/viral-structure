你要根据 boundary reviewer 的审查结果，返工上一轮功能槽位原子化 JSON。

输入边界不变：
- 只使用 manifest 中提供的脚本段落、节奏结构、包装结构三份 final 结果摘要。
- 不重新切镜头，不重做脚本段落/节奏/包装分析，不生成新脚本。
- 本轮只处理 AtomCore / SourceTrace / Meta / Mixed 字段边界问题，尤其是 AtomCore 字段里的具体样例内容。
- 保持 outputContract.schema，不输出 schema、field_roles 或 role_rules。

输入摘要：
{{inputSummaryText}}

路径：
- manifestPath: {{manifestPath}}
- outputContractPath: {{outputContractPath}}

boundary review 结果：
{{boundaryReviewJson}}

上一轮 JSON：
```json
{{priorOutputText}}
```

这是第 {{reworkAttemptCount}} 次 boundary rework。请输出返工后的严格 JSON 对象，必须包含 atom_inventory、slot_map、binding_graph、conflict_checks、recombination_rules、recomposition_templates。

返工要求：
- 只改 reviewer issues 指向的边界问题，以及为了保持引用/结构一致所需的最小关联字段。
- AtomCore / AtomCore.Graph 字段必须抽象、可复用，不得写具体样例内容，如具体品类、产品、部位、动作、镜头、包装物或视觉资产名称。
- SourceTrace 可以保留具体 shot_refs 和上游 label。
- Meta / Meta.StructuralMeta 只写 id、置信度、复核状态或结构记账信息。
- Mixed 字段不强行清洗，但不能替代 AtomCore 表达结构功能。
- 保持 id 引用一致；slot_map、binding_graph、conflict_checks、recombination_rules 中的引用必须能指向当前输出内存在的结构 id。

只返回 JSON，不要 Markdown，不要解释 JSON 外的内容。
