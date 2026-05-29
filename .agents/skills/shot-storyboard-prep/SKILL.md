---
name: shot-storyboard-prep
description: 从 function-slot-restructure 的 restructure.final.md 中提取第 8 节 Shot 设计，回填预计时长，并按每 4 镜头生成故事板生图准备 Markdown。用于用户要求把分镜画面和包装说明合成故事板/生图提示词、提取横竖屏画幅、运行 estimate_dialogue_duration.py 回填预计时长、或生成可喂给 ImgGen/PPAPI 的 storyboard prompts 时。
---

# Shot Storyboard Prep

## 职责

把重组产物 `restructure.final.md` 的 `## 8. Shot 设计` 转成制作准备材料：

- 提取原文中的横屏/竖屏/比例线索。
- 读取第 8 节 Shot 表。
- 用 `function-slot-restructure/scripts/estimate_dialogue_duration.py --shot-json` 根据台词回填原文 `预计时长` 列。
- 生成一个额外故事板 Markdown，默认每 4 个 shot 一组。
- 每个 shot 只提取 `imagePrompt = 分镜画面` 与 `overlayPackaging = 包装说明`；预计时长只回填原文 Shot 表，不写入故事板 Markdown。
- 最后一组不足 4 镜头时，补纯白占位镜头，保证每组仍是 4 格故事板；占位镜头不回写原文。

## 使用脚本

优先运行 bundled script：

```powershell
python .agents/skills/shot-storyboard-prep/scripts/prepare_storyboard.py --input <restructure.final.md>
```

常用参数：

- `--input`：必填，重组 final markdown。
- `--output`：可选，故事板 Markdown 输出路径；默认写到同目录 `shot-storyboard-prompts.md`。
- `--group-size`：可选，默认 `4`，表示每 4 镜头一组故事板。
- `--chars-per-second`：可选，默认 `6`，传给时长估算脚本。
- `--no-write-back`：只生成故事板，不回填原文预计时长。

## 输出规则

- 原文只允许改第 8 节 Shot 表的 `预计时长` 列，不改脚本、节奏、包装、证明功能等其它内容。
- 故事板输出按组写：
  - `## Storyboard Group 01`
  - `- imagePrompt: ...`
  - `- overlayPackaging: ...`
- 每组固定 4 个镜头；如果原始 shot 数不能整除 4，最后一组用 `storyboard_blank_pad_XX` 补齐，`imagePrompt` 写纯白空白画面，`overlayPackaging` 写无。
- 画幅从原文中提取；优先识别 `9:16`、`16:9`、`竖屏`、`横屏`、`竖版`、`横版`。找不到时写 `未明确`，不要猜。
- 生图底图和包装覆盖层要分开保存；不要额外发明 `combinedStoryboardPrompt` 字段。

## 验证

运行后检查：

- 脚本 stdout 中 `shotCount` 是否符合第 8 节行数。
- `updatedInput` 是否为原文件路径，除非使用了 `--no-write-back`。
- 输出 Markdown 是否按 4 镜头分组。
