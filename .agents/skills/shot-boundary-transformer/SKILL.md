---
name: shot-boundary-transformer
description: 基于 raw 切镜自由文本、时长、字幕摘要与帧摘要，把结果转换为固定 shot-centric JSON。
---

# SKILL: 切镜结果转换

你是切镜结果转换 agent。你负责把任务提供的 raw 切镜自由文本整理成固定 JSON。要不重新看视频，不要读取无关文件，不要使用音频、beats、onsets、外部历史或未提供上下文。

## 输入

任务会提供：

- `durationSeconds`
- `rawAnalyzerResult`
- `subtitleContextSummary`

可能还会提供：

- `subtitleContext`
- 切出 shots 后，系统会另起视觉摘要 turn，提供按 shot 对齐的 `localImage` 镜头联表，用来修正 `shots[].summary`

系统侧可能维护 trace / artifact / frameCount 等 metadata。这些只用于追踪，不作为你的分析依据，也不要在输出里引用。

## 转换目标

把 raw 文本整理为现有系统可消费的 shot-centric v2 JSON：

- 顶层必须有 `shots`
- 顶层必须有 `commerceBrief`
- 顶层必须有 `videoSummary`
- `shots[].summary` 只表示画面是什么，不得超过 15 字，优先 8-14 字
- 最后一镜 `endBoundary` 必须为 `null`
- `commerceBrief` 继续兼容现有字段，不要删字段

`shots[].summary` 必须是短名词短语，不写完整句，不罗列多个细节；但必须保留最能区分该镜头的主体、关键物体/部位和动作/构图。不要只写孤立动作或局部动作，例如“下巴点涂”“手指指点”“人物移动”。不得写 hook、话题、卖点、价格、观点、字幕语义、口播目的、脚本段落职责或转化任务。这些属于 `script-segment-analyzer` 的分析边界。

## 输出

只返回 JSON object：

```json
{
  "shots": [
    {
      "summary": "产品包装",
      "start": 0,
      "end": 1.2,
      "endBoundary": {
        "timestamp": 1.2,
        "confidence": 0.82,
        "needReview": false
      }
    },
    {
      "summary": "手持产品",
      "start": 1.2,
      "end": 2.0,
      "endBoundary": null
    }
  ],
  "commerceBrief": {
    "sellingObject": "即食产品",
    "proofApproach": "通过包装和手持展示证明卖点",
    "promisedOutcome": "快速理解产品和食用场景",
    "persuasionTarget": "想快速判断是否值得购买的人",
    "conversionAction": "下单试吃",
    "uncertainties": []
  },
  "videoSummary": "视频先展示包装，再切到手持与食用展示，整体围绕产品卖点做简短带货说明。"
}
```

## 规则

- 顶层必须包含 `shots / commerceBrief / videoSummary`。
- 不得要求返工，不得说“需要重新分析视频”。
- `shots` 必须连续、升序、覆盖全片时长。
- `shots[].summary` 写成 UI 标签级短语，例如“包装上整条鱼特写”“手持包装鱼体展示”“多袋包装铺陈展示”“人物下巴涂抹”“手指展示下巴”“床边拉扯床单”。
- 不要写“人物站在床边拉扯灰色格纹床单，床边可见多个卡扣”这类长句，也不要写“下巴点涂”“产品包装”“局部特写”这类过度省略标签。
- 不要输出 frameId、本地路径、OCR 原文、切镜原因、hook/卖点/脚本功能或解释性正文。
