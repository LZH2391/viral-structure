import type { AgentActivitySummary, AgentRunJob, AgentTraceCard } from "../../types";

type TraceRunLike = {
  role?: string | null;
  status?: string | null;
  threadId?: string | null;
  turnId?: string | null;
  leaseId?: string | null;
  traceId?: string | null;
  artifactId?: string | null;
  parentArtifactId?: string | null;
  startedAt?: string | null;
  updatedAt?: string | null;
};

export function resolveAgentTraceCards(job?: AgentRunJob | null): AgentTraceCard[] {
  if (!job) return [];
  const explicit = Array.isArray(job.agentTraceCards)
    ? job.agentTraceCards.map((card, index) => normalizeTraceCard(card, index)).filter(isTraceCard)
    : [];
  if (explicit.length) return explicit;

  const cards = [
    fromAgentRun({
      id: "raw",
      label: labelFromRole(job.agentRun?.role, "Agent turn"),
      run: job.agentRun,
      activity: isSameTurn(job.agentRun, job.agentActivity) ? job.agentActivity ?? null : null,
      latestMessagePreview: isSameTurn(job.agentRun, job.activeThreadMessage) ? job.activeThreadMessage?.text ?? null : null,
      fallbackStatus: statusFromJob(job),
      stageName: job.stage ?? null,
      traceId: job.traceId ?? null,
    }),
    fromAgentRun({
      id: "transform",
      label: "Transform",
      run: job.shotBoundaryTransform,
      activity: isSameTurn(job.shotBoundaryTransform, job.agentActivity) ? job.agentActivity ?? null : null,
      latestMessagePreview: isSameTurn(job.shotBoundaryTransform, job.activeThreadMessage) ? job.activeThreadMessage?.text ?? null : null,
      fallbackStatus: statusFromJob(job),
      stageName: "shot.boundary_transform",
      traceId: job.shotBoundaryTransform?.traceId ?? job.traceId ?? null,
    }),
  ].filter(Boolean) as AgentTraceCard[];

  if ((job.agentActivity || job.activeThreadMessage) && !cards.some((card) => isSameCardTurn(card, job.agentActivity) || isSameCardTurn(card, job.activeThreadMessage))) {
    cards.push(fromActivityOnly(job));
  }
  return dedupeCards(cards);
}

function isTraceCard(card: AgentTraceCard | null): card is AgentTraceCard {
  return card !== null;
}

export function pickDefaultTraceCard(cards: AgentTraceCard[], currentId?: string | null) {
  if (currentId && cards.some((card) => card.id === currentId)) return currentId;
  return cards.find((card) => card.status === "failed")?.id
    ?? cards.find((card) => card.status === "running")?.id
    ?? cards.slice().sort((left, right) => Date.parse(right.updatedAt ?? "") - Date.parse(left.updatedAt ?? ""))[0]?.id
    ?? null;
}

function normalizeTraceCard(card: Partial<AgentTraceCard>, index: number): AgentTraceCard | null {
  const threadId = stringOrNull(card.threadId);
  const turnId = stringOrNull(card.turnId);
  const id = stringOrNull(card.id) ?? [card.label, card.role, threadId, turnId, index].map((part) => String(part ?? "")).join(":");
  if (!id) return null;
  return {
    id,
    label: stringOrNull(card.label) ?? labelFromRole(card.role, "Agent turn"),
    role: stringOrNull(card.role),
    stageName: stringOrNull(card.stageName),
    status: normalizeTraceStatus(card.status),
    threadId,
    turnId,
    leaseId: stringOrNull(card.leaseId),
    traceId: stringOrNull(card.traceId),
    artifactId: stringOrNull(card.artifactId),
    parentArtifactId: stringOrNull(card.parentArtifactId),
    activity: card.activity ?? null,
    latestMessagePreview: stringOrNull(card.latestMessagePreview) ?? card.activity?.latestMessagePreview ?? null,
    startedAt: stringOrNull(card.startedAt),
    updatedAt: stringOrNull(card.updatedAt) ?? card.activity?.updatedAt ?? null,
  };
}

function fromAgentRun({
  id,
  label,
  run,
  activity,
  latestMessagePreview,
  fallbackStatus,
  stageName,
  traceId,
}: {
  id: string;
  label: string;
  run?: TraceRunLike | null;
  activity: AgentActivitySummary | null;
  latestMessagePreview: string | null;
  fallbackStatus: AgentTraceCard["status"];
  stageName: string | null;
  traceId: string | null;
}): AgentTraceCard | null {
  if (!run?.threadId && !run?.turnId && !run?.leaseId) return null;
  const status = normalizeRunStatus(run.status) ?? fallbackStatus;
  return {
    id,
    label,
    role: stringOrNull(run.role),
    stageName,
    status,
    threadId: stringOrNull(run.threadId),
    turnId: stringOrNull(run.turnId),
    leaseId: stringOrNull(run.leaseId),
    traceId,
    artifactId: stringOrNull(run.artifactId),
    parentArtifactId: stringOrNull(run.parentArtifactId),
    activity,
    latestMessagePreview: stringOrNull(latestMessagePreview) ?? activity?.latestMessagePreview ?? null,
    startedAt: stringOrNull(run.startedAt),
    updatedAt: stringOrNull(run.updatedAt) ?? activity?.updatedAt ?? null,
  };
}

function fromActivityOnly(job: AgentRunJob): AgentTraceCard {
  const activity = job.agentActivity ?? null;
  const message = job.activeThreadMessage ?? null;
  return {
    id: "activity",
    label: "Agent activity",
    role: message?.role ?? null,
    stageName: job.stage ?? null,
    status: statusFromJob(job),
    threadId: activity?.threadId ?? message?.threadId ?? null,
    turnId: activity?.turnId ?? message?.turnId ?? null,
    leaseId: null,
    traceId: job.traceId ?? null,
    artifactId: null,
    parentArtifactId: null,
    activity,
    latestMessagePreview: activity?.latestMessagePreview ?? message?.text ?? null,
    startedAt: null,
    updatedAt: activity?.updatedAt ?? message?.createdAt ?? null,
  };
}

function dedupeCards(cards: AgentTraceCard[]) {
  const seen = new Set<string>();
  return cards.filter((card) => {
    const key = `${card.threadId ?? ""}:${card.turnId ?? ""}:${card.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isSameTurn(run: TraceRunLike | null | undefined, value?: { threadId?: string | null; turnId?: string | null } | null) {
  if (!run || !value) return false;
  const runThread = stringOrNull(run.threadId);
  const runTurn = stringOrNull(run.turnId);
  const valueThread = stringOrNull(value.threadId);
  const valueTurn = stringOrNull(value.turnId);
  return Boolean(runThread && runTurn && runThread === valueThread && runTurn === valueTurn);
}

function isSameCardTurn(card: AgentTraceCard, value?: { threadId?: string | null; turnId?: string | null } | null) {
  if (!value) return false;
  const valueThread = stringOrNull(value.threadId);
  const valueTurn = stringOrNull(value.turnId);
  return Boolean(card.threadId && card.turnId && card.threadId === valueThread && card.turnId === valueTurn);
}

function statusFromJob(job: AgentRunJob): AgentTraceCard["status"] {
  if (job.status === "failed") return "failed";
  if (job.status === "processed") return "completed";
  if (job.status === "pending") return "pending";
  if (job.status === "processing") return "running";
  return "unknown";
}

function normalizeRunStatus(status?: string | null): AgentTraceCard["status"] | null {
  const value = String(status ?? "").trim().toLowerCase();
  if (!value) return null;
  if (["completed", "complete", "processed", "success", "succeeded"].includes(value)) return "completed";
  if (["failed", "error", "errored"].includes(value)) return "failed";
  if (["pending", "created", "queued"].includes(value)) return "pending";
  if (["running", "processing", "collecting", "turn_submitted", "submitted", "in_progress", "inprogress"].includes(value)) return "running";
  return "unknown";
}

function normalizeTraceStatus(status?: string | null): AgentTraceCard["status"] {
  return normalizeRunStatus(status) ?? "unknown";
}

function labelFromRole(role?: string | null, fallback = "Agent turn") {
  const value = String(role ?? "").trim();
  if (!value) return fallback;
  if (value === "shot-boundary-raw-analyzer") return "Raw Analyze";
  if (value === "shot-boundary-transformer") return "Transform";
  return value.split("-").map((part) => part ? `${part[0].toUpperCase()}${part.slice(1)}` : part).join(" ");
}

function stringOrNull(value: unknown) {
  const text = String(value ?? "").trim();
  return text || null;
}
