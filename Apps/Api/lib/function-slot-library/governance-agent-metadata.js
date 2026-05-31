const { buildActiveThreadMessage } = require("../analysis-runtime-v2/thread-message");
const { buildAgentActivityFromTurnResult } = require("../observability/agent-turn-timeline");
const {
  GOVERNANCE_RELATIVE_PATH,
  ROLE,
  SLOT_INDEX_RELATIVE_PATH,
  STAGES,
} = require("./governance-constants");

function buildAgentRun(context, lease, turn, status) {
  const now = new Date().toISOString();
  return {
    provider: "codex-appserver",
    role: ROLE,
    profilePath: context.roleProfile?.profilePath ?? null,
    profileVersion: context.roleProfile?.profileVersion ?? null,
    promptTemplateId: context.promptTemplate?.promptTemplateId ?? null,
    promptTemplateVersion: context.promptTemplate?.promptTemplateVersion ?? null,
    promptTemplateHash: context.promptTemplate?.promptTemplateHash ?? null,
    skillPath: context.roleProfile?.skillPath ?? null,
    skillHash: context.skillHash ?? null,
    leaseId: lease?.lease_id ?? null,
    threadId: lease?.thread_id ?? null,
    turnId: turn?.turnId ?? null,
    traceId: context.traceContext.traceId,
    artifactId: context.artifactId,
    parentArtifactId: context.parentArtifactId,
    sampleVideoId: context.sampleVideoId,
    status,
    preparedInputSummary: {
      governancePath: GOVERNANCE_RELATIVE_PATH,
      slotIndexPath: SLOT_INDEX_RELATIVE_PATH,
    },
    startedAt: now,
    updatedAt: now,
  };
}

function buildAgentArtifact(context) {
  return {
    provider: "codex-appserver",
    role: ROLE,
    skillPath: context.roleProfile?.skillPath ?? null,
    skillHash: context.skillHash ?? null,
    threadId: context.agentRun?.threadId ?? null,
    leaseId: context.agentRun?.leaseId ?? null,
    turnId: context.agentRun?.turnId ?? null,
    profileVersion: context.roleProfile?.profileVersion ?? null,
    promptTemplateId: context.promptTemplate?.promptTemplateId ?? null,
    promptTemplateVersion: context.promptTemplate?.promptTemplateVersion ?? null,
    promptTemplateHash: context.promptTemplate?.promptTemplateHash ?? null,
  };
}

function buildAgentTraceCards(context, status, id = "semantic-governance") {
  if (!context.agentRun) return [];
  const cardStatus = status === "failed" ? "failed" : status === "completed" ? "completed" : "running";
  return [{
    id,
    label: id === "semantic-governance-repair" ? "Semantic Governance Repair" : "Semantic Governance",
    role: ROLE,
    stageName: context.activeStage?.stageName ?? STAGES.analyze,
    status: cardStatus,
    threadId: context.agentRun.threadId ?? null,
    turnId: context.agentRun.turnId ?? null,
    leaseId: context.agentRun.leaseId ?? null,
    traceId: context.traceContext.traceId,
    artifactId: context.artifactId,
    parentArtifactId: context.parentArtifactId,
    activity: null,
    latestMessagePreview: null,
    startedAt: context.agentRun.startedAt ?? null,
    updatedAt: new Date().toISOString(),
  }];
}

function updateActiveThread(context, turn) {
  const activeThreadMessage = buildActiveThreadMessage(turn?.threadId, turn?.turnId, turn?.activeThreadMessage, turn?.status);
  const agentActivity = buildAgentActivityFromTurnResult(turn);
  const cards = buildAgentTraceCards(context, ["completed", "failed"].includes(String(turn?.status)) ? "completed" : "running");
  if (cards[0] && agentActivity) cards[0].activity = agentActivity;
  if (cards[0] && (agentActivity?.latestMessagePreview || activeThreadMessage?.text)) {
    cards[0].latestMessagePreview = agentActivity?.latestMessagePreview ?? activeThreadMessage?.text ?? null;
  }
  context.jobStore.updateJob(context.job.jobId, {
    activeThreadMessage,
    agentActivity,
    agentTraceCards: cards,
  });
}

module.exports = {
  buildAgentRun,
  buildAgentArtifact,
  buildAgentTraceCards,
  updateActiveThread,
};
