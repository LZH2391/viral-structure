---
name: shot-boundary-v2-analyzer
description: 基于服务端生成的 scene score、帧差候选、overview sheet、候选五帧对照和密集区 zoom sheet，一次对话输出最终切镜结果。
---

# SKILL: 切镜 V2 单轮证据分析

你只分析任务提供的 V2 evidence manifest 和 localImage 证据图。不要读取项目里已有分镜结果、历史缓存、reviewer 输出或外部文件。

## 判断原则

- 候选点只是证据，不是最终答案。
- 高 scene score 或高帧差只说明画面变化大，不必然是切镜。
- 最终只按硬切、明显跳切、转场、主体/场景/构图突变来切。
- 同一机位连续口播、手持移动、产品靠近镜头、手部翻动、字幕/贴纸出现、曝光或压缩变化，不单独算切镜。
- 候选五帧对照按 `t-3f / t-1f / t / t+1f / t+3f` 阅读，用来判断切点前后是否真的断开。
- 密集区 zoom sheet 用来区分快切与连续动作。

## 输出

只返回 JSON object，不要输出解释性正文：

```json
{
  "shots": [
    {
      "summary": "镜头内容",
      "start": 0,
      "end": 3.13,
      "endBoundary": {
        "timestamp": 3.13,
        "confidence": 0.85,
        "reason": "从面部近景硬切到正面口播"
      }
    },
    {
      "summary": "结尾镜头",
      "start": 3.13,
      "end": 10.0,
      "endBoundary": null
    }
  ],
  "rejectedCandidates": [
    {
      "id": "C004",
      "time": 4.9,
      "reason": "同机位手持移动，前后主体连续"
    }
  ],
  "methodSummary": {
    "shotCount": 2,
    "standard": "hard_cut_or_obvious_jump_cut"
  }
}
```

## 规则

- 第一镜 `start` 必须是 0。
- 最后一镜 `end` 必须等于 manifest 的 `durationSeconds`，最后一镜 `endBoundary` 必须为 null。
- 相邻镜头必须首尾连续：后一镜 `start` 等于前一镜 `end`。
- 除最后一镜外，每个 `endBoundary.timestamp` 必须等于该镜 `end`。
- `confidence` 是 0 到 1 的数字。
- `rejectedCandidates` 只记录你认为有必要解释的高变化但非切镜候选，不能编造不存在的候选 id。
- 不要输出 frameId、本地路径、OCR 原文、旧分镜引用或 markdown。
