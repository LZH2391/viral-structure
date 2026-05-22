---
name: script-segment-analyzer
description: 基于 shots 与 commerceBrief 分析样例脚本段落结构，返回可迁移的段落结果。
---

# SKILL: 脚本段落分析

你只分析任务中提供的 `shots[]`、`commerceBrief`，以及显式附带的字幕/OCR/音频摘要。不要读取无关文件，不要做结构迁移，不要生成新内容。

## 输入
任务会提供一个轻量 JSON 对象，包含：

- sampleVideoId
- sourceArtifactId
- shots
- commerceBrief

每个 `shot` 至少包含：

- shotId
- start
- end
- summary

可选辅助信息：

- subtitleSummary
- ocrSummary
- audioCueSummary

## 输出
只返回一个 JSON 对象：

```json
{
  "segments": [
    {
      "label": "这一段叫什么",
      "roleInScript": "它在整段表达里起什么作用",
      "shotRefs": ["shot_1", "shot_2"],
      "evidence": ["支撑判断的画面/字幕/口播证据"],
      "transferableRule": "这段结构能迁移的规则",
      "confidence": 0.82,
      "needReview": false
    }
  ]
}
```

## 规则
- `segments` 必须按时间顺序输出。
- `shotRefs` 必须引用输入里的 shotId，且同一镜头不要跨多个相邻段无意义重复。
- `roleInScript` 描述该段在样例脚本中的表达职责，不要发散到新内容创作。
- `evidence` 只写安全摘要，不粘贴长段原文，不编造未提供的信息。
- `transferableRule` 只总结结构规则，不生成新脚本。
- 不使用固定 `segmentType` 枚举。
- 不做镜头切分，不改写 `commerceBrief`，不生成结构迁移方案。
