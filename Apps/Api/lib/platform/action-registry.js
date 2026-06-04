const ACTIONS_RESPONSE_SCHEMA_VERSION = "platform_actions_response.v1";

const RERUNNABLE_STAGE_KEYS = new Set([
  "shotBoundary",
  "scriptSegment",
  "rhythmStructure",
  "packagingStructure",
  "functionSlotAtomization",
  "userMaterialTagger",
]);

function createActionRegistry({ workflowRunStore = null, jobStore = null, activeTurnRuntime = null, agentConversationStore = null } = {}) {
  async function listActions({ resourceKind, resourceId } = {}) {
    const kind = normalizeText(resourceKind);
    const id = normalizeText(resourceId);
    if (!kind || !id) return null;
    if (kind === "workflowRun") return workflowRunActions(id, workflowRunStore);
    if (kind === "job") return jobActions(id, jobStore);
    if (kind === "activeTurn") return activeTurnActions(id, activeTurnRuntime);
    if (kind === "conversation") return conversationActions(id, agentConversationStore);
    return {
      schemaVersion: ACTIONS_RESPONSE_SCHEMA_VERSION,
      resource: { resourceKind: kind, resourceId: id },
      actions: [],
    };
  }

  return {
    schemaVersion: ACTIONS_RESPONSE_SCHEMA_VERSION,
    listActions,
  };
}

function workflowRunActions(workflowRunId, workflowRunStore) {
  const run = workflowRunStore?.getRun?.(workflowRunId) ?? null;
  if (!run) return null;
  const stageKeys = Array.isArray(run.stages)
    ? run.stages.map((stage) => stage?.key).filter((key) => RERUNNABLE_STAGE_KEYS.has(key))
    : [];
  const enabled = Boolean(run.sampleVideoId && stageKeys.length);
  return response("workflowRun", workflowRunId, [
    action({
      actionKey: "workflow.stage.rerun",
      label: "重跑工作流阶段",
      enabled,
      disabledReason: enabled ? null : "workflow_stage_rerun_unavailable",
      requiresConfirm: true,
      dangerLevel: "medium",
      inputSchema: {
        type: "object",
        required: ["stageKey"],
        properties: {
          stageKey: { type: "string", enum: stageKeys },
        },
      },
      effects: {
        createsRun: false,
        createsArtifact: true,
        mayInvalidateDownstream: true,
        affectedResourceRefs: [{ resourceKind: "workflowRun", resourceId: workflowRunId }],
      },
    }),
  ]);
}

function jobActions(jobId, jobStore) {
  const job = jobStore?.getJob?.(jobId) ?? jobStore?.getArchivedJob?.(jobId) ?? null;
  if (!job) return null;
  const cacheWaiting = job.status === "cache_waiting" && Boolean(job.cachePrompt?.cacheKind);
  return response("job", jobId, [
    action({
      actionKey: "job.cache.resolve",
      label: "处理任务缓存决策",
      enabled: cacheWaiting,
      disabledReason: cacheWaiting ? null : "job_cache_decision_unavailable",
      requiresConfirm: false,
      dangerLevel: "low",
      inputSchema: {
        type: "object",
        required: ["decision"],
        properties: {
          decision: { type: "string", enum: ["reuse", "refresh"] },
        },
      },
      effects: {
        createsRun: false,
        createsArtifact: true,
        mayInvalidateDownstream: false,
        affectedResourceRefs: [{ resourceKind: "job", resourceId: jobId }],
      },
    }),
  ]);
}

async function activeTurnActions(resourceId, activeTurnRuntime) {
  const binding = await activeTurnRuntime?.getByBindingId?.(resourceId)
    ?? await activeTurnRuntime?.getByTurnId?.(resourceId)
    ?? null;
  if (!binding) return null;
  const actionTarget = binding.bindingId ?? resourceId;
  const canAddressTurn = Boolean(binding.threadId && binding.turnId);
  return response("activeTurn", actionTarget, [
    action({
      actionKey: "agent.turn.stop",
      label: "停止当前 Agent Turn",
      enabled: canAddressTurn,
      disabledReason: canAddressTurn ? null : "active_turn_stop_unavailable",
      requiresConfirm: true,
      dangerLevel: "medium",
      inputSchema: null,
      effects: {
        createsRun: false,
        createsArtifact: false,
        mayInvalidateDownstream: false,
        affectedResourceRefs: [{ resourceKind: "activeTurn", resourceId: actionTarget }],
      },
    }),
    action({
      actionKey: "agent.turn.retry",
      label: "重试当前 Agent Turn",
      enabled: false,
      disabledReason: canAddressTurn ? "active_turn_retry_requires_legacy_replay_route" : "active_turn_retry_unavailable",
      requiresConfirm: true,
      dangerLevel: "medium",
      inputSchema: {
        type: "object",
        properties: {
          mode: { type: "string", enum: ["same_thread", "new_thread"] },
        },
      },
      effects: {
        createsRun: true,
        createsArtifact: true,
        mayInvalidateDownstream: true,
        affectedResourceRefs: [{ resourceKind: "activeTurn", resourceId: actionTarget }],
      },
    }),
  ]);
}

async function conversationActions(conversationId, agentConversationStore) {
  const conversation = await agentConversationStore?.get?.(conversationId) ?? null;
  if (!conversation) return null;
  const active = conversation.status === "active";
  return response("conversation", conversationId, [
    action({
      actionKey: "conversation.archive",
      label: "归档 Agent 会话",
      enabled: active,
      disabledReason: active ? null : "conversation_archive_unavailable",
      requiresConfirm: true,
      dangerLevel: "low",
      inputSchema: {
        type: "object",
        properties: {
          expectedRevision: { type: ["number", "null"] },
        },
      },
      effects: {
        createsRun: false,
        createsArtifact: false,
        mayInvalidateDownstream: false,
        affectedResourceRefs: [{ resourceKind: "conversation", resourceId: conversationId }],
      },
    }),
  ]);
}

function response(resourceKind, resourceId, actions) {
  return {
    schemaVersion: ACTIONS_RESPONSE_SCHEMA_VERSION,
    resource: { resourceKind, resourceId },
    actions,
  };
}

function action(value) {
  return {
    actionKey: value.actionKey,
    label: value.label,
    enabled: Boolean(value.enabled),
    disabledReason: value.disabledReason ?? null,
    requiresConfirm: Boolean(value.requiresConfirm),
    dangerLevel: value.dangerLevel ?? "none",
    inputSchema: value.inputSchema ?? null,
    effects: {
      createsRun: Boolean(value.effects?.createsRun),
      createsArtifact: Boolean(value.effects?.createsArtifact),
      mayInvalidateDownstream: Boolean(value.effects?.mayInvalidateDownstream),
      affectedResourceRefs: Array.isArray(value.effects?.affectedResourceRefs) ? value.effects.affectedResourceRefs : [],
    },
  };
}

function normalizeText(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

module.exports = {
  ACTIONS_RESPONSE_SCHEMA_VERSION,
  createActionRegistry,
};
