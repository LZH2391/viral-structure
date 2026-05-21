import { RefObject, useEffect, useMemo, useRef, useState } from "react";
import type { AudioFeatureAnalysisArtifact, AudioFeatureMarker, AudioSeparationArtifact, MediaDerivative, MediaKind, SampleVideo, SubtitleArtifact, SubtitleDraft } from "../types";
import { runtimeUrl } from "../api/client";
import { formatPreciseTime, formatTime } from "../utils/format";
import { buildAudioFeatureMarkers, markerLeftPercent } from "../utils/audioFeatureMarkers";
import { clampVisibleSeconds, createTimelineMetrics, frameLeft, timeToTimelineLeft, visibleFrames } from "../utils/timeline";
import { useElementSize } from "../hooks/useElementSize";
import { useAudioWaveform } from "../hooks/useAudioWaveform";
import { useTimelinePlayback } from "../hooks/useTimelinePlayback";
import { TimelinePlayhead } from "./TimelinePlayhead";

type TimelinePanelProps = {
  sampleVideo: SampleVideo | null;
  mediaDerivatives: MediaDerivative[];
  activeMediaKind: MediaKind;
  selectedDerivativeId: string | null;
  selectedFrameId: string | null;
  selectedSubtitleId: string | null;
  selectedAudioFeatureMarkerId: string | null;
  audioSeparation?: AudioSeparationArtifact | null;
  audioFeatures?: AudioFeatureAnalysisArtifact | null;
  subtitles?: SubtitleArtifact | null;
  subtitleDrafts: Record<string, SubtitleDraft>;
  timelineFrameVisible: boolean;
  timelineVisibleSeconds: number;
  videoRef: RefObject<HTMLVideoElement>;
  audioRef: RefObject<HTMLAudioElement>;
  miniCanvasRef: RefObject<HTMLCanvasElement>;
  uiTraceId: string;
  backendTraceId?: string | null;
  onSelectVideo: () => void;
  onSelectAudio: (artifactId?: string | null) => void;
  onSelectAudioFeature: (markerId: string) => void;
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
    selectedAudioFeatureMarkerId,
    audioSeparation,
    audioFeatures,
    subtitles,
    subtitleDrafts,
    timelineFrameVisible,
    timelineVisibleSeconds,
    videoRef,
    audioRef,
    miniCanvasRef,
    uiTraceId,
    backendTraceId,
    onSelectVideo,
    onSelectAudio,
    onSelectAudioFeature,
    onSelectFrame,
    onSelectSubtitle,
    onFrameVisibleChange,
    onVisibleSecondsChange,
  } = props;
  const scrollRef = useRef<HTMLDivElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const playheadLabelRef = useRef<HTMLSpanElement>(null);
  const [miniCanvas, setMiniCanvas] = useState<HTMLCanvasElement | null>(null);
  const size = useElementSize(scrollRef);
  const [draftSeconds, setDraftSeconds] = useState(String(timelineVisibleSeconds));
  const [audioExpanded, setAudioExpanded] = useState(false);
  const audio = mediaDerivatives.find((item) => item.type === "audio-track") ?? null;
  const audioLayers = buildAudioLayers(audio, audioSeparation);
  const subtitleSegments = subtitles?.segments ?? [];
  const selectedAudio = mediaDerivatives.find((item) => item.artifactId === selectedDerivativeId && item.type.startsWith("audio-")) ?? audio;
  const audioFeatureMarkers = useMemo(() => buildAudioFeatureMarkers(audioFeatures), [audioFeatures]);
  const audioFeatureLayerKey = resolveAudioFeatureLayerKey(audioFeatures, audioLayers);
  const collapsedAudioLayer = useMemo(() => resolveCollapsedAudioLayer(audioLayers, audioFeatureLayerKey), [audioFeatureLayerKey, audioLayers]);
  const visibleAudioLayers = useMemo(() => (audioExpanded ? audioLayers : [collapsedAudioLayer]), [audioExpanded, audioLayers, collapsedAudioLayer]);
  const waveformLayerKey = useMemo(() => resolveWaveformLayerKey(audioLayers, visibleAudioLayers, audioExpanded, selectedAudio?.artifactId ?? null, audioFeatureLayerKey), [audioExpanded, audioFeatureLayerKey, audioLayers, selectedAudio?.artifactId, visibleAudioLayers]);
  const waveformLayer = useMemo(() => visibleAudioLayers.find((layer) => layer.key === waveformLayerKey) ?? visibleAudioLayers[0] ?? null, [visibleAudioLayers, waveformLayerKey]);
  const audioUrl = runtimeUrl(waveformLayer?.uri ?? selectedAudio?.uri ?? audio?.uri);
  const frames = sampleVideo?.frameArtifacts ?? [];
  const metrics = useMemo(
    () => createTimelineMetrics(sampleVideo, { visibleSeconds: timelineVisibleSeconds, viewportWidth: size.width }),
    [sampleVideo, size.width, timelineVisibleSeconds],
  );
  const playheadController = useTimelinePlayback({
    activeMediaKind,
    videoRef,
    audioRef,
    onFrame: (time) => {
      const left = timeToPlayheadLeft(time, metrics);
      const playhead = playheadRef.current;
      if (playhead) playhead.style.transform = `translate3d(${left}px, 0, 0)`;
      if (playheadLabelRef.current) playheadLabelRef.current.textContent = formatPreciseTime(time);
    },
  });

  useEffect(() => setDraftSeconds(String(timelineVisibleSeconds)), [timelineVisibleSeconds]);

  useAudioWaveform({
    audio: null,
    mainCanvas: null,
    miniCanvas,
    url: audioUrl,
    active: false,
    animate: false,
    durationSeconds: audioFeatures?.durationSeconds ?? sampleVideo?.duration ?? null,
    trace: {
      uiTraceId,
      backendTraceId: backendTraceId ?? null,
      artifactId: waveformLayer?.artifactId ?? audio?.artifactId ?? null,
      parentArtifactId: waveformLayer?.parentArtifactId ?? audio?.parentArtifactId ?? sampleVideo?.artifactId ?? null,
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
            <TimelinePlayhead
              duration={metrics.duration}
              contentWidth={metrics.contentWidth}
              disabled={!sampleVideo}
              mediaElement={playheadController.mediaElement}
              uiTraceId={uiTraceId}
              backendTraceId={backendTraceId ?? null}
              artifactId={resolveTimelinePlaybackArtifactId(activeMediaKind, sampleVideo, selectedAudio, subtitles)}
              parentArtifactId={resolveTimelinePlaybackParentArtifactId(activeMediaKind, sampleVideo, selectedAudio, subtitles)}
              scrollRef={scrollRef}
              playheadRef={playheadRef}
              labelRef={playheadLabelRef}
              controller={playheadController}
            />
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
              {visibleAudioLayers.map((layer, index) => {
                const showFeatureLayer = layer.key === audioFeatureLayerKey || (!audioExpanded && layer.key === collapsedAudioLayer.key);
                return (
                  <button key={layer.key} className={`audio-track-button audio-layer-${index} ${showFeatureLayer ? "has-feature-layer" : ""} ${layer.uri ? "" : "audio-track-empty"} ${activeMediaKind === "audio" && layer.artifactId === selectedDerivativeId ? "active" : ""}`} type="button" style={{ width: metrics.contentWidth }} onClick={() => onSelectAudio(layer.artifactId)}>
                    <strong>{layer.label}</strong>
                    {layer.uri ? (
                      <canvas
                        ref={layer.key === waveformLayerKey ? setMiniCanvas : undefined}
                        className="audio-mini-waveform"
                        data-audio-wave-mini
                        width={Math.max(1, Math.round(metrics.contentWidth))}
                        height="42"
                        aria-label={layer.summary ?? layer.label}
                      />
                    ) : (
                      <span>{layer.summary || "未检测到可抽取音频轨"}</span>
                    )}
                    {showFeatureLayer ? (
                      <span className="audio-feature-layer" aria-label="音频基础标记" onClick={(event) => event.stopPropagation()}>
                        {audioFeatures?.status === "degraded" ? (
                          <span className="audio-feature-empty">{audioFeatures.reason ?? "音频基础分析未产出"}</span>
                        ) : (
                          audioFeatureMarkers.map((marker) => (
                            <span
                              key={marker.id}
                              role="button"
                              tabIndex={0}
                              className={`audio-feature-marker ${marker.type} ${selectedAudioFeatureMarkerId === marker.id ? "active" : ""}`}
                              style={{ left: `${markerLeftPercent(marker.time, metrics.duration)}%` }}
                              aria-label={`${marker.type} ${formatPreciseTime(marker.time, 3)}`}
                              title={`${marker.type} ${formatPreciseTime(marker.time, 3)}`}
                              onClick={() => onSelectAudioFeature(marker.id)}
                              onKeyDown={(event) => {
                                if (event.key === "Enter" || event.key === " ") onSelectAudioFeature(marker.id);
                              }}
                            />
                          ))
                        )}
                      </span>
                    ) : null}
                  </button>
                );
              })}
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

function timeToPlayheadLeft(time: number, metrics: Pick<ReturnType<typeof createTimelineMetrics>, "duration" | "contentWidth">) {
  return timeToTimelineLeft(time, metrics);
}

function resolveTimelinePlaybackArtifactId(activeMediaKind: MediaKind, sampleVideo: SampleVideo | null, selectedAudio: MediaDerivative | null, subtitles?: SubtitleArtifact | null): string | null {
  if (activeMediaKind === "video") return sampleVideo?.artifactId ?? null;
  if (activeMediaKind === "audio" || activeMediaKind === "audioFeature") return selectedAudio?.artifactId ?? null;
  if (activeMediaKind === "subtitle") return subtitles?.artifactId ?? null;
  return sampleVideo?.artifactId ?? null;
}

function resolveTimelinePlaybackParentArtifactId(activeMediaKind: MediaKind, sampleVideo: SampleVideo | null, selectedAudio: MediaDerivative | null, subtitles?: SubtitleArtifact | null): string | null {
  if (activeMediaKind === "video") return sampleVideo?.parentArtifactId ?? null;
  if (activeMediaKind === "audio" || activeMediaKind === "audioFeature") return selectedAudio?.parentArtifactId ?? sampleVideo?.artifactId ?? null;
  if (activeMediaKind === "subtitle") return subtitles?.parentArtifactId ?? sampleVideo?.artifactId ?? null;
  return sampleVideo?.parentArtifactId ?? null;
}

function buildAudioLayers(audio: MediaDerivative | null, audioSeparation?: AudioSeparationArtifact | null) {
  return [
    {
      key: "original",
      label: "原音频",
      artifactId: audio?.artifactId ?? audioSeparation?.original?.artifactId ?? null,
      parentArtifactId: audio?.parentArtifactId ?? audioSeparation?.original?.parentArtifactId ?? null,
      uri: audio?.uri ?? audioSeparation?.original?.uri ?? null,
      summary: audio?.summary ?? audioSeparation?.original?.summary ?? null,
    },
    {
      key: "vocal",
      label: "人声",
      artifactId: audioSeparation?.vocal?.artifactId ?? null,
      parentArtifactId: audioSeparation?.vocal?.parentArtifactId ?? null,
      uri: audioSeparation?.vocal?.uri ?? null,
      summary: audioSeparation?.vocal?.summary ?? audioSeparation?.reason ?? null,
    },
    {
      key: "music",
      label: "伴奏",
      artifactId: audioSeparation?.music?.artifactId ?? null,
      parentArtifactId: audioSeparation?.music?.parentArtifactId ?? null,
      uri: audioSeparation?.music?.uri ?? null,
      summary: audioSeparation?.music?.summary ?? audioSeparation?.reason ?? null,
    },
  ];
}

function resolveAudioFeatureLayerKey(audioFeatures: AudioFeatureAnalysisArtifact | null | undefined, layers: ReturnType<typeof buildAudioLayers>) {
  const sourceArtifactId = audioFeatures?.sourceAudioArtifactId ?? null;
  const sourceRole = audioFeatures?.analysisParams?.sourceRole ?? null;
  const matched = layers.find((layer) => layer.artifactId && layer.artifactId === sourceArtifactId);
  if (matched) return matched.key;
  if (sourceRole === "music") return "music";
  return "original";
}

function resolveCollapsedAudioLayer(layers: ReturnType<typeof buildAudioLayers>, audioFeatureLayerKey: ReturnType<typeof resolveAudioFeatureLayerKey>) {
  return layers.find((layer) => layer.key === audioFeatureLayerKey && layer.uri) ?? layers.find((layer) => layer.key === "original" && layer.uri) ?? layers[0];
}

function resolveWaveformLayerKey(
  layers: ReturnType<typeof buildAudioLayers>,
  visibleLayers: ReturnType<typeof buildAudioLayers>,
  audioExpanded: boolean,
  selectedAudioArtifactId: string | null,
  audioFeatureLayerKey: ReturnType<typeof resolveAudioFeatureLayerKey>,
) {
  if (!audioExpanded) return visibleLayers[0]?.key ?? "original";
  const selectedLayer = layers.find((layer) => layer.artifactId && layer.artifactId === selectedAudioArtifactId && layer.uri);
  if (selectedLayer) return selectedLayer.key;
  const featureLayer = layers.find((layer) => layer.key === audioFeatureLayerKey && layer.uri);
  if (featureLayer) return featureLayer.key;
  return visibleLayers[0]?.key ?? "original";
}
