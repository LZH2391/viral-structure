# Workbench

创作工作台，用于承载用户可见的创作流程。

重点职责：

- 样例视频输入与状态展示。
- 爆款结构拆解结果展示。
- 用户新内容输入。
- 新方案展示、对比和编辑。
- 多版本、分支和返工入口。

工作台只表达用户体验和交互流程，核心业务判断应下沉到 `Core`。

## React + TypeScript 入口

当前工作台由 React + TypeScript 实现，通过 Vite 构建：

- `src/main.tsx`：工作台入口。
- `src/debug.tsx`：运行追踪页入口。
- `src/components/`：React 页面和面板组件。
- `src/api/client.ts`：前端 API 访问层。
- `src/types.ts`：前端共享类型。
- `styles.css`：样式入口，按区域引入 `styles/` 下的布局、面板、预览和时间线样式。

源码目录分工和分析能力接入规则见 [src/README.md](src/README.md)。

首次或源码变更后先构建：

```powershell
npm install
npm run build:workbench
```

再启动 API 并通过 HTTP 打开：

```powershell
.\start-api-server.bat
```

访问地址为 `http://127.0.0.1:5177/`，运行追踪页为 `http://127.0.0.1:5177/debug`。当前实现接入真实样例视频上传、任务轮询和本地 Runtime 产物展示，不调用模型、不生成正式视频。
