import { useState } from "react";
import { AnalysisHistory } from "./AnalysisHistory";

export function AnalysisHome() {
  const [view, setView] = useState<"home" | "detail">("home");

  if (view === "detail") {
    return <AnalysisDetailPage onBack={() => setView("home")} />;
  }

  return (
    <section className="new-ui-analysis-home" aria-label="分析首页">
      <button className="new-ui-analysis-upload-frame" type="button" aria-label="上传视频开始分析" onClick={() => setView("detail")}>
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
          <span className="new-ui-analysis-upload-primary">拖拽视频到此处</span>
          <span className="new-ui-analysis-upload-secondary">或点击选择文件</span>
        </span>
        <span className="new-ui-analysis-upload-limit" aria-hidden="true">MP4/MOV 最多 5 个 最大 2GB</span>
      </button>
      <AnalysisHistory onOpenItem={() => setView("detail")} />
    </section>
  );
}

function AnalysisDetailPage({ onBack }: { onBack: () => void }) {
  return (
    <section className="new-ui-analysis-detail" aria-label="分析详情">
      <button className="new-ui-analysis-back-button" type="button" aria-label="返回分析首页" title="返回" onClick={onBack}>
        <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
          <path d="M15 6 9 12l6 6" />
        </svg>
      </button>
    </section>
  );
}
