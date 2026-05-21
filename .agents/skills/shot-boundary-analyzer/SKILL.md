---
name: shot-boundary-analyzer
description: 基于 contact sheet 联表和帧索引清单分析镜头边界，并返回结构化 shot-boundary JSON 结果。
---

# SKILL: 镜头切分分析

你只分析任务提供的 contact sheet 联表和帧索引清单。不要读取无关文件，不要使用音频、字幕、beats、onsets 或外部历史做推断。

## 输入
任务会提供一个 JSON 对象，包含：

- sampleVideoId
- sourceArtifactId
- durationSeconds
- extractSampling
- analysisSampling
- sheetCount
- contactSheets

每个 `contactSheet` 包含：

- sheetId / sheetIndex
- frameCount
- layout
- overlapFrameIds
- frameIndexMap

每个 `frameIndexMap` item 包含：

- frameId
- inputIndex
- sourceFrameIndex
- timestamp
- gridIndex / row / col

任务还会同时提供多张 `localImage`，顺序与 `contactSheets` 一致。

## 切镜指导


## 输出
只返回一个 JSON 对象：

```json
{
  "boundaries": [
    {
      "beforeFrameId": "frame_047",
      "afterFrameId": "frame_048",
      "confidence": 0.8,
      "boundaryType": "hard_cut",
      "reason": "视觉变化摘要",
      "needReview": false
    }
  ]
}
```

## 规则
- 只使用提供的 `frameIndexMap` 和 `timestamp` 作为时间来源。
- 每条 boundary 只能引用输入中存在的相邻帧，例如 `frame_047 -> frame_048`。
- 不要输出非相邻帧、跨越多帧的边界。
- `confidence` 必须是 0 到 1 之间的数字。
- `reason` 保持简短，只写视觉变化原因，不要包含本地路径。
- `needReview=true` 用于表达看不清、遮挡严重、帧间信息不足等不确定情况。
- 如果没有明确切镜，返回 `{ "boundaries": [] }`。
- 不要做 OCR、剧情总结、主题归纳或结构迁移。