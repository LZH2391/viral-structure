# 爆款结构迁移引擎

本仓库用于建设面向短视频创作的 AI 创作平台。核心目标不是直接生成视频，而是从优质样例中拆解可迁移的创作结构，并迁移到用户的新主题、商品或素材中。

当前项目仍处于本地原型和能力验证阶段，依赖 Windows 本地运行环境、媒体处理工具和本地 AppServer / ThreadPool 服务。公开仓库中不包含运行时素材、调试快照、API 密钥或本地工作区状态。

## 目录结构

当前工程按职责分为：

- `Apps`：对外入口，包括创作工作台和 API 编排入口。
- `Core`：核心业务契约与领域边界；当前真实代码主要在 `Core/Workspace`。
- `Infrastructure`：模型、媒体、存储、日志和运行时工程支撑。
- `Assets`：prompt、role profile、schema、评估标准等可调整资产；只在有实际资产时建子目录。
- `Runtime`：本地运行产物，默认不入库。
- `Docs`：长期架构文档；产品和领域说明只有形成真实内容时再建目录。

长期架构约束以 `Docs/Architecture` 为准。阶段讨论和本地计划不作为公开仓库内容提交。

## 关键架构文档

- [基础架构约束](Docs/Architecture/基础架构约束.md)：通用边界、追踪、返工和文件粒度约束。
- [Debug 追踪规范](Docs/Architecture/Debug追踪规范.md)：stage log、DebugSnapshot、artifact lineage 的硬性要求。
- [模块注册体系](Docs/Architecture/模块注册体系.md)：模块 descriptor、executor registry、workflow descriptor 和前端安全投影的权威边界。
- [Analysis Role Registry](Docs/Architecture/Analysis%20Role%20Registry.md)：旧分析入口兼容层，已委托给模块注册体系。
- [新增 ThreadPool Role 标准路线](Docs/Architecture/新增ThreadPoolRole标准路线.md)：新增 role/profile/service/thread lease 闭环的标准步骤。

## 环境要求

- Windows PowerShell
- Node.js 18+
- Python 3.10+
- FFmpeg，可通过 `FFMPEG_BIN` / `FFPROBE_BIN` 指向本机安装路径
- Codex AppServer 本地可启动
- Python 依赖：`pydantic`、`websocket-client`、`fastapi`、`uvicorn`
- 可选：豆包 SAUC 凭据，用于字幕识别

## 安装

```powershell
npm install
```

如需运行本仓库内置的 AgentRuntime / ThreadPool，请额外安装 Python 依赖：

```powershell
python -m pip install pydantic websocket-client fastapi uvicorn
```

## 启动

推荐使用根目录脚本启动完整本地栈：

```powershell
.\start-api-server.ps1
```

脚本会启动：

- Codex AppServer：`codex app-server --listen ws://127.0.0.1:8146`
- ThreadPool：`Infrastructure\AgentRuntime\scripts\thread_pool_service.py`
- API server：`Apps\Api\server.js`
- Workbench：Vite dev server

默认访问地址：

```text
http://127.0.0.1:5177/
```

调试追踪页：

```text
http://127.0.0.1:5177/debug
```

ThreadPool 页面：

```text
http://127.0.0.1:5177/threadpool
```

## 本地服务配置

启动脚本默认使用以下端口：

- API server：`5177`
- Workbench dev server：`5178`
- Codex AppServer：`8146`
- ThreadPool：`8877`

AppServer 需要本机已安装并可执行 `codex` CLI。脚本通过 `APP_SERVER_URL` 配置 AppServer websocket 地址，并同步写入 `CODEX_APP_SERVER_WS_URL` 供 API bridge 和 ThreadPool 使用。

ThreadPool 通过 `THREADPOOL_CONFIG_PATH` 读取角色配置，默认使用：

```text
Infrastructure\ThreadPool\thread_roles.json
```

AgentRuntime 默认从仓库内置目录加载：

```text
Infrastructure\AgentRuntime
```

## 常用环境变量

本项目不提交 `.env` 文件。需要的本地配置请通过系统环境变量、PowerShell 会话变量或本地私有脚本注入。

- `PORT`：API server 端口，默认 `5177`。
- `VITE_PORT`：Workbench dev server 端口，默认 `5178`。
- `APP_SERVER_URL`：启动 Codex AppServer 使用的 websocket 地址，默认 `ws://127.0.0.1:8146`。
- `PYTHON_RUNTIME_ROOT`：本仓库内置 AgentRuntime 根目录，默认 `Infrastructure\AgentRuntime`。
- `CODEX_APP_SERVER_WS_URL`：API bridge 和 ThreadPool 连接 AppServer 使用的 websocket 地址，通常由启动脚本从 `APP_SERVER_URL` 写入。
- `THREADPOOL_BASE_URL`：ThreadPool HTTP 服务地址。
- `THREADPOOL_PORT`：本地 ThreadPool 端口。
- `THREADPOOL_CONFIG_PATH`：ThreadPool 角色配置文件路径。
- `FFMPEG_BIN`：本机 FFmpeg 可执行文件路径。
- `FFPROBE_BIN`：本机 FFprobe 可执行文件路径。
- `DOUBAO_Api_App_Key`：豆包 SAUC 应用 Key。
- `DOUBAO_Api_Access_Key`：豆包 SAUC Access Key。
- `DOUBAO_SAUC_RESOURCE_ID`：豆包 SAUC 资源 ID，默认 `volc.bigasr.sauc.duration`。
