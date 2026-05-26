你要修复上一轮功能槽位原子化输出，使它符合相同 JSON 输出契约。

输入边界不变：
- 只使用 manifest 中提供的三份 final 结果摘要。
- 不重新切镜头，不重做脚本段落/节奏/包装分析，不生成新脚本。
- repair 只修输出结构和字段，不改变任务边界。

输入摘要：
{{inputSummaryText}}

路径：
- manifestPath: {{manifestPath}}
- outputContractPath: {{outputContractPath}}
- validation: {{validationPathText}}
- priorOutputSummary: {{priorOutputSummaryPathText}}

校验失败摘要：
{{validationJson}}

上次输出摘要：
{{priorOutputSummaryJson}}

这是第 {{repairAttemptCount}} 次修复。请输出严格 JSON 对象，必须包含 atom_inventory、slot_map、binding_graph、conflict_checks、recombination_rules、recomposition_templates。slot_map.slots 必须非空，每个槽位至少挂一个脚本原子、一个节奏原子、一个包装原子。只返回 JSON，不要 Markdown，不要解释 JSON 外的内容。

字段归属参考：
- 最终 JSON 只输出 outputContract.schema 中的业务字段，不要输出 schema、field_roles 或 role_rules。
- 本轮 repair 只修校验失败摘要中指出的结构问题，不负责抽象质量审查。
- 修结构时参考 field_roles 保持字段职责：AtomCore 写结构语义，SourceTrace 写来源证据，Meta 写结构记账，Mixed 保持原字段边界。
