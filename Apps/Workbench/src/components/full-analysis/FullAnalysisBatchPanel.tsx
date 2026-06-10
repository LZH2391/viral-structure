import type { FullAnalysisBatchItem, FullAnalysisBatchRun } from "../../types";
import { shortId } from "../../utils/format";

export function BatchQueuePanel({
  batch,
  selectedItemId,
  onSelect,
  onRetry,
}: {
  batch: FullAnalysisBatchRun;
  selectedItemId: string | null;
  onSelect: (item: FullAnalysisBatchItem) => void;
  onRetry: (item: FullAnalysisBatchItem) => void;
}) {
  return (
    <div className="full-analysis-batch-panel">
      <div className="batch-panel-heading">
        <strong>批量队列</strong>
        <span>{batchStatusLabel(batch.status)} · 并发 {batch.maxConcurrentRuns}</span>
      </div>
      <div className="batch-item-list">
        {batch.items.map((item) => (
          <div
            key={item.queueItemId}
            className={`batch-item ${selectedItemId === item.queueItemId ? "is-selected" : ""}`}
            role="button"
            tabIndex={0}
            onClick={() => onSelect(item)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              onSelect(item);
            }}
          >
            <span className="batch-item-title">{item.filename}</span>
            <span>{batchStatusLabel(item.status)}{item.position > 0 ? ` · 第 ${item.position} 位` : ""}</span>
            <span>{item.currentStageLabel ?? (item.workflowRunId ? `workflow ${shortId(item.workflowRunId)}` : "等待启动")}</span>
            {item.errorSummary?.message ? <em>{item.errorSummary.message}</em> : null}
            {item.retryable ? (
              <button
                className="ghost-button"
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onRetry(item);
                }}
              >
                重试
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

export function isBatchTerminal(batch: FullAnalysisBatchRun) {
  return batch.items.every((item) => ["processed", "partial_failed", "failed", "canceled"].includes(item.status));
}

export function batchStatusLabel(status: string) {
  if (status === "queued") return "排队中";
  if (status === "running") return "分析中";
  if (status === "cache_waiting") return "等待缓存选择";
  if (status === "processed") return "完成";
  if (status === "partial_failed") return "部分失败";
  if (status === "failed") return "失败";
  if (status === "canceled") return "已取消";
  return status || "等待";
}
