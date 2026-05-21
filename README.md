# 爆款结构迁移引擎

本仓库用于建设面向短视频创作的 AI 创作平台。核心目标不是直接生成视频，而是从优质样例中拆解可迁移的创作结构，并迁移到用户的新主题、商品或素材中。

当前项目仍处于本地原型和能力验证阶段，依赖 Windows 本地运行环境、媒体处理工具和本地 AppServer / ThreadPool 服务。公开仓库中不包含运行时素材、调试快照、API 密钥或本地工作区状态。

## 目录结构

当前工程骨架按职责分为：

- `Apps`：对外入口，包括创作工作台和 API 编排入口。
- `Core`：爆款结构迁移的核心业务能力。
- `Infrastructure`：模型、媒体、存储、日志、配置等工程支撑。
- `Assets`：prompt、结构 schema、评估标准等高频变化资产。
- `Runtime`：本地运行产物，默认不入库。
- `Docs`：长期产品、领域和架构文档。
- `PlanMD`：阶段计划和讨论过程。

长期架构约束以 `Docs/Architecture` 为准；`PlanMD` 只记录阶段性计划和讨论结果。

## 环境要求

- Windows PowerShell
- Node.js 18+
- Python 3.10+
- FFmpeg，可通过 `FFMPEG_BIN` / `FFPROBE_BIN` 指向本机安装路径
- Codex AppServer 本地可启动
- Python 依赖：`pydantic`、`websocket-client`、`fastapi`、`uvicorn`
- 可选：讯飞 IAT 凭据，用于字幕识别

## 安装

```powershell
npm install
```

如需运行本仓库内置的 AgentRuntime / ThreadPool，请额外安装 Python 依赖：

```powershell
python -m pip install pydantic websocket-client fastapi uvicorn
```

## 启动

推荐使用根目录脚本启动本地 API、Workbench 和相关本地服务：

```powershell
.\start-api-server.ps1
```

工作台默认地址：

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

## 常用环境变量

本项目不提交 `.env` 文件。需要的本地配置请通过系统环境变量、PowerShell 会话变量或本地私有脚本注入。

- `PYTHON_RUNTIME_ROOT`：本仓库内置 AgentRuntime 根目录，默认 `Infrastructure\AgentRuntime`。
- `CEP_WORKSPACE_CORE_ROOT`：兼容旧版 CEP Workspace Core 的 fallback 根目录，非默认必需项。
- `CODEX_APP_SERVER_WS_URL`：AppServer websocket 地址，默认 `ws://127.0.0.1:8146`。
- `THREADPOOL_BASE_URL`：ThreadPool HTTP 服务地址。
- `THREADPOOL_PORT`：本地 ThreadPool 端口。
- `FFMPEG_BIN`：本机 FFmpeg 可执行文件路径。
- `FFPROBE_BIN`：本机 FFprobe 可执行文件路径。
- `XFYUN_APP_ID`：讯飞应用 ID。
- `XFYUN_API_KEY`：讯飞 API Key。
- `XFYUN_API_SECRET`：讯飞 API Secret。

## 测试

```powershell
npm test
```

可单独运行关键回归测试：

```powershell
node --test Tests/unit/threadpool-shot-boundary.test.js Tests/unit/artifact-index.test.js Tests/unit/frontend-trace.test.js
```

## 本地产物

以下目录只用于本地运行和调试，不应提交：

- `Runtime/Uploads`
- `Runtime/Artifacts`
- `Runtime/ArtifactIndex`
- `Runtime/DebugSnapshots`
- `Runtime/Jobs`
- `Runtime/Temp`
- `_workspace`
- `MP4`
- `ffmpeg-*`
- `node_modules`

如果运行后出现上述目录内文件被 Git 跟踪，应先从索引移除，再提交：

```powershell
git rm --cached -r Runtime/Jobs _workspace
```

## 发布前检查

公开推送前建议执行：

```powershell
npm test
git status --short
```

确认没有 `.env`、运行素材、调试快照、ThreadPool lease/thread 状态、真实 API 密钥或本地隐私路径进入提交。

## AgentRuntime 说明

shot-boundary 主链路现在默认使用仓库内置的轻量 AgentRuntime：

- `Infrastructure/AgentRuntime/agent_runtime/appserver`
- `Infrastructure/AgentRuntime/agent_runtime/threadpool`
- `Infrastructure/AgentRuntime/scripts/thread_pool_service.py`

这套 runtime 只覆盖当前课题所需的 AppServer Session Client 和 Role ThreadPool 最小闭包，不包含 AE 工作流、SDK、workstream 平台。`CEP_WORKSPACE_CORE_ROOT` 仅保留为兼容回退路径，便于对比回归。
