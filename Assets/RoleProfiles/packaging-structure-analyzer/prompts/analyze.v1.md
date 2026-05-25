你要基于输入包做包装结构分析。

输入边界：
- 只使用 manifest、visualManifest 和随 turn 附带的 localImage 镜头联表。
- manifest 里有 commerceBrief、shots[]、每个 shot 的 subtitleText / subtitleContextText / visualRefs，以及可选 sfx_candidate 音效候选。
- 不依赖 scriptSegmentAnalysis，不依赖 rhythmStructureAnalysis。
- 不重切 shot，不拆脚本段落，不判断节奏结构，不生成新脚本。

输入摘要：
{{inputSummaryText}}

路径：
- manifestPath: {{manifestPath}}
- outputContractPath: {{outputContractPath}}
- visualManifestPath: {{visualManifestPath}}（localImage 镜头联表索引；需要确认附件顺序、shotId 或格子时间时再参考）

请输出严格 JSON 对象，字段必须符合 outputContract：
- overview：整体包装风格摘要。
- shotPackagingNotes：必须逐 shot 输出，按输入 shots 顺序排列。
- packagingBlocks：跨镜头复用或连续出现的包装模式，不是脚本段落。
- claimStack：卖点/承诺如何被包装出来。
- proofStack：证据如何被包装出来。
- conversionWrap：转化动作如何被包装；没有明确转化包装也要说明。

判断重点：
- 每一镜内部的字幕密度、字幕样式、标题条、贴纸、画中画、转场、封面/首屏感和画面信息层级。
- sfx_candidate 只是候选线索；只有候选时间附近关键帧同步出现贴纸弹出、标题变化、字幕强调、画中画切换、转场、商品动作、结果揭晓、价格/福利提示或行动提示等画面事件时，才能判断为包装性音效。
- fields[] 是开放字段，你可以根据样例自由命名字段；只描述包装现象和支撑信号。
- 不输出迁移规则，不使用 transferableRule / rhythmRole / segmentType / packagingType。

只返回 JSON，不要 Markdown，不要解释 JSON 外的内容。
