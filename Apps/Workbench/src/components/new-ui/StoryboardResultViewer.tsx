import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { IconChevronDown, IconClock, IconListDetails, IconPhoto, IconVideo, IconX } from "@tabler/icons-react";
import { API_BASE_URL, getAgentChatStoryboardResult, type AgentChatStoryboardCover, type AgentChatStoryboardGroup, type AgentChatStoryboardResult, type AgentChatStoryboardShot, type AgentChatStoryboardVersion } from "../../api/client";

type StoryboardResultViewerProps = {
  conversationId: string;
  resultId?: string | null;
  statusLabel?: string | null;
};

type SelectableStoryboardShot = {
  key: string;
  groupLabel: string;
  groupTitle: string;
  shot: AgentChatStoryboardShot;
};

export function StoryboardResultViewer({ conversationId, resultId = null, statusLabel = null }: StoryboardResultViewerProps) {
  const [result, setResult] = useState<AgentChatStoryboardResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedByGroupId, setExpandedByGroupId] = useState<Record<string, boolean>>({});
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [selectedShotKey, setSelectedShotKey] = useState<string | null>(null);

  useEffect(() => {
    let canceled = false;
    setResult(null);
    setError(null);
    setExpandedByGroupId({});
    setSelectedShotKey(null);
    void getAgentChatStoryboardResult(conversationId, resultId, selectedVersionId)
      .then((payload) => {
        if (canceled) return;
        setResult(payload);
        if (!selectedVersionId && payload.selectedVersionId) setSelectedVersionId(payload.selectedVersionId);
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
  }, [conversationId, resultId, selectedVersionId]);

  const groups = result?.status === "available" ? result.groups : [];
  const totalShotCount = useMemo(() => groups.reduce((sum, group) => sum + group.shotCount, 0), [groups]);
  const selectableShots = useMemo(() => buildSelectableShots(result), [result]);
  const selectedShot = useMemo(
    () => selectableShots.find((item) => item.key === selectedShotKey) ?? null,
    [selectableShots, selectedShotKey],
  );
  if (error) return <StoryboardResultShell state="error" message={error} />;
  if (!result) return <StoryboardResultShell state="loading" message="故事板结果读取中" />;
  if (!groups.length && !result.cover) return null;

  return (
    <section className="new-ui-storyboard-result" aria-label="故事板结果">
      <header className="new-ui-storyboard-result-head">
        <div>
          <span>故事板结果</span>
          <strong>{totalShotCount} 镜头</strong>
        </div>
        <small>{statusLabel || result.aspect?.ratio || "9:16"}</small>
      </header>
      {Array.isArray(result.versions) && result.versions.length > 1 ? (
        <StoryboardVersionSelector
          versions={result.versions}
          selectedVersionId={result.selectedVersionId ?? selectedVersionId}
          onSelect={setSelectedVersionId}
        />
      ) : null}
      {selectedShot ? (
        <StoryboardShotDetail
          item={selectedShot}
          onClose={() => setSelectedShotKey(null)}
        />
      ) : null}
      <div className="new-ui-storyboard-segments">
        {result.cover ? (
          <StoryboardCoverSegment
            cover={result.cover}
            expanded={expandedByGroupId.cover ?? false}
            onToggle={() => setExpandedByGroupId((current) => ({ ...current, cover: !(current.cover ?? false) }))}
            selectedShotKey={selectedShotKey}
            onSelectShot={setSelectedShotKey}
          />
        ) : null}
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
              {expanded ? (
                <StoryboardShotGrid
                  group={group}
                  selectedShotKey={selectedShotKey}
                  onSelectShot={setSelectedShotKey}
                />
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}

function StoryboardVersionSelector({ versions, selectedVersionId, onSelect }: { versions: AgentChatStoryboardVersion[]; selectedVersionId?: string | null; onSelect: (versionId: string) => void }) {
  return (
    <div className="new-ui-storyboard-version-bar" aria-label="故事板方案版本">
      {versions.map((version) => {
        const versionId = String(version.versionId ?? "");
        if (!versionId) return null;
        const active = versionId === selectedVersionId;
        return (
          <button
            key={versionId}
            className={active ? "is-active" : undefined}
            type="button"
            aria-pressed={active}
            onClick={() => onSelect(versionId)}
          >
            {version.versionName || versionId}
          </button>
        );
      })}
    </div>
  );
}

function StoryboardCoverSegment({ cover, expanded, onToggle, selectedShotKey, onSelectShot }: { cover: AgentChatStoryboardCover; expanded: boolean; onToggle: () => void; selectedShotKey: string | null; onSelectShot: (shotKey: string) => void }) {
  const shot = createCoverShot(cover);
  const shotKey = createStoryboardShotKey("cover", shot);
  return (
    <article className={`new-ui-storyboard-segment is-cover ${expanded ? "is-expanded" : ""}`.trim()}>
      <button
        className="new-ui-storyboard-segment-header"
        type="button"
        aria-expanded={expanded}
        onClick={onToggle}
      >
        <span className="new-ui-storyboard-segment-label">封面</span>
        <strong>{cover.title}</strong>
        <small>{cover.kindLabel}</small>
        <IconChevronDown aria-hidden="true" />
      </button>
      {expanded ? <div className="new-ui-storyboard-shot-grid">
        <StoryboardShotCard
          shot={shot}
          selected={selectedShotKey === shotKey}
          onSelect={() => onSelectShot(shotKey)}
        />
      </div> : null}
    </article>
  );
}

function StoryboardShotGrid({ group, selectedShotKey, onSelectShot }: { group: AgentChatStoryboardGroup; selectedShotKey: string | null; onSelectShot: (shotKey: string) => void }) {
  return (
    <div className="new-ui-storyboard-shot-grid">
      {group.shots.map((shot) => {
        const shotKey = createStoryboardShotKey(group.id, shot);
        return (
          <StoryboardShotCard
            key={shotKey}
            shot={shot}
            selected={selectedShotKey === shotKey}
            onSelect={() => onSelectShot(shotKey)}
          />
        );
      })}
    </div>
  );
}

function StoryboardShotCard({ shot, selected, onSelect }: { shot: AgentChatStoryboardShot; selected: boolean; onSelect: () => void }) {
  const mediaStyle = {
    "--new-ui-storyboard-card-aspect": normalizeAspectCss(shot.aspect?.css),
  } as CSSProperties;
  return (
    <button
      className={`new-ui-storyboard-shot-card is-${shot.kind === "material" ? "material" : "generated"} ${selected ? "is-selected" : ""}`.trim()}
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
    >
      <div className="new-ui-storyboard-shot-media" style={mediaStyle}>
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
          {shot.duration ? (
            <span data-tooltip={shot.durationTooltip ?? "预计时间轴，非精确剪辑点"}>
              {shot.duration}
            </span>
          ) : null}
        </strong>
        {shot.dialogue ? <p>{shot.dialogue}</p> : null}
      </div>
    </button>
  );
}

function StoryboardShotDetail({ item, onClose }: { item: SelectableStoryboardShot; onClose: () => void }) {
  const { shot } = item;
  const mediaStyle = {
    "--new-ui-storyboard-card-aspect": normalizeAspectCss(shot.aspect?.css),
  } as CSSProperties;
  const sourceRefs = Array.isArray(shot.sourceRefs) ? shot.sourceRefs.filter(Boolean) : [];
  const strategyText = firstDetailText(shot.strategyRaw, shot.strategy);
  const detailRows = [
    ["槽位段落", `${item.groupLabel} ${item.groupTitle}`.trim()],
    ["类型", shot.kindLabel || shot.kind],
    ["时长", shot.duration || shot.durationRaw || null],
    ["画幅", shot.aspect?.ratio || shot.aspect?.orientation || null],
  ].filter((row): row is [string, string] => Boolean(row[1]));
  const detailSections = [
    {
      key: "task",
      title: "镜头任务",
      body: firstDetailText(shot.scriptSegment, item.groupTitle),
      meta: firstDetailText(shot.slotSubtype, shot.slotKey),
    },
    {
      key: "visual",
      title: "画面与素材",
      body: shot.visualPrompt,
      meta: strategyText,
      chips: sourceRefs,
    },
    {
      key: "packaging",
      title: "包装设计",
      body: shot.overlayPackaging,
      meta: shot.dialogue,
    },
    {
      key: "rhythm",
      title: "节奏同步",
      body: firstDetailText(shot.rhythmRange, shot.durationRaw, shot.duration),
      meta: shot.syncPoint,
    },
    {
      key: "proof",
      title: "证明功能",
      body: shot.proofFunction,
      meta: shot.packagingBlock,
    },
  ].filter((section) => Boolean(section.body || section.meta || section.chips?.length));

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  return (
    <div
      className="new-ui-storyboard-shot-detail-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="镜头详情"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside className="new-ui-storyboard-shot-detail" aria-label="镜头详情">
        <header className="new-ui-storyboard-shot-detail-head">
          <span className="new-ui-storyboard-shot-detail-icon" aria-hidden="true">
            <IconListDetails />
          </span>
          <div>
            <span>镜头详情</span>
            <strong>{shot.title}</strong>
          </div>
          <button type="button" aria-label="关闭镜头详情" onClick={onClose}>
            <IconX aria-hidden="true" />
          </button>
        </header>
        <div className="new-ui-storyboard-shot-detail-layout">
          <div className="new-ui-storyboard-shot-detail-preview">
            <div className="new-ui-storyboard-shot-media" style={mediaStyle}>
              <span className="new-ui-storyboard-shot-kind">{shot.kindLabel}</span>
              {shot.imageUrl ? (
                <img src={`${API_BASE_URL}${shot.imageUrl}`} alt={shot.title} loading="lazy" />
              ) : (
                <span className="new-ui-storyboard-shot-placeholder" aria-hidden="true">
                  {shot.kind === "material" ? <IconVideo /> : <IconPhoto />}
                </span>
              )}
            </div>
            <div className="new-ui-storyboard-shot-detail-preview-caption">
              <span>{shot.kindLabel || "镜头"}</span>
              <strong>{shot.dialogue || shot.visualPrompt || shot.title}</strong>
            </div>
          </div>
          <div className="new-ui-storyboard-shot-detail-content">
            <div className="new-ui-storyboard-shot-detail-meta">
              {detailRows.map(([label, value]) => (
                <span key={label}>
                  <small>{label}</small>
                  <strong>{value}</strong>
                </span>
              ))}
            </div>
            <div className="new-ui-storyboard-shot-detail-sections">
              {detailSections.length ? detailSections.map((section) => (
                <section key={section.key} className={`new-ui-storyboard-shot-detail-section is-${section.key}`.trim()}>
                  <span>{section.title}</span>
                  {section.body ? <p>{section.body}</p> : null}
                  {section.meta ? <small>{section.meta}</small> : null}
                  {section.chips?.length ? (
                    <div className="new-ui-storyboard-shot-detail-chips">
                      {section.chips.map((sourceRef) => <code key={sourceRef}>{sourceRef}</code>)}
                    </div>
                  ) : null}
                </section>
              )) : (
                <section className="new-ui-storyboard-shot-detail-section is-empty">
                  <span>镜头信息</span>
                  <p>{shot.dialogue || strategyText || "该镜头暂无更多详情。"}</p>
                </section>
              )}
            </div>
            {shot.durationTooltip ? (
              <div className="new-ui-storyboard-shot-detail-note">
                <IconClock aria-hidden="true" />
                <span>{shot.durationTooltip}</span>
              </div>
            ) : null}
          </div>
        </div>
      </aside>
    </div>
  );
}

function StoryboardResultShell({ state, message }: { state: "loading" | "error"; message: string }) {
  return (
    <section className={`new-ui-storyboard-result is-${state}`.trim()} aria-label="故事板结果">
      <p>{message}</p>
    </section>
  );
}

function buildSelectableShots(result: AgentChatStoryboardResult | null): SelectableStoryboardShot[] {
  if (!result || result.status !== "available") return [];
  const cover = result.cover ? [{
    key: createStoryboardShotKey("cover", createCoverShot(result.cover)),
    groupLabel: "封面",
    groupTitle: result.cover.title,
    shot: createCoverShot(result.cover),
  }] : [];
  const shots = result.groups.flatMap((group) => group.shots.map((shot) => ({
    key: createStoryboardShotKey(group.id, shot),
    groupLabel: group.label,
    groupTitle: group.title,
    shot,
  })));
  return [...cover, ...shots];
}

function createCoverShot(cover: AgentChatStoryboardCover): AgentChatStoryboardShot {
  return {
    id: cover.id,
    index: 0,
    title: cover.title,
    duration: null,
    durationRaw: null,
    durationTooltip: null,
    dialogue: cover.dialogue ?? null,
    strategy: null,
    sourceRefs: [],
    kind: cover.kind,
    kindLabel: cover.kindLabel,
    imageUrl: cover.imageUrl ?? null,
    aspect: cover.aspect ?? null,
  };
}

function createStoryboardShotKey(groupId: string, shot: AgentChatStoryboardShot) {
  return `${groupId}:${shot.id || shot.index}`;
}

function normalizeAspectCss(value: string | null | undefined) {
  const css = String(value ?? "").trim();
  return css === "16 / 9" ? "16 / 9" : "9 / 16";
}

function firstDetailText(...values: Array<string | null | undefined>) {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return null;
}
