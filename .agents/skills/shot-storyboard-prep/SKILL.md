---
name: shot-storyboard-prep
description: 从 function-slot-shot-design 产出的 shot-design.final.md 中提取 Shot 设计表，回填预计时长，按每 4 镜头生成故事板生图 Markdown，并在确认方案自动触发时继续调用 image-generation 生成故事板图。用于用户要求把分镜画面和包装说明合成故事板/生图提示词、提取横竖屏画幅、运行 estimate_dialogue_duration.py 回填预计时长、生成可喂给 ImgGen/PPAPI 的 storyboard prompts，或确认重组方案后自动准备并生图时；不负责补写 Shot 设计，若缺少 shot-design.final.md，先使用 function-slot-shot-design。
---

# Shot Storyboard Prep

## 职责

把已完成 Shot 设计的 `shot-design.final.md` 转成制作准备材料。若缺少 `shot-design.final.md` 或 Shot 表，先使用 `function-slot-shot-design` 补全，不在这里补写 Shot。

- 提取原文中的横屏/竖屏/比例线索。
- 读取 `## Shot 设计` 或旧格式 `## 2. Shot 设计` 中的 Shot 表。
- 用 `function-slot-restructure/scripts/estimate_dialogue_duration.py --shot-json` 根据台词回填 `shot-design.final.md` 中仍为占位的 `预计时长` 列；已由 ShotDesign 写成具体预算范围的时长必须保留。
- 生成一个额外故事板 Markdown，默认每 4 个 shot 一组。
- 每个 shot 只提取 `imagePrompt = 分镜画面` 与 `overlayPackaging = 包装说明`；预计时长只回填原文 Shot 表，不写入故事板 Markdown。
- 最后一组不足 4 镜头时，补纯白占位镜头，保证每组仍是 4 格故事板；占位镜头不回写原文。
- 故事板 Markdown 必须写入四格参考布局图路径：横屏用 `assets/storyboard-layout-16x9-4grid.png`，竖屏用 `assets/storyboard-layout-9x16-4grid.png`；提示模型只参考四格位置，不要生成红线、`image1-4` 标签或参考图文字。
- 每组故事板必须作为独立四镜生成；人物、产品、场景在本组内保持大致一致即可，不新增跨组连续性字段。
- 每组必须声明这是短视频分镜示例帧，不是广告海报、电商主图或最终包装成片；`overlayPackaging` 只作为包装覆盖层/分镜标注参考，不要让模型把整张图做成宣传图。
- 当输入摘要包含 `trigger: "restructure-confirmed"` 且 `runImageGeneration` 不是 `false` 时，生成 `shot-storyboard-prompts.md` 后必须继续调用 image-generation 生图。
- 只在用户明确要求“只生成 prompt / 不生图”或输入摘要显式 `runImageGeneration: false` 时，停在 `shot-storyboard-prompts.md`。
- 生图时把生成的 `shot-storyboard-prompts.md` 作为 `image-generation` 模块的 `storyboardPromptFile` 输入；不要再手动拆组调用 PPAPI。

## 使用脚本

优先运行 bundled script 生成故事板 prompt：

```powershell
python .agents/skills/shot-storyboard-prep/scripts/prepare_storyboard.py --input <shot-design.final.md>
```

常用参数：

- `--input`：必填，重组 final markdown。
- `--output`：可选，故事板 Markdown 输出路径；默认写到同目录 `shot-storyboard-prompts.md`。
- `--group-size`：可选，默认 `4`，表示每 4 镜头一组故事板。
- `--chars-per-second`：可选，默认 `6`，只用于回填空值、`待估算`、旧版 `待后置估算` 等占位时长。
- `--no-write-back`：只生成故事板，不回填原文预计时长。

如需生成给 `image-generation` 模块使用的标准请求 payload：

```powershell
python .agents/skills/shot-storyboard-prep/scripts/build_image_generation_payload.py --storyboard-prompt-file <shot-storyboard-prompts.md> --sample-video-id <sampleVideoId> --parent-artifact-id <artifactId>
```

该脚本只输出 JSON，不发起生图。

确认方案自动触发或用户要求生图时，继续运行故事板生图：

```powershell
node .agents/skills/shot-storyboard-prep/scripts/run_image_generation_storyboard.js --storyboard-prompt-file <shot-storyboard-prompts.md> --sample-video-id <sampleVideoId> --parent-artifact-id <artifactId>
```

默认每组最多 10 并发，单组超时 `450s`。脚本会等待 job 完成并输出 artifact/images 摘要。

## 接入 image-generation

`image-generation` 已支持直接读取故事板 prompt 文件。模块调用体使用：

```json
{
  "sampleVideoId": "sample_1",
  "storyboardPromptFile": "C:/.../shot-storyboard-prompts.md",
  "parentArtifactId": "artifact_parent",
  "timeoutSeconds": 450
}
```

在代码里通过 module registry 调用：

```js
await moduleRegistry.startModule({
  moduleId: "image-generation",
  sampleVideoId,
  body: {
    storyboardPromptFile,
    parentArtifactId,
    timeoutSeconds: 450
  }
});
```

`image-generation` 会按 `Storyboard Group` 分组，每组调用一次 provider；若部分组出现 `retryable: true` 的失败，模块会只重试失败组，不重跑已成功组。输出图片和 artifact 写入 `Runtime/Artifacts/<sampleVideoId>/image-generation/<artifactId>/`。

## 输出规则

- 原文只允许改 `shot-design.final.md` 中 Shot 表仍为占位的 `预计时长` 列，不改已写好的具体预算范围，也不改脚本、节奏、包装、证明功能等其它内容。
- 故事板输出按组写：
  - `## Storyboard Group 01`
  - `- imagePrompt: ...`
  - `- overlayPackaging: ...`
- 每组固定 4 个镜头；如果原始 shot 数不能整除 4，最后一组用 `storyboard_blank_pad_XX` 补齐，`imagePrompt` 写纯白空白画面，`overlayPackaging` 写无。
- 每组写 `referenceImagePath`，供 `image-generation` 走 `/images/edits` 上传参考图。
- 画幅从原文中提取；优先识别 `9:16`、`16:9`、`竖屏`、`横屏`、`竖版`、`横版`。找不到时写 `未明确`，不要猜。
- 生图底图和包装覆盖层要分开保存；不要额外发明 `combinedStoryboardPrompt` 字段。

## 验证

运行后检查：

- 脚本 stdout 中 `shotCount` 是否符合 Shot 表行数，并查看 `durationUpdatedCount / durationPreservedCount` 是否符合预期。
- `updatedInput` 是否为原文件路径，除非使用了 `--no-write-back`。
- 输出 Markdown 是否按 4 镜头分组。
- 生图前确认传给模块的是 `storyboardPromptFile`，不是单条 `prompt`。
- 自动确认触发时，最终回复必须说明已触发 image-generation，并列出 image-generation artifact/images 摘要；如果未生图，必须说明是 `runImageGeneration: false`、用户要求只生成 prompt，还是生图失败。
