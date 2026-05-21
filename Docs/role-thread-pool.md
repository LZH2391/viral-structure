# Role Thread Pool

这份文档对应：

- `Infrastructure/AgentRuntime/agent_runtime/threadpool/manager.py`
- `Infrastructure/AgentRuntime/agent_runtime/threadpool/store.py`
- `Infrastructure/AgentRuntime/scripts/thread_pool_service.py`

当前仓库已经内置 shot-boundary 主链路所需的最小 ThreadPool runtime，不再默认依赖外部 `AE_WorkspaceCore` 目录。

## 模块分工

### `manager.py`

`ThreadPoolManager` 负责：

- 读取 `Infrastructure/ThreadPool/thread_roles.json`
- 维护 seed thread / idle thread / lease 生命周期
- 处理成功 release 回 idle
- 处理失败、孤儿 lease、不可恢复 thread 的 discard
- 输出 role status、health、config

### `store.py`

负责本地状态持久化：

- `catalog.json`
- `threads/*.json`
- `leases/*.json`

默认状态目录位于：

```text
_workspace/runtime/thread_pool
```

### `thread_pool_service.py`

FastAPI 服务入口，保留现有 HTTP API：

- `/health`
- `/config`
- `/roles/{role}/status`
- `/leases/acquire`
- `/leases/{lease_id}/touch`
- `/leases/{lease_id}/release`
- `/leases/release-owner`
- `/threads/{thread_id}/discard`

## 启动方式

默认通过仓库根目录脚本启动：

```powershell
.\start-api-server.ps1
```

脚本会优先使用：

```text
Infrastructure/AgentRuntime/scripts/thread_pool_service.py
```

如果显式设置了 `CEP_WORKSPACE_CORE_ROOT`，且本地 runtime 缺失，才回退到旧 CEP 路径做兼容对比。

## 当前边界

本次仅内置 shot-boundary 所需的 ThreadPool 最小闭包：

- 不迁 AE SDK
- 不迁 workstream driver
- 不修改现有前端 ThreadPool API 协议

Reviewer runtime 属于后续扩展位，不接入当前 shot-boundary 主链路。
