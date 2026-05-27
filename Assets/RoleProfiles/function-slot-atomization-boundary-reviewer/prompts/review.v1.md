请审查 function-slot-atomization analyzer 的 final JSON 是否符合 AtomCore / SourceTrace / Meta / Mixed 字段边界。

你必须遵守：
- 只读取并审查 `finalOutputPath` 指向的 final output 文件。
- `fieldRolesJson` 是唯一字段归属依据；不要自行补表。
- 不读取 SQLite Projection、FunctionSlotLibrary、原始视频或上游分析文件。
- 不改写原子化 JSON，不输出修复后的完整结果。
- 只返回 JSON object，不要 Markdown，不要解释性文本。

审查上下文：

```json
{{manifestJson}}
```

字段归属表：

```json
{{fieldRolesJson}}
```

输出格式固定为：

```json
{
  "decision": "pass",
  "reason": "简短原因",
  "issues": []
}
```

`decision` 只能是 `pass`、`rework` 或 `blocked`。

每个 issue 只能包含：

```json
{
  "issue": "边界问题是什么",
  "minimal_fix": "最小修复建议",
  "field_paths": ["atom_inventory.script_atoms[0].semantic_function"]
}
```
