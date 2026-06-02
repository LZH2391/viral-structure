这是 Shot Storyboard Prep 的 agentRepair 任务。

后端确定性流水线已经失败，当前只允许你做最小修复，修复后必须交还后端继续跑流水线。

输入：
- repairAttemptCount: {{repairAttemptCount}}
- restructureFinalPath: `{{restructureFinalPath}}`
- shotDesignFinalPath: `{{shotDesignFinalPath}}`
- repairedPath: `{{repairedPath}}`
- errorCode: `{{errorCode}}`
- errorMessage: {{errorMessage}}
- validationErrors: {{validationErrorsJson}}
- repairRequestJson:
```json
{{repairRequestJson}}
```

允许修复：
- `shot-design.final.md` 的 Shot 表字段缺失、表格格式不合规、列名或单元格明显错位。
- 明显错误的 `素材来源/处理策略` 格式。
- 可从同一行上下文确定的 shot 字段缺失。
- 导致 prompt/manifest 无法重生成的格式问题。

禁止修复：
- 不得修改已确认的 `restructure.final.md`、槽位链、脚本段落、节奏曲线、包装证明核心结构。
- 不得虚构素材事实、代表帧、用户素材能力或 image-generation provider 结果。
- 不得手工调用 image-generation、裁切或 PDF 脚本。
- 不得为了绕过素材缺失把素材镜头改成自设计镜头。

请直接创建或修改 `{{repairedPath}}`，内容应是修复后的完整 `shot-design.final.md`。finalMessage 只返回简短中文状态，说明已写入 repairedPath。
