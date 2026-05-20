import { RefObject, useEffect, useMemo, useRef, useState } from "react";
import type { MediaDerivative, MediaKind, SampleVideo } from "../types";
import { runtimeUrl } from "../api/client";
import { formatTime } from "../utils/format";
import { clampVisibleSeconds, createTimelineMetrics, frameLeft, visibleFrames } from "../utils/timeline";
import { useElementSize } from "../hooks/useElementSize";
import { useAudioWaveform } from "../hooks/useAudioWaveform";

type TimelinePanelProps = {
  sampleVideo: SampleVideo | null;
  mediaDerivatives: MediaDerivative[];
  activeMediaKind: MediaKind;
  selectedFrameId: string | null;
  timelineFrameVisible: boolean;
  timelineVisibleSeconds: number;
  videoRef: RefObject<HTMLVideoElement>;
  miniCanvasRef: RefObject<HTMLCanvasElement>;
  onSelectVideo: () => void;
  onSelectAudio: () => void;
  onSelectFrame: (frameId: string) => void;
  onFrameVisibleChange: (visible: boolean) => void;
  onVisibleSecondsChange: (value: number) => void;
};

export function TimelinePanel(props: TimelinePanelProps) {
  const {
    sampleVideo,
    mediaDerivatives,
    activeMediaKind,
    selectedFrameId,
    timelineFrameVisible,
    timelineVisibleSeconds,
    videoRef,
    miniCanvasRef,
    onSelectVideo,
    onSelectAudio,
    onSelectFrame,
    onFrameVisibleChange,
    onVisibleSecondsChange,
  } = props;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [miniCanvas, setMiniCanvas] = useState<HTMLCanvasElement | null>(null);
  const size = useElementSize(scrollRef);
  const [draftSeconds, setDraftSeconds] = useState(String(timelineVisibleSeconds));
  const audio = mediaDerivatives.find((item) => item.type === "audio-track") ?? null;
  const audioUrl = runtimeUrl(audio?.uri);
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
              <button className={`audio-track-button ${audio?.uri ? "" : "audio-track-empty"} ${activeMediaKind === "audio" ? "active" : ""}`} type="button" style={{ width: metrics.contentWidth }} onClick={onSelectAudio}>
                {audio?.uri ? (
                  <canvas
                    ref={(node) => {
                      setMiniCanvas(node);
                    }}
                    className="audio-mini-waveform"
                    data-audio-wave-mini
                    width={Math.max(1, Math.round(metrics.contentWidth))}
                    height="42"
                    aria-label={audio.summary ?? "音频轨"}
                  />
                ) : (
                  <span>{audio?.summary || "未检测到可抽取音频轨"}</span>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
