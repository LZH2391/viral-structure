import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getFunctionSlotReplacementCandidates } from "../../api/client";
import type { AgentChatAtomSummary, AgentChatSlotAtomDisplay, AgentChatSlotSummary, AtomReplacement, ReplacementCandidate, ReplacementDraft, SlotReplacement } from "../../types";

type AtomKind = "script" | "rhythm" | "packaging";
type DrawerState = { kind: "slot"; atomKind?: null } | { kind: "atom"; atomKind: AtomKind };
const REPLACEMENT_DRAWER_ANIMATION_MS = 340;

export function SlotAtomView({
  display,
  active = true,
  busy = false,
  sourceRestructureFinalPath = null,
  sourceTurnId = null,
  onSubmitReplacement,
}: {
  display: AgentChatSlotAtomDisplay | null;
  active?: boolean;
  busy?: boolean;
  sourceRestructureFinalPath?: string | null;
  sourceTurnId?: string | null;
  onSubmitReplacement?: (draft: ReplacementDraft, summary: string) => Promise<void>;
}) {
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<DrawerState | null>(null);
  const [drawerClosing, setDrawerClosing] = useState(false);
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<ReplacementCandidate[]>([]);
  const [candidateStatus, setCandidateStatus] = useState("等待选择");
  const [draft, setDraft] = useState<Array<SlotReplacement | AtomReplacement>>([]);
  const drawerCloseTimerRef = useRef<number | null>(null);
  const slots = display?.slots ?? [];
  const atoms = display?.atoms ?? [];
  const selectedSlot = useMemo(() => {
    if (!slots.length) return null;
    return slots.find((slot) => slot.slotSubtypeId === selectedSlotId) ?? slots.find((slot) => slot.slotSubtypeId === display?.selectedSlotSubtypeId) ?? slots[0];
  }, [display?.selectedSlotSubtypeId, selectedSlotId, slots]);
  const selectedAtoms = useMemo(() => {
    if (!selectedSlot?.slotSubtypeId) return atoms[0] ?? null;
    return atoms.find((atom) => atom.slotSubtypeId === selectedSlot.slotSubtypeId) ?? null;
  }, [atoms, selectedSlot?.slotSubtypeId]);
  const slotInvalidated = Boolean(draft.find((item) => item.type === "slot" && item.fromSlotSubtypeId === selectedSlot?.slotSubtypeId));
  const visibleCandidates = useMemo(
    () => candidates.filter((candidate) => !isCurrentReplacementCandidate(candidate, drawer, selectedSlot, selectedAtoms)),
    [candidates, drawer, selectedAtoms, selectedSlot],
  );

  useEffect(() => {
    setSelectedSlotId(display?.selectedSlotSubtypeId ?? display?.slots?.[0]?.slotSubtypeId ?? null);
    setDraft([]);
    setDrawer(null);
    setDrawerClosing(false);
  }, [display]);

  useEffect(() => {
    if (active) return;
    if (drawerCloseTimerRef.current) {
      window.clearTimeout(drawerCloseTimerRef.current);
      drawerCloseTimerRef.current = null;
    }
    setDrawer(null);
    setDrawerClosing(false);
  }, [active]);

  useEffect(() => () => {
    if (drawerCloseTimerRef.current) window.clearTimeout(drawerCloseTimerRef.current);
  }, []);

  useEffect(() => {
    if (!drawer) return;
    let cancelled = false;
    setCandidateStatus("读取库候选...");
    getFunctionSlotReplacementCandidates({
      kind: drawer.kind,
      atomKind: drawer.kind === "atom" ? drawer.atomKind : null,
      slotSubtypeId: drawer.kind === "atom" ? selectedSlot?.slotSubtypeId ?? null : null,
      q: query,
      limit: 40,
    })
      .then((payload) => {
        if (cancelled) return;
        setCandidates(payload.candidates ?? []);
      })
      .catch((error) => {
        if (cancelled) return;
        setCandidates([]);
        setCandidateStatus(error instanceof Error ? error.message : "候选读取失败");
      });
    return () => {
      cancelled = true;
    };
  }, [drawer, query, selectedSlot?.slotSubtypeId]);

  const openSlotDrawer = useCallback((slot?: AgentChatSlotSummary | null) => {
    if (!active) return;
    if (drawerCloseTimerRef.current) window.clearTimeout(drawerCloseTimerRef.current);
    drawerCloseTimerRef.current = null;
    setSelectedSlotId(slot?.slotSubtypeId ?? null);
    setQuery("");
    setCandidates([]);
    setCandidateStatus("等待读取槽位库");
    setDrawerClosing(false);
    setDrawer({ kind: "slot" });
  }, [active]);

  const openAtomDrawer = useCallback((atomKind: AtomKind) => {
    if (!active) return;
    if (drawerCloseTimerRef.current) window.clearTimeout(drawerCloseTimerRef.current);
    drawerCloseTimerRef.current = null;
    setQuery("");
    setCandidates([]);
    setCandidateStatus(`等待读取${atomKindLabel(atomKind)}原子库`);
    setDrawerClosing(false);
    setDrawer({ kind: "atom", atomKind });
  }, [active]);

  const closeDrawer = useCallback(() => {
    if (!drawer) return;
    if (drawerCloseTimerRef.current) window.clearTimeout(drawerCloseTimerRef.current);
    setDrawerClosing(true);
    const prefersReducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    drawerCloseTimerRef.current = window.setTimeout(() => {
      drawerCloseTimerRef.current = null;
      setDrawer(null);
      setDrawerClosing(false);
    }, prefersReducedMotion ? 0 : REPLACEMENT_DRAWER_ANIMATION_MS);
  }, [drawer]);

  const stageSlotReplacement = useCallback((candidate: ReplacementCandidate) => {
    if (!selectedSlot?.slotSubtypeId) return;
    const next: SlotReplacement = {
      type: "slot",
      slotOrder: selectedSlot.index ?? null,
      fromSlotSubtypeId: selectedSlot.slotSubtypeId,
      fromSlotLabel: stripBacktickLabel(selectedSlot.slotSubtype) || selectedSlot.slotSubtypeId,
      toSlotSubtypeId: candidate.slotSubtypeId ?? candidate.candidateId,
      toSlotLabel: candidate.label ?? candidate.slotSubtypeId ?? candidate.candidateId,
      candidateId: candidate.candidateId,
      sourceSampleId: candidate.sourceSampleId,
      sourceArtifactId: candidate.sourceArtifactId,
      affectedAtomIds: atomIdsFor(selectedAtoms),
    };
    setDraft((current) => [...current.filter((item) => !(item.type === "slot" && item.fromSlotSubtypeId === selectedSlot.slotSubtypeId)), next]);
  }, [selectedAtoms, selectedSlot]);

  const stageAtomReplacement = useCallback((candidate: ReplacementCandidate, atomKind: AtomKind) => {
    if (!selectedSlot?.slotSubtypeId) return;
    const currentAtom = atomValueFor(selectedAtoms, atomKind);
    const next: AtomReplacement = {
      type: "atom",
      atomKind,
      slotSubtypeId: selectedSlot.slotSubtypeId,
      slotLabel: stripBacktickLabel(selectedSlot.slotSubtype) || selectedSlot.slotSubtypeId,
      fromAtomId: extractBacktickId(currentAtom) || currentAtom || `${atomKind}:unknown`,
      fromAtomLabel: currentAtom,
      toAtomId: candidate.atomId ?? candidate.candidateId,
      toAtomLabel: candidate.label ?? candidate.atomId ?? candidate.candidateId,
      candidateId: candidate.candidateId,
      sourceSampleId: candidate.sourceSampleId,
      sourceArtifactId: candidate.sourceArtifactId,
    };
    setDraft((current) => [...current.filter((item) => !(item.type === "atom" && item.slotSubtypeId === selectedSlot.slotSubtypeId && item.atomKind === atomKind)), next]);
  }, [selectedAtoms, selectedSlot]);

  const submitDraft = useCallback(async () => {
    if (!display || !draft.length || !onSubmitReplacement || !display.displayJsonPath || !sourceRestructureFinalPath) return;
    const payload: ReplacementDraft = {
      sourceDisplayJsonPath: display.displayJsonPath,
      sourceRestructureFinalPath: display.sourceRestructureFinalPath ?? sourceRestructureFinalPath,
      rootRestructureFinalPath: display.rootRestructureFinalPath ?? null,
      sourceTurnId,
      versionId: display.versionId ?? null,
      versionName: display.versionName ?? null,
      displayFingerprint: display.fileFingerprint ?? null,
      replacements: draft,
    };
    await onSubmitReplacement(payload, buildReplacementDraftSummary(draft));
    setDraft([]);
    setDrawer(null);
  }, [display, draft, onSubmitReplacement, sourceRestructureFinalPath, sourceTurnId]);

  if (!display || display.status === "empty" || (!slots.length && !atoms.length)) {
    return (
      <div className="agent-chat-slot-atom-empty">
        <SlotAtomEmptyIcon />
        <strong>暂无槽位结果</strong>
        <span>发送消息后，Agent 生成的结构方案会在这里显示，你可以对槽位和原子进行调整。</span>
      </div>
    );
  }

  return (
    <div className="agent-chat-slot-atom-panel">
      <div className="agent-chat-slot-atom-summary">
        <b>{display.slotCount ?? slots.length} 槽位</b>
      </div>
      <div className="agent-chat-slot-list" aria-label="槽位链">
        {slots.map((slot, index) => (
          <button
            key={`${slot.slotSubtypeId ?? "slot"}-${index}`}
            className={slot.slotSubtypeId === selectedSlot?.slotSubtypeId ? "active" : ""}
            type="button"
            title={slot.slotSubtypeId ?? slot.slotSubtype ?? undefined}
            onClick={() => setSelectedSlotId(slot.slotSubtypeId ?? null)}
          >
            <small>{String(slot.index ?? index + 1).padStart(2, "0")}</small>
            <b>{slot.functionText || stripBacktickLabel(slot.slotSubtype) || slot.slotSubtypeId || "未命名槽位"}</b>
            <i
              role="button"
              tabIndex={0}
              onClick={(event) => {
                event.stopPropagation();
                openSlotDrawer(slot);
              }}
              onKeyDown={(event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                event.stopPropagation();
                openSlotDrawer(slot);
              }}
            >
              换槽位
            </i>
          </button>
        ))}
      </div>
      <div className="agent-chat-slot-detail">
        <div className="agent-chat-slot-detail-head">
          <b>{selectedSlot?.functionText || stripBacktickLabel(selectedSlot?.slotSubtype) || selectedSlot?.slotSubtypeId || "槽位"}</b>
        </div>
        {slotInvalidated ? <div className="agent-chat-replacement-warning">槽位已预选替换，原绑定原子将交给 Agent 重新评估。</div> : null}
        <AtomCard label="脚本" value={selectedAtoms?.scriptAtom} tone="script" onReplace={() => openAtomDrawer("script")} />
        <AtomCard label="节奏" value={selectedAtoms?.rhythmAtom} tone="rhythm" onReplace={() => openAtomDrawer("rhythm")} />
        <AtomCard label="包装" value={selectedAtoms?.packagingAtom} tone="packaging" onReplace={() => openAtomDrawer("packaging")} />
        {selectedAtoms?.handling ? <div className="agent-chat-atom-handling">{selectedAtoms.handling}</div> : null}
      </div>
      {drawer ? (
        <div className={`agent-chat-replacement-stack ${drawerClosing ? "is-closing" : ""}`.trim()}>
          <section className="agent-chat-replacement-drawer" aria-label="槽位/原子替换候选">
            <div className="agent-chat-replacement-drawer-head">
              <b>{replacementDrawerTitle(drawer)}</b>
              <button type="button" onClick={closeDrawer}>关闭</button>
            </div>
            <div className="agent-chat-replacement-mode">
              <span>{drawer.kind === "slot" ? "当前仅展示槽位候选" : `当前仅展示${atomKindLabel(drawer.atomKind)}原子候选`}</span>
              <small>绑定证据随候选展示</small>
            </div>
            <div className="agent-chat-replacement-current">
              <span>当前替换对象</span>
              <b>{currentReplacementLabel(drawer, selectedSlot, selectedAtoms)}</b>
            </div>
            <input value={query} onChange={(event) => setQuery(event.currentTarget.value)} placeholder="搜索槽位 / 原子 / 样例来源" />
            <small>{candidateStatusText(candidateStatus, candidates.length, visibleCandidates.length)}</small>
            <div className="agent-chat-replacement-candidates">
              {visibleCandidates.map((candidate) => (
                <article key={candidate.candidateId} className={candidate.needReview ? "needs-review" : ""}>
                  <div>
                    <b>{candidate.label ?? candidate.candidateId}</b>
                    <span>{candidate.slotSubtypeId ?? candidate.atomId ?? candidate.candidateId}</span>
                  </div>
                  {candidate.functionText ? <p>{candidate.functionText}</p> : null}
                  <small>{candidate.sourceSampleId ?? "source sample unknown"} · {candidate.sourceArtifactId ?? "artifact unknown"}</small>
                  {candidate.evidenceTags?.length ? <em>{candidate.evidenceTags.join(" / ")}</em> : null}
                  <CandidateEvidence candidate={candidate} />
                  <button type="button" onClick={() => drawer.kind === "slot" ? stageSlotReplacement(candidate) : stageAtomReplacement(candidate, drawer.atomKind)}>预选</button>
                </article>
              ))}
            </div>
          </section>
          {draft.length ? (
            <div className="agent-chat-replacement-draft">
              <b>待提交替换 {draft.length} 项</b>
              <span>{buildReplacementDraftSummary(draft).replace(/\n/g, " / ")}</span>
              <button type="button" disabled={busy || !sourceRestructureFinalPath} onClick={() => void submitDraft()}>交给 Agent 评估并重组</button>
              <button type="button" disabled={busy} onClick={() => setDraft([])}>清空</button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function SlotAtomEmptyIcon() {
  return (
    <svg className="agent-chat-slot-atom-empty-icon" viewBox="0 0 28 28" focusable="false" aria-hidden="true">
      <rect x="5" y="5" width="7" height="7" rx="1.6" />
      <rect x="16" y="5" width="7" height="7" rx="1.6" />
      <rect x="5" y="16" width="7" height="7" rx="1.6" />
      <path d="M16 18.5h7" />
    </svg>
  );
}

function AtomCard({ label, value, tone, onReplace }: { label: string; value?: string | null; tone: AtomKind; onReplace: () => void }) {
  if (!value) return null;
  return (
    <article className={`agent-chat-atom-card ${tone}`}>
      <span>{label}</span>
      <b>{stripBacktickLabel(value) || value}</b>
      <button type="button" onClick={onReplace}>换原子</button>
    </article>
  );
}

function CandidateEvidence({ candidate }: { candidate: ReplacementCandidate }) {
  const bindings = candidate.bindingEvidence?.bindings ?? [];
  const rules = candidate.bindingEvidence?.rules ?? [];
  const firstBinding = bindings[0];
  const firstRule = rules[0];
  if (!firstBinding && !firstRule) return null;
  return (
    <div className="agent-chat-replacement-evidence">
      {firstBinding ? <span>Binding: {String(firstBinding.rule ?? firstBinding.type ?? firstBinding.id ?? "")}</span> : null}
      {firstBinding?.riskIfBroken ? <span>Risk: {String(firstBinding.riskIfBroken)}</span> : null}
      {firstRule ? <span>Rule: {String(firstRule.reason ?? firstRule.ruleKind ?? firstRule.id ?? "")}</span> : null}
    </div>
  );
}

function replacementDrawerTitle(drawer: DrawerState) {
  if (drawer.kind === "slot") return "槽位库";
  return `${atomKindLabel(drawer.atomKind)}原子库`;
}

function currentReplacementLabel(drawer: DrawerState, slot: AgentChatSlotSummary | null, atoms: AgentChatAtomSummary | null) {
  if (drawer.kind === "slot") return slot?.functionText || stripBacktickLabel(slot?.slotSubtype) || slot?.slotSubtypeId || "未知槽位";
  return stripBacktickLabel(atomValueFor(atoms, drawer.atomKind)) || atomValueFor(atoms, drawer.atomKind) || `未知${atomKindLabel(drawer.atomKind)}原子`;
}

function candidateStatusText(status: string, totalCount: number, visibleCount: number) {
  if (!status.includes("候选") && !status.includes("candidate")) return status;
  const hiddenCount = Math.max(0, totalCount - visibleCount);
  return hiddenCount ? `${visibleCount} 个候选，可见候选已排除当前对象 ${hiddenCount} 项` : `${visibleCount} 个候选`;
}

function atomKindLabel(kind: AtomKind) {
  if (kind === "script") return "脚本";
  if (kind === "rhythm") return "节奏";
  return "包装";
}

function isCurrentReplacementCandidate(
  candidate: ReplacementCandidate,
  drawer: DrawerState | null,
  slot: AgentChatSlotSummary | null,
  atoms: AgentChatAtomSummary | null,
) {
  if (!drawer) return false;
  if (drawer.kind === "slot") return idSetsOverlap(candidateSlotKeys(candidate), currentSlotKeys(slot));
  return idSetsOverlap(candidateAtomKeys(candidate), currentAtomKeys(atomValueFor(atoms, drawer.atomKind)));
}

function candidateSlotKeys(candidate: ReplacementCandidate) {
  return normalizeKeySet([candidate.slotSubtypeId, candidate.sourceSlotId, candidate.label, candidate.candidateId]);
}

function currentSlotKeys(slot: AgentChatSlotSummary | null) {
  return normalizeKeySet([slot?.slotSubtypeId, slot?.slotSubtype, stripBacktickLabel(slot?.slotSubtype), extractBacktickId(slot?.slotSubtype)]);
}

function candidateAtomKeys(candidate: ReplacementCandidate) {
  return normalizeKeySet([candidate.atomId, candidate.label, candidate.candidateId]);
}

function currentAtomKeys(value?: string | null) {
  return normalizeKeySet([value, stripBacktickLabel(value), extractBacktickId(value)]);
}

function idSetsOverlap(left: Set<string>, right: Set<string>) {
  for (const value of left) {
    if (right.has(value)) return true;
  }
  return false;
}

export function buildReplacementDraftSummary(replacements: Array<SlotReplacement | AtomReplacement>) {
  const lines = ["用户手动替换 Slot/Atom："];
  for (const item of replacements) {
    if (item.type === "slot") {
      lines.push(`- Slot ${item.slotOrder ?? ""} ${item.fromSlotLabel ?? item.fromSlotSubtypeId} -> ${item.toSlotLabel ?? item.toSlotSubtypeId}`);
    } else {
      lines.push(`- ${item.atomKind} Atom (${item.slotLabel ?? item.slotSubtypeId}) ${item.fromAtomLabel ?? item.fromAtomId} -> ${item.toAtomLabel ?? item.toAtomId}`);
    }
  }
  return lines.join("\n");
}

function atomIdsFor(atom: AgentChatAtomSummary | null) {
  return ["scriptAtom", "rhythmAtom", "packagingAtom"]
    .map((key) => extractBacktickId(atom?.[key as keyof AgentChatAtomSummary] as string | null))
    .filter((id): id is string => Boolean(id));
}

function atomValueFor(atom: AgentChatAtomSummary | null, kind: AtomKind) {
  if (kind === "script") return atom?.scriptAtom ?? "";
  if (kind === "rhythm") return atom?.rhythmAtom ?? "";
  return atom?.packagingAtom ?? "";
}

function stripBacktickLabel(value?: string | null) {
  return String(value ?? "").replace(/`[^`]+`\s*[：:]?\s*/g, "").trim();
}

function extractBacktickId(value?: string | null) {
  const text = String(value ?? "");
  return text.match(/`([^`]+)`/)?.[1] ?? null;
}

function normalizeKeySet(values: Array<string | null | undefined>) {
  return new Set(values.flatMap((value) => normalizeCandidateKeys(value)));
}

function normalizeCandidateKeys(value?: string | null) {
  const text = String(value ?? "").trim();
  if (!text) return [];
  const withoutBackticks = text.replace(/`/g, "").trim();
  const parts = [
    text,
    withoutBackticks,
    stripBacktickLabel(text),
    extractBacktickId(text),
    lastSegment(text, "::"),
    lastSegment(withoutBackticks, "::"),
  ];
  return [...new Set(parts.map((part) => String(part ?? "").trim().toLowerCase()).filter(Boolean))];
}

function lastSegment(value: string, separator: string) {
  const parts = value.split(separator);
  return parts[parts.length - 1] ?? value;
}
