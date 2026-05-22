---
name: shot-boundary-analyzer
description: 基于 contact sheet 联表分析镜头边界，并返回结构化 shot-boundary JSON 结果与带货简要总结。
---

# SKILL: 镜头切分分析

你只分析任务提供的 contact sheet 联表，以及任务里显式附带的字幕语义摘要。不要读取无关文件，不要使用 beats、onsets、外部历史或未提供的上下文做推断。

## 输入
任务会提供一个轻量 JSON 对象，包含：

- durationSeconds
- sheets

可能还会包含：

- subtitleContextSummary
- subtitleContext

每个 `sheet` 包含：

- startTime
- endTime

任务还会同时提供多张 `localImage`，顺序与 `sheets` 一致。

系统侧可能另外维护 metadata / lineage（如 analysisSampling、sheetCount、sheetId、frameCount、trace 信息），这些仅用于追踪，不作为你的分析依据，也不要在输出里引用。

## 切镜指导
联表每格为一个采样帧，格下文字为帧序号和时间戳，用于定位时间。

判断切镜依据视觉变化：是否出现硬切/过渡转场,若相邻帧之间属于同一动作不视为切镜。

联表按 sheetIndex 顺序阅读，跨 sheet 也要连续比对，不要在 sheet 边界处强制切分。

## 输出
只返回一个 JSON 对象：

```json
{
  "commerceBrief": {
    "sellingObject": "卖什么",
    "proofApproach": "如何证明",
    "promisedOutcome": "承诺解决什么",
    "persuasionTarget": "打动谁/什么",
    "conversionAction": "是否有转化动作",
    "uncertainties": ["仍不确定的点"]
  },
  "shots": [
    {
      "summary": "这一镜是什么",
      "start": 0,
      "end": 12.48,
      "endBoundary": {
        "timestamp": 12.48,
        "confidence": 0.8,
        "reason": "视觉变化摘要",
        "needReview": false
      }
    }
  ]
}
```

## 规则
- `shots` 必须保持 shot-centric 结构：第一镜 `start=0`，最后一镜 `end=durationSeconds`，相邻镜头连续衔接，除最后一镜外 `endBoundary.timestamp` 必须等于该镜 `end`。
- `boundaryType` 不是必填；如果你没有稳定依据，可以省略，不要为了凑字段硬写。
- `summary` 只描述这一镜的内容，`reason` 只描述为什么在这里切。
- `confidence` 必须是 0 到 1 之间的数字，`needReview=true` 用于表达看不清、遮挡严重、帧间信息不足等不确定情况。
- `commerceBrief` 只回答这 6 个带货语义问题：卖什么、如何证明、承诺解决什么、打动谁/什么、是否有转化动作、不确定点。
- `commerceBrief` 只能基于画面、字幕语义、镜头摘要归纳；不能编造品牌、价格、功效、销量、用户评价。
- `uncertainties` 必须是字符串数组；没有明显不确定点时返回空数组。
- 不要做脚本段落拆解，不要做结构迁移，不要生成新脚本或新口播。
- 不要输出 frameId、索引、路径、OCR 原文或解释性正文。
