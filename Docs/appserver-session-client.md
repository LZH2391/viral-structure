# App-Server Session Client

这份文档对应：

- `ae_workspace_core/appserver/client.py`
- `ae_workspace_core/appserver/transport_ws.py`
- `ae_workspace_core/appserver/reviewer_runtime.py`

在本仓库内置化之后，对应实现位于：

- `Infrastructure/AgentRuntime/agent_runtime/appserver/client.py`
- `Infrastructure/AgentRuntime/agent_runtime/appserver/transport_ws.py`
- `Infrastructure/AgentRuntime/agent_runtime/appserver/transport_stdio.py`

它们共同负责 reviewer thread / turn 生命周期，以及本地到 app-server 的 websocket 长连接。

## 模块分工

### `client.py`

`AppServerSessionClient` 是主入口。它负责：

- 建立和关闭 transport
- `thread/read`、`thread/resume`
- `turn/start`
- 本地缓存 turn 状态
- 注册 `turn/completed` listener
- 补查 thread 真值

高频入口包括：

- `start_turn(...)`
- `collect_turn_result(...)`
- `wait_turn_result(...)`
- `get_thread_input_tokens(...)`
- `submit_review(...)`
- `ensure_reviewer_ready(...)`

### `transport_ws.py`

`WebSocketTransport` 负责 websocket 层：

- 启动本地 `codex app-server --listen ws://...` 或连接既有地址
- 发送 request / notify
- reader 循环消费 response / event / tool call
- 在连接异常时让 pending request 失败并释放 socket

当前实现里，tool call 不再在 reader 线程里同步执行，而是分派到 worker，避免 reader 被慢工具调用卡住。

### `reviewer_runtime.py`

`AppServerReviewerRuntime` 是 reviewer 侧的长驻包装：

- 持有同一个 `AppServerSessionClient`
- 初始化或复用同一个 reviewer thread
- 适合同一个 reviewer 连续多轮送审

它不负责多 `part` 调度；那是 `WorkstreamRuntime` 的工作。

## Thread、Turn、Client 三层关系

- `thread`
  reviewer 的对话容器，保存历史消息和 turn
- `turn`
  thread 里的一次具体执行
- `client`
  当前本地常驻进程里持有 websocket 连接和 turn 状态缓存的对象

复用同一批 reviewer slot 背后的 thread，不等于重建一个新的 client。  
真实 stepwise 调试里，要同时尽量复用：

- 同一轮 workstream 当前已绑定的 reviewer slot thread
- 同一个常驻 `AppServerSessionClient`
- 同一个常驻 `WorkstreamRuntime`

## Turn 发起与回收

### 发起

当前发 turn 的主入口是 `start_turn(...)`。

它支持的核心输入是：

- `text`
- `skill_path`
- `cwd`
- `sandbox_policy`

其中 `skill_path` 会作为独立的 `skill` input 传给 app-server，不是把 skill 文本拼进 prompt。

### 回收

回收有两条路径：

1. live event
   `turn/completed` 到达当前长连接时，client 会更新本地 turn 缓存并通知 listener
2. 补查
   `collect_turn_result(...)` 会读取本地缓存；如果状态缺失或仍是非终态，就主动 `thread/read` 补查真值

这里要把“观察到 completion event”和“真正让上层状态推进”区分开：

- `turn/completed` 一旦命中当前 inflight turn，就立刻应用 review / produce 结果
- 然后继续自动 `advance_to_boundary()`
- 如果 event 到达瞬间 session 正被别的操作占着锁，auto-resume 也不会丢；driver 会登记 pending auto-resume，等锁释放后补跑

这里的“非终态”包括：

- `running`
- `inProgress`

所以当前实现不会盲信旧的 `inProgress` 缓存。

### 上下文占用读取

`get_thread_input_tokens(...)` 会对目标 thread 做一次 `thread/read(include_turns=True)`，然后从最近一次 turn 里提取 `last_token_usage.input_tokens`。

这个接口给上层 runtime 做 thread 退休判断用；它只负责读数，不负责决定要不要换 thread。

## 为什么还需要补查

live event 是最快路径，但不是唯一真相来源。

如果常驻连接漏掉了 completion event，thread 里的真实 turn 仍可能已经结束。  
这时必须靠 `collect_turn_result(...)` 从 thread 补查终态，否则上层 runtime 会一直以为 review 还在 `in_review`。

当前实现还做了两层兜底：

- app-server `initialize` 若返回 `Already initialized`，client 会把它当成幂等重入，而不是直接把长连接打坏
- runtime 在常驻 client 的 `collect_turn_result(...)` 失败时，会再起一个 fresh client 做一次补查，避免 review 明明已经给出终态 JSON，却只因为旧长连接状态脏掉而长期停在 `in_review`

## 共享 client

正式宿主推荐用 shared client 生命周期：

- `start_shared_app_server_client(...)`
- `get_shared_app_server_client()`
- `close_shared_app_server_client()`

这样应用内多个调用点能复用同一条长连接，不会每次都重建 transport。

## 与上层的边界

- `client.py / transport_ws.py / reviewer_runtime.py`
  负责 thread、turn、transport
- `part_flow.py`
  负责 `part` 状态机
- `workstream/runtime.py`
  负责多 `part` 调度、inflight review 管理和 step 推进
- `sdk/recovery.py`
  负责显式 RUN 恢复、driver session recover 和 executor pump 接管

不要把业务状态真相放回 thread；thread 是 reviewer 执行上下文，不是 `part` 真相。

也不要在 app-server client 的 `thread/resume` 语义上承载 SDK RUN 恢复。恢复旧 RUN 必须走 `resume_run / recover_run` 或 CLI `resume / recover`，查询和 thread 补查都不能隐式启动新的 driver session 或 pump。
