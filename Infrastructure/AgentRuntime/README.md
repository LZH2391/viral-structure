# AgentRuntime

`Infrastructure/AgentRuntime` 是仓库内置的本地 agent runtime。

它负责把后端分析 service 连接到 Codex AppServer 和 ThreadPool，不承载具体业务分析语义。

## 目录分工

- `agent_runtime/appserver/`：AppServer session client、transport、prompt 附件和 turn result 解析。
- `agent_runtime/threadpool/`：ThreadPool manager、lease store、role profile、seed pool 和 HTTP client。
- `scripts/thread_pool_service.py`：本地 ThreadPool FastAPI 服务入口。
- `agent_runtime/layout.py`、`storage.py`：运行时路径和本地存储 helper。

## 启动关系

通常由仓库根目录脚本统一启动：

```powershell
.\start-api-server.ps1
```

脚本会启动 Codex AppServer、ThreadPool 服务、API server 和 Workbench dev server。

## 运行时状态

Thread、lease、catalog、debug snapshot 等运行时状态不应提交到仓库。

默认运行产物位于本地 runtime 目录，具体位置由启动脚本和 store 配置决定。

## 相关文档

- `Docs/appserver-session-client.md`
- `Docs/role-thread-pool.md`
- `Docs/Architecture/新增ThreadPoolRole标准路线.md`

## 接入约束

- AppServer 对话内容只能通过受控摘要进入普通日志。
- ThreadPool lease 必须能在成功、失败和中断时闭环。
- 新增 role 时，profile、skill、service、artifact、cache、DebugSnapshot 和测试要一起补齐。
- 不要在 AgentRuntime 中加入具体业务判断；业务字段应留在 API service、descriptor 或 role profile 中。
