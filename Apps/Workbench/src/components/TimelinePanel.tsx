import { RefObject, useEffect, useMemo, useRef, useState } from "react";
import type { AudioSeparationArtifact, MediaDerivative, MediaKind, SampleVideo, SubtitleArtifact, SubtitleDraft } from "../types";
import { runtimeUrl } from "../api/client";
import { formatTime } from "../utils/format";
import { clampVisibleSeconds, createTimelineMetrics, frameLeft, visibleFrames } from "../utils/timeline";
import { useElementSize } from "../hooks/useElementSize";
import { useAudioWaveform } from "../hooks/useAudioWaveform";

type TimelinePanelProps = {
  sampleVideo: SampleVideo | null;
  mediaDerivatives: MediaDerivative[];
  activeMediaKind: MediaKind;
  selectedDerivativeId: string | null;
  selectedFrameId: string | null;
  selectedSubtitleId: string | null;
  audioSeparation?: AudioSeparationArtifact | null;
  subtitles?: SubtitleArtifact | null;
  subtitleDrafts: Record<string, SubtitleDraft>;
  timelineFrameVisible: boolean;
  timelineVisibleSeconds: number;
  videoRef: RefObject<HTMLVideoElement>;
  miniCanvasRef: RefObject<HTMLCanvasElement>;
  uiTraceId: string;
  backendTraceId?: string | null;
  onSelectVideo: () => void;
  onSelectAudio: (artifactId?: string | null) => void;
  onSelectFrame: (frameId: string) => void;
  onSelectSubtitle: (segmentId: string) => void;
  onFrameVisibleChange: (visible: boolean) => void;
  onVisibleSecondsChange: (value: number) => void;
};

export function TimelinePanel(props: TimelinePanelProps) {
  const {
    sampleVideo,
    mediaDerivatives,
    activeMediaKind,
    selectedDerivativeId,
    selectedFrameId,
    selectedSubtitleId,
    audioSeparation,
    subtitles,
    subtitleDrafts,
    timelineFrameVisible,
    timelineVisibleSeconds,
    videoRef,
    miniCanvasRef,
    uiTraceId,
    backendTraceId,
    onSelectVideo,
    onSelectAudio,
    onSelectFrame,
    onSelectSubtitle,
    onFrameVisibleChange,
    onVisibleSecondsChange,
  } = props;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [miniCanvas, setMiniCanvas] = useState<HTMLCanvasElement | null>(null);
  const size = useElementSize(scrollRef);
  const [draftSeconds, setDraftSeconds] = useState(String(timelineVisibleSeconds));
  const [audioExpanded, setAudioExpanded] = useState(false);
  const audio = mediaDerivatives.find((item) => item.type === "audio-track") ?? null;
  const audioLayers = buildAudioLayers(audio, audioSeparation);
  const subtitleSegments = subtitles?.segments ?? [];
  const selectedAudio = mediaDerivatives.find((item) => item.artifactId === selectedDerivativeId && item.type.startsWith("audio-")) ?? audio;
  const audioUrl = runtimeUrl(selectedAudio?.uri ?? audio?.uri);
  const frames = sampleVideo?.frameArtifacts ?? [];
  const metrics = useMemo(
    () => createTimelineMetrics(sampleVideo, { visibleSeconds: timelineVisibleSeconds, viewportWidth: size.width }),
    [sampleVideo, size.width, timelineVisibleSeconds],
  );

  useEffect(() => setDraftSeconds(String(timelineVisibleSeconds)), [timelineVisibleSeconds]);

  useAudioWaveform({
    audio: null,
    mainCanvas: null,
    miniCanvas,
    url: audioUrl,
    active: false,
    animate: false,
    trace: {
      uiTraceId,
      backendTraceId: backendTraceId ?? null,
      artifactId: audio?.artifactId ?? null,
      parentArtifactId: audio?.parentArtifactId ?? sampleVideo?.artifactId ?? null,
    },
  });

  return (
    <section className={`timeline-panel ${timelineFrameVisible ? "" : "frames-hidden"}`} aria-label="底部时间线">
      <div className="timeline-shell">
        <div className="timeline-label-column" aria-hidden="true">
          <div className="timeline-label ruler-label">时间</div>
          <div className="timeline-label">视频轨</div>
          <label className="timeline-label frame-track-toggle">
            <input id="frameTrackVisibleInput" type="checkbox" checked={timelineFrameVisible} onChange={(event) => onFrameVisibleChange(event.currentTarget.checked)} />
            <span>帧轨</span>
          </label>
          <div className="timeline-label">音频轨</div>
          <div className="timeline-label">字幕轨</div>
        </div>
        <div className="timeline-controls" aria-label="时间线缩放">
          <label>
            <span>显示秒数</span>
            <input
              id="timelineVisibleSecondsInput"
              type="number"
              min="1"
              max="30"
              step="1"
              value={draftSeconds}
              onChange={(event) => setDraftSeconds(event.currentTarget.value)}
              onBlur={() => onVisibleSecondsChange(clampVisibleSeconds(draftSeconds))}
              onKeyDown={(event) => {
                if (event.key === "Enter") onVisibleSecondsChange(clampVisibleSeconds(draftSeconds));
              }}
            />
          </label>
        </div>
        <div id="timelineScroll" ref={scrollRef} className="timeline-scroll">
          <div id="timelineContent" className="timeline-content" style={{ width: metrics.contentWidth }}>
            <div id="timelineRuler" className="timeline-ruler">
              {metrics.ticks.map((tick) => (
                <span key={`${tick.time}-${tick.left}`} className="ruler-tick" style={{ left: tick.left }}>
                  {formatTime(tick.time)}
                </span>
              ))}
            </div>
            <div id="videoTrack" className="track video-track">
              <button className={`video-clip ${activeMediaKind === "video" ? "active" : ""}`} type="button" style={{ width: metrics.contentWidth }} onClick={onSelectVideo}>
                <strong>原视频</strong>
                <span>{sampleVideo ? `${sampleVideo.fileName} / ${formatTime(sampleVideo.duration)}` : "等待样例视频"}</span>
              </button>
            </div>
            <div id="frameTrack" className="track frame-track">
              {timelineFrameVisible &&
                visibleFrames(frames).map((frame) => (
                  <button
                    key={frame.id}
                    className={`frame-cell ${frame.id === selectedFrameId ? "active" : ""}`}
                    type="button"
                    data-frame-id={frame.id}
                    style={{ left: frameLeft(frame.time, metrics) }}
                    onClick={() => onSelectFrame(frame.id)}
                  >
                    <img alt="" src={runtimeUrl(frame.imageUri) ?? ""} />
                    <span>{formatTime(frame.time)}</span>
                  </button>
                ))}
            </div>
            <div id="audioTrack" className="track audio-track">
              <button className="audio-expand-button" type="button" onClick={() => setAudioExpanded((value) => !value)} aria-expanded={audioExpanded}>
                {audioExpanded ? "收起" : "展开"}
              </button>
              {(audioExpanded ? audioLayers : audioLayers.slice(0, 1)).map((layer, index) => (
                <button key={layer.key} className={`audio-track-button audio-layer-${index} ${layer.uri ? "" : "audio-track-empty"} ${activeMediaKind === "audio" && layer.artifactId === selectedDerivativeId ? "active" : ""}`} type="button" style={{ width: metrics.contentWidth }} onClick={() => onSelectAudio(layer.artifactId)}>
                  <strong>{layer.label}</strong>
                {layer.uri ? (
                  <canvas
                    ref={index === 0 ? setMiniCanvas : undefined}
                    className="audio-mini-waveform"
                    data-audio-wave-mini
                    width={Math.max(1, Math.round(metrics.contentWidth))}
                    height="42"
                    aria-label={layer.summary ?? layer.label}
                  />
                ) : (
                  <span>{layer.summary || "未检测到可抽取音频轨"}</span>
                )}
                </button>
              ))}
            </div>
            <div id="subtitleTrack" className="track subtitle-track">
              {subtitleSegments.length ? (
                subtitleSegments.map((segment) => {
                  const draft = subtitleDrafts[segment.id];
                  const text = draft?.text ?? segment.text;
                  const start = draft?.start ?? segment.start;
                  const end = draft?.end ?? segment.end;
                  return (
                    <button
                      key={segment.id}
                      className={`subtitle-clip ${selectedSubtitleId === segment.id ? "active" : ""}`}
                      type="button"
                      style={{ left: frameLeft(start, metrics), width: Math.max(46, frameLeft(end, metrics) - frameLeft(start, metrics)) }}
                      onClick={() => onSelectSubtitle(segment.id)}
                    >
                      {text || "空字幕"}
                    </button>
                  );
                })
              ) : (
                <span className="subtitle-empty">{subtitles?.reason ?? "暂无字幕"}</span>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function buildAudioLayers(audio: MediaDerivative | null, audioSeparation?: AudioSeparationArtifact | null) {
  return [
    {
      key: "original",
      label: "原音频",
      artifactId: audio?.artifactId ?? audioSeparation?.original?.artifactId ?? null,
      uri: audio?.uri ?? audioSeparation?.original?.uri ?? null,
      summary: audio?.summary ?? audioSeparation?.original?.summary ?? null,
    },
    {
      key: "vocal",
      label: "人声",
      artifactId: audioSeparation?.vocal?.artifactId ?? null,
      uri: audioSeparation?.vocal?.uri ?? null,
      summary: audioSeparation?.vocal?.summary ?? audioSeparation?.reason ?? null,
    },
    {
      key: "music",
      label: "伴奏",
      artifactId: audioSeparation?.music?.artifactId ?? null,
      uri: audioSeparation?.music?.uri ?? null,
      summary: audioSeparation?.music?.summary ?? audioSeparation?.reason ?? null,
    },
  ];
}
