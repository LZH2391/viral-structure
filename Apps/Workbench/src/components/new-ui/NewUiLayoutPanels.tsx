import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { AnalysisHomeQueueItem, AnalysisHomeQueueState } from "./AnalysisHome";
import type { AnalysisHistoryItem } from "./analysisHistoryData";

export function ThemedTooltipLayer({ rootRef }: {
    rootRef: {
        current: HTMLElement | null;
    };
}) { const [tooltip, setTooltip] = useState<{
    text: string;
    left: number;
    top: number;
    placement: "top" | "bottom";
    variables: CSSProperties;
} | null>(null); const showTimerRef = useRef<number | null>(null); useEffect(() => { const root = rootRef.current; if (!root)
    return undefined; const clearShowTimer = () => { if (showTimerRef.current === null)
    return; window.clearTimeout(showTimerRef.current); showTimerRef.current = null; }; const findTooltipAnchor = (target: EventTarget | null) => (target instanceof Element ? target.closest<HTMLElement>("[data-tooltip]") : null); const showTooltip = (target: Element | null) => { const anchor = findTooltipAnchor(target); const text = anchor?.dataset.tooltip?.trim(); if (!anchor || !text) {
    setTooltip(null);
    return;
} const rect = anchor.getBoundingClientRect(); const placement = rect.top < 44 ? "bottom" : "top"; const maxTooltipWidth = Math.min(260, Math.max(0, window.innerWidth - 32)); const minLeft = 16 + maxTooltipWidth / 2; const maxLeft = window.innerWidth - 16 - maxTooltipWidth / 2; const centerLeft = rect.left + rect.width / 2; const left = maxLeft >= minLeft ? Math.min(Math.max(centerLeft, minLeft), maxLeft) : window.innerWidth / 2; const top = placement === "top" ? rect.top - 10 : rect.bottom + 10; setTooltip({ text, left, top, placement, variables: readTooltipVariables(root) }); }; const scheduleTooltip = (target: Element | null, delayMs: number) => { clearShowTimer(); showTimerRef.current = window.setTimeout(() => { showTimerRef.current = null; showTooltip(target); }, delayMs); }; const hideTooltip = () => { clearShowTimer(); setTooltip(null); }; const handlePointerOver = (event: PointerEvent) => scheduleTooltip(event.target as Element | null, 420); const handlePointerOut = (event: PointerEvent) => { const fromAnchor = findTooltipAnchor(event.target); const toAnchor = findTooltipAnchor(event.relatedTarget); if (fromAnchor && fromAnchor === toAnchor)
    return; hideTooltip(); }; const handleFocusIn = (event: FocusEvent) => scheduleTooltip(event.target as Element | null, 120); root.addEventListener("pointerover", handlePointerOver); root.addEventListener("focusin", handleFocusIn); root.addEventListener("pointerout", handlePointerOut); root.addEventListener("focusout", hideTooltip); root.addEventListener("pointerdown", hideTooltip); window.addEventListener("scroll", hideTooltip, true); window.addEventListener("resize", hideTooltip); return () => { root.removeEventListener("pointerover", handlePointerOver); root.removeEventListener("focusin", handleFocusIn); root.removeEventListener("pointerout", handlePointerOut); root.removeEventListener("focusout", hideTooltip); root.removeEventListener("pointerdown", hideTooltip); window.removeEventListener("scroll", hideTooltip, true); window.removeEventListener("resize", hideTooltip); clearShowTimer(); }; }, [rootRef]); return tooltip ? createPortal(<div className="new-ui-tooltip-layer" data-placement={tooltip.placement} style={{ ...tooltip.variables, left: tooltip.left, top: tooltip.top }} role="tooltip"> {tooltip.text} </div>, document.body) : null; }

export function AnalysisQueueSidebar({ items, loading, governanceSchedulerState, onOpenItem, onCancelItem, onRetryItem, actionBusyKey, }: {
    items: AnalysisHomeQueueItem[];
    loading: boolean;
    governanceSchedulerState?: AnalysisHomeQueueState["governanceSchedulerState"];
    onOpenItem?: (item: AnalysisHistoryItem) => void;
    onCancelItem?: (item: AnalysisHomeQueueItem) => void;
    onRetryItem?: (item: AnalysisHomeQueueItem) => void;
    actionBusyKey?: string | null;
}) { return (<section className="new-ui-analysis-queue-sidebar" aria-label="视频处理队列"> <header className="new-ui-analysis-queue-sidebar-header"> <h2>视频处理队列</h2> <span>{items.length} 项</span> </header> {governanceSchedulerState ? (<div className={`new-ui-analysis-queue-governance is-${governanceSchedulerState.status}`.trim()}> <strong>{governanceSchedulerLabel(governanceSchedulerState.status)}</strong> <span>{governanceSchedulerState.message ?? "等待结构分析队列完成后自动语义治理。"}</span> </div>) : null} {items.length ? (<div className="new-ui-analysis-queue-sidebar-list"> {items.map((item) => { const canCancel = (item.status === "running" || item.status === "waiting") && Boolean(onCancelItem && item.batchRunId && item.queueItemId); const canRetry = (item.status === "canceled" || item.status === "failed") && Boolean(onRetryItem && item.batchRunId && item.queueItemId && item.retryable); const cancelBusy = actionBusyKey === `cancel:${item.key}`; const retryBusy = actionBusyKey === `retry:${item.key}`; const actionDisabled = Boolean(actionBusyKey && !cancelBusy && !retryBusy); return (<div key={item.key} className={`new-ui-analysis-queue-sidebar-row is-${item.status}`.trim()}> <button className="new-ui-analysis-queue-sidebar-item" type="button" disabled={!item.historyItem || !onOpenItem} onClick={() => { if (item.historyItem)
    onOpenItem?.(item.historyItem); }}> <span className={`new-ui-analysis-queue-sidebar-thumb is-${item.ratio}`} aria-hidden="true"> {item.thumbnailUrl ? <img src={item.thumbnailUrl} alt="" loading="lazy" decoding="async"/> : <span />} </span> <span className="new-ui-analysis-queue-sidebar-copy"> <strong>{item.title}</strong> <small>{item.badgeLabel}</small> </span> </button> {canCancel || canRetry ? (<button className={`new-ui-analysis-queue-sidebar-action ${canRetry ? "is-retry" : "is-cancel"}`.trim()} type="button" disabled={actionDisabled || cancelBusy || retryBusy} onClick={(event) => { event.stopPropagation(); if (canRetry) {
    onRetryItem?.(item);
    return;
} onCancelItem?.(item); }}> {cancelBusy ? "停止中" : retryBusy ? "继续中" : canRetry ? "继续" : "停止"} </button>) : null} </div>); })} </div>) : (<div className="new-ui-analysis-queue-sidebar-empty"> <AnalysisQueueEmptyIcon /> <strong>暂无排队任务</strong> <span>{loading ? "正在读取视频处理队列，新的分析任务会显示在这里。" : "上传样例或素材后，等待处理的视频会在这里显示。"}</span> </div>)} </section>); }

export function governanceSchedulerLabel(status: string) { if (status === "scheduled")
    return "等待语义治理"; if (status === "running")
    return "语义治理运行中"; if (status === "dirty")
    return "有新样例待纳入"; if (status === "skipped")
    return "语义治理已跳过"; if (status === "failed")
    return "语义治理失败"; return "自动语义治理"; }

export function AnalysisQueueEmptyIcon() { return (<svg className="new-ui-analysis-queue-sidebar-empty-icon" viewBox="0 0 32 32" focusable="false" aria-hidden="true"> <rect x="5" y="7" width="12" height="8" rx="2.2"/> <path d="m10.5 9.4 3.4 1.6-3.4 1.6Z"/> <path d="M19.5 11h4.8c1.8 0 3.2 1.4 3.2 3.2v0c0 1.8-1.4 3.2-3.2 3.2H8.7c-1.8 0-3.2 1.4-3.2 3.2v0c0 1.8 1.4 3.2 3.2 3.2h4.8"/> <circle cx="18.5" cy="23.8" r="2.2"/> <circle cx="25.5" cy="23.8" r="2.2"/> <path d="M20.7 23.8h2.6"/> </svg>); }

export function readTooltipVariables(source: HTMLElement): CSSProperties { const computed = getComputedStyle(source); return { "--new-ui-control-border": computed.getPropertyValue("--new-ui-control-border"), "--new-ui-control-shadow": computed.getPropertyValue("--new-ui-control-shadow"), "--new-ui-control-text": computed.getPropertyValue("--new-ui-control-text"), "--new-ui-surface": computed.getPropertyValue("--new-ui-surface"), "--new-ui-text": computed.getPropertyValue("--new-ui-text"), } as CSSProperties; }

export function LibraryGraphPanelPortal({ children }: {
    children: ReactNode;
}) { const [host, setHost] = useState<HTMLElement | null>(null); useEffect(() => { const nextHost = document.getElementById("new-ui-library-graph-panel"); setHost(nextHost); }, []); return host ? createPortal(children, host) : null; }
