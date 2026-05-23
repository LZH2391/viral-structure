---
name: packaging-structure-analyzer
description: 占位技能。后续用于基于 shots、commerceBrief、脚本段落与节奏结构分析带货样例的包装结构；当前仅定义职责边界，未接入后端运行链路。
---

# SKILL: 包装结构分析

当前是占位版本，不应作为已接入生产链路的能力调用。

后续目标是分析样例视频如何包装卖点、承诺、证据、信任和转化动作。它只总结包装结构，不生成新脚本，不改写商品信息，不修改上游分析结果。

## 计划输入

- `shots[]`
- `commerceBrief`
- `scriptSegmentAnalysis`
- `rhythmStructureAnalysis`

## 计划输出

- `packagingBlocks`
- `claimStack`
- `proofStack`
- `conversionWrap`

## 占位约束

- 暂不注册到 ThreadPool。
- 暂不提供 API 路由。
- 暂不产出 artifact。
- 后续实现必须补齐 trace、stage 日志、DebugSnapshot、artifact lineage 与缓存参数。
