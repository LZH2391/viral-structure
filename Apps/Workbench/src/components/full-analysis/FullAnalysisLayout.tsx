import type { Dispatch, RefObject, SetStateAction } from "react";
import type { FullAnalysisBatchItem, FullAnalysisBatchRun, LibraryItemSummary, ProcessingJob, SampleArtifact, WorkflowRun, WorkflowStageState } from "../../types";
import { clampNumber, isRunExecuting } from "./fullAnalysisState";
import { CacheDecisionDialog } from "../CacheDecisionDialog";
import { SplitResizeHandle } from "../SplitResizeHandle";
import { ResultPanel, TabButton, type ResultTab } from "./FullAnalysisResults";
import { canRerun, StageStep, type FullAnalysisStageTarget } from "./FullAnalysisStageStep";
import { BatchQueuePanel } from "./FullAnalysisBatchPanel";

type WorkflowCachePrompt = { stage: WorkflowStageState; job: ProcessingJob; order: number };
type UploadCachePrompt = { file: File; cachedItem: LibraryItemSummary } | null;
type WorkflowMode = "full-analysis" | "material-recognition";
type LayoutControls = {
  startResize: (kind: "column" | "top-row" | "bottom-row", event: React.PointerEvent<HTMLElement>) => void;
  resetSize: (kind: "column" | "top-row" | "bottom-row") => void;
  nudgeSize: (kind: "column" | "top-row" | "bottom-row", direction: number) => void;
};

type FullAnalysisLayoutProps = {
  embedded: boolean;
  pageTitle: string;
  mode: WorkflowMode;
  isMaterialMode: boolean;
  statusText: string;
  countLabel: string;
  workflowTraceLabel: string;
  layoutRef: RefObject<HTMLElement>;
  layout: LayoutControls;
  run: WorkflowRun | null;
  artifact: SampleArtifact | null;
  videoUrl: string | null;
  isStarting: boolean;
  frameSampleRate: number;
  maxConcurrentRuns: number;
  refreshMode: boolean;
  enableFunctionSlotAtomization: boolean;
  batchRun: FullAnalysisBatchRun | null;
  selectedBatchItemId: string | null;
  orderedStages: WorkflowStageState[];
  childJobs: Record<string, ProcessingJob | null>;
  activeTab: ResultTab;
  errorText: string | null;
  activeCachePrompt: WorkflowCachePrompt | null;
  uploadCachePrompt: UploadCachePrompt;
  onUpload: (files: FileList | File[]) => Promise<void>;
  onFrameSampleRateChange: Dispatch<SetStateAction<number>>;
  onMaxConcurrentRunsChange: Dispatch<SetStateAction<number>>;
  onRefreshModeChange: Dispatch<SetStateAction<boolean>>;
  onFunctionSlotAtomizationChange: Dispatch<SetStateAction<boolean>>;
  onSelectBatchItem: (item: FullAnalysisBatchItem) => Promise<void>;
  onRetryBatchItem: (item: FullAnalysisBatchItem) => Promise<void>;
  onRerun: (stageKey: string) => Promise<void>;
  onOpenWorkbenchStage?: (stageKey: FullAnalysisStageTarget) => void;
  onResolveStageCache: (stage: WorkflowStageState, job: ProcessingJob, decision: "reuse" | "refresh") => Promise<void>;
  onResolveWorkflowCache: (prompt: WorkflowCachePrompt, decision: "reuse" | "refresh") => Promise<void>;
  onActiveTabChange: Dispatch<SetStateAction<ResultTab>>;
  onDismissCachePromptJobIdsChange: Dispatch<SetStateAction<string[]>>;
  onUploadCachePromptChange: Dispatch<SetStateAction<UploadCachePrompt>>;
  onStatusTextChange: Dispatch<SetStateAction<string>>;
  onStartFullAnalysis: (file: File, cacheDecision: "ask" | "reuse" | "refresh") => Promise<void>;
};

export function FullAnalysisLayout({
  embedded,
  pageTitle,
  mode,
  isMaterialMode,
  statusText,
  countLabel,
  workflowTraceLabel,
  layoutRef,
  layout,
  run,
  artifact,
  videoUrl,
  isStarting,
  frameSampleRate,
  maxConcurrentRuns,
  refreshMode,
  enableFunctionSlotAtomization,
  batchRun,
  selectedBatchItemId,
  orderedStages,
  childJobs,
  activeTab,
  errorText,
  activeCachePrompt,
  uploadCachePrompt,
  onUpload,
  onFrameSampleRateChange,
  onMaxConcurrentRunsChange,
  onRefreshModeChange,
  onFunctionSlotAtomizationChange,
  onSelectBatchItem,
  onRetryBatchItem,
  onRerun,
  onOpenWorkbenchStage,
  onResolveStageCache,
  onResolveWorkflowCache,
  onActiveTabChange,
  onDismissCachePromptJobIdsChange,
  onUploadCachePromptChange,
  onStatusTextChange,
  onStartFullAnalysis,
}: FullAnalysisLayoutProps) {
  return (
    <div className={embedded ? "full-analysis-shell embedded-view" : "app-shell full-analysis-shell"}>
      {embedded ? null : (
        <header className="topbar">
          <div className="project-block">
            <div className="project-name">{pageTitle}</div>
            <div className="save-status">{statusText}</div>
          </div>
          <div className="run-status-bar">
            <span>{countLabel}</span>
            <span>{workflowTraceLabel}</span>
          </div>
        </header>
      )}
      <main ref={layoutRef} className="full-analysis-main">
        <div className="full-analysis-top-row">
          <section className="full-analysis-upload" aria-label={`${pageTitle}上传`}>
            <label className="upload-target" htmlFor={`${mode}VideoInput`}>
              <input
                id={`${mode}VideoInput`}
                type="file"
                accept="video/*"
                multiple={!isMaterialMode}
                disabled={isStarting || isRunExecuting(run)}
                onChange={(event) => {
                  const files = event.currentTarget.files;
                  if (files?.length) void onUpload(files);
                  event.currentTarget.value = "";
                }}
              />
              <span className="upload-title">{isStarting ? "启动中" : `选择视频并${pageTitle}`}</span>
              <span className="upload-meta">{artifact?.sampleVideo.original.summary ?? (isMaterialMode ? "上传后自动完成切镜" : "上传后自动完成切镜、脚本、节奏、包装")}</span>
            </label>
            <div className="upload-options compact-options">
              <label className="sampling-control">
                <span>抽帧采样率</span>
                <input
                  type="number"
                  min="1"
                  max="10"
                  step="1"
                  value={frameSampleRate}
                  disabled={isStarting || isRunExecuting(run)}
                  onChange={(event) => onFrameSampleRateChange(clampNumber(Number(event.currentTarget.value || 10), 1, 10))}
                />
              </label>
              {!isMaterialMode ? (
                <label className="sampling-control">
                  <span>并发视频数</span>
                  <input
                    type="number"
                    min="1"
                    max="12"
                    step="1"
                    value={maxConcurrentRuns}
                    disabled={isStarting || isRunExecuting(run)}
                    onChange={(event) => onMaxConcurrentRunsChange(clampNumber(Number(event.currentTarget.value || 2), 1, 12))}
                  />
                </label>
              ) : null}
              <label className="option-toggle">
                <input
                  type="checkbox"
                  checked={refreshMode}
                  disabled={isStarting || isRunExecuting(run)}
                  onChange={(event) => onRefreshModeChange(event.currentTarget.checked)}
                />
                <span>重新生成</span>
              </label>
              {!isMaterialMode ? (
                <label className="option-toggle">
                  <input
                    type="checkbox"
                    checked={enableFunctionSlotAtomization}
                    disabled={isStarting || isRunExecuting(run)}
                    onChange={(event) => onFunctionSlotAtomizationChange(event.currentTarget.checked)}
                  />
                  <span>原子化</span>
                </label>
              ) : null}
            </div>
          </section>
          <SplitResizeHandle
            className="workspace-resize-handle full-analysis-col-resizer"
            label="调整上方面板左右分界"
            orientation="vertical"
            onResizeStart={(event) => layout.startResize("column", event)}
            onReset={() => layout.resetSize("column")}
            onNudge={(direction) => layout.nudgeSize("column", direction)}
          />
          <section className="full-analysis-preview" aria-label="视频预览">
            {videoUrl ? <video controls src={videoUrl} /> : <div className="empty-preview">等待视频产物</div>}
          </section>
        </div>
        <SplitResizeHandle
          className="workspace-resize-handle full-analysis-row-resizer"
          label="调整上下区域高度"
          orientation="horizontal"
          onResizeStart={(event) => layout.startResize("top-row", event)}
          onReset={() => layout.resetSize("top-row")}
          onNudge={(direction) => layout.nudgeSize("top-row", direction)}
        />
        <div className="full-analysis-bottom-row">
          <section className="full-analysis-flow" aria-label="流程状态">
            {batchRun ? <BatchQueuePanel batch={batchRun} selectedItemId={selectedBatchItemId} onSelect={onSelectBatchItem} onRetry={onRetryBatchItem} /> : null}
            {orderedStages.map((stage) => (
              <StageStep
                key={stage.key}
                stage={stage}
                job={stage.childJobId ? childJobs[stage.childJobId] ?? null : null}
                onRerun={onRerun}
                onOpenStage={onOpenWorkbenchStage}
                onResolveCache={(cacheStage, job, decision) => onResolveStageCache(cacheStage, job, decision)}
                disabled={!canRerun(stage, run, isRunExecuting)}
              />
            ))}
          </section>
          <SplitResizeHandle
            className="workspace-resize-handle full-analysis-bottom-resizer"
            label="调整下方面板左右分界"
            orientation="vertical"
            onResizeStart={(event) => layout.startResize("bottom-row", event)}
            onReset={() => layout.resetSize("bottom-row")}
            onNudge={(direction) => layout.nudgeSize("bottom-row", direction)}
          />
          <section className="full-analysis-results" aria-label="分析结果">
            <div className="result-tabs">
              <TabButton active={activeTab === "shot"} label="切镜" onClick={() => onActiveTabChange("shot")} />
              {isMaterialMode ? <TabButton active={activeTab === "material"} label="素材" onClick={() => onActiveTabChange("material")} /> : null}
              {!isMaterialMode ? <TabButton active={activeTab === "script"} label="脚本" onClick={() => onActiveTabChange("script")} /> : null}
              {!isMaterialMode ? <TabButton active={activeTab === "rhythm"} label="节奏" onClick={() => onActiveTabChange("rhythm")} /> : null}
              {!isMaterialMode ? <TabButton active={activeTab === "packaging"} label="包装" onClick={() => onActiveTabChange("packaging")} /> : null}
              {!isMaterialMode && enableFunctionSlotAtomization ? <TabButton active={activeTab === "atomization"} label="原子化" onClick={() => onActiveTabChange("atomization")} /> : null}
            </div>
            {errorText ? <div className="detail-hint failure-hint">{errorText}</div> : null}
            <ResultPanel tab={activeTab} artifact={artifact} />
          </section>
        </div>
      </main>
      {activeCachePrompt ? (
        <CacheDecisionDialog
          item={activeCachePrompt.job.cachePrompt!.cachedItem}
          onReuse={() => onResolveWorkflowCache(activeCachePrompt, "reuse")}
          onRefresh={() => onResolveWorkflowCache(activeCachePrompt, "refresh")}
          onCancel={() => {
            onDismissCachePromptJobIdsChange((current) => activeCachePrompt.job.jobId && !current.includes(activeCachePrompt.job.jobId) ? [...current, activeCachePrompt.job.jobId] : current);
            onStatusTextChange(`${activeCachePrompt.stage.label}等待缓存选择`);
          }}
        />
      ) : null}
      {uploadCachePrompt ? (
        <CacheDecisionDialog
          item={uploadCachePrompt.cachedItem}
          onReuse={() => {
            const prompt = uploadCachePrompt;
            onUploadCachePromptChange(null);
            void onStartFullAnalysis(prompt.file, "reuse");
          }}
          onRefresh={() => {
            const prompt = uploadCachePrompt;
            onUploadCachePromptChange(null);
            void onStartFullAnalysis(prompt.file, "refresh");
          }}
          onCancel={() => {
            onUploadCachePromptChange(null);
            onStatusTextChange("等待上传");
          }}
        />
      ) : null}
    </div>
  );
}
