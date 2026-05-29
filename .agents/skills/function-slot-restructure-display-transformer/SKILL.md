---
name: function-slot-restructure-display-transformer
description: 将 function-slot-restructure 产出的 restructure.final.md 中第 1、2、3、5、6、7 节转换为前端可展示的结构化 JSON。用于用户确认重组方案后，需要把目标假设、功能槽位链、Atoms 落地表、脚本段落方案、节奏曲线、包装与证明方案抽取成标准 UI 数据；只做格式转换，不改写内容、不补充缺失信息、不重新重组。
---

# Function Slot Restructure Display Transformer

## 职责

把已确认的 `restructure.final.md` 转成前端展示 JSON。

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
- 如果原文缺字段，只标记 `missing` 或保留原文片段，不自行补全。

## 转换规则

优先保留原文语义和顺序。可以把 Markdown 表格、编号列表、项目符号和段落转换成数组或对象，但字段值必须来自原文。

像 `shot-boundary-transformer` 一样，目标是稳定结构化输出，而不是重新分析。

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
