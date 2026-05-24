import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getDebugTraceDetail, getDebugTraces } from "../api/client";
import type { DebugEvent, DebugTraceDetail, DebugTraceSummary } from "../types";
import { formatClock, shortId } from "../utils/format";

const SUMMARY_LIMIT = 420;
const TRACE_LIST_LIMIT = 20;

export function DebugApp({ embedded = false, onBack }: { embedded?: boolean; onBack?: () => void } = {}) {
  const [status, setStatus] = useState("读取 DebugSnapshots");
  const [traces, setTraces] = useState<DebugTraceSummary[]>([]);
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState("等待刷新");
  const [detailVersion, setDetailVersion] = useState(0);
  const detailCacheRef = useRef(new Map<string, DebugTraceDetail>());

  const refresh = useCallback(async () => {
    setStatus("刷新中");
    const data = await getDebugTraces();
    const nextTraces = data.traces ?? [];
    setTraces(nextTraces);
    detailCacheRef.current.clear();
    setSelectedTraceId((current) => (nextTraces.some((trace) => trace.traceId === current) ? current : nextTraces[0]?.traceId ?? null));
    setUpdatedAt(new Date().toLocaleTimeString("zh-CN", { hour12: false }));
    setStatus("已同步");
  }, []);

  useEffect(() => {
    refresh().catch((error) => setStatus(error instanceof Error ? error.message : "读取失败"));
  }, [refresh]);

  useEffect(() => {
    if (!selectedTraceId) return;
    if (detailCacheRef.current.has(selectedTraceId)) return;
    setStatus("读取详情");
    getDebugTraceDetail(selectedTraceId)
      .then((detail) => {
        detailCacheRef.current.set(selectedTraceId, detail);
        setDetailVersion((value) => value + 1);
        setStatus("已同步");
      })
      .catch((error) => setStatus(error instanceof Error ? error.message : "读取详情失败"));
  }, [selectedTraceId]);

  const selectedDetail = useMemo(() => {
    void detailVersion;
    return selectedTraceId ? detailCacheRef.current.get(selectedTraceId) ?? null : null;
  }, [detailVersion, selectedTraceId]);

  const visibleTraces = traces.slice(0, TRACE_LIST_LIMIT);
  const hiddenCount = Math.max(0, traces.length - visibleTraces.length);

  return (
    <div className={embedded ? "debug-shell embedded-view" : "debug-shell"}>
      {!embedded ? <DebugHeader status={status} count={hiddenCount ? `${visibleTraces.length}/${traces.length} traces` : `${traces.length} traces`} updatedAt={updatedAt} onRefresh={refresh} /> : null}
      {embedded ? <EmbeddedHeader title="运行追踪" status={status} count={hiddenCount ? `${visibleTraces.length}/${traces.length} traces` : `${traces.length} traces`} updatedAt={updatedAt} onBack={onBack} onRefresh={refresh} /> : null}
      <main className="debug-grid">
        <TraceList traces={visibleTraces} hiddenCount={hiddenCount} selectedTraceId={selectedTraceId} onSelect={setSelectedTraceId} />
        <TraceDetail traceId={selectedTraceId} detail={selectedDetail} />
      </main>
    </div>
  );
}

function DebugHeader({ status, count, updatedAt, onRefresh }: { status: string; count: string; updatedAt: string; onRefresh: () => Promise<void> }) {
  return (
    <header className="topbar">
      <div className="project-block">
        <div className="project-name">运行追踪</div>
        <div id="debugStatus" className="save-status">
          {status}
        </div>
      </div>
      <div className="run-strip">
        <span id="debugCount" className="run-pill">{count}</span>
        <span id="debugUpdatedAt" className="trace-label">{updatedAt}</span>
      </div>
      <div className="top-actions">
        <a className="ghost-button action-link" href="http://127.0.0.1:5177/">
          返回工作台
        </a>
        <button id="refreshDebugBtn" className="primary-button" type="button" onClick={() => onRefresh().catch(() => undefined)}>
          刷新
        </button>
      </div>
    </header>
  );
}

function EmbeddedHeader({ title, status, count, updatedAt, onBack, onRefresh }: { title: string; status: string; count: string; updatedAt: string; onBack?: () => void; onRefresh: () => Promise<void> }) {
  return (
    <div className="embedded-view-header">
      <div>
        <div className="section-heading">{title}</div>
        <div className="debug-trace-title">{status}</div>
      </div>
      <div className="run-strip">
        <span className="run-pill">{count}</span>
        <span className="trace-label">{updatedAt}</span>
      </div>
      <div className="top-actions">
        <button className="ghost-button" type="button" onClick={onBack}>
          返回工作台
        </button>
        <button id="refreshDebugBtn" className="primary-button" type="button" onClick={() => onRefresh().catch(() => undefined)}>
          刷新
        </button>
      </div>
    </div>
  );
}

function TraceList({ traces, hiddenCount, selectedTraceId, onSelect }: { traces: DebugTraceSummary[]; hiddenCount: number; selectedTraceId: string | null; onSelect: (traceId: string) => void }) {
  return (
    <aside className="debug-trace-list" aria-label="Trace 列表">
      <div className="section-heading">最近运行</div>
      <div id="debugTraceList" className="compact-list">
        {traces.length ? (
          <>
            {traces.map((trace) => (
              <button key={trace.traceId} className={`debug-trace-item ${trace.traceId === selectedTraceId ? "active" : ""} ${trace.latestEvent === "stage.fail" ? "failed" : ""}`} type="button" data-trace-id={trace.traceId} onClick={() => onSelect(trace.traceId)}>
                <strong>{shortId(trace.traceId)}</strong>
                <span>{trace.latestEvent ?? "no-event"} / {trace.latestStageName ?? "unknown"}</span>
              </button>
            ))}
            {hiddenCount ? <div className="debug-trace-crop">已隐藏更早的 {hiddenCount} 条运行记录</div> : null}
          </>
        ) : (
          <EmptyState text="暂无运行记录" />
        )}
      </div>
    </aside>
  );
}

function TraceDetail({ traceId, detail }: { traceId: string | null; detail: DebugTraceDetail | null }) {
  return (
    <section className="debug-detail" aria-label="Trace 详情">
      <div className="debug-detail-header">
        <div>
          <div className="section-heading">阶段事件</div>
          <div id="debugTraceTitle" className="debug-trace-title">
            {traceId ?? "未选择 trace"}
          </div>
        </div>
        <a id="debugLogLink" className="ghost-button action-link" href={detail?.logUri ?? "#"} target="_blank" rel="noreferrer">
          打开日志
        </a>
      </div>
      <div id="debugEventList" className="debug-event-list">
        {!traceId ? <EmptyState text="等待后端生成 trace log" /> : detail?.events.length ? detail.events.map((event, index) => <EventItem key={`${event.event}-${event.createdAt}-${index}`} event={event} />) : <EmptyState text="该 trace 暂无事件" />}
      </div>
    </section>
  );
}

function EventItem({ event }: { event: DebugEvent }) {
  const stageName = event.stageName ?? event.stage ?? "unknown";
  const output = event.outputSummary ?? event.summary ?? null;
  return (
    <article className={`debug-event-item ${event.event === "stage.fail" ? "fail" : ""}`}>
      <div className="debug-event-main">
        <strong>{event.event ?? "event"}</strong>
        <span>{stageName}</span>
        <time>{formatClock(event.createdAt ?? event.time)}</time>
      </div>
      {event.relatedTraceId ? <SummaryBlock label="关联 trace" value={{ backendTraceId: event.relatedTraceId }} /> : null}
      <SummaryBlock label="输入" value={event.inputSummary} />
      <SummaryBlock label="输出" value={output} />
      <SummaryBlock label="错误" value={event.errorSummary} />
    </article>
  );
}

function SummaryBlock({ label, value }: { label: string; value: unknown }) {
  if (!value) return null;
  const text = JSON.stringify(value, null, 2);
  const cropped = cropText(text);
  return (
    <div className="debug-summary-block">
      <pre>
        <b>{label}</b> {cropped.text}
      </pre>
      {cropped.isCropped ? (
        <details>
          <summary>展开完整 {label}</summary>
          <pre>{text}</pre>
        </details>
      ) : null}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="empty-state">
      <strong>{text}</strong>
      <span>从 http://127.0.0.1:5177 上传样例后刷新</span>
    </div>
  );
}

function cropText(text: string) {
  if (text.length <= SUMMARY_LIMIT) return { text, isCropped: false };
  return { text: `${text.slice(0, SUMMARY_LIMIT)}\n... 已裁切 ${text.length - SUMMARY_LIMIT} 字符`, isCropped: true };
}
