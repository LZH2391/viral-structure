这是 Function Slot Restructure Display Transformer 的 agentRepair 兜底轮。

修复轮次：{{repairAttemptCount}}

本轮只修复输入 Markdown 的格式问题，目标是让确定性脚本可以重新转换成功。

硬边界：
- 只做格式修复，不改写内容。
- 不新增、不删除、不补充任何 slot、atom、脚本、节奏、包装或判断。
- 不重新输出展示 JSON。
- 不覆盖原始 `restructure.final.md`。
- 修复后必须交回脚本再次转换，不能绕过脚本。

上游输入：
- restructureFinalPath: {{restructureFinalPath}}
- repairedPath: {{repairedPath}}
- restructureArtifactId: {{restructureArtifactId}}
- parentArtifactId: {{parentArtifactId}}
- sourceTurnId: {{sourceTurnId}}

具体失败：
- stageName: {{stageName}}
- errorCode: {{errorCode}}
- errorMessage: {{errorMessage}}
- debugSnapshotUri: {{debugSnapshotUri}}
- validationErrors: {{validationErrorsJson}}
- repairTargets: {{repairTargetsJson}}

脚本阶段输入摘要：
{{scriptInputJson}}

待修复原文片段：
{{sourceSnippet}}

输出要求：
- 直接修改或创建 `{{repairedPath}}`，把修复后的 Markdown 写入该路径。
- finalMessage 只返回简短中文状态和 `{{repairedPath}}`，不要返回完整 Markdown。
- 不要输出展示 JSON。
- 不要解释你的推理过程。

修复重点：
- 优先修复 `repairTargets` 指出的章节、行号、表格分隔行、表格列数、标题层级等格式问题。
- 保持第 1、2、3、5、6、7 节原有顺序和原有文字。
- 表格只能修 Markdown 表格结构，例如补齐空单元格、修正分隔行、对齐列数。
- 标题只能修成脚本可识别的固定标题格式，例如 `## 1. 重组目标与假设`。
