import { useEffect, useState } from "react";
import type { SubtitleArtifact, SubtitleDraft } from "../../types";
import type { PropertyPanelProps } from "../PropertyPanel";
import { DetailRow } from "./SharedRows";

export function SubtitleRows({
  subtitle,
  artifact,
  draft,
  onChange,
}: {
  subtitle: NonNullable<SubtitleArtifact["segments"]>[number];
  artifact: SubtitleArtifact;
  draft?: SubtitleDraft;
  onChange: PropertyPanelProps["onSubtitleDraftChange"];
}) {
  const [text, setText] = useState(draft?.text ?? subtitle.text);
  const [start, setStart] = useState(String(draft?.start ?? subtitle.start));
  const [end, setEnd] = useState(String(draft?.end ?? subtitle.end));

  useEffect(() => {
    setText(draft?.text ?? subtitle.text);
    setStart(String(draft?.start ?? subtitle.start));
    setEnd(String(draft?.end ?? subtitle.end));
  }, [draft?.end, draft?.start, draft?.text, subtitle.end, subtitle.start, subtitle.text]);

  const commit = () => {
    onChange({
      segmentId: subtitle.id,
      text,
      start: Number(start || subtitle.start),
      end: Number(end || subtitle.end),
      sourceArtifactId: artifact.artifactId,
    });
  };

  return (
    <div className="subtitle-editor">
      <DetailRow label="字幕来源" value={artifact.artifactId} />
      <DetailRow label="parent" value={artifact.parentArtifactId ?? "无"} />
      <DetailRow label="保存状态" value={renderDraftStatus(draft)} />
      <label>
        <span>文本</span>
        <textarea value={text} rows={4} onChange={(event) => setText(event.currentTarget.value)} onBlur={commit} />
      </label>
      <div className="subtitle-time-fields">
        <label>
          <span>开始</span>
          <input type="number" min="0" step="0.1" value={start} onChange={(event) => setStart(event.currentTarget.value)} onBlur={commit} />
        </label>
        <label>
          <span>结束</span>
          <input type="number" min="0" step="0.1" value={end} onChange={(event) => setEnd(event.currentTarget.value)} onBlur={commit} />
        </label>
      </div>
      <DetailRow label="草稿版本" value={draft?.draftVersionId ?? "未编辑"} />
      {draft?.errorMessage ? <DetailRow label="失败原因" value={draft.errorMessage} /> : null}
    </div>
  );
}

function renderDraftStatus(draft?: SubtitleDraft) {
  if (!draft) return "未编辑";
  if (draft.saveState === "saving") return "保存中";
  if (draft.saveState === "saved") return "已保存";
  if (draft.saveState === "failed") return "保存失败";
  return "未编辑";
}
