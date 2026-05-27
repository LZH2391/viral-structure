import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { deleteLibraryItemCache, getLibraryItemDetail, getLibraryItems, loadLibraryItem, runtimeUrl } from "../api/client";
import type { LibraryArtifactNode, LibraryItemDetail, LibraryItemSummary } from "../types";
import { SplitResizeHandle } from "./SplitResizeHandle";
import { useResizableTwoPaneLayout } from "../hooks/useResizableTwoPaneLayout";
import { formatClock, formatTime, shortId } from "../utils/format";

const DETAIL_LIMIT = 30;

export function LibraryApp({ embedded = false }: { embedded?: boolean } = {}) {
  const [items, setItems] = useState<LibraryItemSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [status, setStatus] = useState("读取处理库");
  const [updatedAt, setUpdatedAt] = useState("等待刷新");
  const [detailVersion, setDetailVersion] = useState(0);
  const detailCacheRef = useRef(new Map<string, LibraryItemDetail>());
  const layoutRef = useRef<HTMLElement>(null);
  const layout = useResizableTwoPaneLayout({
    containerRef: layoutRef,
    storageKey: "library:layout",
    cssVar: "--library-list-width",
    defaultLeft: 340,
    minLeft: 260,
    maxLeft: 520,
    minRight: 420,
  });

  const refresh = useCallback(async () => {
    setStatus("刷新中");
    const data = await getLibraryItems();
    const nextItems = data.items ?? [];
    setItems(nextItems);
    detailCacheRef.current.clear();
    setSelectedId((current) => (nextItems.some((item) => item.sampleVideoId === current) ? current : nextItems[0]?.sampleVideoId ?? null));
    setUpdatedAt(new Date().toLocaleTimeString("zh-CN", { hour12: false }));
    setStatus("已同步");
  }, []);

  useEffect(() => {
    refresh().catch((error) => setStatus(error instanceof Error ? error.message : "读取失败"));
  }, [refresh]);

  useEffect(() => {
    if (!selectedId || detailCacheRef.current.has(selectedId)) return;
    setStatus("读取详情");
    getLibraryItemDetail(selectedId)
      .then((detail) => {
        detailCacheRef.current.set(selectedId, detail);
        setDetailVersion((value) => value + 1);
        setStatus("已同步");
      })
      .catch((error) => setStatus(error instanceof Error ? error.message : "读取详情失败"));
  }, [selectedId]);

  const selectedDetail = useMemo(() => {
    void detailVersion;
    return selectedId ? detailCacheRef.current.get(selectedId) ?? null : null;
  }, [detailVersion, selectedId]);

  return (
    <div className={embedded ? "library-shell embedded-view" : "library-shell"}>
      {!embedded ? <LibraryHeader items={items} status={status} updatedAt={updatedAt} onRefresh={refresh} /> : null}
      <main ref={layoutRef} className="library-grid">
        <LibraryList items={items} selectedId={selectedId} onSelect={setSelectedId} />
        <SplitResizeHandle
          className="workspace-resize-handle library-resizer"
          label="调整处理库列表宽度"
          orientation="vertical"
          onResizeStart={layout.startResize}
          onReset={layout.resetSize}
          onNudge={layout.nudgeSize}
        />
        <LibraryDetail detail={selectedDetail} onDeleted={refresh} />
      </main>
    </div>
  );
}

function LibraryHeader({ items, status, updatedAt, onRefresh }: { items: LibraryItemSummary[]; status: string; updatedAt: string; onRefresh: () => Promise<void> }) {
  return (
    <header className="topbar">
      <div className="project-block">
        <div className="project-name">处理库</div>
        <div id="libraryStatus" className="save-status">
          {status}
        </div>
      </div>
      <div className="run-strip">
        <span id="libraryCount" className="run-pill">
          {items.length} records
        </span>
        <span id="libraryUpdatedAt" className="trace-label">
          {updatedAt}
        </span>
      </div>
      <div className="top-actions">
        <button className="tab-button" type="button" onClick={() => window.location.assign("/")}>
          工作台
        </button>
        <button className="tab-button" type="button" onClick={() => window.location.assign("/full-analysis")}>
          完整分析
        </button>
        <button className="tab-button active" type="button">
          处理库
        </button>
        <button className="tab-button" type="button" onClick={() => window.location.assign("/function-slot-graph")}>
          结构图谱
        </button>
        <button className="tab-button" type="button" onClick={() => window.location.assign("/threadpool")}>
          ThreadPool
        </button>
        <button id="refreshLibraryBtn" className="primary-button" type="button" onClick={() => onRefresh().catch(() => undefined)}>
          刷新
        </button>
      </div>
    </header>
  );
}

function LibraryList({ items, selectedId, onSelect }: { items: LibraryItemSummary[]; selectedId: string | null; onSelect: (id: string) => void }) {
  return (
    <aside className="library-list" aria-label="处理库列表">
      <div className="section-heading">本地素材</div>
      <div id="libraryItemList" className="compact-list">
        {items.length ? (
          items.map((item) => (
            <button key={item.sampleVideoId} className={`library-item ${selectedId === item.sampleVideoId ? "active" : ""}`} type="button" onClick={() => onSelect(item.sampleVideoId)}>
              <strong>{item.filename}</strong>
              <span>{formatTime(item.durationSeconds ?? 0)} / {resolutionText(item)}</span>
              <TagRow tags={item.tags} cacheAvailable={item.cacheAvailable} />
              <small>{formatClock(item.updatedAt ?? undefined)} / trace {shortId(item.traceId ?? "")}</small>
            </button>
          ))
        ) : (
          <EmptyState text="暂无处理记录" />
        )}
      </div>
    </aside>
  );
}

function LibraryDetail({ detail, onDeleted }: { detail: LibraryItemDetail | null; onDeleted: () => Promise<void> }) {
  const visibleNodes = (detail?.artifactTree ?? detail?.artifactNodes ?? []).slice(0, DETAIL_LIMIT);
  const deleteCache = () => {
    if (!detail) return;
    deleteLibraryItemCache(detail.sampleVideoId).then(() => onDeleted()).catch(() => undefined);
  };
  return (
    <section className="library-detail" aria-label="处理库详情">
      <div className="library-detail-header">
        <div>
          <div className="section-heading">产物树</div>
          <div id="libraryDetailTitle" className="debug-trace-title">
            {detail ? `${detail.filename} / ${detail.sampleVideoId}` : "未选择素材"}
          </div>
        </div>
        <div className="library-actions">
          <button id="loadLibraryItemBtn" className="ghost-button" type="button" disabled={!detail} onClick={() => detail && loadLibraryItem(detail.sampleVideoId).then((data) => writeWorkbenchDraft(data.sampleArtifact)).catch(() => undefined)}>
            加载到工作台
          </button>
          <button id="deleteLibraryCacheBtn" className="ghost-button" type="button" disabled={!detail} onClick={deleteCache}>
            删除缓存
          </button>
        </div>
      </div>
      <div id="libraryArtifactTree" className="library-artifact-tree">
        {detail ? (
          visibleNodes.map((node) => <ArtifactNode key={`${node.stageName}-${node.artifactId}`} node={node} />)
        ) : (
          <EmptyState text="选择左侧素材查看详情" />
        )}
      </div>
    </section>
  );
}

function ArtifactNode({ node }: { node: LibraryArtifactNode }) {
  const uri = runtimeUrl(node.uri);
  return (
    <article className="library-node">
      <div className="library-node-main">
        <strong>{node.label}</strong>
        <span>{node.stageName}</span>
        <b>{node.status}</b>
      </div>
      <div className="library-node-grid">
        <Detail label="artifact" value={node.artifactId} />
        <Detail label="parent" value={node.parentArtifactId ?? "无"} />
        <Detail label="trace" value={node.traceId ?? "无"} />
        <Detail label="cacheKey" value={node.cacheKey ?? "未登记"} />
        <Detail label="参数" value={JSON.stringify(node.params ?? {})} />
        <Detail label="摘要" value={node.summary ?? "无"} />
      </div>
      {uri ? (
        <a className="library-uri" href={uri} target="_blank" rel="noreferrer">
          打开产物
        </a>
      ) : null}
    </article>
  );
}

function TagRow({ tags, cacheAvailable }: { tags: string[]; cacheAvailable: boolean }) {
  return (
    <span className="library-tags">
      {tags.map((tag) => (
        <b key={tag}>{tag}</b>
      ))}
      <b className={cacheAvailable ? "cache-on" : "cache-off"}>{cacheAvailable ? "缓存可用" : "无缓存"}</b>
    </span>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <b>{label}</b>
      <span>{value}</span>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="empty-state">
      <strong>{text}</strong>
      <span>上传并处理样例后刷新</span>
    </div>
  );
}

function resolutionText(item: { width?: number | null; height?: number | null }) {
  if (!item.width || !item.height) return "未知分辨率";
  return `${item.width} x ${item.height}`;
}

function writeWorkbenchDraft(sampleArtifact: LibraryItemDetail["artifact"]) {
  const current = readExistingWorkbenchDraft();
  localStorage.setItem(
    "workbench:last-sample",
    JSON.stringify({
      sampleVideoId: sampleArtifact.sampleVideoId,
      artifactId: sampleArtifact.sampleVideo.artifactId,
      traceId: sampleArtifact.trace?.traceId ?? null,
      activeSampleRevision: Number(current?.activeSampleRevision ?? 0) + 1,
      activeSampleSource: "library",
      sampleArtifact,
      selectedFrameId: sampleArtifact.frames[0]?.frameId ?? null,
      selectedDerivativeId: sampleArtifact.sampleVideo.normalized.artifactId,
      versions: [],
    }),
  );
  window.location.assign("/");
}

function readExistingWorkbenchDraft() {
  try {
    return JSON.parse(localStorage.getItem("workbench:last-sample") ?? "null") as { activeSampleRevision?: number } | null;
  } catch {
    return null;
  }
}
