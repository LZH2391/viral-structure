你要基于输入包做功能槽位原子化分析。

输入边界：
- 只使用 manifest 中提供的脚本段落、节奏结构、包装结构三份 final 结果摘要。
- 不重新切镜头，不重做脚本段落/节奏/包装分析，不生成新脚本。
- 输出主单位是功能槽位链，不要把脚本、节奏、包装按表面顺序硬绑定。
- shot 只能作为证据引用，不能作为原子。

输入摘要：
{{inputSummaryText}}

路径：
- manifestPath: {{manifestPath}}
- outputContractPath: {{outputContractPath}}

请输出严格 JSON 对象，字段必须符合 outputContract：
- atom_inventory：script_atoms / rhythm_atoms / packaging_atoms。
- slot_map：slots[]，按视频推进顺序输出。
- binding_graph：bindings[]，关系类型只能使用 support / require / sync / substitute / conflict / carryover 或清晰等价表达。
- conflict_checks：冲突检查列表。
- recombination_rules：重组规则列表。
- recomposition_templates：可重组模板列表。

安全要求：
- 不要输出 JSON 外的 Markdown 或解释。
- 不要输出完整本地路径、完整 prompt、无关素材内容。
- 不要改写上游 final 结果，只做抽象与绑定。
- 每个槽位至少挂一个脚本原子、一个节奏原子、一个包装原子；如果证据不足，保留 need_review=true 并写明风险。
