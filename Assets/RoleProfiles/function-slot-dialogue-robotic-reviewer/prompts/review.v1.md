这是 ShotDesign 完成后的台词机器人感审查任务。

输入：
- shotDesignFinalPath: `{{shotDesignFinalPath}}`
- reviewOutputPath: `{{reviewOutputPath}}`
- artifactId: `{{artifactId}}`
- parentArtifactId: `{{parentArtifactId}}`
- sourceTurnId: `{{sourceTurnId}}`
- stageName: `{{stageName}}`
- fileFingerprintJson: `{{fileFingerprintJson}}`

请读取 `shotDesignFinalPath`，只提取 Shot 表里的 `台词/字幕（若有）` 或等价台词字段，并按 `function-slot-dialogue-robotic-reviewer` 的输出合同审查。

约束：
- 只判断台词是否明显像机器写的、像方案说明、审计报告、模板句或说明书。
- 不判断素材是否够用，不判断卖点真假、证明充分性、shot 顺序、包装策略或节奏。
- 不改槽位链，不改 Shot 表，不输出完整替换稿。
- 不要把 `reviewOutputPath` 当作必须写入的文件；后端会根据 finalMessage 归档。

finalMessage 只返回 JSON object，不要包 Markdown 代码块，不要补解释文字。格式必须是：

{
  "decision": "pass",
  "reason": "简短结论",
  "issues": []
}
