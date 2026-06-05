import { useEffect, useRef, useState } from "react";
import {
  hydrateAnalysisHistoryArtifacts,
  listAnalysisHistorySamples,
  resolveAnalysisHistoryMedia,
  type AnalysisHistoryItem,
} from "./analysisHistoryData";

export function AnalysisHistory() {
  const [items, setItems] = useState<AnalysisHistoryItem[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let mounted = true;

    listAnalysisHistorySamples()
      .then((nextItems) => {
        if (!mounted) return;
        setItems(nextItems);
        setStatus("ready");

        hydrateAnalysisHistoryArtifacts(nextItems.map((item) => item.sample), (sampleVideoId, artifact) => {
          if (!mounted) return;
          setItems((current) => current.map((item) => (
            item.sample.resourceId === sampleVideoId
              ? { ...item, artifact, artifactStatus: artifact ? "ready" : "failed" }
              : item
          )));
        });
      })
      .catch(() => {
        if (!mounted) return;
        setItems([]);
        setStatus("error");
      });

    return () => {
      mounted = false;
    };
  }, []);

  return (
    <section className="new-ui-analysis-history" aria-label="历史结果">
      <div className="new-ui-analysis-history-header">
        <h2 className="new-ui-analysis-history-title">历史结果</h2>
      </div>
      {status === "loading" ? <div className="new-ui-analysis-history-state">加载中</div> : null}
      {status === "error" ? <div className="new-ui-analysis-history-state">暂时无法读取历史结果</div> : null}
      {status === "ready" && !items.length ? <div className="new-ui-analysis-history-state">暂无历史结果</div> : null}
      {items.length ? (
        <div className="new-ui-analysis-history-grid">
          {items.map((item) => <AnalysisHistoryCard key={item.sample.resourceId} item={item} />)}
        </div>
      ) : null}
    </section>
  );
}

function AnalysisHistoryCard({ item }: { item: AnalysisHistoryItem }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [previewing, setPreviewing] = useState(false);
  const media = resolveAnalysisHistoryMedia(item);

  const playPreview = () => {
    if (!media.videoUrl) return;
    setPreviewing(true);
    window.requestAnimationFrame(() => {
      const video = videoRef.current;
      if (!video) return;
      video.play().catch(() => undefined);
    });
  };

  const pausePreview = () => {
    const video = videoRef.current;
    if (video) {
      video.pause();
      video.currentTime = 0;
    }
    setPreviewing(false);
  };

  return (
    <article
      className={`new-ui-analysis-history-card is-${media.orientation}`}
      tabIndex={0}
      aria-label={media.title}
      onPointerEnter={playPreview}
      onPointerLeave={pausePreview}
      onFocus={playPreview}
      onBlur={pausePreview}
    >
      <div className="new-ui-analysis-history-media">
        {media.coverUrl ? <img src={media.coverUrl} alt="" loading="lazy" decoding="async" /> : <div className="new-ui-analysis-history-placeholder" aria-hidden="true" />}
        {previewing && media.videoUrl ? <video ref={videoRef} src={media.videoUrl} muted loop playsInline preload="none" aria-hidden="true" /> : null}
        <span className={`new-ui-analysis-history-badge new-ui-analysis-history-badge-${badgeClass(media.badgeLabel)}`}>{media.badgeLabel}</span>
        <span className="new-ui-analysis-history-duration">{media.durationLabel}</span>
        <span className="new-ui-analysis-history-ratio">{media.ratioLabel}</span>
      </div>
      <div className="new-ui-analysis-history-meta">
        <span className="new-ui-analysis-history-name">{media.title}</span>
        <span className="new-ui-analysis-history-detail">{media.relativeDateLabel}</span>
      </div>
    </article>
  );
}

function badgeClass(label: "素材识别" | "样例分析" | "分析中") {
  if (label === "素材识别") return "material";
  if (label === "样例分析") return "sample";
  return "pending";
}
