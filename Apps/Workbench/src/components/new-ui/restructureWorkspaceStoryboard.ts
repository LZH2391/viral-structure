import type { AgentChatConversation, AgentChatMessageSnapshot } from "../../types";
import type { ConfirmedPlanStatusDisplay, NewUiPendingStoryboardConfirmation } from "./restructureWorkspaceTypes";

export function resolveConfirmedPlanStatusDisplay(status: string | null | undefined): ConfirmedPlanStatusDisplay | null {
  const value = String(status ?? "").trim();
  if (value === "confirmed") return { label: "方案已确认", status: "completed" };
  if (value === "storyboard_processing") return { label: "故事板准备中", status: "running" };
  if (value === "storyboard_failed") return { label: "故事板准备失败", status: "failed" };
  if (value === "completed") return { label: "方案完成", status: "completed" };
  return null;
}

export function resolveStoryboardResultStatusLabel(status: string | null | undefined) {
  const value = String(status ?? "").trim();
  if (value === "confirmed") return "方案已确认";
  if (value === "storyboard_processing") return "故事板准备中";
  if (value === "storyboard_failed") return "故事板准备失败";
  if (value === "completed") return "方案完成";
  return null;
}

export function resolveStoryboardPendingStatusLabel(status: string | null | undefined) {
  const value = String(status ?? "").trim();
  if (value === "storyboard_processing") return "生成中";
  if (value === "confirmed") return "已确认";
  return "准备中";
}

export function shouldShowStoryboardPendingForMessage(
  message: AgentChatMessageSnapshot,
  conversation: AgentChatConversation | null,
  options: { confirmingPlan: boolean; hasStoryboardResultForConfirmedPlan: boolean },
) {
  if (message.storyboardResult) return false;
  if (options.confirmingPlan) return true;
  if (String(conversation?.confirmedPlan?.status ?? "").trim() !== "storyboard_processing") return false;
  if (options.hasStoryboardResultForConfirmedPlan) return false;
  return isMessagePlanConfirmed(message, conversation);
}

export function shouldShowConfirmedPlanStoryboardForMessage(
  message: AgentChatMessageSnapshot,
  conversation: AgentChatConversation | null,
  hasStoryboardResultForConfirmedPlan: boolean,
  pendingStoryboardConfirmation: NewUiPendingStoryboardConfirmation | null = null,
) {
  if (!conversation?.conversationId || hasStoryboardResultForConfirmedPlan || message.storyboardResult) return false;
  if (!isMessagePlanConfirmed(message, conversation)) return false;
  if (pendingStoryboardConfirmation && isPendingStoryboardConfirmationForMessage(message, pendingStoryboardConfirmation)) return false;
  const status = String(conversation.confirmedPlan?.status ?? "").trim();
  if (status === "completed") return true;
  if (status === "storyboard_failed") return true;
  return hasConfirmedPlanStoryboardArtifact(conversation.confirmedPlan);
}

export function shouldShowStoryboardResultMessage(
  message: AgentChatMessageSnapshot,
  conversation: AgentChatConversation | null,
  pendingStoryboardConfirmation: NewUiPendingStoryboardConfirmation | null,
) {
  const result = message.storyboardResult;
  if (!result) return false;
  if (pendingStoryboardConfirmation) {
    return storyboardResultMatchesConfirmation(result, pendingStoryboardConfirmation);
  }
  const confirmed = conversation?.confirmedPlan;
  if (!confirmed) return true;
  const confirmedConfirmationId = normalizeComparableId(confirmed?.confirmationId);
  const resultConfirmationId = normalizeComparableId(result.confirmationId);
  if (confirmedConfirmationId && resultConfirmationId) return confirmedConfirmationId === resultConfirmationId;
  const confirmedRestructurePath = normalizeComparablePath(confirmed?.sourceRestructurePath);
  const resultRestructurePath = normalizeComparablePath(result.sourceRestructurePath);
  const confirmedShotDesignPath = normalizeComparablePath(confirmed?.sourceShotDesignPath);
  const resultShotDesignPath = normalizeComparablePath(result.sourceShotDesignPath);
  return Boolean(
    confirmedRestructurePath
    && resultRestructurePath
    && confirmedRestructurePath === resultRestructurePath
    && (!confirmedShotDesignPath || !resultShotDesignPath || confirmedShotDesignPath === resultShotDesignPath),
  );
}

export function resolveActiveStoryboardConfirmation(
  conversation: AgentChatConversation | null,
  pendingStoryboardConfirmation: NewUiPendingStoryboardConfirmation | null,
) {
  if (!pendingStoryboardConfirmation) return null;
  const pendingConversationId = normalizeComparableId(pendingStoryboardConfirmation.conversationId);
  const conversationId = normalizeComparableId(conversation?.conversationId);
  if (pendingConversationId && conversationId && pendingConversationId !== conversationId) return null;
  return pendingStoryboardConfirmation;
}

function isPendingStoryboardConfirmationForMessage(
  message: AgentChatMessageSnapshot,
  pendingStoryboardConfirmation: NewUiPendingStoryboardConfirmation,
) {
  const pendingMessageId = normalizeComparableId(pendingStoryboardConfirmation.messageId);
  if (pendingMessageId && normalizeComparableId(message.id) === pendingMessageId) return true;
  const pendingRestructurePath = normalizeComparablePath(pendingStoryboardConfirmation.sourceRestructurePath);
  const messageRestructurePath = resolveMessageConfirmedRestructurePath(message, pendingStoryboardConfirmation.sourceRestructurePath);
  if (!pendingRestructurePath || !messageRestructurePath || pendingRestructurePath !== messageRestructurePath) return false;
  const pendingShotDesignPath = normalizeComparablePath(pendingStoryboardConfirmation.sourceShotDesignPath);
  const messageShotDesignPath = normalizeComparablePath(message.dialogueRoboticReview?.shotDesignFinalPath)
    || normalizeComparablePath(extractShotDesignFinalPath(message.text));
  return !pendingShotDesignPath || !messageShotDesignPath || pendingShotDesignPath === messageShotDesignPath;
}

function storyboardResultMatchesConfirmation(
  result: NonNullable<AgentChatMessageSnapshot["storyboardResult"]>,
  confirmation: NewUiPendingStoryboardConfirmation,
) {
  const confirmationId = normalizeComparableId(confirmation.confirmationId);
  const resultConfirmationId = normalizeComparableId(result.confirmationId);
  if (confirmationId && resultConfirmationId) return confirmationId === resultConfirmationId;
  const confirmationRestructurePath = normalizeComparablePath(confirmation.sourceRestructurePath);
  const resultRestructurePath = normalizeComparablePath(result.sourceRestructurePath);
  const confirmationShotDesignPath = normalizeComparablePath(confirmation.sourceShotDesignPath);
  const resultShotDesignPath = normalizeComparablePath(result.sourceShotDesignPath);
  return Boolean(
    confirmationRestructurePath
    && resultRestructurePath
    && confirmationRestructurePath === resultRestructurePath
    && (!confirmationShotDesignPath || !resultShotDesignPath || confirmationShotDesignPath === resultShotDesignPath),
  );
}

function hasConfirmedPlanStoryboardArtifact(confirmedPlan: AgentChatConversation["confirmedPlan"]) {
  if (!confirmedPlan) return false;
  if (confirmedPlan.storyboardArtifact?.artifactId || confirmedPlan.storyboardArtifact?.processingJobId) return true;
  return (confirmedPlan.storyboardVersions ?? []).some((version) => (
    Boolean(version.storyboardArtifact?.artifactId || version.storyboardArtifact?.processingJobId)
  ));
}

export function hasConversationStoryboardResultForConfirmedPlan(conversation: AgentChatConversation | null) {
  const confirmed = conversation?.confirmedPlan;
  if (!confirmed) return false;
  const confirmationId = normalizeComparableId(confirmed.confirmationId);
  const confirmedRestructurePath = normalizeComparablePath(confirmed.sourceRestructurePath);
  const confirmedShotDesignPath = normalizeComparablePath(confirmed.sourceShotDesignPath);
  return (conversation?.messages ?? []).some((message) => {
    const result = message.storyboardResult;
    if (!result) return false;
    const resultConfirmationId = normalizeComparableId(result.confirmationId);
    if (confirmationId && resultConfirmationId) return resultConfirmationId === confirmationId;
    const resultRestructurePath = normalizeComparablePath(result.sourceRestructurePath);
    const resultShotDesignPath = normalizeComparablePath(result.sourceShotDesignPath);
    return Boolean(
      confirmedRestructurePath
      && resultRestructurePath
      && confirmedRestructurePath === resultRestructurePath
      && (!confirmedShotDesignPath || !resultShotDesignPath || confirmedShotDesignPath === resultShotDesignPath),
    );
  });
}

export function isMessagePlanConfirmed(message: AgentChatMessageSnapshot, conversation: AgentChatConversation | null) {
  const confirmed = conversation?.confirmedPlan;
  if (!confirmed?.status) return false;
  const messageTurnId = message.turnId?.trim();
  const confirmedTurnId = confirmed.turnId?.trim();
  if (!messageTurnId || !confirmedTurnId || messageTurnId !== confirmedTurnId) return false;
  const sourceRestructurePath = resolveMessageConfirmedRestructurePath(message, confirmed.sourceRestructurePath);
  const sourceShotDesignPath = normalizeComparablePath(message.dialogueRoboticReview?.shotDesignFinalPath) || normalizeComparablePath(extractShotDesignFinalPath(message.text)) || normalizeComparablePath(confirmed.sourceShotDesignPath);
  const confirmedRestructurePath = normalizeComparablePath(confirmed.sourceRestructurePath);
  const confirmedShotDesignPath = normalizeComparablePath(confirmed.sourceShotDesignPath);
  if (confirmedRestructurePath && sourceRestructurePath && confirmedRestructurePath !== sourceRestructurePath) return false;
  if (confirmedShotDesignPath && sourceShotDesignPath && confirmedShotDesignPath !== sourceShotDesignPath) return false;
  return true;
}

export function resolveMessageConfirmedRestructurePath(message: AgentChatMessageSnapshot, confirmedPath?: string | null) {
  const confirmed = normalizeComparablePath(confirmedPath);
  const displayPaths = [
    message.slotAtomDisplay?.sourceRestructureFinalPath,
    ...(message.slotAtomDisplay?.versionDisplays ?? []).map((display) => display?.sourceRestructureFinalPath),
  ].map(normalizeComparablePath).filter((path): path is string => Boolean(path));
  if (confirmed && displayPaths.includes(confirmed)) return confirmed;
  return displayPaths[0] ?? normalizeComparablePath(extractRestructureFinalPath(message.text)) ?? confirmed;
}

function normalizeComparablePath(pathText?: string | null) {
  return String(pathText ?? "").trim().replace(/\\/g, "/").toLowerCase() || null;
}

function normalizeComparableId(value?: string | null) {
  return String(value ?? "").trim() || null;
}

function extractRestructureFinalPath(text?: string | null) {
  const value = String(text ?? "");
  const saved = value.match(/保存路径[：:]\s*`([^`]+restructure\.final\.md)`/i);
  if (saved?.[1]) return saved[1];
  const artifactPath = value.match(/(Artifacts[\\/]+FunctionSlotRestructure[^\n`]*?restructure\.final\.md)/i);
  if (artifactPath?.[1]) return artifactPath[1];
  const absolutePath = value.match(/([A-Za-z]:[\\/][^\n`)]*?restructure\.final\.md)/i);
  return absolutePath?.[1] ?? null;
}

export function extractShotDesignFinalPath(text?: string | null) {
  const value = String(text ?? "");
  const saved = value.match(/保存路径[：:]\s*`([^`]+shot-design\.final\.md)`/i);
  if (saved?.[1]) return saved[1];
  const artifactPath = value.match(/(Artifacts[\\/]+FunctionSlotRestructure[^\n`]*?shot-design\.final\.md)/i);
  if (artifactPath?.[1]) return artifactPath[1];
  const absolutePath = value.match(/([A-Za-z]:[\\/][^\n`)]*?shot-design\.final\.md)/i);
  return absolutePath?.[1] ?? null;
}
