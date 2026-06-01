import { useCallback, useEffect, useMemo, useState } from "react";
import { getFunctionSlotReplacementCandidates } from "../../api/client";
import type { AgentChatAtomSummary, AgentChatSlotAtomDisplay, AgentChatSlotSummary, AtomReplacement, ReplacementCandidate, ReplacementDraft, SlotReplacement } from "../../types";

type AtomKind = "script" | "rhythm" | "packaging";
type DrawerState = { kind: "slot"; atomKind?: null } | { kind: "atom"; atomKind: AtomKind };
type MaterialGap = {
  tone: "gap" | "weak" | "ready";
  label: string;
  title: string;
  body: string;
  action: string;
};

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
  const materialGaps = useMemo(() => buildMaterialGapHints(selectedSlot, selectedAtoms), [selectedAtoms, selectedSlot]);
  const planHealth = useMemo(() => summarizePlanHealth(slots, atoms), [atoms, slots]);
  const slotInvalidated = Boolean(draft.find((item) => item.type === "slot" && item.fromSlotSubtypeId === selectedSlot?.slotSubtypeId));
  const visibleCandidates = useMemo(
    () => candidates.filter((candidate) => !isCurrentReplacementCandidate(candidate, drawer, selectedSlot, selectedAtoms)),
    [candidates, drawer, selectedAtoms, selectedSlot],
  );

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
    setSelectedSlotId(slot?.slotSubtypeId ?? null);
    setQuery("");
    setCandidates([]);
    setCandidateStatus("等待读取 Slot 库");
    setDrawer({ kind: "slot" });
  }, []);

  const openAtomDrawer = useCallback((atomKind: AtomKind) => {
    setQuery("");
    setCandidates([]);
    setCandidateStatus(`等待读取 ${atomKind} Atom 库`);
    setDrawer({ kind: "atom", atomKind });
  }, []);

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
      <div className="agent-chat-plan-health" aria-label="素材缺口总览">
        <span><b>{planHealth.ready}</b> 可落地</span>
        <span><b>{planHealth.weak}</b> 需补强</span>
        <span><b>{planHealth.gap}</b> 高缺口</span>
      </div>
      {display.displayJsonPath ? <div className="agent-chat-slot-atom-path" title={display.displayJsonPath}>{display.displayJsonPath}</div> : null}
      <div className="agent-chat-slot-list" aria-label="Slot 链">
        {slots.map((slot, index) => (
          <button
            key={`${slot.slotSubtypeId ?? "slot"}-${index}`}
            className={`${slot.slotSubtypeId === selectedSlot?.slotSubtypeId ? "active" : ""} slot-material-${slotMaterialTone(slot, atoms)}`}
            type="button"
            onClick={() => setSelectedSlotId(slot.slotSubtypeId ?? null)}
          >
            <small>{String(slot.index ?? index + 1).padStart(2, "0")}</small>
            <b>{stripBacktickLabel(slot.slotSubtype) || slot.slotSubtypeId || "未命名 slot"}</b>
            {slot.functionText ? <span>{slot.functionText}</span> : null}
            <em>{slotMaterialLabel(slot, atoms)}</em>
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
        {selectedSlot?.demand || selectedSlot?.reason ? (
          <div className="agent-chat-slot-evidence">
            {selectedSlot.demand ? <span><b>需求</b>{selectedSlot.demand}</span> : null}
            {selectedSlot.reason ? <span><b>选择理由</b>{selectedSlot.reason}</span> : null}
          </div>
        ) : null}
        {slotInvalidated ? <div className="agent-chat-replacement-warning">Slot 已预选替换，原绑定 Atom 将交给 Agent 重新评估。</div> : null}
        <AtomCard label="Script" value={selectedAtoms?.scriptAtom} tone="script" onReplace={() => openAtomDrawer("script")} />
        <AtomCard label="Rhythm" value={selectedAtoms?.rhythmAtom} tone="rhythm" onReplace={() => openAtomDrawer("rhythm")} />
        <AtomCard label="Packaging" value={selectedAtoms?.packagingAtom} tone="packaging" onReplace={() => openAtomDrawer("packaging")} />
        {selectedAtoms?.handling ? <div className="agent-chat-atom-handling">{selectedAtoms.handling}</div> : null}
        <div className="agent-chat-material-gap-list">
          {materialGaps.map((gap) => (
            <article key={`${gap.tone}_${gap.label}`} className={gap.tone}>
              <span>{gap.label}</span>
              <b>{gap.title}</b>
              <p>{gap.body}</p>
              <small>{gap.action}</small>
            </article>
          ))}
        </div>
      </div>
      {drawer ? (
        <section className="agent-chat-replacement-drawer" aria-label="FunctionSlotLibrary 替换候选">
          <div className="agent-chat-replacement-drawer-head">
            <b>{replacementDrawerTitle(drawer)}</b>
            <button type="button" onClick={() => setDrawer(null)}>关闭</button>
          </div>
          <div className="agent-chat-replacement-mode">
            <span>{drawer.kind === "slot" ? "当前仅展示 Slot 候选" : `当前仅展示 ${drawer.atomKind} Atom 候选`}</span>
            <small>绑定证据随候选展示</small>
          </div>
          <div className="agent-chat-replacement-current">
            <span>当前替换对象</span>
            <b>{currentReplacementLabel(drawer, selectedSlot, selectedAtoms)}</b>
          </div>
          <input value={query} onChange={(event) => setQuery(event.currentTarget.value)} placeholder="搜索 slot / atom / 样例来源" />
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

function buildMaterialGapHints(slot: AgentChatSlotSummary | null, atoms: AgentChatAtomSummary | null): MaterialGap[] {
  const text = [
    slot?.demand,
    slot?.functionText,
    slot?.usage,
    slot?.reason,
    atoms?.scriptAtom,
    atoms?.rhythmAtom,
    atoms?.packagingAtom,
    atoms?.handling,
  ].filter(Boolean).join(" ");
  const hints: MaterialGap[] = [];
  if (/(缺口|无长期|若无|必须|要求|需要|补足|补齐|不能|避免)/.test(text)) {
    hints.push({
      tone: "gap",
      label: "素材缺口",
      title: firstMatchingPhrase(text, ["若无长期素材", "必须通过", "必须有", "要求", "需要"]) || "当前 Slot 对素材有硬约束",
      body: compactText(text, 96),
      action: "处理：补拍对应证据，或替换 Slot/Atom 后交给 Agent 重新评估。",
    });
  }
  if (/(实拍|近景|同框|接触|动作|等待|结果|包装|商品|时间证据|使用痕迹|购买入口|活动利益)/.test(text)) {
    hints.push({
      tone: "weak",
      label: "拍摄义务",
      title: "需要把抽象主张落到可见镜头",
      body: extractMaterialObligation(text),
      action: "补拍草稿：问题/动作/结果/商品锚点至少命中其中一个可见证据。",
    });
  }
  if (!hints.length) {
    hints.push({
      tone: "ready",
      label: "素材状态",
      title: "当前绑定没有明显高缺口提示",
      body: "可先按现有 Slot/Atom 进入 Shot 设计，再在分镜阶段校验真实素材。",
      action: "处理：保持绑定，后续按具体素材做落地检查。",
    });
  }
  return hints.slice(0, 2);
}

function summarizePlanHealth(slots: AgentChatSlotSummary[], atoms: AgentChatAtomSummary[]) {
  return slots.reduce((summary, slot) => {
    const atom = atoms.find((item) => item.slotSubtypeId === slot.slotSubtypeId) ?? null;
    const tone = buildMaterialGapHints(slot, atom)[0]?.tone ?? "ready";
    if (tone === "gap") summary.gap += 1;
    else if (tone === "weak") summary.weak += 1;
    else summary.ready += 1;
    return summary;
  }, { ready: 0, weak: 0, gap: 0 });
}

function slotMaterialTone(slot: AgentChatSlotSummary, atoms: AgentChatAtomSummary[]) {
  const tone = buildMaterialGapHints(slot, atoms.find((item) => item.slotSubtypeId === slot.slotSubtypeId) ?? null)[0]?.tone ?? "ready";
  return tone;
}

function slotMaterialLabel(slot: AgentChatSlotSummary, atoms: AgentChatAtomSummary[]) {
  const tone = slotMaterialTone(slot, atoms);
  if (tone === "gap") return "高缺口";
  if (tone === "weak") return "需补强";
  return "可落地";
}

function firstMatchingPhrase(text: string, markers: string[]) {
  for (const marker of markers) {
    const index = text.indexOf(marker);
    if (index >= 0) return compactText(text.slice(index), 36);
  }
  return "";
}

function extractMaterialObligation(text: string) {
  const sentences = text.split(/[。；;]\s*/).map((item) => item.trim()).filter(Boolean);
  return compactText(sentences.find((sentence) => /(实拍|近景|同框|接触|动作|等待|结果|包装|商品|时间证据|使用痕迹|购买入口|活动利益)/.test(sentence)) ?? text, 88);
}

function compactText(value: string, maxLength: number) {
  const text = value.replace(/`/g, "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1))}…`;
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

function replacementDrawerTitle(drawer: DrawerState) {
  if (drawer.kind === "slot") return "Slot 库";
  if (drawer.atomKind === "script") return "Script Atom 库";
  if (drawer.atomKind === "rhythm") return "Rhythm Atom 库";
  return "Packaging Atom 库";
}

function currentReplacementLabel(drawer: DrawerState, slot: AgentChatSlotSummary | null, atoms: AgentChatAtomSummary | null) {
  if (drawer.kind === "slot") return stripBacktickLabel(slot?.slotSubtype) || slot?.slotSubtypeId || "未知 Slot";
  return atomValueFor(atoms, drawer.atomKind) || `未知 ${drawer.atomKind} Atom`;
}

function candidateStatusText(status: string, totalCount: number, visibleCount: number) {
  if (!status.includes("候选") && !status.includes("candidate")) return status;
  const hiddenCount = Math.max(0, totalCount - visibleCount);
  return hiddenCount ? `${visibleCount} candidates，可见候选已排除当前对象 ${hiddenCount} 项` : `${visibleCount} candidates`;
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
  return String(value ?? "").replace(/`[^`]+`\s*/g, "").trim();
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
