---
name: function-slot-restructure-display-transformer
description: 将 function-slot-restructure 产出的 restructure.final.md 中第 1、2、3、5、6、7 节转换为前端可展示的结构化 JSON。用于用户确认重组方案后，需要把目标假设、功能槽位链、Atoms 落地表、脚本段落方案、节奏曲线、包装与证明方案抽取成标准 UI 数据；只做格式转换，不改写内容、不补充缺失信息、不重新重组。
---

# Function Slot Restructure Display Transformer

## 职责

配合确定性脚本把已确认的 `restructure.final.md` 转成前端展示 JSON。

自动触发由后端编排判断：找到当前或历史 `restructure.final.md` 路径后，比对文件指纹（size / mtimeMs / sha256）；文件变化才转换，文件未变则跳过。不要根据回答文本触发词自行判断是否转换。

只读取并转换这些章节：

- `## 1. 重组目标与假设`
- `## 2. 最终功能槽位链`
- `## 3. Atoms 落地表`
- `## 5. 脚本段落方案`
- `## 6. 节奏曲线`
- `## 7. 包装与证明方案`

不要读取、转换或推断其它章节内容。

## 硬边界

- 不改内容。
- 不补内容。
- 不重新组织方案逻辑。
- 不新增 slot、atom、adapter、脚本、节奏或包装判断。
- 不执行 `function-slot-restructure` 的重组职责。
- 不执行 `shot-storyboard-prep` 的故事板职责。
- 不决定自动转换触发时机。
- 不覆盖原始 `restructure.final.md`。
- 如果原文缺字段，只标记 `missing` 或保留原文片段，不自行补全。

## 转换规则

优先保留原文语义和顺序。可以把 Markdown 表格、编号列表、项目符号和段落转换成数组或对象，但字段值必须来自原文。

像 `shot-boundary-transformer` 一样，目标是稳定结构化输出，而不是重新分析。

## Repair 规则

当确定性脚本解析失败时，只做格式修复：

- 输入可以是原始 `restructure.final.md`，也可以是上一轮 `restructure.final.repair-attempt-N.md`。
- 修复结果必须写入后端指定的 `restructure.final.repair-attempt-N.md` 旁路文件。
- 不得写回或覆盖原始 `restructure.final.md`。
- finalMessage 只返回简短状态和修复文件路径，不返回完整 Markdown。
- 修复后仍由确定性脚本重新转换，不绕过脚本直接输出展示 JSON。

## 输出

只返回 JSON object：

```json
{
  "schemaVersion": "function_slot_restructure_display.v1",
  "source": {
    "restructureFinalPath": "Artifacts/FunctionSlotRestructure/example/restructure.final.md",
    "restructureArtifactId": "artifact_or_null"
  },
  "sections": {
    "goalAndAssumptions": {
      "title": "1. 重组目标与假设",
      "items": []
    },
    "finalSlotChain": {
      "title": "2. 最终功能槽位链",
      "items": []
    },
    "atomLandingTable": {
      "title": "3. Atoms 落地表",
      "items": []
    },
    "scriptSegments": {
      "title": "5. 脚本段落方案",
      "items": []
    },
    "rhythmCurve": {
      "title": "6. 节奏曲线",
      "items": []
    },
    "packagingProof": {
      "title": "7. 包装与证明方案",
      "items": []
    }
  },
  "missingSections": [],
  "sourceTextDigest": {
    "sectionCount": 6,
    "convertedAt": "ISO-8601"
  }
}
```

`items` 的内部结构按原文形态保守转换：

- Markdown 表格转成 `{ "type": "table", "columns": [], "rows": [] }`
- 列表转成 `{ "type": "list", "items": [] }`
- 普通段落转成 `{ "type": "paragraph", "text": "..." }`
- 小标题转成 `{ "type": "heading", "text": "..." }`

## 缺失处理

如果某一节不存在：

- 对应 section 的 `items` 为空数组。
- `missingSections` 加入该章节 key。
- 不编造内容。

如果表格无法可靠解析：

- 保留为 `{ "type": "rawMarkdown", "text": "..." }`。
- 不猜列。

## 验证

输出前检查：

- 顶层必须是 JSON object。
- `schemaVersion` 必须是 `function_slot_restructure_display.v1`。
- 只包含指定六个章节。
- 所有展示文本均来自原文。
