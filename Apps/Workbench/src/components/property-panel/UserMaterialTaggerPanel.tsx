import type { AgentRunJob, UserMaterialPackArtifact, UserMaterialPackHistoryEntry } from "../../types";
import { formatSecondsCompact } from "../../utils/format";
import { AgentTurnTimelinePanel } from "./AgentTurnTimeline";

type ShotCard = UserMaterialPackArtifact["shotCards"][number];
type ProofCoverage = UserMaterialPackArtifact["proofCoverage"][number];
type SequenceCandidate = UserMaterialPackArtifact["sequenceRecommendations"]["openingCandidates"][number];

function expandRefs(analysis: UserMaterialPackArtifact | null | undefined, refs?: string[] | null, dictName: "entityDict" | "supportDict" | "guardrailDict" = "guardrailDict") {
  const dict = analysis?.semanticDictionaries?.[dictName] ?? {};
  return (refs ?? []).map((item) => dict[item] ?? item).filter(Boolean);
}

function renderRange(card: ShotCard) {
  const range = card.timeRange;
  if (!range || !Number.isFinite(range.start) || !Number.isFinite(range.end)) return "时间未知";
  return `${formatSecondsCompact(range.start)} - ${formatSecondsCompact(range.end)}`;
}

function renderConfidence(value: number | null | undefined) {
  if (!Number.isFinite(value)) return "置信度未知";
  return `${Math.round(Math.max(0, Math.min(1, Number(value))) * 100)}%`;
}

function renderHistoryOrigin(value: string | null | undefined) {
  if (value === "cache_reuse") return "复用缓存";
  if (value === "repaired_turn") return "修复结果";
  if (value === "failed_validation") return "校验失败";
  return "新识别";
}

function renderCoverage(value: string | null | undefined) {
  if (value === "strong") return "强";
  if (value === "partial") return "部分";
  if (value === "weak") return "弱";
  if (value === "missing") return "缺";
  return value || "未知";
}

function coverageTone(value: string | null | undefined) {
  if (value === "strong") return "strong";
  if (value === "partial") return "partial";
  if (value === "weak") return "weak";
  if (value === "missing") return "missing";
  return "unknown";
}

function shotTimeByRef(cards: ShotCard[], shotRef: string | null | undefined) {
  if (!shotRef) return 0;
  return cards.find((card) => card.shotRef === shotRef)?.timeRange?.start ?? 0;
}

function firstShotTime(cards: ShotCard[], refs: string[]) {
  return shotTimeByRef(cards, refs[0]);
}

function SummaryList({ title, tone, items, empty }: { title: string; tone: "strong" | "weak" | "missing" | "neutral"; items?: string[] | null; empty: string }) {
  const values = items?.filter(Boolean) ?? [];
  return (
    <div className={`material-summary-list ${tone}`}>
      <strong>{title}</strong>
      {values.length ? values.slice(0, 4).map((item) => <span key={`${title}_${item}`}>{item}</span>) : <span>{empty}</span>}
    </div>
  );
}

function SequenceList({ title, items, cards, onSelectShot }: { title: string; items: SequenceCandidate[]; cards: ShotCard[]; onSelectShot: (time: number) => void }) {
  if (!items.length) return null;
  return (
    <div className="material-sequence-column">
      <strong>{title}</strong>
      {items.slice(0, 3).map((item) => (
        <button key={`${title}_${item.shotRef}`} type="button" onClick={() => onSelectShot(shotTimeByRef(cards, item.shotRef))}>
          <b>{item.shotRef}</b>
          <span>{item.fit} / {item.recommendedPosition}</span>
          <small>{item.reason}</small>
        </button>
      ))}
    </div>
  );
}

export function UserMaterialTaggerPanel({
  analysis,
  analysisHistory,
  job,
  onRun,
  onSelectShot,
}: {
  analysis?: UserMaterialPackArtifact | null;
  analysisHistory?: UserMaterialPackHistoryEntry[] | null;
  job?: AgentRunJob | null;
  onRun: () => void;
  onSelectShot: (time: number) => void;
}) {
  const running = job?.status === "pending" || job?.status === "processing";
  const cards = analysis?.shotCards ?? [];
  const groups = analysis?.materialGroups ?? [];
  const proof = analysis?.proofCoverage ?? [];
  const sequence = analysis?.sequenceRecommendations;
  const summary = analysis?.restructureInputSummary;
  const doNotUseFor = expandRefs(analysis, summary?.doNotUseForRefs);
  const restructureAttention = expandRefs(analysis, summary?.needsRestructureAttentionRefs);
  const historyEntries = analysisHistory ?? [];
  const failed = analysis?.status === "failed" || analysis?.validation?.status === "failed" || job?.status === "failed";
  const failureMessage = job?.errorSummary?.message ?? null;
  const debugSnapshotUri = job?.errorSummary?.debugSnapshotUri ?? null;
  const statusText = job
    ? `${job.stage} / ${job.progress}%`
    : analysis
      ? failed
        ? "识别失败"
        : `${cards.length} 镜 / ${groups.length} 组 / ${proof.length} 证明类`
      : "等待识别";

  return (
    <section className="property-section agent-run-panel">
      <div className="section-heading">Agent</div>
      <AgentTurnTimelinePanel agentName="user-material-tagger" statusText={statusText} job={job} running={running} onRun={onRun} />
      {analysis ? (
        <div className="detail-hint">
          <div>status：{analysis.status}</div>
          <div>shotCards：{cards.length} / materialGroups：{groups.length} / proofCoverage：{proof.length}</div>
          <div>validation：{analysis.validation?.status ?? "未知"}{analysis.validation?.validatorCode ? ` / ${analysis.validation.validatorCode}` : ""}</div>
        </div>
      ) : null}
      {failed ? (
        <div className="detail-hint">
          <div>素材识别失败，当前没有可展示素材卡。请重试或打开运行追踪查看原因。</div>
          {failureMessage ? <div>原因：{failureMessage}</div> : null}
          {debugSnapshotUri ? <div>debugSnapshot：{debugSnapshotUri}</div> : null}
        </div>
      ) : null}
      {analysis?.restructureInputSummary ? (
        <div className="rhythm-overview-panel material-overview-panel">
          <div className="rhythm-overview-heading">
            <span>重组可用性</span>
            <strong>{analysis.restructureInputSummary.recommendedUse?.[0] ?? "已生成素材识别包"}</strong>
          </div>
          <div className="rhythm-overview-grid">
            <div>
              <span>强素材</span>
              <strong>{analysis.restructureInputSummary.strongMaterialAreas?.length ?? 0}</strong>
            </div>
            <div>
              <span>弱素材</span>
              <strong>{analysis.restructureInputSummary.weakMaterialAreas?.length ?? 0}</strong>
            </div>
            <div>
              <span>缺口</span>
              <strong>{analysis.restructureInputSummary.missingMaterialAreas?.length ?? 0}</strong>
            </div>
          </div>
          <div className="material-summary-grid">
            <SummaryList title="强素材" tone="strong" items={summary?.strongMaterialAreas} empty="暂无强素材判断" />
            <SummaryList title="弱素材" tone="weak" items={summary?.weakMaterialAreas} empty="暂无弱素材判断" />
            <SummaryList title="素材缺口" tone="missing" items={summary?.missingMaterialAreas} empty="暂无缺口判断" />
            <SummaryList title="推荐用途" tone="neutral" items={summary?.recommendedUse} empty="暂无推荐用途" />
          </div>
          {doNotUseFor.length || restructureAttention.length ? (
            <div className="material-boundary-panel">
              {doNotUseFor.length ? <span><b>禁用边界</b>{doNotUseFor.slice(0, 3).join(" / ")}</span> : null}
              {restructureAttention.length ? <span><b>重组注意</b>{restructureAttention.slice(0, 3).join(" / ")}</span> : null}
            </div>
          ) : null}
        </div>
      ) : null}
      {proof.length ? (
        <div className="material-proof-matrix" aria-label="证明覆盖矩阵">
          <div className="material-proof-head">
            <strong>证明覆盖</strong>
            <span>{proof.filter((item) => item.coverage === "missing").length} 缺 / {proof.filter((item) => item.coverage === "weak").length} 弱</span>
          </div>
          <div className="material-proof-grid">
            {proof.map((item: ProofCoverage) => (
              <button
                key={item.proofNeedClass}
                className={`material-proof-cell ${coverageTone(item.coverage)}`}
                type="button"
                onClick={() => onSelectShot(firstShotTime(cards, item.candidateShots))}
              >
                <b>{item.proofNeedClass}</b>
                <span>{renderCoverage(item.coverage)}</span>
                <small>{item.candidateShots.join(", ") || "无候选镜头"}</small>
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {cards.length ? (
        <div className="agent-shot-list rhythm-card-list">
          {cards.map((card, index) => (
            <button
              key={`${card.shotRef}_${index}`}
              className="rhythm-card-item"
              type="button"
              onClick={() => onSelectShot(card.timeRange?.start ?? 0)}
            >
              <span className="rhythm-card-index">{card.shotNo ?? `M${String(index + 1).padStart(3, "0")}`}</span>
              <span className={`rhythm-card-badge ${card.needReview ? "needs-review" : ""}`}>
                {card.needReview ? "需复核" : renderConfidence(card.confidence)}
              </span>
              <span className="rhythm-card-time">{renderRange(card)}</span>
              <strong className="rhythm-card-title">{card.shotClass}</strong>
              <span className="rhythm-card-block">
                <b>功能</b>
                <small>{card.shotFunctions.slice(0, 3).join(" / ") || "未标注"}</small>
              </span>
              <span className="rhythm-card-block">
                <b>标签</b>
                <small>{card.materialTags.slice(0, 4).join(" / ") || "无"}</small>
              </span>
              <span className="rhythm-card-meta">{card.visualSummary}</span>
              {proof.some((item) => item.candidateShots.includes(card.shotRef)) ? (
                <span className="material-shot-proof-tags">
                  {proof.filter((item) => item.candidateShots.includes(card.shotRef)).slice(0, 4).map((item) => (
                    <i key={`${card.shotRef}_${item.proofNeedClass}`} className={coverageTone(item.coverage)}>{item.proofNeedClass}</i>
                  ))}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      ) : (
        <div className="detail-hint">{failed ? "本次失败产物已记录，但没有有效 shotCards。" : "还没有素材识别结果。运行后会在这里展示素材卡和运行追踪。"}</div>
      )}
      {proof.length ? (
        <div className="agent-history-list material-proof-detail-list">
          <strong>证明详情与缺口建议</strong>
          {proof.map((item) => (
            <div key={item.proofNeedClass} className={`agent-history-item material-proof-detail ${coverageTone(item.coverage)}`}>
              <strong>{item.proofNeedClass} / {item.coverage}</strong>
              <span>shots {item.candidateShots.join(", ") || "无"} / groups {item.candidateGroups.join(", ") || "无"}</span>
              <small>{item.reason}</small>
              <small>{expandRefs(analysis, item.gapAdviceRefs).join(" / ")}</small>
            </div>
          ))}
        </div>
      ) : null}
      {groups.length ? (
        <div className="material-group-list">
          <strong>素材组</strong>
          {groups.map((group) => (
            <div key={group.groupId} className="material-group-item">
              <b>{group.groupId} / {group.groupType}</b>
              <span>{group.shotRefs.join(", ")}</span>
              <small>{group.groupSummary}</small>
            </div>
          ))}
        </div>
      ) : null}
      {sequence ? (
        <div className="material-sequence-grid">
          <SequenceList title="开头候选" items={sequence.openingCandidates ?? []} cards={cards} onSelectShot={onSelectShot} />
          <SequenceList title="中段候选" items={sequence.middleCandidates ?? []} cards={cards} onSelectShot={onSelectShot} />
          <SequenceList title="结尾候选" items={sequence.endingCandidates ?? []} cards={cards} onSelectShot={onSelectShot} />
        </div>
      ) : null}
      {historyEntries.length ? (
        <div className="agent-history-list">
          {historyEntries.slice(-5).reverse().map((entry) => (
            <div key={`${entry.artifactId}_${entry.createdAt}`} className={`agent-history-item ${analysis?.artifactId === entry.artifactId ? "is-current" : ""}`}>
              <strong>{renderHistoryOrigin(entry.resultOrigin)}</strong>
              <span>{entry.shotCardCount} 镜 / {entry.materialGroupCount} 组 / {entry.proofCoverageCount} 证明类</span>
              <small>turn {entry.turnId ? entry.turnId.slice(-10) : "无"} / cache {entry.cacheKey ? entry.cacheKey.slice(0, 12) : "无"}</small>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
