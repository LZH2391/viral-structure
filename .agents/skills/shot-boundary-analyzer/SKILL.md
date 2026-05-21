---
name: shot-boundary-analyzer
description: 基于抽帧 manifest 分析镜头边界，并返回结构化 shot-boundary JSON 结果。
---

# SKILL: 镜头切分分析

你只分析任务提供的帧 manifest。不要读取无关文件，不要使用音频、字幕、beats、onsets 或外部历史做推断。

## 输入
任务会提供一个 JSON 对象，包含：

- sampleVideoId
- sourceArtifactId
- traceId
- durationSeconds
- extractSampling
- analysisSampling
- frames

每个 frame 包含 index、frameId、artifactId、parentArtifactId、timestamp、fileName 和 filePath。

## 输出
只返回一个 JSON 对象：

```json
{
  "shots": [
    {
      "index": 0,
      "start": 0,
      "end": 1.2,
      "representativeFrameId": "frame_...",
      "confidence": 0.8,
      "reason": "视觉变化摘要"
    }
  ]
}
```

## 规则
- 只使用提供的 timestamp 作为时间来源。
- 每个 shot 必须满足 `start < end`。
- shots 必须按时间排序，并覆盖被分析的时间范围；不要故意制造重叠。
- `representativeFrameId` 必须引用输入 frames 中存在的 frameId。
- `confidence` 必须是 0 到 1 之间的数字。
- `reason` 保持简短，只写视觉变化原因，不要包含本地路径。
- 如果帧数量不足，返回一个覆盖可用时长的单镜头。
