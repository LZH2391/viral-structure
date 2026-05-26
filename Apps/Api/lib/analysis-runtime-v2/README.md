# Analysis Runtime v2

`analysis-runtime-v2` 是脚本段落、节奏结构、包装结构等 role-service 类分析能力共享的运行时骨架。

它不定义某个具体 role 的业务语义。具体输入、prompt、校验、修复、cache 参数和 artifact 写入由各 role 的 pipeline descriptor 提供。

## 模块分工

- `role-service.js`：对外 service 工厂，提供 `enqueue` 和 `resolveCacheDecision`。
- `pipeline-runner.js`：按 descriptor 串起 cache、输入准备、ThreadPool、AppServer、校验、修复和 materialize。
- `stage-runtime.js`：stage start/end/fail、DebugSnapshot 和失败 artifact 处理。
- `job-runtime.js`：任务状态、cache waiting、resume、complete。
- `thread-runtime.js`：ThreadPool turn 状态、active thread message 更新。
- `materialize-runtime.js`：cache reuse 或结果写入后同步 artifact index。
- `cache-runtime.js`：统一 cache prompt、dependency、analysisOptions。
- `shot-boundary-cache.js`：依赖切镜结果的 role-service 共享 cache lookup、cache prompt 和 cache reuse 流程。
- `appserver-turn-runner.js`：共享 ThreadPool lease、AppServer turn 启动、轮询收集和 turn 状态判断。
- `agent-run.js`：共享 Codex AppServer agentRun 元数据构造和完成态更新。
- `artifact-writer.js`：共享分析产物写入、artifact 挂载和历史追加外壳。
- `analysis-history.js`：共享历史记录公共字段，role 只补充自己的计数字段和来源字段。
- `dependency-contract.js`：上游 artifact 依赖校验。
- `thread-message.js`：运行中的线程消息规范化。

## Descriptor 责任

调用方必须通过 descriptor 或 definition 提供：

- role、skill path、stage 列表。
- 输入准备和输入包生成。
- analyze / repair prompt template。
- 模型输出解析和结构校验。
- cache fingerprint 和 cache reuse materialize。
- 成功 / 失败 artifact 构建与写入。
- safe error 和 DebugSnapshot payload 脱敏策略。

运行时负责执行顺序和追踪，不负责替某个 role 猜业务字段。

## Debug 要求

所有使用该 runtime 的能力必须保持：

- 每个核心 stage 有 `stage.start / stage.end / stage.fail`。
- 普通 stage log 只记录摘要。
- 失败写受控 DebugSnapshot。
- cache reuse / refresh 保留 artifact lineage。
- ThreadPool lease、threadId、turnId 能追到 job 和 trace。

具体要求见 `Docs/Architecture/Debug追踪规范.md`。
