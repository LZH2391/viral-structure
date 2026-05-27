const { test, assert, fs, path, vm, ts, read, readPropertyPanelCss } = require("./frontend-trace.helpers");

test("rhythm and packaging structure skills are registered as independent analyzers", () => {
  const root = path.resolve(__dirname, "../..");
  const rhythmSkill = read(root, ".agents/skills/rhythm-structure-analyzer/SKILL.md");
  const packagingSkill = read(root, ".agents/skills/packaging-structure-analyzer/SKILL.md");
  const rhythmRole = read(root, "Assets/RoleProfiles/rhythm-structure-analyzer/role.json");
  const packagingRole = read(root, "Assets/RoleProfiles/packaging-structure-analyzer/role.json");
  const roles = read(root, "Infrastructure/ThreadPool/thread_roles.json");
  const server = read(root, "Apps/Api/server.js");

  assert.match(rhythmSkill, /name: rhythm-structure-analyzer/);
  assert.match(rhythmSkill, /不重切 shot/);
  assert.match(packagingSkill, /name: packaging-structure-analyzer/);
  assert.doesNotMatch(packagingSkill, /占位版本/);
  assert.match(packagingSkill, /不依赖 `scriptSegmentAnalysis` 或 `rhythmStructureAnalysis`/);
  assert.match(packagingSkill, /subtitleText/);
  assert.match(packagingSkill, /subtitleContextText/);
  assert.match(packagingSkill, /visualRefs/);
  assert.match(rhythmRole, /"turnTemplates": \{/);
  assert.match(rhythmRole, /"analyze"/);
  assert.match(rhythmRole, /"repair"/);
  assert.doesNotMatch(packagingRole, /"status": "placeholder"/);
  assert.match(packagingRole, /"turnTemplates": \{/);
  assert.match(packagingRole, /"analyze"/);
  assert.match(packagingRole, /"repair"/);
  assert.match(roles, /rhythm-structure-analyzer/);
  assert.match(roles, /packaging-structure-analyzer/);
  assert.match(server, /rhythm-structure/);
  assert.match(server, /packaging-structure/);
});

test("findCurrentShot uses half-open ranges and keeps final boundary inclusive", async () => {
  const root = path.resolve(__dirname, "../..");
  const source = read(root, "Apps/Workbench/src/utils/workbenchHelpers.ts");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } });
  const exports = {};
  vm.runInNewContext(compiled.outputText, {
    exports,
    require: () => ({
      getLibraryItemDetail: async () => null,
      getProcessingJob: async () => null,
      getSampleArtifact: async () => null,
      getThreadPoolRoleStatus: async () => null,
      listAnalysisRoles: () => [],
      startAnalysisRole: async () => null,
      startRhythmStructureAnalysis: async () => null,
      startShotBoundaryAnalysis: async () => null,
      startScriptSegmentAnalysis: async () => null,
    }),
  });
  const { findCurrentShot } = exports;
  const shots = [
    { id: "shot_1", index: 0, start: 0, end: 1, representativeFrameId: "frame_1", confidence: 0.9, reason: "start" },
    { id: "shot_2", index: 1, start: 1, end: 2, representativeFrameId: "frame_2", confidence: 0.9, reason: "middle" },
    { id: "shot_3", index: 2, start: 2, end: 3, representativeFrameId: "frame_3", confidence: 0.9, reason: "end" },
  ];

  assert.equal(findCurrentShot(shots, 0.5)?.id, "shot_1");
  assert.equal(findCurrentShot(shots, 1)?.id, "shot_2");
  assert.equal(findCurrentShot(shots, 2)?.id, "shot_3");
  assert.equal(findCurrentShot(shots, 3)?.id, "shot_3");
  assert.equal(findCurrentShot(shots, 3.01), null);
});

test("appserver bridge and startup script use local agent runtime", () => {
  const root = path.resolve(__dirname, "../..");
  const bridge = read(root, "Apps/Api/lib/gateways/appserver/bridge.js");
  const bridgePy = read(root, "Apps/Api/lib/gateways/appserver/bridge.py");
  const legacyBridgePy = read(root, "Apps/Api/lib/appserver_bridge.py");
  const startup = read(root, "start-api-server.ps1");

  assert.match(bridge, /DEFAULT_PYTHON_RUNTIME_ROOT/);
  assert.match(bridge, /pythonRuntimeRoot = process\.env\.PYTHON_RUNTIME_ROOT \|\| DEFAULT_PYTHON_RUNTIME_ROOT/);
  assert.match(bridge, /async function readThread/);
  assert.match(bridgePy, /from agent_runtime\.appserver\.client import AppServerSessionClient/);
  assert.match(bridgePy, /if operation == "readThread"/);
  assert.match(bridgePy, /client\.read_thread\(str\(payload\["threadId"\]\), include_turns=True\)/);
  assert.match(bridgePy, /local_runtime_root/);
  assert.match(bridgePy, /structured_error\("appserver_bridge_failed"/);
  assert.match(bridgePy, /except Exception as exc:/);
  assert.match(legacyBridgePy, /gateways.*appserver.*bridge\.py/);
  assert.match(startup, /\$env:PYTHON_RUNTIME_ROOT/);
  assert.match(startup, /Join-Path \$env:PYTHON_RUNTIME_ROOT "scripts\\thread_pool_service\.py"/);
  assert.match(startup, /function Test-ThreadPoolReady/);
  assert.match(startup, /\[bool\]\$payload\.ok/);
  assert.match(startup, /thread_pool_service/);
  assert.doesNotMatch(startup, /return \[bool\]\$payload\.ready_for_leases/);
  assert.match(startup, /Resolve-CommandPathOrNull @\("codex\.cmd", "codex\.exe"\)/);
  assert.match(startup, /function Test-DirectStartCommandPath/);
  assert.match(startup, /"\.exe", "\.cmd", "\.bat", "\.com"/);
  assert.doesNotMatch(startup, /Resolve-CommandPathOrNull @\("codex\.exe", "codex", "codex\.cmd"\)/);
  assert.match(startup, /\$\(.*Spec\.Name.*\) ready\./);
  assert.match(startup, /startup time \$\(\[math\]::Round/);
  assert.doesNotMatch(startup, /THREADPOOL_ALLOWED_ROLES/);
  assert.equal(bridge.includes("cepRoot"), false);
  assert.equal(bridgePy.includes("cepRoot"), false);
});

test("appserver collect exposes active thread message without final residue", () => {
  const root = path.resolve(__dirname, "../..");
  const client = read(root, "Infrastructure/AgentRuntime/agent_runtime/appserver/client.py");
  const bridgePy = read(root, "Apps/Api/lib/gateways/appserver/bridge.py");
  const shotService = read(root, "Apps/Api/lib/shot-boundary/service.js");
  const scriptService = read(root, "Apps/Api/lib/script-segment/service.js");
  const shared = read(root, "Apps/Api/lib/compatibility/analysis-service-shared.js");

  assert.match(client, /active_thread_message: str \| None = None/);
  assert.match(client, /_turn_active_thread_messages/);
  assert.match(client, /_extract_turn_active_thread_message\(turn, status=status\)/);
  assert.match(client, /if not _is_non_terminal_turn_status\(status\):[\s\S]*_turn_active_thread_messages\.pop\(turn_id, None\)/);
  assert.match(bridgePy, /"activeThreadMessage": result\.active_thread_message/);
  assert.match(bridgePy, /"turnActivity": turn_activity/);
  assert.match(bridgePy, /def inspect_turn_activity\(client, payload\):/);
  assert.match(bridgePy, /"latestMessagePreview": snapshot\.latest_message_preview/);
  assert.match(bridgePy, /"activeThreadMessage": message\[:1200\]/);
  assert.match(shotService, /buildActiveThreadMessage\(threadId, turnId, message, status, options = \{\}\)/);
  assert.match(shotService, /String\(message \?\? ""\)\.trim\(\) \|\| String\(options\.fallbackMessage \?\? ""\)\.trim\(\)/);
  assert.match(shotService, /fallbackMessage: "正在分析镜头边界"/);
  assert.match(shared, /createAnalysisRuntimeV2/);
  const runtimeThread = read(root, "Apps/Api/lib/analysis-runtime-v2/thread-runtime.js");
  assert.match(runtimeThread, /buildActiveThreadMessage\(\s*turn\?\.threadId,\s*turn\?\.turnId,\s*turn\?\.activeThreadMessage,\s*turn\?\.status,\s*\)/);
  assert.match(shotService, /if \(normalized \|\| !isPendingTurnStatus\(status\)\)/);
  assert.match(runtimeThread, /buildAgentActivityFromTurnResult\(turn\)/);
  assert.match(runtimeThread, /if \(activeThreadMessage \|\| agentActivity \|\| !isPendingTurnStatus\(turn\?\.status\)\)/);
  const turnResult = read(root, "Infrastructure/AgentRuntime/agent_runtime/appserver/turn_result.py");
  const events = read(root, "Infrastructure/AgentRuntime/agent_runtime/appserver/events.py");
  assert.match(events, /latest_message_preview: str \| None = None/);
  assert.match(turnResult, /_summarize_latest_turn_activity_item\(items\)/);
  assert.match(turnResult, /"kind": "tool_result"/);
  assert.match(scriptService, /runtime\.updateActiveThreadMessage\(context, turn\)/);
  assert.match(shotService, /activeThreadMessage: null/);
  assert.match(scriptService, /activeThreadMessage: null/);
});

test("workbench api client safely parses empty and invalid JSON responses", () => {
  const root = path.resolve(__dirname, "../..");
  const client = read(root, "Apps/Workbench/src/api/client.ts");

  assert.match(client, /export async function readJsonResponse/);
  assert.match(client, /parseJsonResponse/);
  assert.match(client, /summarizeResponseText/);
  assert.match(client, /responseBodySnippet/);
  assert.match(client, /responseContentType/);
  assert.match(client, /API 返回了非 JSON 响应/);
});

test("workbench api client safely parses empty and invalid JSON responses", async () => {
  const root = path.resolve(__dirname, "../..");
  const source = read(root, "Apps/Workbench/src/api/client.ts");
  assert.match(source, /readJsonResponse/);
  assert.match(source, /parseJsonResponse/);
  assert.match(source, /summarizeResponseText/);
  assert.match(source, /responseBodySnippet/);
  assert.match(source, /responseContentType/);
  assert.match(source, /API 返回了非 JSON 响应/);
});

test("workbench workspace layout supports persisted splitters", () => {
  const root = path.resolve(__dirname, "../..");
  const app = read(root, "Apps/Workbench/src/components/WorkbenchApp.tsx");
  const workspaceView = read(root, "Apps/Workbench/src/components/workbench/WorkbenchWorkspaceView.tsx");
  const hook = read(root, "Apps/Workbench/src/hooks/useResizableWorkspaceLayout.ts");
  const handle = read(root, "Apps/Workbench/src/components/WorkspaceResizeHandle.tsx");
  const splitHandle = read(root, "Apps/Workbench/src/components/SplitResizeHandle.tsx");
  const layoutCss = read(root, "Apps/Workbench/styles/layout.css");
  const responsiveCss = read(root, "Apps/Workbench/styles/responsive.css");

  assert.match(app, /useResizableWorkspaceLayout/);
  assert.match(workspaceView, /WorkspaceResizeHandle/);
  assert.match(app, /workspaceGridRef/);
  assert.match(hook, /workbench:layout/);
  assert.match(hook, /clampWorkspaceLayout/);
  assert.match(hook, /setProperty\("--workspace-left-width"/);
  assert.match(hook, /setProperty\("--workspace-right-width"/);
  assert.match(hook, /setProperty\("--workspace-timeline-height"/);
  assert.match(splitHandle, /role="separator"/);
  assert.match(splitHandle, /onDoubleClick=\{onReset\}/);
  assert.match(splitHandle, /ArrowRight/);
  assert.match(handle, /onReset=\{\(\) => onReset\(kind\)\}/);
  assert.match(layoutCss, /grid-template-areas:[\s\S]*left-resizer[\s\S]*right-resizer[\s\S]*timeline-resizer/);
  assert.match(layoutCss, /\.workspace-resize-handle/);
  assert.match(layoutCss, /body\.is-resizing-workspace/);
  assert.match(responsiveCss, /max-width: 980px[\s\S]*\.workspace-resize-handle[\s\S]*display: none/);
});

test("full analysis splitters control top row, row height, and bottom row independently", () => {
  const root = path.resolve(__dirname, "../..");
  const app = read(root, "Apps/Workbench/src/components/FullAnalysisApp.tsx");
  const stageStep = read(root, "Apps/Workbench/src/components/full-analysis/FullAnalysisStageStep.tsx");
  const api = read(root, "Apps/Workbench/src/api/client.ts");
  const draft = read(root, "Apps/Workbench/src/utils/fullAnalysisDraft.ts");
  const hook = read(root, "Apps/Workbench/src/hooks/useResizableGridLayout.ts");
  const css = read(root, "Apps/Workbench/styles/full-analysis.css");

  assert.match(app, /leftCssVar: "--full-analysis-left-width"/);
  assert.match(app, /topCssVar: "--full-analysis-top-height"/);
  assert.match(app, /bottomLeftCssVar: "--full-analysis-bottom-left-width"/);
  assert.match(app, /className="full-analysis-top-row"[\s\S]*layout\.startResize\("column", event\)/);
  assert.match(app, /className="workspace-resize-handle full-analysis-row-resizer"[\s\S]*layout\.startResize\("top-row", event\)/);
  assert.match(app, /className="full-analysis-bottom-row"[\s\S]*layout\.startResize\("bottom-row", event\)/);
  assert.match(app, /checkFullAnalysisUploadCache/);
  assert.match(app, /setUploadCachePrompt/);
  assert.match(app, /readFullAnalysisDraft/);
  assert.match(app, /writeFullAnalysisDraft/);
  assert.match(app, /getLatestFullAnalysisRun/);
  assert.match(app, /restoredRunRef/);
  assert.match(app, /onWorkbenchSync/);
  assert.match(app, /onOpenWorkbenchStage/);
  assert.doesNotMatch(app, /getThreadConversation/);
  assert.doesNotMatch(app, /workflow-step-thread/);
  assert.doesNotMatch(app, /resolveThreadMessages/);
  assert.match(stageStep, /role=\{onOpenStage \? "button" : undefined\}/);
  assert.match(stageStep, /event\.stopPropagation\(\);[\s\S]*onRerun\(stage\.key\)/);
  assert.match(api, /\/api\/workflows\/full-analysis\/cache-check/);
  assert.match(api, /\/api\/workflows\/full-analysis\/latest/);
  assert.match(api, /cache: "no-store"/);
  assert.match(draft, /FULL_ANALYSIS_DRAFT_STORAGE_KEY = "full-analysis:last-run"/);
  assert.match(draft, /localStorage\.setItem\(FULL_ANALYSIS_DRAFT_STORAGE_KEY, JSON\.stringify/);
  assert.match(draft, /localStorage\.getItem\(FULL_ANALYSIS_DRAFT_STORAGE_KEY\)/);
  assert.match(css, /\.full-analysis-main \{[\s\S]*grid-template-rows: var\(--full-analysis-top-height/);
  assert.match(css, /\.full-analysis-shell \{[\s\S]*overflow: auto/);
  assert.match(css, /\.full-analysis-top-row \{[\s\S]*grid-template-columns: var\(--full-analysis-left-width/);
  assert.match(css, /\.full-analysis-bottom-row \{[\s\S]*grid-template-columns: var\(--full-analysis-bottom-left-width/);
  assert.match(css, /\.workflow-step\.is-clickable/);
  assert.doesNotMatch(css, /\.workflow-step-thread/);
  assert.match(hook, /if \(drag\.kind === "column"\) next\.left = drag\.startLayout\.left \+ event\.clientX - drag\.startX/);
  assert.match(hook, /if \(drag\.kind === "top-row"\) next\.top = drag\.startLayout\.top \+ event\.clientY - drag\.startY/);
  assert.match(hook, /if \(drag\.kind === "bottom-row"\) next\.bottomLeft = drag\.startLayout\.bottomLeft \+ event\.clientX - drag\.startX/);
});

test("workbench workspace layout clamp keeps panel sizes in range", async () => {
  const root = path.resolve(__dirname, "../..");
  const source = read(root, "Apps/Workbench/src/hooks/useResizableWorkspaceLayout.ts");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } });
  const exports = {};
  vm.runInNewContext(compiled.outputText, {
    exports,
    require: () => ({ useCallback: (value) => value, useEffect: () => undefined, useRef: (current) => ({ current }) }),
  });
  const { clampWorkspaceLayout } = exports;
  const grid = { getBoundingClientRect: () => ({ width: 1000 }) };

  const plain = (value) => JSON.parse(JSON.stringify(value));
  assert.deepEqual(plain(clampWorkspaceLayout({ left: 100, right: 100, timeline: 80 }, grid)), { left: 220, right: 260, timeline: 150 });
  assert.deepEqual(plain(clampWorkspaceLayout({ left: 900, right: 900, timeline: 900 }, grid)), { left: 308, right: 260, timeline: 360 });
  assert.deepEqual(plain(clampWorkspaceLayout({ left: 260, right: 320, timeline: 190 }, grid)), { left: 260, right: 308, timeline: 190 });
});
