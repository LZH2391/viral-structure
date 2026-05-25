# ThreadPool Config

`Infrastructure/ThreadPool` 保存 ThreadPool 的仓库内配置。

当前目录只包含 role 配置，不保存运行时 thread、lease 或 AppServer 对话状态。

## 当前入口

- `thread_roles.json`

运行时实现位于：

- `Infrastructure/AgentRuntime/agent_runtime/threadpool/`
- `Infrastructure/AgentRuntime/scripts/thread_pool_service.py`

长期说明见：

- `Docs/role-thread-pool.md`
- `Docs/Architecture/新增ThreadPoolRole标准路线.md`

## 配置职责

`thread_roles.json` 定义每个 role 的：

- role 名称。
- profile 路径。
- 最小 idle thread 数。

role 名称必须与以下位置保持一致：

- `Assets/RoleProfiles/<role>/role.json`
- `.agents/skills/<role>/SKILL.md`
- 后端 service / descriptor 中的 `role`

## 约束

- 不提交本地 runtime 状态、lease、thread catalog 或对话内容。
- 新增 role 前先确认是否真的需要独立 role。
- role profile、prompt template、service、artifact、cache 和 DebugSnapshot 要一起形成闭环。
- 失败和中断必须能释放 lease 或 discard 不可恢复 thread。
