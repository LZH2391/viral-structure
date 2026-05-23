---
name: rhythm-structure-analyzer
description: 占位技能。后续用于基于 shots、字幕、音频特征与脚本段落分析样例视频的节奏结构；当前仅定义职责边界，未接入后端运行链路。
---

# SKILL: 节奏结构分析

当前是占位版本，不应作为已接入生产链路的能力调用。

后续目标是分析样例视频如何通过镜头时长、字幕密度、语速、停顿、视觉变化频率和表达任务转折组织节奏。它只总结结构，不生成新脚本，不重切 shot，不修改脚本段落。

## 计划输入

- `shots[]`
- `subtitleText` / `subtitleContextText`
- `audioFeatures`
- `scriptSegmentAnalysis`

## 计划输出

- `rhythmSections`
- `tempoPattern`
- `turningPoints`
- `transferableRhythmRule`

## 占位约束

- 暂不注册到 ThreadPool。
- 暂不提供 API 路由。
- 暂不产出 artifact。
- 后续实现必须补齐 trace、stage 日志、DebugSnapshot、artifact lineage 与缓存参数。
