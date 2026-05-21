import { RefObject, useEffect, useMemo, useRef, useState } from "react";
import type { AudioFeatureAnalysisArtifact, AudioFeatureMarker, MediaDerivative, MediaKind, SampleVideo } from "../types";
import { runtimeUrl } from "../api/client";
import { formatPreciseTime, formatTime } from "../utils/format";
import { fitMediaViewport } from "../utils/mediaViewport";
import { buildAudioFeatureMarkers, markerLeftPercent, resolveAudioFeatureDuration } from "../utils/audioFeatureMarkers";
import { useAudioWaveform } from "../hooks/useAudioWaveform";
import { useElementSize } from "../hooks/useElementSize";

type PreviewPanelProps = {
  sampleVideo: SampleVideo | null;
  mediaDerivatives: MediaDerivative[];
  activeMediaKind: MediaKind;
  selectedDerivativeId: string | null;
  selectedFrameId: string | null;
  selectedAudioFeatureMarkerId: string | null;
  audioFeatures?: AudioFeatureAnalysisArtifact | null;
  audioSeekRequest?: { requestId: number; time: number } | null;
  processingText: string;
  traceText: string;
  uiTraceId: string;
  backendTraceId?: string | null;
  errorText?: string | null;
  videoRef: RefObject<HTMLVideoElement>;
  audioRef: RefObject<HTMLAudioElement>;
  miniCanvasRef: RefObject<HTMLCanvasElement>;
  onSelectAudioFeature: (marker: AudioFeatureMarker) => void;
};

export function PreviewPanel(props: PreviewPanelProps) {
  const { sampleVideo, activeMediaKind, processingText, traceText, errorText, videoRef, audioRef } = props;
  const previewPanelRef = useRef<HTMLElement>(null);
  const previewStageRef = useRef<HTMLDivElement>(null);
  const [mainCanvas, setMainCanvas] = useState<HTMLCanvasElement | null>(null);
  const [audioPlaying, setAudioPlaying] = useState(false);
  const size = useElementSize(previewStageRef);
  const activeMedia = useMemo(
    () =>
      resolveActiveMedia({
        sampleVideo,
        mediaDerivatives: props.mediaDerivatives,
        activeMediaKind: props.activeMediaKind,
        selectedDerivativeId: props.selectedDerivativeId,
        selectedFrameId: props.selectedFrameId,
      }),
    [props.activeMediaKind, props.mediaDerivatives, props.selectedDerivativeId, props.selectedFrameId, sampleVideo],
  );
  const audioDerivative = useMemo(() => props.mediaDerivatives.find((item) => item.type === "audio-track") ?? null, [props.mediaDerivatives]);
  const waveformUrl = useMemo(() => (activeMedia.kind === "audio" ? activeMedia.url : runtimeUrl(audioDerivative?.uri ?? sampleVideo?.audioUri)), [activeMedia, audioDerivative?.uri, sampleVideo?.audioUri]);
  const audioUrl = activeMedia.kind === "audio" ? activeMedia.url : null;
  const audioFeatureMarkers = useMemo(() => buildAudioFeatureMarkers(props.audioFeatures), [props.audioFeatures]);
  const selectedMarker = useMemo(() => audioFeatureMarkers.find((marker) => marker.id === props.selectedAudioFeatureMarkerId) ?? null, [audioFeatureMarkers, props.selectedAudioFeatureMarkerId]);
  const audioDuration = useMemo(() => resolveAudioFeatureDuration(props.audioFeatures, sampleVideo?.duration ?? null), [props.audioFeatures, sampleVideo?.duration]);

  const { renderWithProgress } = useAudioWaveform({
    audio: audioRef.current,
    mainCanvas,
    miniCanvas: null,
    url: waveformUrl,
    active: activeMedia.kind === "audio",
    animate: true,
    durationSeconds: audioDuration,
    trace: {
      uiTraceId: props.uiTraceId,
      backendTraceId: props.backendTraceId ?? null,
      artifactId: audioDerivative?.artifactId ?? null,
      parentArtifactId: audioDerivative?.parentArtifactId ?? sampleVideo?.artifactId ?? null,
    },
  });

  useEffect(() => {
    const stage = previewStageRef.current;
    if (!stage) return;
    const fit = fitMediaViewport({
      viewportWidth: size.width,
      viewportHeight: size.height,
      mediaWidth: sampleVideo?.width ?? 16,
      mediaHeight: sampleVideo?.height ?? 9,
    });
    stage.style.setProperty("--media-content-width", `${fit.contentWidth}px`);
    stage.style.setProperty("--media-content-height", `${fit.contentHeight}px`);
    stage.dataset.letterboxInsets = JSON.stringify(fit.letterboxInsets);
  }, [sampleVideo?.height, sampleVideo?.width, size.height, size.width]);

  useEffect(() => {
    if (activeMedia.kind === "audio") videoRef.current?.pause();
    else audioRef.current?.pause();
  }, [activeMedia.kind, audioRef, videoRef]);

  useEffect(() => {
    if (activeMedia.kind !== "audio" || !props.audioSeekRequest) return undefined;
    const audio = audioRef.current;
    if (!audio) return undefined;
    const targetTime = props.audioSeekRequest.time;
    const seek = () => {
      const maxTime = resolveSeekDuration(audio, audioDuration, targetTime);
      const nextTime = Math.max(0, Math.min(targetTime, maxTime));
      audio.currentTime = nextTime;
      renderWithProgress(maxTime > 0 ? nextTime / maxTime : 0);
    };
    audio.addEventListener("loadedmetadata", seek, { once: true });
    audio.addEventListener("canplay", seek, { once: true });
    if (Number.isFinite(audio.duration) && audio.duration > 0) seek();
    return () => {
      audio.removeEventListener("loadedmetadata", seek);
      audio.removeEventListener("canplay", seek);
    };
  }, [activeMedia.kind, audioDuration, audioRef, props.audioSeekRequest, renderWithProgress]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return undefined;
    const sync = () => setAudioPlaying(!audio.paused);
    audio.addEventListener("play", sync);
    audio.addEventListener("pause", sync);
    return () => {
      audio.removeEventListener("play", sync);
      audio.removeEventListener("pause", sync);
    };
  }, [audioRef]);

  const meta = sampleVideo ? `${mediaLabel(activeMediaKind)} / ${sampleVideo.fileName} / ${formatTime(sampleVideo.duration)}` : processingText || "未加载样例";

  return (
    <section ref={previewPanelRef} className="preview-panel" aria-label="中央预览区">
      <div className="preview-toolbar">
        <div className="section-heading">媒体查看器</div>
        <div id="previewMeta" className="preview-meta">
          {meta}
        </div>
      </div>
      <div id="previewStage" ref={previewStageRef} className="preview-stage">
        {!sampleVideo && (
          <div id="emptyPreview" className="preview-empty" style={{ display: "grid" }}>
            <div className="frame-mark" />
            <strong>{errorText ? `处理失败 / ${errorText}` : processingText || "等待样例视频"}</strong>
            <span>{traceText || "上传后显示预览、封面和抽帧"}</span>
          </div>
        )}
        {sampleVideo && activeMedia.kind === "video" && activeMedia.url && <video id="sampleVideo" ref={videoRef} className="sample-video active" src={activeMedia.url} controls playsInline />}
        {sampleVideo && activeMedia.kind === "image" && activeMedia.url && <img id="mediaImagePreview" className="media-image-preview active" src={activeMedia.url} alt={activeMedia.alt} />}
        {sampleVideo && activeMedia.kind === "audio" && activeMedia.url && (
          <div id="audioWaveformPanel" className="audio-waveform-panel active" aria-label="音频波形播放器">
            <div className="audio-waveform-toolbar">
              <button
                id="audioWaveformPlayBtn"
                className={`audio-play-button ${audioPlaying ? "playing" : ""}`}
                type="button"
                aria-label="播放或暂停音频"
                onClick={() => {
                  const audio = audioRef.current;
                  if (!audio) return;
                  if (audio.paused) audio.play().catch(() => undefined);
                  else audio.pause();
                }}
              >
                <span />
              </button>
              <AudioTime audioRef={audioRef} />
            </div>
            <div className="audio-waveform-surface">
              <canvas id="audioWaveformCanvas" ref={setMainCanvas} className="audio-waveform-canvas" width="960" height="220" />
              <div className="audio-waveform-feature-layer" aria-label="音频基础标记">
                {audioFeatureMarkers.map((marker) => (
                  <button
                    key={marker.id}
                    className={`audio-waveform-feature-marker ${marker.type} ${selectedMarker?.id === marker.id ? "active" : ""}`}
                    type="button"
                    style={{ left: `${markerLeftPercent(marker.time, audioDuration)}%` }}
                    aria-label={`${marker.type} ${formatPreciseTime(marker.time, 3)}`}
                    title={`${marker.type} ${formatPreciseTime(marker.time, 3)}`}
                    onClick={() => props.onSelectAudioFeature(marker)}
                  />
                ))}
              </div>
            </div>
          </div>
        )}
        <audio id="audioPreview" ref={audioRef} className="audio-preview" preload="metadata" src={audioUrl ?? undefined} />
        {sampleVideo && activeMedia.kind === "empty" && <div id="mediaEmptyPreview" className="media-empty-preview active">{activeMedia.text}</div>}
      </div>
    </section>
  );
}

function AudioTime({ audioRef }: { audioRef: RefObject<HTMLAudioElement> }) {
  const [time, setTime] = useState("00:00 / 00:00");
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return undefined;
    const sync = () => setTime(`${formatTime(audio.currentTime)} / ${formatTime(Number.isFinite(audio.duration) ? audio.duration : 0)}`);
    audio.addEventListener("timeupdate", sync);
    audio.addEventListener("loadedmetadata", sync);
    sync();
    return () => {
      audio.removeEventListener("timeupdate", sync);
      audio.removeEventListener("loadedmetadata", sync);
    };
  }, [audioRef]);
  return (
    <span id="audioWaveformTime" className="audio-waveform-time">
      {time}
    </span>
  );
}

function resolveActiveMedia({ sampleVideo, mediaDerivatives, activeMediaKind, selectedDerivativeId, selectedFrameId }: Pick<PreviewPanelProps, "sampleVideo" | "mediaDerivatives" | "activeMediaKind" | "selectedDerivativeId" | "selectedFrameId">) {
  if (!sampleVideo) return { kind: "empty" as const, text: "未加载样例" };
  const derivative = mediaDerivatives.find((item) => item.artifactId === selectedDerivativeId) ?? null;
  if (activeMediaKind === "cover") {
    const url = runtimeUrl(derivative?.uri ?? sampleVideo.coverUri);
    return url ? { kind: "image" as const, url, alt: "封面帧" } : { kind: "empty" as const, text: "暂无可预览图片" };
  }
  if (activeMediaKind === "frame") {
    const frame = sampleVideo.frameArtifacts.find((item) => item.id === selectedFrameId) ?? sampleVideo.frameArtifacts[0];
    const url = runtimeUrl(frame?.imageUri);
    return url ? { kind: "image" as const, url, alt: "抽帧图片" } : { kind: "empty" as const, text: "暂无可预览图片" };
  }
  if (activeMediaKind === "audio" || activeMediaKind === "audioFeature") {
    const audio = derivative ?? mediaDerivatives.find((item) => item.type === "audio-track");
    const url = runtimeUrl(audio?.uri ?? sampleVideo.audioUri);
    return url ? { kind: "audio" as const, url } : { kind: "empty" as const, text: audio?.summary || sampleVideo.audioSummary || "未检测到可抽取音频轨" };
  }
  const videoUrl = runtimeUrl(isVideoDerivative(derivative) ? derivative?.uri : sampleVideo.videoUri);
  return videoUrl ? { kind: "video" as const, url: videoUrl } : { kind: "empty" as const, text: "暂无可播放视频" };
}

function mediaLabel(kind: MediaKind): string {
  const labels: Record<MediaKind, string> = { video: "原视频", cover: "封面", frame: "抽帧", audio: "音频", subtitle: "字幕", audioFeature: "音频分析" };
  return labels[kind] ?? "媒体";
}

function isVideoDerivative(item: MediaDerivative | null) {
  return item?.type === "original-video" || item?.type === "normalized-video";
}

function resolveSeekDuration(audio: HTMLAudioElement, fallbackDuration: number | null | undefined, targetTime: number) {
  if (Number.isFinite(audio.duration) && audio.duration > 0) return audio.duration;
  if (Number.isFinite(fallbackDuration) && fallbackDuration && fallbackDuration > 0) return Number(fallbackDuration);
  return Math.max(1, targetTime);
}
