import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { IconChevronDown, IconPhoto, IconVideo } from "@tabler/icons-react";
import { API_BASE_URL, getAgentChatStoryboardResult, type AgentChatStoryboardGroup, type AgentChatStoryboardResult, type AgentChatStoryboardShot } from "../../api/client";

type StoryboardResultViewerProps = {
  conversationId: string;
};

export function StoryboardResultViewer({ conversationId }: StoryboardResultViewerProps) {
  const [result, setResult] = useState<AgentChatStoryboardResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedByGroupId, setExpandedByGroupId] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let canceled = false;
    setResult(null);
    setError(null);
    setExpandedByGroupId({});
    void getAgentChatStoryboardResult(conversationId)
      .then((payload) => {
        if (canceled) return;
        setResult(payload);
        const firstGroup = payload.groups[0]?.id ?? null;
        setExpandedByGroupId(firstGroup ? { [firstGroup]: true } : {});
      })
      .catch((fetchError) => {
        if (canceled) return;
        setError(fetchError instanceof Error ? fetchError.message : "故事板结果读取失败");
      });
    return () => {
      canceled = true;
    };
  }, [conversationId]);

  const groups = result?.status === "available" ? result.groups : [];
  const totalShotCount = useMemo(() => groups.reduce((sum, group) => sum + group.shotCount, 0), [groups]);
  if (error) return <StoryboardResultShell state="error" message={error} />;
  if (!result) return <StoryboardResultShell state="loading" message="故事板结果读取中" />;
  if (!groups.length) return null;

  return (
    <section className="new-ui-storyboard-result" aria-label="故事板结果">
      <header className="new-ui-storyboard-result-head">
        <div>
          <span>故事板结果</span>
          <strong>{totalShotCount} 镜头</strong>
        </div>
        <small>{result.aspect?.ratio ?? "9:16"}</small>
      </header>
      <div className="new-ui-storyboard-segments">
        {groups.map((group) => {
          const expanded = expandedByGroupId[group.id] ?? false;
          return (
            <article key={group.id} className={`new-ui-storyboard-segment ${expanded ? "is-expanded" : ""}`.trim()}>
              <button
                className="new-ui-storyboard-segment-header"
                type="button"
                aria-expanded={expanded}
                onClick={() => setExpandedByGroupId((current) => ({ ...current, [group.id]: !(current[group.id] ?? false) }))}
              >
                <span className="new-ui-storyboard-segment-label">{group.label}</span>
                <strong>{group.title}</strong>
                <small>{group.shotCount} 镜头</small>
                <IconChevronDown aria-hidden="true" />
              </button>
              {expanded ? <StoryboardShotGrid group={group} /> : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}

function StoryboardShotGrid({ group }: { group: AgentChatStoryboardGroup }) {
  return (
    <div className="new-ui-storyboard-shot-grid">
      {group.shots.map((shot) => (
        <StoryboardShotCard key={shot.id} shot={shot} />
      ))}
    </div>
  );
}

function StoryboardShotCard({ shot }: { shot: AgentChatStoryboardShot }) {
  const mediaStyle = {
    "--new-ui-storyboard-card-aspect": normalizeAspectCss(shot.aspect?.css),
  } as CSSProperties;
  return (
    <article className={`new-ui-storyboard-shot-card is-${shot.kind === "material" ? "material" : "generated"}`.trim()}>
      <div className="new-ui-storyboard-shot-media" style={mediaStyle}>
        <span className="new-ui-storyboard-shot-index">{String(shot.index).padStart(2, "0")}</span>
        <span className="new-ui-storyboard-shot-kind">{shot.kindLabel}</span>
        {shot.imageUrl ? (
          <img src={`${API_BASE_URL}${shot.imageUrl}`} alt={shot.title} loading="lazy" />
        ) : (
          <span className="new-ui-storyboard-shot-placeholder" aria-hidden="true">
            {shot.kind === "material" ? <IconVideo /> : <IconPhoto />}
          </span>
        )}
      </div>
      <div className="new-ui-storyboard-shot-caption">
        <strong>
          {shot.title}
          {shot.duration ? <span>{shot.duration}</span> : null}
        </strong>
        {shot.dialogue ? <p>{shot.dialogue}</p> : null}
      </div>
    </article>
  );
}

function StoryboardResultShell({ state, message }: { state: "loading" | "error"; message: string }) {
  return (
    <section className={`new-ui-storyboard-result is-${state}`.trim()} aria-label="故事板结果">
      <p>{message}</p>
    </section>
  );
}

function normalizeAspectCss(value: string | null | undefined) {
  const css = String(value ?? "").trim();
  return css === "16 / 9" ? "16 / 9" : "9 / 16";
}
