import { shortId } from "../utils/format";

type RunStatusBarProps = {
  label: string;
  backendTraceId?: string | null;
  uiTraceId: string;
  stageId?: string | null;
};

export function RunStatusBar({ label, backendTraceId, uiTraceId, stageId }: RunStatusBarProps) {
  const traceLabel = backendTraceId ? `trace ${shortId(backendTraceId)}` : `uiTrace ${shortId(uiTraceId)}`;
  return (
    <div className="run-strip">
      <span id="runStatus" className="run-pill">
        {label}
      </span>
      <span id="traceLabel" className="trace-label">
        {stageId ? `${traceLabel} / stage ${shortId(stageId, 6)}` : "trace 未创建"}
      </span>
    </div>
  );
}
