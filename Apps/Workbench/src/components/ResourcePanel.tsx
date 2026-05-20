type ResourcePanelProps = {
  fileLabel: string;
  isUploading: boolean;
  frameSampleRate: number;
  onFrameSampleRateChange: (value: number) => void;
  onUpload: (file: File) => void;
};

export function ResourcePanel({ fileLabel, isUploading, frameSampleRate, onFrameSampleRateChange, onUpload }: ResourcePanelProps) {
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
            }}
          />
          <span className="upload-title">选择样例视频</span>
          <span id="sampleFileLabel" className="upload-meta">
            {fileLabel}
          </span>
        </label>
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
      </section>
    </aside>
  );
}
