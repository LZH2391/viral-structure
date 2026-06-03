---
name: shot-storyboard-prep
description: Shot Storyboard Prep 确定性流水线与 agent 边界说明。用于确认重组方案后由后端自动收集 restructure.final.md、shot-design.final.md、可选素材帧映射，执行 prepare/image-generation/crop，并在 PDF 阶段触发 agent 使用 `$pdf` skill 出最终 PDF；prepare 校验失败时仍由 repair agent 做最小格式修复。
---

# Shot Storyboard Prep

## 定位

主链路由后端确定性流水线执行。agent 只承担两类受控任务：

- `repairTurn`：prepare 校验失败后的最小格式修复。
- `pdfTurn`：在 crop 完成后使用 `$pdf` skill 生成最终 PDF。

目标链路：

```text
确认方案 -> 后端自动收集输入 -> prepare -> image-generation -> crop -> material frame resolve -> pdfTurn($pdf) -> artifact
                                               \-> 校验失败 -> repair agent -> 后端重跑
```

agent 不负责手工跑完整链路，不直接调用 image-generation 或裁切脚本。repair 完成后必须交还后端流水线继续执行；pdfTurn 只能消费后端输入包生成 PDF，不得改上游产物。

## 后端流水线输入

必需输入：

- `restructure.final.md`
- 同目录或显式传入的 `shot-design.final.md`

可选输入：

- `user-material-pack.stable` 或 `user-material-pack.stable.json`
- `material-frame-map.json`
- `visual-manifest.json`
- 显式传入的 material frame map / visual manifest / frame map

后端应从确认记录、会话、artifact lineage 或请求体中解析输入。找不到必需输入时返回结构化错误，不让 agent 猜。

## 确定性阶段

### 1. Input Resolve

解析并校验：

- `restructureFinalPath`
- `shotDesignFinalPath`
- `parentArtifactId`
- 可选素材帧映射

缺少必需文件时失败，错误码应能被前端展示。

### 2. Prepare

后端调用：

```powershell
python .agents/skills/shot-storyboard-prep/scripts/prepare_storyboard.py --input <shot-design.final.md> --output <shot-storyboard-prompts.md> --manifest-output <shot-storyboard-manifest.json>
```

输出：

- `shot-storyboard-prompts.md`
- `shot-storyboard-manifest.json`

校验：

- Shot 表可解析。
- 存在并识别 `素材来源/处理策略`。
- `generatedShotCount` 与 manifest 对齐。
- 只有 `self_designed_by_shot_design` 进入 prompt。
- pad 只出现在 prompt/manifest 的 storyboard group，不进入最终 PDF。

### 3. Image Generation

后端通过 module registry 调用 `image-generation`，使用：

```json
{
  "storyboardPromptFile": "C:/.../shot-storyboard-prompts.md",
  "parentArtifactId": "artifact_parent"
}
```

校验：

- group 数与 manifest 一致。
- 每个 group 至少有图片。
- 失败 group 由 image-generation 模块自身重试。

### 4. Crop

后端调用：

```powershell
python .agents/skills/shot-storyboard-prep/scripts/crop_storyboard_groups.py --artifact <image-generation/artifact.json> --manifest <shot-storyboard-manifest.json> --output-dir <shot-storyboard-frames> --root <repoRoot>
```

校验：

- 每个非 pad 自设计 shot 都有 `shotId.png`。
- pad 没有 crop。
- `cropBox` 来自 layout reference。

### 5. Material Frame Resolve

素材镜头通过 `shotRef/groupId/shotId` 查找代表帧。`user-material-pack.stable` 只作为素材索引入口；没有真实图片路径时不得伪造。

素材代表帧缺失时进入 PDF warning，是否阻断由后端规则决定。

### 6. PDF Agent

后端写出 `shot-storyboard-pdf-input.json`，然后触发 `pdfTurn`。

`pdfTurn` 必须：

- 使用 `$pdf` skill。
- 读取后端输入包中的 manifest、crop manifest、素材代表帧、参考版式和输出契约。
- 输出 `shot-storyboard.pdf`、`shot-storyboard.summary.json`、`shot-storyboard.layout.json`。
- 对生成结果做渲染检查。

`pdfTurn` 禁止：

- 重跑 image-generation。
- 修改 `restructure.final.md` / `shot-design.final.md`。
- 修改 manifest 或 crop 结果。
- 重新裁切图片。
- 伪造缺失素材图。

后端继续负责校验：

- PDF、summary、layout 三个文件存在。
- slot 数、shot 数一致。
- layout 覆盖所有非 pad shot。
- `imageFit === contain`。
- 素材代表帧缺失进入 warnings。

## Repair Agent 边界

只有 deterministic 校验失败后才触发 repair agent。输入必须是结构化 repair package，包含：

- failedStage
- error code
- 安全错误摘要
- 相关文件路径
- manifest 摘要
- 校验失败项
- allowedRepairs
- forbiddenRepairs
- repairedPath

允许修：

- `shot-design.final.md` 的表格字段缺失或格式不合规。
- 明显错误的 `素材来源/处理策略` 格式。
- 缺失但可从上下文确定的 shot 字段。
- prompt/manifest 可重生成的问题。

禁止修：

- 已确认槽位链。
- `restructure.final.md` 核心结构。
- 素材事实。
- image-generation provider 结果。
- 代表帧不存在的问题。

修复后必须写入 `repairedPath`。不要继续手工跑 prepare、image-generation、crop 或 pdfTurn；后端会从失败阶段或 prepare 阶段重跑。

## 重跑策略

- repair attempt 最多 1-2 次。
- repair 后由后端重跑确定性流水线。
- 仍失败时前端展示失败 stage、错误码、可操作建议、traceId，不再无限 agent 循环。

## 脚本说明

这些脚本是后端流水线的确定性执行单元，也可用于本地定向验证：

- `scripts/prepare_storyboard.py`
- `scripts/crop_storyboard_groups.py`
- `scripts/build_image_generation_payload.py`
- `scripts/run_image_generation_storyboard.js`

`scripts/build_storyboard_pdf.py` 保留为本地 fallback/历史工具，不再是正式主链路。

agent repair 场景中不要直接运行这些脚本，除非用户明确要求本地排查脚本本身。
