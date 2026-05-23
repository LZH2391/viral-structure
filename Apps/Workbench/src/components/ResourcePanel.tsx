import type { BackendCapabilities } from "../types";

const REQUIRED_DOUBAO_ENV = ["DOUBAO_SAUC_APP_ID", "DOUBAO_SAUC_ACCESS_TOKEN"];

type ResourcePanelProps = {
  fileLabel: string;
  isUploading: boolean;
  frameSampleRate: number;
  capabilities: BackendCapabilities | null;
  enableAudioSeparation: boolean;
  enableSubtitleRecognition: boolean;
  enableAudioFeatureAnalysis: boolean;
  onFrameSampleRateChange: (value: number) => void;
  onEnableAudioSeparationChange: (value: boolean) => void;
  onEnableSubtitleRecognitionChange: (value: boolean) => void;
  onEnableAudioFeatureAnalysisChange: (value: boolean) => void;
  onUpload: (file: File) => void;
};

export function ResourcePanel({
  fileLabel,
  isUploading,
  frameSampleRate,
  capabilities,
  enableAudioSeparation,
  enableSubtitleRecognition,
  enableAudioFeatureAnalysis,
  onFrameSampleRateChange,
  onEnableAudioSeparationChange,
  onEnableSubtitleRecognitionChange,
  onEnableAudioFeatureAnalysisChange,
  onUpload,
}: ResourcePanelProps) {
  const demucsDisabled = isUploading || capabilities?.demucsAvailable === false;
  const subtitleDisabled = isUploading || capabilities?.doubaoSaucConfigured === false;
  const audioFeatureDisabled = isUploading || capabilities?.librosaAvailable === false;
  return (
    <aside className="resource-panel" aria-label="资源区">
      <section className="resource-view active" data-view="materials">
        <label className="upload-target" htmlFor="sampleVideoInput">
          <input
            id="sampleVideoInput"
            type="file"
            accept="video/*"
            disabled={isUploading}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              if (file) onUpload(file);
              event.currentTarget.value = "";
            }}
          />
          <span className="upload-title">选择样例视频</span>
          <span id="sampleFileLabel" className="upload-meta">
            {fileLabel}
          </span>
        </label>
        <div className="upload-options">
          <label className="sampling-control">
          <span>抽帧采样率</span>
          <input
            id="frameSampleRateInput"
            type="number"
            min="1"
            max="10"
            step="1"
            value={frameSampleRate}
            disabled={isUploading}
            onChange={(event) => onFrameSampleRateChange(Number(event.currentTarget.value || 1))}
          />
          <small>每秒抽多少帧</small>
          </label>
          <label className={`option-toggle ${demucsDisabled ? "disabled" : ""}`}>
            <input
              id="enableAudioSeparationInput"
              type="checkbox"
              checked={enableAudioSeparation}
              disabled={demucsDisabled}
              onChange={(event) => onEnableAudioSeparationChange(event.currentTarget.checked)}
            />
            <span>人声/音乐分离</span>
            <small>{capabilities?.demucsAvailable === false ? "需要安装或配置 Demucs" : "随上传任务执行"}</small>
          </label>
          <label className={`option-toggle ${subtitleDisabled ? "disabled" : ""}`}>
            <input
              id="enableSubtitleRecognitionInput"
              type="checkbox"
              checked={enableSubtitleRecognition}
              disabled={subtitleDisabled}
              onChange={(event) => onEnableSubtitleRecognitionChange(event.currentTarget.checked)}
            />
            <span>字幕识别</span>
            <small>{capabilities?.doubaoSaucConfigured === false ? `需要配置 ${(capabilities.doubaoSaucRequiredEnv ?? REQUIRED_DOUBAO_ENV).join(" / ")}` : "优先使用人声轨"}</small>
          </label>
          <label className={`option-toggle ${audioFeatureDisabled ? "disabled" : ""}`}>
            <input
              id="enableAudioFeatureAnalysisInput"
              type="checkbox"
              checked={enableAudioFeatureAnalysis}
              disabled={audioFeatureDisabled}
              onChange={(event) => onEnableAudioFeatureAnalysisChange(event.currentTarget.checked)}
            />
            <span>音频基础分析</span>
            <small>{capabilities?.librosaAvailable === false ? "需要 Python/Librosa 环境" : "优先分析伴奏轨"}</small>
          </label>
        </div>
      </section>
    </aside>
  );
}
