# UI 精简与媒体预览/抽帧采样方案

## Summary
按你的确认，本轮做三类变更：左侧只保留样例上传与媒体派生；右侧只保留“当前片段”；底部只保留“视频帧轨”和“字幕/语音轨”。同时把预览区升级为媒体查看器：可播放原视频、可单独查看封面、点击抽帧显示对应图片、点击音频轨显示音频播放器。抽帧采样改为用户输入“每秒抽多少帧”。

## Key Changes
- UI 布局：
  - 移除左侧资源分类 tab，以及“样例结构 / 结构库 / 版本历史”相关区域。
  - 移除右侧“AI 理解结果”和“新内容画像”表单，保留“当前片段”。
  - 底部时间线移除“结构段落轨”和“迁移映射轨”，只渲染视频帧轨、字幕/语音轨。
  - 保留现有上传、媒体派生、运行追踪、DebugSnapshot 等入口。

- 预览行为：
  - 新增前端预览状态，例如 `activeMediaKind: video | cover | frame | audio`。
  - 上传完成后默认显示可播放原视频，而不是只停留第一帧。
  - 点击“封面帧”媒体派生项时，中间显示封面图片。
  - 点击视频帧轨的某一帧时，中间显示该帧图片，并同步“当前片段”展示帧时间、artifactId、parentArtifactId。
  - 点击“音频轨”或字幕/语音轨时，中间显示音频播放器；无音频时显示“未检测到可抽取音频轨”。
  - 原视频播放使用后端返回的 `sampleVideo.normalized.uri`，封面使用 `cover.uri`，帧使用 `frame.imageUri`，音频使用 `audio.uri`。

- 抽帧采样率：
  - 上传区增加“抽帧采样率”控件，语义为“每秒抽多少帧”，字段名建议为 `frameSampleRateFps`。
  - 默认值保持当前体验等价：`0.25` fps，即约每 4 秒 1 帧。
  - 允许范围：`0.1` 到 `2` fps；后端统一校验。
  - 后端根据 `durationSeconds * frameSampleRateFps` 计算目标帧数，并限制最大 `120` 帧；超过上限时均匀覆盖整段视频。
  - artifact 增加 `processingOptions.frameSampleRateFps` 和帧输出摘要，便于追踪本次抽帧参数。

- 接口与后端：
  - `POST /api/workspaces/:workspaceId/sample-videos` 支持 multipart 普通字段 `frameSampleRateFps`。
  - 扩展 multipart 解析，返回 `{ file, fields }` 或等价结构，避免只读取文件。
  - `sample.frames.extracted` stage 的 `inputSummary/outputSummary` 记录采样率、目标帧数、实际帧数、最大帧数。
  - FFmpeg 失败仍走现有结构化错误和 DebugSnapshot；不把完整路径或 stderr 裸写普通日志。

## Test Plan
- 单元测试：
  - `planFrameTimestamps(duration, { frameSampleRateFps })` 覆盖默认值、1 fps、上限 120、非法值。
  - 采样率校验覆盖低于 `0.1`、高于 `2`、非数字。
  - artifact contract 覆盖 `processingOptions.frameSampleRateFps` 和帧 artifact 血缘不丢失。

- 集成/手动测试：
  - 上传短视频，确认默认显示原视频播放器且可播放。
  - 点击封面派生项，中间预览切到封面图片。
  - 点击底部任意帧，中间预览切到对应抽帧图片，不再始终显示第一帧。
  - 点击字幕/语音轨或音频派生项，有音频时显示播放器，无音频时显示安全空状态。
  - 用 `1` fps 上传 5 秒视频，确认约 5 帧；用长视频确认不会超过 120 帧。
  - 运行现有 `node Tests/run-tests.js`，有 FFmpeg 环境时补跑媒体处理集成测试。

## Assumptions
- “抽帧采样率”按你补充的“1s 抽多少帧”实现为 FPS，而不是总帧数或间隔秒数。
- 左侧精简为只保留“选择样例视频”和“媒体派生”，右侧精简为只保留“当前片段”。
- 本轮不删除后续结构理解/迁移的核心策略文件，只从当前 UI 暂时隐藏不用的入口和轨道。
