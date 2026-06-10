import type { AgentTurnTimeline, ThreadConversation, ThreadPoolHealth, ThreadPoolRoleDetail, ThreadPoolRoleSummary } from "../../types";
import { API_BASE_URL, readJsonResponse } from "./shared";

export async function getThreadPoolHealth() {
  return readJsonResponse<ThreadPoolHealth>(await fetch(`${API_BASE_URL}/api/threadpool/health`));
}

export async function getThreadPoolRoles() {
  return readJsonResponse<{ ok: boolean; roles: ThreadPoolRoleSummary[]; health?: ThreadPoolHealth }>(await fetch(`${API_BASE_URL}/api/threadpool/roles`));
}

export async function getThreadPoolRoleStatus(role: string) {
  return readJsonResponse<ThreadPoolRoleDetail>(await fetch(`${API_BASE_URL}/api/threadpool/roles/${encodeURIComponent(role)}/status`));
}

export async function discardThreadPoolThread(threadId: string) {
  return readJsonResponse<{ ok: boolean; thread_id: string; status: string }>(
    await fetch(`${API_BASE_URL}/api/threadpool/threads/${encodeURIComponent(threadId)}/discard`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: "manual-discard-from-workbench" }),
    }),
  );
}

export async function getThreadConversation(threadId: string) {
  return readJsonResponse<ThreadConversation>(await fetch(`${API_BASE_URL}/api/threadpool/threads/${encodeURIComponent(threadId)}/conversation`));
}

export async function getAgentTurnTimeline(threadId: string, turnId: string) {
  return readJsonResponse<AgentTurnTimeline>(
    await fetch(`${API_BASE_URL}/api/threadpool/threads/${encodeURIComponent(threadId)}/turns/${encodeURIComponent(turnId)}/timeline`, { cache: "no-store" }),
  );
}

export async function releaseAgentChatLease(leaseId: string, ownerId?: string | null, conversationId?: string | null) {
  return readJsonResponse<{ ok: boolean; leaseId: string; ownerId: string; status: string; conversationDeleted?: boolean }>(
    await fetch(`${API_BASE_URL}/api/agent-chat/threadpool/leases/release`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ leaseId, ownerId, conversationId }),
    }),
  );
}

export async function releaseThreadPoolOwnerLeases(ownerId: string) {
  return readJsonResponse<{ ok: boolean }>(
    await fetch(`${API_BASE_URL}/api/threadpool/leases/release-owner`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ownerId }),
    }),
  );
}

export async function forceUpdateThreadPoolSeeds(options: { roles?: string[]; reason?: string } = {}) {
  const roles = (options.roles ?? []).map((role) => String(role).trim()).filter(Boolean);
  return readJsonResponse<{ ok: boolean; roles: string[]; deleted_count: number; retiring_count: number }>(
    await fetch(`${API_BASE_URL}/api/threadpool/maintenance/force-update-seeds`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        reason: options.reason ?? "manual-force-update-seeds-from-workbench",
        ...(roles.length ? { roles } : {}),
      }),
    }),
  );
}
