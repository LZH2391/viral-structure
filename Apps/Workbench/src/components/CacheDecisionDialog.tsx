import type { LibraryItemSummary } from "../types";

export function CacheDecisionDialog({ item, onReuse, onRefresh, onCancel }: { item: LibraryItemSummary; onReuse: () => void; onRefresh: () => void; onCancel: () => void }) {
  const isShotCache = item.tags?.includes("切镜");
  return (
    <div className="cache-dialog-backdrop" role="presentation">
      <section className="cache-dialog" role="dialog" aria-modal="true" aria-labelledby="cacheDialogTitle">
        <div>
          <div className="section-heading">命中缓存</div>
          <h2 id="cacheDialogTitle">{isShotCache ? "发现切镜缓存" : "发现同视频处理记录"}</h2>
          <p>{item.filename} / {item.durationSeconds ? `${Math.round(item.durationSeconds)}s` : "未知时长"}</p>
          {isShotCache ? (
            <p>
              {item.analysisFps ?? "?"} fps / {item.shotCount ?? "?"} 镜 / turn {shortCacheTurnId(item.sourceTurnId)}
            </p>
          ) : null}
        </div>
        <div className="cache-dialog-actions">
          <button className="ghost-button" type="button" onClick={onCancel}>
            取消
          </button>
          <button className="ghost-button" type="button" onClick={onRefresh}>
            重新生成覆盖
          </button>
          <button className="primary-button" type="button" onClick={onReuse}>
            复用缓存
          </button>
        </div>
      </section>
    </div>
  );
}

function shortCacheTurnId(turnId?: string | null) {
  if (!turnId) return "无";
  return turnId.length > 10 ? turnId.slice(-10) : turnId;
}
