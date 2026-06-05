import { useEffect, useRef, useState } from "react";
import { getSampleArtifact, runtimeUrl } from "../../api/client";
import { listPlatformResources, type PlatformResourceSummary } from "../../api/platformClient";
import type { SampleArtifact } from "../../types";

export function AnalysisHome() {
  return (
    <section className="new-ui-analysis-home" aria-label="分析首页">
      <button className="new-ui-analysis-upload-frame" type="button" aria-label="上传视频开始分析">
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
      <AnalysisHistory />
    </section>
  );
}

type AnalysisHistoryItem = {
  sample: PlatformResourceSummary;
  artifact: SampleArtifact | null;
  artifactStatus: "pending" | "ready" | "failed";
};

function AnalysisHistory() {
  const [items, setItems] = useState<AnalysisHistoryItem[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let mounted = true;

    listPlatformResources("sample")
      .then((response) => {
        const samples = [...response.resources]
          .sort((a, b) => timestampValue(b.updatedAt ?? b.createdAt) - timestampValue(a.updatedAt ?? a.createdAt))
          .slice(0, 12);
        const baseItems = samples.map((sample) => ({
          sample,
          artifact: null,
          artifactStatus: "pending" as const,
        }));
        if (!mounted) return;
        setItems(baseItems);
        setStatus("ready");

        hydrateHistoryArtifacts(samples, (sampleVideoId, artifact) => {
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
  const media = resolveHistoryMedia(item);

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
        <span className="new-ui-analysis-history-ratio">{media.ratioLabel}</span>
      </div>
      <div className="new-ui-analysis-history-meta">
        <span className="new-ui-analysis-history-name">{media.title}</span>
        <span className="new-ui-analysis-history-detail">{media.detail}</span>
      </div>
    </article>
  );
}

function resolveHistoryMedia(item: AnalysisHistoryItem) {
  const artifact = item.artifact;
  const width = positiveNumber(artifact?.metadata.width ?? item.sample.summary?.width);
  const height = positiveNumber(artifact?.metadata.height ?? item.sample.summary?.height);
  const duration = positiveNumber(artifact?.metadata.durationSeconds ?? item.sample.summary?.durationSeconds);
  const orientation = width && height && height > width ? "portrait" : "landscape";
  const title = artifact?.sampleVideo.original.summary ?? item.sample.label ?? item.sample.resourceId;
  const coverUri = artifact?.cover?.uri ?? artifact?.frames?.[0]?.imageUri ?? null;
  const videoUri = artifact?.sampleVideo.normalized.uri ?? artifact?.sampleVideo.original.uri ?? null;
  const orientationLabel = orientation === "portrait" ? "9:16" : "16:9";

  return {
    title,
    orientation,
    coverUrl: runtimeUrl(coverUri),
    videoUrl: runtimeUrl(videoUri),
    ratioLabel: orientationLabel,
    detail: [formatDuration(duration), orientationLabel, item.artifactStatus === "pending" ? "封面加载中" : null].filter(Boolean).join(" / "),
  };
}

async function hydrateHistoryArtifacts(samples: PlatformResourceSummary[], onItem: (sampleVideoId: string, artifact: SampleArtifact | null) => void) {
  const queue = [...samples];
  const workerCount = Math.min(2, queue.length);
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (queue.length) {
      const sample = queue.shift();
      if (!sample) return;
      const artifact = await getSampleArtifact(sample.resourceId).catch(() => null);
      onItem(sample.resourceId, artifact);
    }
  }));
}

function positiveNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function timestampValue(value: string | null | undefined) {
  const timestamp = Date.parse(value ?? "");
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function formatDuration(seconds: number | null) {
  if (!seconds) return null;
  const total = Math.max(1, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}
