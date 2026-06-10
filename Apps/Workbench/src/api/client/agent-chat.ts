import type { AgentChatArtifactRef, AgentChatConversation, AgentChatDialogueRoboticReview, AgentChatMaterialGapMatrix, AgentChatSlotAtomDisplay, AgentTurnTimeline, AtomReplacement, SlotReplacement, ThreadConversation } from "../../types";
import type { ActiveTurnSummary, AgentChatCompactResponse, AgentChatRetryResponse, AgentChatSessionResponse, AgentChatStopResponse, AgentChatStoryboardResult, AgentChatStoryboardVersion, AgentChatStructureRef, AgentChatMaterialPackRef, AgentChatTurnResponse } from "./types";
import { API_BASE_URL, buildQuery, readJsonResponse } from "./shared";

export async function startAgentChatThread(payload: { source?: "direct" | "threadpool-role"; role?: string | null; conversationId?: string | null; sampleVideoId?: string | null; expectedRevision?: number | null } = {}) {
  return readJsonResponse<AgentChatSessionResponse>(
    await fetch(`${API_BASE_URL}/api/agent-chat/threads`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );
}

export async function sendAgentChatMessage(
  threadId: string,
  payload: {
    message: string;
    source?: "direct" | "threadpool-role";
    role?: string | null;
    leaseId?: string | null;
    parentThreadId?: string | null;
    conversationId?: string | null;
    expectedRevision?: number | null;
    workspaceRoot?: string | null;
    skillPath?: string | null;
    materialPackRef?: AgentChatMaterialPackRef | null;
    structureRef?: AgentChatStructureRef | null;
  },
) {
  return readJsonResponse<AgentChatTurnResponse>(
    await fetch(`${API_BASE_URL}/api/agent-chat/threads/${encodeURIComponent(threadId)}/turns`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );
}

export async function submitAgentChatManualReplacement(
  threadId: string,
  payload: {
    conversationId?: string | null;
    expectedRevision?: number | null;
    workspaceRoot?: string | null;
    skillPath?: string | null;
    source?: "direct" | "threadpool-role";
    sourceRestructureFinalPath: string;
    sourceDisplayJsonPath: string;
    rootRestructureFinalPath?: string | null;
    sourceTurnId?: string | null;
    versionId?: string | null;
    versionName?: string | null;
    displayFingerprint?: AgentChatSlotAtomDisplay["fileFingerprint"];
    replacements: Array<SlotReplacement | AtomReplacement>;
  },
) {
  return readJsonResponse<AgentChatTurnResponse>(
    await fetch(`${API_BASE_URL}/api/agent-chat/threads/${encodeURIComponent(threadId)}/turns/manual-replacement`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );
}

export async function compactAgentChatThread(
  threadId: string,
  payload: {
    conversationId?: string | null;
    expectedRevision?: number | null;
    workspaceRoot?: string | null;
    contextUsage?: Record<string, unknown> | null;
  } = {},
) {
  return readJsonResponse<AgentChatCompactResponse>(
    await fetch(`${API_BASE_URL}/api/agent-chat/threads/${encodeURIComponent(threadId)}/compact`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );
}

export async function stopAgentChatTurn(
  threadId: string,
  turnId: string,
  payload: { conversationId?: string | null; expectedRevision?: number | null; workspaceRoot?: string | null; reason?: string | null } = {},
) {
  return readJsonResponse<AgentChatStopResponse>(
    await fetch(`${API_BASE_URL}/api/agent-chat/threads/${encodeURIComponent(threadId)}/turns/${encodeURIComponent(turnId)}/stop`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );
}

export async function stopAgentChatThread(
  threadId: string,
  payload: { conversationId?: string | null; expectedRevision?: number | null; workspaceRoot?: string | null; activeTurnId?: string | null; source?: "direct" | "threadpool-role"; leaseId?: string | null; ownerId?: string | null; discardThread?: boolean; archiveConversation?: boolean; reason?: string | null } = {},
) {
  return readJsonResponse<AgentChatStopResponse>(
    await fetch(`${API_BASE_URL}/api/agent-chat/threads/${encodeURIComponent(threadId)}/stop`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );
}

export async function retryAgentChatTurn(
  threadId: string,
  turnId: string,
  payload: { mode?: "same_thread" | "new_thread"; conversationId: string; expectedRevision?: number | null; workspaceRoot?: string | null; source?: "direct" | "threadpool-role"; role?: string | null; skillPath?: string | null } ,
) {
  return readJsonResponse<AgentChatRetryResponse>(
    await fetch(`${API_BASE_URL}/api/agent-chat/threads/${encodeURIComponent(threadId)}/turns/${encodeURIComponent(turnId)}/retry`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );
}

export async function listActiveTurns(payload: { ownerType?: string | null; ownerId?: string | null } = {}) {
  const query = buildQuery({ ownerType: payload.ownerType, ownerId: payload.ownerId });
  return readJsonResponse<{ ok: boolean; activeTurns: ActiveTurnSummary[]; count: number }>(
    await fetch(`${API_BASE_URL}/api/active-turns${query}`, { cache: "no-store" }),
  );
}

export async function stopActiveTurn(bindingId: string, payload: { turnId?: string | null; workspaceRoot?: string | null } = {}) {
  return readJsonResponse<{ ok: boolean; action: "stop"; bindingId: string; ownerType: string; ownerId: string; threadId: string; turnId: string; status: string; ownerResult?: unknown }>(
    await fetch(`${API_BASE_URL}/api/active-turns/${encodeURIComponent(bindingId)}/stop`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );
}

export async function stopActiveThread(bindingId: string, payload: { turnId?: string | null; workspaceRoot?: string | null; reason?: string | null } = {}) {
  return readJsonResponse<{ ok: boolean; action: "stop_thread"; bindingId: string; ownerType: string; ownerId: string; threadId: string; turnId: string; status: string; ownerResult?: unknown }>(
    await fetch(`${API_BASE_URL}/api/active-turns/${encodeURIComponent(bindingId)}/stop-thread`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );
}

export async function retryActiveTurn(bindingId: string, payload: { workspaceRoot?: string | null; mode?: "same_thread" | "new_thread"; role?: string | null } = {}) {
  return readJsonResponse<{ ok: boolean; action: "retry" | "retry_new_thread"; bindingId: string; ownerType: string; ownerId: string; threadId: string; previousThreadId?: string | null; turnId: string | null; status: string }>(
    await fetch(`${API_BASE_URL}/api/active-turns/${encodeURIComponent(bindingId)}/retry`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );
}

export async function collectAgentChatTurn(
  threadId: string,
  turnId: string,
  workspaceRoot?: string | null,
  conversationId?: string | null,
  extra: { role?: string | null; restructureFinalPath?: string | null; parentArtifactId?: string | null; confirmationId?: string | null } = {},
) {
  const query = buildQuery({ workspaceRoot, conversationId, role: extra.role, restructureFinalPath: extra.restructureFinalPath, parentArtifactId: extra.parentArtifactId, confirmationId: extra.confirmationId });
  return readJsonResponse<AgentChatTurnResponse>(
    await fetch(`${API_BASE_URL}/api/agent-chat/threads/${encodeURIComponent(threadId)}/turns/${encodeURIComponent(turnId)}${query}`, { cache: "no-store" }),
  );
}

export async function getAgentChatTurnTimeline(threadId: string, turnId: string, workspaceRoot?: string | null) {
  const query = buildQuery({ workspaceRoot });
  return readJsonResponse<AgentTurnTimeline>(
    await fetch(`${API_BASE_URL}/api/agent-chat/threads/${encodeURIComponent(threadId)}/turns/${encodeURIComponent(turnId)}/timeline${query}`, { cache: "no-store" }),
  );
}

export async function listAgentChatConversations(payload: { role?: string | null; status?: "active" | "archived" | string | null; limit?: number | null; offset?: number | null } = {}) {
  const query = buildQuery({ role: payload.role, status: payload.status ?? "active", limit: payload.limit, offset: payload.offset });
  return readJsonResponse<{ ok: boolean; conversations: AgentChatConversation[]; total?: number | null; limit?: number | null; offset?: number | null; hasMore?: boolean; nextOffset?: number | null; traceId: string; runId: string; stageId: string }>(
    await fetch(`${API_BASE_URL}/api/agent-chat/conversations${query}`, { cache: "no-store" }),
  );
}

export async function getAgentChatStoryboardResult(conversationId: string, resultId?: string | null, versionId?: string | null) {
  const query = buildQuery({ resultId, versionId });
  return readJsonResponse<AgentChatStoryboardResult>(
    await fetch(`${API_BASE_URL}/api/agent-chat/conversations/${encodeURIComponent(conversationId)}/storyboard-result${query}`, { cache: "no-store" }),
  );
}

export async function startAgentChatAutoAdvance(
  conversationId: string,
  payload: {
    threadId?: string | null;
    sourceTurnId?: string | null;
    restructureFinalPath?: string | null;
    restructureFingerprint?: AgentChatSlotAtomDisplay["fileFingerprint"] | null;
    displayFingerprint?: AgentChatSlotAtomDisplay["fileFingerprint"] | null;
    parentArtifactId?: string | null;
    expectedRevision?: number | null;
    workspaceRoot?: string | null;
    skillPath?: string | null;
    source?: "direct" | "threadpool-role";
    role?: string | null;
    leaseId?: string | null;
    userInstruction?: string | null;
  } = {},
) {
  return readJsonResponse<AgentChatTurnResponse>(
    await fetch(`${API_BASE_URL}/api/agent-chat/conversations/${encodeURIComponent(conversationId)}/auto-advance`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );
}

export async function resumeAgentChatConversation(conversationId: string) {
  return readJsonResponse<{ ok: boolean; conversation: AgentChatConversation; refreshed?: ThreadConversation | null; refreshError?: { code?: string; message?: string | null } | null; deleted?: boolean; traceId: string; runId: string; stageId: string }>(
    await fetch(`${API_BASE_URL}/api/agent-chat/conversations/${encodeURIComponent(conversationId)}/resume`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    }),
  );
}

export async function archiveAgentChatConversation(conversationId: string, expectedRevision?: number | null) {
  return readJsonResponse<{ ok: boolean; conversation: AgentChatConversation; traceId: string; runId: string; stageId: string }>(
    await fetch(`${API_BASE_URL}/api/agent-chat/conversations/${encodeURIComponent(conversationId)}/archive`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expectedRevision: expectedRevision ?? null }),
    }),
  );
}

export async function recordAgentChatSystemMessage(conversationId: string, message: string, expectedRevision?: number | null) {
  return readJsonResponse<{ ok: boolean; conversation: AgentChatConversation; traceId: string; runId: string; stageId: string }>(
    await fetch(`${API_BASE_URL}/api/agent-chat/conversations/${encodeURIComponent(conversationId)}/system-messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message, expectedRevision: expectedRevision ?? null }),
    }),
  );
}

export async function reviewAgentChatDialogue(
  conversationId: string,
  payload: {
    turnId?: string | null;
    shotDesignFinalPath?: string | null;
    parentArtifactId?: string | null;
    expectedRevision?: number | null;
    force?: boolean;
  } = {},
) {
  return readJsonResponse<{ ok: boolean; review: AgentChatDialogueRoboticReview; conversation: AgentChatConversation; conversationRevision?: number | null; traceId: string; runId: string; stageId: string }>(
    await fetch(`${API_BASE_URL}/api/agent-chat/conversations/${encodeURIComponent(conversationId)}/dialogue-review`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );
}

export async function submitAgentChatDialogueRework(
  conversationId: string,
  payload: {
    threadId?: string | null;
    turnId?: string | null;
    shotDesignFinalPath?: string | null;
    reviewOutputPath?: string | null;
    decision?: string | null;
    issueCount?: number | null;
    userInstruction?: string | null;
    expectedRevision?: number | null;
    workspaceRoot?: string | null;
    skillPath?: string | null;
    source?: "direct" | "threadpool-role";
    role?: string | null;
    leaseId?: string | null;
    parentArtifactId?: string | null;
  } = {},
) {
  return readJsonResponse<AgentChatTurnResponse>(
    await fetch(`${API_BASE_URL}/api/agent-chat/conversations/${encodeURIComponent(conversationId)}/dialogue-rework`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );
}

export async function confirmAgentChatConversation(
  conversationId: string,
  payload: {
    turnId?: string | null;
    note?: string | null;
    confirmationId?: string | null;
    sourceRestructurePath?: string | null;
    sourceShotDesignPath?: string | null;
    displayArtifact?: AgentChatArtifactRef | null;
    storyboardArtifact?: AgentChatArtifactRef | null;
    mode?: "single" | "multi_version" | string | null;
    defaultVersionId?: string | null;
    versions?: AgentChatStoryboardVersion[] | null;
    storyboardVersions?: AgentChatStoryboardVersion[] | null;
    status?: string | null;
    expectedRevision?: number | null;
  } = {},
) {
  return readJsonResponse<{ ok: boolean; conversation: AgentChatConversation; traceId: string; runId: string; stageId: string }>(
    await fetch(`${API_BASE_URL}/api/agent-chat/conversations/${encodeURIComponent(conversationId)}/confirm`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );
}
