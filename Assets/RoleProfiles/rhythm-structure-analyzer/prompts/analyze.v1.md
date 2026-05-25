你要基于输入包做节奏结构分析。

输入边界：
- 只使用 manifest、visualManifest 和随 turn 附带的 localImage 镜头联表。
- manifest 里有 shots[]、镜头级字幕摘要和切点理由。
- 不分析音频，不要求音频特征，不重切 shot，不改脚本段落，不生成新脚本。

输入摘要：
{{inputSummaryText}}

路径：
- manifestPath: {{manifestPath}}
- visualManifestPath: {{visualManifestPath}}
- outputContractPath: {{outputContractPath}}

请输出严格 JSON 对象，字段必须符合 outputContract：
- overview：全局节奏总览。
- sections：节奏区间数组。

判断重点：
- 整体节奏气质、快慢和密度变化。
- 什么时候观感开始变化，以及为什么变化。
- 高潮、停顿、回落、断裂、重复、堆叠或爆点。
- 节奏变化是否和脚本段落边界一致；不一致时要说明这是两层结构。
- fields[] 是开放字段，你可以根据样例自由命名字段；只描述节奏现象和支撑信号。
- 不输出迁移规则，不使用 transferableRule / rhythmRole / rhythmPattern / attentionEffect。

只返回 JSON，不要 Markdown，不要解释 JSON 外的内容。
