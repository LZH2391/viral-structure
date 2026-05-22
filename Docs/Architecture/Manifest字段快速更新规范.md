# Manifest 字段快速更新规范

## 定位

本文档定义分析类输入包在新增或调整字段时的最小更新规则，目标是让字段变化可理解、可追踪、可返工，不把系统追踪信息混进模型推理主输入。

本文档适用于当前以 `manifest.json`、`metadata.json`、`lineage.json`、`output-contract.json`、`visual-manifest.json` 组织的分析输入包，尤其适用于：

- `shot-boundary-analyzer`
- `script-segment-analyzer`
- 后续新增的同类分析 role

---

## 1. 先判断字段属于哪一类

新增字段前，先明确它属于以下哪一类，不要直接默认加进 `manifest.json`。

### A. 模型判断必需字段

只有字段会直接影响模型判断时，才进入 `manifest.json`。

典型例子：

- 时间范围
- 镜头摘要
- 字幕内容
- 与视觉联表直接配套的可读说明
- 模型必须遵守的业务约束输入

判断标准：

- 去掉它后，模型结论会明显变差或失真。
- 它不是仅供排查、映射、缓存、定位使用。

### B. 系统运行字段

只用于程序组织、兼容、路径定位、统计或调试时，进入 `metadata.json`，不作为模型生产判断依据。

典型例子：

- `durationSeconds`
- `frameDimensions`
- `analysisSampling`
- `sheetCount`
- `sheetId`
- `frameCount`
- 输入包目录或文件路径

要求：

- prompt 中如需提到，必须明确说明这些字段仅供系统定位或背景信息，不要求模型在输出中引用。

### C. 血缘追踪字段

只用于追踪上游来源、版本关系、返工关系时，进入 `lineage.json`。

典型例子：

- `sampleVideoId`
- `artifactId`
- `parentArtifactId`
- `traceId`
- 上游分析产物引用

要求：

- 不得因为下游调试方便，就把 lineage 字段重新暴露给模型主输入。

### D. 调试 / 缓存 / 观测字段

只用于 cache、prompt 版本、调试快照、日志摘要的字段，不进入模型可见输入包主体；优先放在：

- stage log `inputSummary` / `outputSummary`
- `DebugSnapshot.debugPayload`
- cache 参数
- 运行时内存上下文

典型例子：

- `promptTemplateVersion`
- `promptTemplateHash`
- `cacheKey`
- `manifestHash`
- `outputContractHash`
- 重试次数
- 本地绝对路径

---

## 2. Manifest 只放模型真正需要消费的信息

`manifest.json` 的默认规则：

- 只放模型生产判断真正需要的信息。
- 内容以“可读、可判断、可约束”为主。
- 不承载缓存、定位、血缘、调试职责。

禁止把以下内容默认塞进 `manifest.json`：

- 仅用于系统映射的 ID
- 本地路径
- 调试统计字段
- cache 指纹
- trace 字段
- 只为程序派生字段服务的冗余字段

如果字段同时满足“模型判断需要”和“系统也需要追踪”，优先做法是：

- 在 `manifest.json` 放最小可判断表达
- 在 `metadata.json` / `lineage.json` 保留系统版本字段

不要只因为“一个地方全有更方便”，就把两层职责合并。

---

## 3. 增字段时的标准步骤

每次增加字段，按下面顺序走。

### 1. 写明变更目的

至少回答：

- 这个字段解决什么判断问题？
- 为什么现有字段不够？
- 它属于 manifest、metadata、lineage 还是 debug？

如果回答不清，先不要加。

### 2. 选定落点

明确写出字段放在哪个文件：

- `manifest.json`
- `metadata.json`
- `lineage.json`
- `visual-manifest.json`
- 非输入包，改到日志 / cache / snapshot

### 3. 保持最小可见面

只新增本次能力真正需要的字段，不顺手捎带一批“以后可能有用”的字段。

### 4. 同步 prompt 文案

如果字段进入模型可见输入，必须同步检查：

- role template 是否需要引用它
- output contract 是否需要约束模型如何使用它
- repair prompt 是否需要同样可见

如果字段只进 `metadata.json`，要确认 prompt 没有把它错误描述成分析依据。

### 5. 检查派生关系

若某些输出字段可以由系统派生，不要反向要求模型重复产出。

典型规则：

- 模型输出尽量给语义核心字段
- 系统负责补 `id`、时间归并、血缘字段、索引字段、缓存字段

### 6. 补最小测试

至少覆盖：

- 新字段出现在正确位置
- 不该暴露给模型的字段没有误入 `manifest`
- 输出校验仍通过
- 缓存 / lineage / repair 不被破坏

---

## 4. 兼容与收敛规则

### 新增字段

- 默认做向后兼容。
- 下游未消费前，不要求一次性改全链路。
- 若字段缺失可安全降级，应允许缺省。

### 删除或迁移字段

- 先确认它是否仍被下游读取。
- 若仍被系统侧使用，迁移到 `metadata` / `lineage` / debug，不要直接消失。
- 若只是模型误暴露字段，优先从 `manifest` 移除，再在系统侧保留引用。

### 可选输入字段

对于未来可能随时增加的上下文字段，例如字幕、音效、OCR，推荐规则是：

- 允许按能力逐步增加字段
- 字段本身要自描述
- 缺失时不影响基础流程
- 有内容时再进入 `manifest`

不要为了“通用性”先造一批长期为空的字段。

---

## 5. 日志与 Debug 要求

字段变更属于核心输入契约变更，必须满足通用 Debug 约束：

- stage log 记录本次输入摘要变化
- 必要时记录新的 `promptTemplateVersion` / `manifestHash`
- 普通日志只记摘要，不裸写完整敏感内容
- 复杂兼容或解析失败进入 `DebugSnapshot`

若字段变化影响缓存命中条件，还要同步检查 cache 参数是否应更新。

---

## 6. 最小检查清单

每次增字段前后，至少检查以下问题：

- 这个字段真的影响模型判断吗？
- 它是不是其实更适合放 `metadata` 或 `lineage`？
- 它是否让模型看到了不该看的系统字段？
- prompt 是否同步更新？
- repair 输入是否同步更新？
- 输出契约是否需要变化？
- cache key 是否需要纳入或排除该字段？
- stage log / DebugSnapshot 是否还能解释这次变更？
- 相关单测是否覆盖“字段在正确层、且不误暴露”？

---

## 7. 当前推荐实践

### `shot-boundary`

- `manifest` 放时间范围、字幕上下文、联表时间范围等判断信息
- `metadata` 放 `analysisSampling`、`sheetCount`、`sheetId`、`frameCount`
- `lineage` 放样例和上游产物来源

### `script-segment`

- `manifest` 放 `shots[].shotId/start/end/summary`、`commerceBrief`、必要的字幕等内容输入
- `visual-manifest` 放镜头联表与系统映射
- `metadata` 放目录、时长、画幅等运行信息
- `lineage` 放样例与上游 artifact 关系

以上规则优先保证：模型看的是判断信息，系统保留的是追踪信息。
