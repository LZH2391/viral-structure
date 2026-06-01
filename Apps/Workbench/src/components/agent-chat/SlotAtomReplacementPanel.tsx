import { useCallback, useEffect, useMemo, useState } from "react";
import { getFunctionSlotReplacementCandidates } from "../../api/client";
import type { AgentChatAtomSummary, AgentChatSlotAtomDisplay, AgentChatSlotSummary, AtomReplacement, ReplacementCandidate, ReplacementDraft, SlotReplacement } from "../../types";

type AtomKind = "script" | "rhythm" | "packaging";
type DrawerState = { kind: "slot"; atomKind?: null } | { kind: "atom"; atomKind: AtomKind };

export function SlotAtomView({
  display,
  busy = false,
  sourceRestructureFinalPath = null,
  onSubmitReplacement,
}: {
  display: AgentChatSlotAtomDisplay | null;
  busy?: boolean;
  sourceRestructureFinalPath?: string | null;
  onSubmitReplacement?: (draft: ReplacementDraft, summary: string) => Promise<void>;
}) {
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<DrawerState | null>(null);
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<ReplacementCandidate[]>([]);
  const [candidateStatus, setCandidateStatus] = useState("等待选择");
  const [draft, setDraft] = useState<Array<SlotReplacement | AtomReplacement>>([]);
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

  useEffect(() => {
    setSelectedSlotId(display?.selectedSlotSubtypeId ?? display?.slots?.[0]?.slotSubtypeId ?? null);
    setDraft([]);
    setDrawer(null);
  }, [display]);

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
        setCandidateStatus(`${payload.candidates?.length ?? 0} candidates`);
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
      sourceRestructureFinalPath,
      displayFingerprint: display.fileFingerprint ?? null,
      replacements: draft,
    };
    await onSubmitReplacement(payload, buildReplacementDraftSummary(draft));
    setDraft([]);
    setDrawer(null);
  }, [display, draft, onSubmitReplacement, sourceRestructureFinalPath]);

  if (!display || display.status === "empty" || (!slots.length && !atoms.length)) {
    return <div className="empty-state"><strong>无</strong><span>当前 turn 还没有可展示的 Slot/Atom 转换结果</span></div>;
  }

  return (
    <div className="agent-chat-slot-atom-panel">
      <div className="agent-chat-slot-atom-summary">
        <b>{display.slotCount ?? slots.length} slots</b>
        <span>{display.atomBindingCount ?? atoms.length} atom bindings</span>
      </div>
      {display.displayJsonPath ? <div className="agent-chat-slot-atom-path" title={display.displayJsonPath}>{display.displayJsonPath}</div> : null}
      <div className="agent-chat-slot-list" aria-label="Slot 链">
        {slots.map((slot, index) => (
          <button
            key={`${slot.slotSubtypeId ?? "slot"}-${index}`}
            className={slot.slotSubtypeId === selectedSlot?.slotSubtypeId ? "active" : ""}
            type="button"
            onClick={() => setSelectedSlotId(slot.slotSubtypeId ?? null)}
          >
            <small>{String(slot.index ?? index + 1).padStart(2, "0")}</small>
            <b>{stripBacktickLabel(slot.slotSubtype) || slot.slotSubtypeId || "未命名 slot"}</b>
            {slot.functionText ? <span>{slot.functionText}</span> : null}
            <i
              role="button"
              tabIndex={0}
              onClick={(event) => {
                event.stopPropagation();
                setDrawer({ kind: "slot" });
              }}
              onKeyDown={(event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                event.stopPropagation();
                setDrawer({ kind: "slot" });
              }}
            >
              替换
            </i>
          </button>
        ))}
      </div>
      <div className="agent-chat-slot-detail">
        <div className="agent-chat-slot-detail-head">
          <b>{stripBacktickLabel(selectedSlot?.slotSubtype) || selectedSlot?.slotSubtypeId || "Slot"}</b>
          {selectedSlot?.archetypeId ? <span>{selectedSlot.archetypeId}</span> : null}
        </div>
        {selectedSlot?.usage ? <p>{selectedSlot.usage}</p> : null}
        {slotInvalidated ? <div className="agent-chat-replacement-warning">Slot 已预选替换，原绑定 Atom 将交给 Agent 重新评估。</div> : null}
        <AtomCard label="Script" value={selectedAtoms?.scriptAtom} tone="script" onReplace={() => setDrawer({ kind: "atom", atomKind: "script" })} />
        <AtomCard label="Rhythm" value={selectedAtoms?.rhythmAtom} tone="rhythm" onReplace={() => setDrawer({ kind: "atom", atomKind: "rhythm" })} />
        <AtomCard label="Packaging" value={selectedAtoms?.packagingAtom} tone="packaging" onReplace={() => setDrawer({ kind: "atom", atomKind: "packaging" })} />
        {selectedAtoms?.handling ? <div className="agent-chat-atom-handling">{selectedAtoms.handling}</div> : null}
      </div>
      {drawer ? (
        <section className="agent-chat-replacement-drawer" aria-label="FunctionSlotLibrary 替换候选">
          <div className="agent-chat-replacement-drawer-head">
            <b>{drawer.kind === "slot" ? "Slot 库" : `${drawer.atomKind} Atom 库`}</b>
            <button type="button" onClick={() => setDrawer(null)}>关闭</button>
          </div>
          <div className="agent-chat-replacement-tabs">
            <button className={drawer.kind === "slot" ? "active" : ""} type="button" onClick={() => setDrawer({ kind: "slot" })}>Slot 库</button>
            <button className={drawer.kind === "atom" ? "active" : ""} type="button" onClick={() => setDrawer({ kind: "atom", atomKind: drawer.kind === "atom" ? drawer.atomKind : "script" })}>Atom 库</button>
            <span>绑定证据随候选展示</span>
          </div>
          <input value={query} onChange={(event) => setQuery(event.currentTarget.value)} placeholder="搜索 slot / atom / 样例来源" />
          <small>{candidateStatus}</small>
          <div className="agent-chat-replacement-candidates">
            {candidates.map((candidate) => (
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
      ) : null}
      {draft.length ? (
        <div className="agent-chat-replacement-draft">
          <b>待提交替换 {draft.length} 项</b>
          <span>{buildReplacementDraftSummary(draft).replace(/\n/g, " / ")}</span>
          <button type="button" disabled={busy || !sourceRestructureFinalPath} onClick={() => void submitDraft()}>交给 Agent 评估并重组</button>
          <button type="button" disabled={busy} onClick={() => setDraft([])}>清空</button>
        </div>
      ) : null}
    </div>
  );
}

function AtomCard({ label, value, tone, onReplace }: { label: string; value?: string | null; tone: AtomKind; onReplace: () => void }) {
  if (!value) return null;
  return (
    <article className={`agent-chat-atom-card ${tone}`}>
      <span>{label}</span>
      <b>{value}</b>
      <button type="button" onClick={onReplace}>换Atom</button>
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

export function buildReplacementDraftSummary(replacements: Array<SlotReplacement | AtomReplacement>) {
  return replacements.map((item) => {
    if (item.type === "slot") return `Slot ${item.slotOrder ?? ""} ${item.fromSlotLabel ?? item.fromSlotSubtypeId} -> ${item.toSlotLabel ?? item.toSlotSubtypeId}`;
    return `${item.atomKind} Atom ${item.fromAtomLabel ?? item.fromAtomId} -> ${item.toAtomLabel ?? item.toAtomId}`;
  }).join("\n");
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
  return String(value ?? "").replace(/`[^`]+`\s*/g, "").trim();
}

function extractBacktickId(value?: string | null) {
  const text = String(value ?? "");
  return text.match(/`([^`]+)`/)?.[1] ?? null;
}
