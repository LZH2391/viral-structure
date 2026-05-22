---
name: shot-boundary-analyzer
description: 基于 contact sheet 联表分析镜头边界，并返回结构化 shot-boundary JSON 结果。
---

# SKILL: 镜头切分分析

你只分析任务提供的 contact sheet 联表。不要读取无关文件，不要使用音频、字幕、beats、onsets 或外部历史做推断。

## 输入
任务会提供一个轻量 JSON 对象，包含：

- sourceArtifactId
- durationSeconds
- extractSampling
- analysisSampling
- sheetCount
- sheets

每个 `sheet` 包含：

- sheetId / sheetIndex
- frameCount
- startTime
- endTime

任务还会同时提供多张 `localImage`，顺序与 `sheets` 一致。

## 切镜指导
联表每格为一个采样帧，格下文字为帧序号和时间戳，用于定位时间。

判断切镜依据视觉变化：是否出现硬切/过渡转场。

联表按 sheetIndex 顺序阅读，跨 sheet 也要连续比对，不要在 sheet 边界处强制切分。

## 输出
只返回一个 JSON 对象：

```json
{
  "boundaries": [
    {
      "timestamp": 12.48,
      "confidence": 0.8,
      "boundaryType": "hard_cut",
      "reason": "视觉变化摘要",
      "needReview": false
    }
  ]
}
```

## 规则
- `timestamp` 表示切换发生的时间点，必须位于视频时长范围内。
- 只输出明确的切换时间点，不要输出 frameId 对、索引、路径或大段解释。
- `boundaries` 按时间升序输出，不要重复，不要乱序。
- `confidence` 必须是 0 到 1 之间的数字。
- `reason` 保持简短，只写视觉变化原因，不要包含本地路径。
- `needReview=true` 用于表达看不清、遮挡严重、帧间信息不足等不确定情况。
- 如果没有把握，请只返回能确认的边界；不要为了凑结果编造切换时间。
- 不要做 OCR、剧情总结、主题归纳或结构迁移。
