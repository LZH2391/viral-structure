import { useEffect, useState } from "react";
import { getAgentChatTurnTimeline } from "../../api/client";
import type { AgentTimelineItem, AgentTurnTimeline } from "../../types";
import { ChevronGlyph, RestructureTimelineIcon } from "./RestructureWorkspaceGlyphs";
import type { NewUiTurnTimelineTarget, RestructureTimelineActivityItem, RestructureTimelineDisplayItem, RestructureTimelineStreamableItem } from "./restructureWorkspaceTypes";
import { hasRenderableAssistantText, normalizeTimelineText, sanitizeDomId } from "./restructureWorkspaceUtils";

const RESTRUCTURE_TIMELINE_SETTLED_POLL_COUNT = 3;

export function RestructureTimelineItemGroup({
  items,
  scopeKey,
  expanded,
  running,
  getDisplayText,
  isPseudoStreaming,
  onToggle,
}: {
  items: RestructureTimelineDisplayItem[];
  scopeKey: string | null;
  expanded: boolean;
  running: boolean;
  getDisplayText: (item: RestructureTimelineDisplayItem) => string;
  isPseudoStreaming: (item: RestructureTimelineDisplayItem) => boolean;
  onToggle: () => void;
}) {
  if (!items.length) return null;
  const activityItems = items.filter((item): item is RestructureTimelineActivityItem => item.kind !== "agent_message");
  const latestActivity = running ? activityItems[activityItems.length - 1] ?? null : null;
  const panelId = scopeKey ? `new-ui-restructure-activity-${sanitizeDomId(scopeKey)}` : undefined;

  return (
    <div className="new-ui-restructure-activity-group-stack">
      {activityItems.length ? (
        <section className={`new-ui-restructure-activity-group ${expanded ? "is-expanded" : ""} ${running ? "is-running" : ""}`.trim()} aria-label="过程">
          <button
            className="new-ui-restructure-activity-toggle"
            type="button"
            aria-expanded={expanded}
            aria-controls={panelId}
            onClick={onToggle}
          >
            <span className="new-ui-restructure-activity-chevron" aria-hidden="true">
              <ChevronGlyph />
            </span>
            <span className="new-ui-restructure-activity-summary">
              <span>{expanded ? "收起过程" : "显示过程"}</span>
            </span>
          </button>
          <div id={panelId} className="new-ui-restructure-activity-group-body" aria-hidden={!expanded}>
            {items.map((item) => (
              <RestructureTimelineItem
                key={item.id}
                item={item}
                displayText={getDisplayText(item)}
                pseudoStreaming={isPseudoStreaming(item)}
                highlight={running && item.kind !== "agent_message" && item.id === latestActivity?.id}
              />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function RestructureTimelineItem({ item, displayText, pseudoStreaming = false, highlight = false }: { item: RestructureTimelineDisplayItem; displayText?: string; pseudoStreaming?: boolean; highlight?: boolean }) {
  if (item.kind === "agent_message") {
    const text = displayText ?? item.text;
    const running = isTimelineItemRunning(item.status);
    return (
      <article className={`new-ui-restructure-message is-assistant ${item.status ?? ""} ${pseudoStreaming ? "pseudo-streaming" : ""}`.trim()} aria-busy={running || pseudoStreaming || undefined}>
        <div className="new-ui-restructure-message-body">
          <p className={running && !hasRenderableAssistantText(text) ? "is-thinking-text" : undefined}>
            {running && !hasRenderableAssistantText(text) ? "正在思考" : text}
          </p>
        </div>
      </article>
    );
  }

  const detailText = displayText ?? item.detail;
  const thinking = pseudoStreaming || highlight;
  return (
    <article className={`new-ui-restructure-activity is-${item.kind} ${item.status ?? ""}`.trim()} aria-busy={thinking || undefined}>
      <span className="new-ui-restructure-activity-icon" aria-hidden="true">
        <RestructureTimelineIcon kind={item.kind} />
      </span>
      <p className={thinking ? "is-thinking-text" : undefined}>
        <span>{item.label}</span>
        {detailText ? <strong>{detailText}</strong> : null}
      </p>
    </article>
  );
}

export function useRestructureTurnTimeline(target: NewUiTurnTimelineTarget | null) {
  const [timeline, setTimeline] = useState<AgentTurnTimeline | null>(null);
  const threadId = target?.threadId ?? null;
  const turnId = target?.turnId ?? null;
  const workspaceRoot = target?.workspaceRoot ?? null;
  const targetRunning = Boolean(target?.running);
  const targetKey = threadId && turnId ? `${threadId}:${turnId}:${workspaceRoot ?? ""}` : "";

  useEffect(() => {
    setTimeline(null);
  }, [targetKey]);

  useEffect(() => {
    if (!threadId || !turnId) return undefined;
    let cancelled = false;
    let settlePollsRemaining = RESTRUCTURE_TIMELINE_SETTLED_POLL_COUNT;
    const load = async () => {
      try {
        const next = await getAgentChatTurnTimeline(threadId, turnId, workspaceRoot);
        if (!cancelled) setTimeline(next);
      } catch {
        if (!cancelled) setTimeline(null);
      }
    };
    void load();
    const timer = window.setInterval(() => {
      if (!targetRunning) {
        if (settlePollsRemaining <= 0) {
          window.clearInterval(timer);
          return;
        }
        settlePollsRemaining -= 1;
      }
      void load();
    }, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [targetKey, threadId, turnId, workspaceRoot, targetRunning]);

  return timeline;
}

export function buildRestructureTimelineDisplayItems(items: AgentTimelineItem[]): RestructureTimelineDisplayItem[] {
  const result: RestructureTimelineDisplayItem[] = [];
  const sourceKeyCounts = new Map<string, number>();
  items.forEach((item) => {
    const sourceKey = createTimelineItemSourceKey(item, sourceKeyCounts);
    if (item.kind === "reasoning") {
      appendTimelineActivity(result, {
        id: sourceKey,
        sourceKey,
        kind: "reasoning",
        label: "reasoning",
        detail: resolveTimelineItemText(item) || normalizeTimelineTitle(item.title, "Reasoning") || null,
        status: item.status,
      });
      return;
    }
    if (item.kind === "context_compacted") {
      appendTimelineActivity(result, {
        id: sourceKey,
        sourceKey,
        kind: "context_compacted",
        label: "上下文已压缩",
        detail: normalizeTimelineDetail(resolveTimelineItemText(item), "Context compacted"),
        status: item.status,
      });
      return;
    }
    if (item.kind === "agent_message") {
      const text = resolveTimelineItemText(item);
      if (text) {
        appendTimelineActivity(result, {
          id: sourceKey,
          sourceKey,
          kind: "agent_message",
          text,
          status: item.status,
        });
      }
      return;
    }
    if (isTimelineToolCallKind(item.kind)) {
      const toolName = resolveTimelineToolName(item);
      appendTimelineActivity(result, {
        id: sourceKey,
        sourceKey,
        kind: "tool_call",
        label: toolName ? `Tool call: ${toolName}` : "Tool call",
        detail: null,
        status: item.status,
      });
    }
  });
  return result;
}

function appendTimelineActivity(result: RestructureTimelineDisplayItem[], next: RestructureTimelineDisplayItem) {
  const previous = result[result.length - 1];
  if (previous && isSameTimelineActivity(previous, next)) {
    result[result.length - 1] = {
      ...previous,
      status: preferTimelineActivityStatus(previous.status, next.status),
    };
    return;
  }
  const duplicateIndex = result.findIndex((item) => isSameTimelineActivity(item, next));
  if (duplicateIndex >= 0) {
    const duplicate = result[duplicateIndex];
    result[duplicateIndex] = {
      ...duplicate,
      id: next.kind === "agent_message" ? duplicate.id : next.id,
      sourceKey: next.kind === "agent_message" ? duplicate.sourceKey : next.sourceKey,
      status: preferTimelineActivityStatus(duplicate.status, next.status),
    };
    return;
  }
  result.push(next);
}

function isSameTimelineActivity(left: RestructureTimelineDisplayItem, right: RestructureTimelineDisplayItem) {
  if (left.kind !== right.kind) return false;
  if (left.kind === "agent_message" && right.kind === "agent_message") {
    return normalizeTimelineText(left.text) === normalizeTimelineText(right.text);
  }
  if (left.kind === "agent_message" || right.kind === "agent_message") return false;
  return left.label === right.label
    && normalizeTimelineText(left.detail) === normalizeTimelineText(right.detail);
}

function preferTimelineActivityStatus(current: AgentTimelineItem["status"], next: AgentTimelineItem["status"]) {
  if (isTimelineItemRunning(current) && !isTimelineItemRunning(next)) return next;
  return current ?? next;
}

export function isTimelineItemRunning(status: AgentTimelineItem["status"] | undefined) {
  return String(status ?? "").toLowerCase() === "running";
}

function isTimelineToolCallKind(kind: AgentTimelineItem["kind"]) {
  return kind === "tool_call"
    || kind === "command_execution"
    || kind === "mcp_tool_call"
    || kind === "dynamic_tool_call";
}

export function isPseudoStreamableTimelineItem(item: RestructureTimelineDisplayItem): item is RestructureTimelineStreamableItem {
  if (item.kind === "agent_message") {
    return !isTimelineItemRunning(item.status) && Boolean(item.text);
  }
  return item.kind !== "tool_call"
    && !isTimelineItemRunning(item.status)
    && Boolean(item.detail);
}

export function getTimelineDisplayText(item: RestructureTimelineDisplayItem) {
  return item.kind === "agent_message" ? item.text : item.detail ?? "";
}

export function getTimelineStreamText(item: RestructureTimelineStreamableItem) {
  return item.kind === "agent_message" ? item.text : item.detail;
}

export function createTimelinePseudoStreamKey(item: RestructureTimelineStreamableItem) {
  if (item.sourceKey) return item.sourceKey;
  const text = getTimelineStreamText(item);
  return item.kind === "agent_message" ? `agent_message:${normalizeTimelineText(text) ?? ""}` : `${item.kind}:${normalizeTimelineText(text) ?? ""}`;
}

export function isTimelineObservedBeforeCompletion(item: RestructureTimelineDisplayItem) {
  return item.kind !== "agent_message"
    && item.kind !== "tool_call"
    && isTimelineItemRunning(item.status)
    && Boolean(item.detail);
}

export function createTimelineObservedPseudoStreamKey(item: RestructureTimelineDisplayItem) {
  if (item.sourceKey) return item.sourceKey;
  if (item.kind === "agent_message") return `agent_message:${normalizeTimelineText(item.text) ?? ""}`;
  return `${item.kind}:${normalizeTimelineText(item.detail) ?? ""}`;
}

function createTimelineItemSourceKey(item: AgentTimelineItem, sourceKeyCounts: Map<string, number>) {
  const rawId = String(item.id ?? "").trim();
  const kind = String(item.kind ?? "unknown").trim() || "unknown";
  const stableId = rawId && !/^item_\d+$/i.test(rawId) ? rawId : null;
  const timestamp = normalizeTimelineText(item.createdAt);
  if (!stableId && !timestamp) {
    const orderKey = `__order:${kind}`;
    const order = sourceKeyCounts.get(orderKey) ?? 0;
    sourceKeyCounts.set(orderKey, order + 1);
    return `timeline:${kind}:order:${order}`;
  }
  const baseKey = stableId ? `timeline:${kind}:id:${stableId}` : `timeline:${kind}:at:${timestamp}`;
  const count = sourceKeyCounts.get(baseKey) ?? 0;
  sourceKeyCounts.set(baseKey, count + 1);
  return count > 0 ? `${baseKey}:${count}` : baseKey;
}

function resolveTimelineItemText(item: AgentTimelineItem) {
  const fullText = (item as AgentTimelineItem & { text?: string | null }).text;
  return normalizeTimelineText(fullText) ?? normalizeTimelineText(item.textPreview);
}

function normalizeTimelineTitle(title: string | null | undefined, fallback: string) {
  const trimmed = normalizeTimelineText(title);
  if (!trimmed || trimmed.toLowerCase() === fallback.toLowerCase()) return null;
  return trimmed;
}

function normalizeTimelineDetail(value: string | null | undefined, fallback: string) {
  const trimmed = normalizeTimelineText(value);
  if (!trimmed || trimmed.toLowerCase() === fallback.toLowerCase()) return null;
  return trimmed;
}

function resolveTimelineToolName(item: AgentTimelineItem) {
  return normalizeTimelineText(item.metadata?.toolName) ?? normalizeToolNameFromTitle(item.title);
}

function normalizeToolNameFromTitle(title: string | null | undefined) {
  const trimmed = normalizeTimelineText(title);
  if (!trimmed) return null;
  const match = trimmed.match(/^(?:Tool call|Command|MCP tool|Dynamic tool):\s*(.+)$/i);
  return normalizeTimelineText(match?.[1]);
}
