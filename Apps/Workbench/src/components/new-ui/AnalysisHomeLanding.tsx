import { useRef, type DragEvent } from "react";
import { AnalysisHistory } from "./AnalysisHistory";
import type { AnalysisWorkflowMode } from "./analysisBackend";
import type { AnalysisHistoryItem } from "./analysisHistoryData";

export function AnalysisHomeLanding({
  view,
  mode,
  isUploading,
  historyRefreshKey,
  onUploadFiles,
  onOpenItem,
}: {
  view: "home" | "detail";
  mode: AnalysisWorkflowMode;
  isUploading: boolean;
  historyRefreshKey: number;
  onUploadFiles: (files: FileList | File[]) => Promise<void>;
  onOpenItem: (item: AnalysisHistoryItem) => void;
}) {
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const isMaterialMode = mode === "materialRecognition";
  const uploadTitle = isMaterialMode ? "拖拽视频做素材识别" : "拖拽样例做结构分析";
  const uploadSubtitle = isMaterialMode ? "生成素材能力包" : "拆出脚本 / 节奏 / 包装";
  const uploadAriaLabel = isMaterialMode ? "上传视频开始素材识别" : "上传视频开始结构分析";
  const handleUploadDrop = (event: DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    if (isUploading) return;
    if (event.dataTransfer.files.length) void onUploadFiles(event.dataTransfer.files);
  };

  return (
    <>
      <input
        ref={uploadInputRef}
        type="file"
        accept="video/*"
        multiple
        hidden
        onChange={(event) => {
          const files = event.currentTarget.files;
          if (files?.length) void onUploadFiles(files);
          event.currentTarget.value = "";
        }}
      />
      <section className={`new-ui-analysis-home ${view === "home" ? "" : "is-hidden"}`.trim()} aria-hidden={view !== "home"} aria-label="分析首页">
        <button
          className="new-ui-analysis-upload-frame"
          type="button"
          aria-label={uploadAriaLabel}
          disabled={isUploading}
          onClick={() => uploadInputRef.current?.click()}
          onDragOver={(event) => event.preventDefault()}
          onDrop={handleUploadDrop}
        >
          <span className="new-ui-analysis-upload-icon-tile">
            <svg className="new-ui-analysis-upload-icon" viewBox="0 0 128 96" focusable="false" aria-hidden="true">
              <path className="new-ui-analysis-upload-cloud-fill" d="M38 70c-10.6 0-19-8.2-19-18.5 0-9.8 7.3-17.6 17.1-19.1 3.6-10.9 13.1-17.9 24.4-17.9 12.6 0 23 9 25.1 20.9 10.1 1.3 17.9 9 17.9 18.8 0 8.9-6.7 15.8-16.1 15.8H38Z" />
              <path className="new-ui-analysis-upload-cloud-line" d="M38 70c-10.6 0-19-8.2-19-18.5 0-9.8 7.3-17.6 17.1-19.1 3.6-10.9 13.1-17.9 24.4-17.9 12.6 0 23 9 25.1 20.9 10.1 1.3 17.9 9 17.9 18.8 0 8.9-6.7 15.8-16.1 15.8H38Z" />
              <path className="new-ui-analysis-upload-arrow" d="M61 71V42" />
              <path className="new-ui-analysis-upload-arrow" d="M46 56 61 41l15 15" />
              <path className="new-ui-analysis-upload-base" d="M49 82h24" />
            </svg>
          </span>
          <span className="new-ui-analysis-upload-copy">
            <span className="new-ui-analysis-upload-primary">{isUploading ? (isMaterialMode ? "正在启动识别" : "正在启动分析") : uploadTitle}</span>
            <span className="new-ui-analysis-upload-secondary">{isUploading ? "正在创建任务" : uploadSubtitle}</span>
          </span>
          <span className="new-ui-analysis-upload-limit-group" aria-hidden="true">
            <span className="new-ui-analysis-upload-limit">支持并行</span>
            <span className="new-ui-analysis-upload-limit">单文件最大 2G</span>
          </span>
        </button>
        <AnalysisHistory mode={mode} refreshKey={historyRefreshKey} onOpenItem={onOpenItem} />
      </section>
    </>
  );
}
