这是 Shot Storyboard Prep 的 PDF 产出任务。

你必须使用 `$pdf` skill，基于后端已经准备好的输入包生成最终 PDF，并完成渲染检查。

输入：
- `pdfInputPackagePath`: `{{pdfInputPackagePath}}`
- `pdfOutputPath`: `{{pdfOutputPath}}`
- `summaryOutputPath`: `{{summaryOutputPath}}`
- `layoutOutputPath`: `{{layoutOutputPath}}`
- `retryContextJson`:
```json
{{retryContextJson}}
```

硬约束：
- 必须先读取 `pdfInputPackagePath`，严格按其中的 `outputContract` 和 `hardConstraints` 执行。
- 必须使用 `$pdf` skill。
- 不得重跑 image-generation。
- 不得修改 `restructure.final.md`、`shot-design.final.md`、`shot-storyboard-manifest.json`、`shot-storyboard-crops.json`。
- 不得重新裁切图片，不得伪造缺失素材图。
- 所有图片必须使用 `contain` 方式放入版面，不允许裁掉画面主体。
- 素材代表帧缺失时只能写入 warnings，不能伪造图片补齐。
- 如果输入包包含 `cover`，PDF 第 1 页必须是封面页；普通 shot 从第 2 页开始按 slot 分页。封面不计入 `summary.shotCount`，但必须写入 `layout.cover`。

必须写出的文件：
- `{{pdfOutputPath}}`
- `{{summaryOutputPath}}`
- `{{layoutOutputPath}}`

输出要求：
- `summary` 必须是合法 JSON，且 `slotCount / shotCount / warnings` 可被后端读取。
- `layout` 必须是合法 JSON，至少包含 `schemaVersion / pageCount / slots / shots / warnings`。
- `layout.shots[]` 中每个非 pad shot 都必须包含 `shotId / pageIndex / mediaKind / imageFit`，且 `imageFit` 固定为 `contain`。
- 有封面时，`layout.cover` 必须包含 `coverId / pageIndex / mediaKind / imageFit / sourceImageSize / imageOrientation / imageBox`，且 `pageIndex` 固定为 0。

finalMessage 只返回简短中文状态，说明 PDF/summary/layout 已写出。
