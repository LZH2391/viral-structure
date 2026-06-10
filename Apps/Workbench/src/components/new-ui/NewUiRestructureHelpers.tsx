import type { AgentChatConversation, AgentChatMessageSnapshot, AgentChatSlotAtomDisplay, AgentTurnTimeline } from "../../types";
import type { collectAgentChatTurn, confirmAgentChatConversation } from "../../api/client";
import { extractRestructureFinalPath, normalizeRestructureFinalPath } from "../../utils/restructurePath";
import type { NewUiTurnTimelineTarget } from "./NewUiRestructureWorkspace";
import type { OptimisticRestructureGeneration, RunningRestructureTurn } from "./NewUiLayoutTypes";
import { isTerminalAgentTurnStatus } from "./NewUiLayoutConversationHelpers";

export function numberFromRecord(record: Record<string, number> | undefined, key: string) { const value = record?.[key]; return Number.isFinite(value) ? Number(value) : null; }

export function resolveRestructureTurnTarget(conversation: AgentChatConversation | null, runningTurn: RunningRestructureTurn | null): NewUiTurnTimelineTarget | null { if (runningTurn) {
    if (conversationHasTerminalAssistantTurn(conversation, runningTurn.turnId)) {
        return { threadId: runningTurn.threadId, turnId: runningTurn.turnId, workspaceRoot: runningTurn.workspaceRoot, running: false, };
    }
    return { threadId: runningTurn.threadId, turnId: runningTurn.turnId, workspaceRoot: runningTurn.workspaceRoot, running: true, };
} const threadId = conversation?.threadId?.trim(); if (!threadId)
    return null; const messages = conversation?.messages ?? []; const runningMessage = [...messages].reverse().find((message) => message.role === "assistant" && message.status === "running" && message.turnId); const latestAssistant = [...messages].reverse().find((message) => message.role === "assistant" && message.turnId); const latestMessage = [...messages].reverse().find((message) => message.turnId); const turnId = runningMessage?.turnId ?? conversation?.latestTurnId ?? latestAssistant?.turnId ?? latestMessage?.turnId ?? null; if (!turnId)
    return null; return { threadId, turnId, workspaceRoot: conversation?.workspaceRoot ?? null, running: runningMessage?.turnId === turnId, }; }

export function resolveRunningRestructureTurnFromConversation(conversation: AgentChatConversation | null): RunningRestructureTurn | null { if (!conversation?.conversationId || !conversation.threadId)
    return null; const runningMessage = [...(conversation.messages ?? [])].reverse().find((message) => (message.role === "assistant" && message.status === "running" && Boolean(message.turnId))); if (!runningMessage?.turnId)
    return null; return { conversationId: conversation.conversationId, role: conversation.role ?? "function-slot-restructure", threadId: conversation.threadId, turnId: runningMessage.turnId, workspaceRoot: conversation.workspaceRoot ?? null, }; }

export function optimisticGenerationHasRealAssistant(generation: OptimisticRestructureGeneration, conversation: AgentChatConversation | null) { const messages = conversation?.messages ?? []; if (!messages.length)
    return false; const generationTurnId = generation.turnId ?? generation.message.turnId ?? null; return messages.some((message) => (message.role === "assistant" && ((generationTurnId && message.turnId === generationTurnId) || message.id === generation.message.id))); }

export function resolveActiveSlotAtomDisplay(conversation: AgentChatConversation | null, currentTurnId: string | null): AgentChatSlotAtomDisplay | null { const messages = conversation?.messages ?? []; const current = currentTurnId ? messages.find((message) => message.role === "assistant" && message.turnId === currentTurnId && message.slotAtomDisplay)?.slotAtomDisplay ?? null : null; if (current)
    return current; for (let index = messages.length - 1; index >= 0; index -= 1) {
    const display = messages[index].slotAtomDisplay;
    if (display)
        return display;
} return null; }

export function resolveSlotAtomVersionDisplays(display: AgentChatSlotAtomDisplay | null): AgentChatSlotAtomDisplay[] { const versions = display?.versionDisplays?.filter(Boolean) ?? []; if (versions.length)
    return versions; return display ? [display] : []; }

export function selectSlotAtomVersionDisplay(displays: AgentChatSlotAtomDisplay[], selectedVersionId: string | null, defaultVersionId: string | null): AgentChatSlotAtomDisplay | null { if (!displays.length)
    return null; return displays.find((display) => display.versionId && display.versionId === selectedVersionId) ?? displays.find((display) => display.versionId && display.versionId === defaultVersionId) ?? displays[0] ?? null; }

export function resolvePlanTraceDisplay(display: AgentChatSlotAtomDisplay | null, selectedVersionId: string | null): AgentChatSlotAtomDisplay | null { if (!display)
    return null; if (display.displayJsonPath)
    return display; const displays = resolveSlotAtomVersionDisplays(display).filter((candidate) => Boolean(candidate.displayJsonPath)); return displays.find((candidate) => candidate.versionId && candidate.versionId === selectedVersionId) ?? displays.find((candidate) => candidate.versionId && candidate.versionId === display.defaultVersionId) ?? displays[0] ?? null; }

export function resolvePlanTracePreviewInput(display: AgentChatSlotAtomDisplay | null, selectedVersionId: string | null): {
    displayJsonPath: string | null;
    sourceRestructureFinalPath: string | null;
    multiVersion: boolean;
} { if (!display)
    return { displayJsonPath: null, sourceRestructureFinalPath: null, multiVersion: false }; const versions = resolveSlotAtomVersionDisplays(display).filter((candidate) => Boolean(candidate.displayJsonPath || candidate.sourceRestructureFinalPath)); const multiVersion = versions.length > 1 || display.mode === "multi_version"; if (multiVersion) {
    return { displayJsonPath: null, sourceRestructureFinalPath: display.rootRestructureFinalPath ?? display.sourceRestructureFinalPath ?? versions[0]?.rootRestructureFinalPath ?? null, multiVersion: true, };
} const selected = resolvePlanTraceDisplay(display, selectedVersionId); return { displayJsonPath: selected?.displayJsonPath ?? display.displayJsonPath ?? null, sourceRestructureFinalPath: selected?.sourceRestructureFinalPath ?? display.sourceRestructureFinalPath ?? null, multiVersion: false, }; }

export function resolveCurrentRestructureFinalPath(conversation: AgentChatConversation | null, currentTurnId: string | null) { const messages = conversation?.messages ?? []; const reversed = [...messages].reverse(); const currentAssistantPath = normalizeRestructureFinalPath(extractRestructureFinalPath(reversed.find((message) => message.role === "assistant" && message.turnId === currentTurnId)?.text)); if (currentAssistantPath)
    return currentAssistantPath; for (const message of reversed) {
    if (message.role !== "assistant")
        continue;
    const path = normalizeRestructureFinalPath(extractRestructureFinalPath(message.text));
    if (path)
        return path;
} return normalizeRestructureFinalPath(conversation?.confirmedPlan?.sourceRestructurePath); }

export function SlotAtomVersionBar({ displays, selectedVersionId, onSelect, }: {
    displays: AgentChatSlotAtomDisplay[];
    selectedVersionId: string | null;
    onSelect: (versionId: string | null) => void;
}) { if (displays.length <= 1)
    return null; return (<div className="new-ui-storyboard-version-bar new-ui-slot-atom-version-bar" aria-label="槽位版本选择"> {displays.map((display, index) => { const versionId = display.versionId ?? null; const label = display.versionName || display.versionId || `版本 ${index + 1}`; const active = versionId === selectedVersionId || (!selectedVersionId && index === 0); return (<button key={`${versionId ?? "version"}-${index}`} className={active ? "is-active" : ""} type="button" title={label} onClick={() => onSelect(versionId)}> {label} </button>); })} </div>); }

export function resolveCurrentShotDesignFinalPath(conversation: AgentChatConversation | null, currentTurnId: string | null, sourceMessage?: AgentChatMessageSnapshot | null) { if (sourceMessage?.dialogueRoboticReview?.shotDesignFinalPath) {
    return normalizeShotDesignFinalPath(sourceMessage.dialogueRoboticReview.shotDesignFinalPath);
} const messages = conversation?.messages ?? []; const reversed = [...messages].reverse(); const currentAssistantPath = normalizeShotDesignFinalPath(extractShotDesignFinalPath(reversed.find((message) => message.role === "assistant" && message.turnId === currentTurnId)?.text)); if (currentAssistantPath)
    return currentAssistantPath; for (const message of reversed) {
    if (message.dialogueRoboticReview?.shotDesignFinalPath)
        return normalizeShotDesignFinalPath(message.dialogueRoboticReview.shotDesignFinalPath);
    if (message.role !== "assistant")
        continue;
    const path = normalizeShotDesignFinalPath(extractShotDesignFinalPath(message.text));
    if (path)
        return path;
} return normalizeShotDesignFinalPath(conversation?.confirmedPlan?.sourceShotDesignPath); }

export async function recordFailedStoryboardResultMessage({ confirmWithRevision, turnId, confirmationId, sourceRestructurePath, sourceShotDesignPath, expectedRevision, }: {
    confirmWithRevision: (payload: NonNullable<Parameters<typeof confirmAgentChatConversation>[1]>, expectedRevision: number | null) => Promise<Awaited<ReturnType<typeof confirmAgentChatConversation>>>;
    turnId: string | null;
    confirmationId: string;
    sourceRestructurePath: string;
    sourceShotDesignPath: string | null;
    expectedRevision: number | null;
}) { await confirmWithRevision({ turnId, confirmationId, sourceRestructurePath, sourceShotDesignPath, note: "故事板准备失败。", storyboardArtifact: { artifactId: `storyboard_failed_${confirmationId}`, status: "failed", }, status: "storyboard_failed", }, expectedRevision).catch(() => null); }

export function buildAutoAdvanceSubmissionKey(conversation: AgentChatConversation, display: AgentChatSlotAtomDisplay) { return [conversation.conversationId, display.displayJsonPath ?? "display", display.fileFingerprint?.sha256 ?? display.fileFingerprint?.mtimeMs ?? "fingerprint", display.slotCount ?? 0, display.atomBindingCount ?? 0,].join(":"); }

export function extractShotDesignFinalPath(text?: string | null) { const value = String(text ?? ""); const saved = value.match(/保存路径[：:]\s*`([^`]+shot-design\.final\.md)`/i); if (saved?.[1])
    return saved[1]; const artifactPath = value.match(/(Artifacts[\\/]+FunctionSlotRestructure[^\n`]*?shot-design\.final\.md)/i); if (artifactPath?.[1])
    return artifactPath[1]; const absolutePath = value.match(/([A-Za-z]:[\\/][^\n`)]*?shot-design\.final\.md)/i); return absolutePath?.[1] ?? null; }

export function normalizeShotDesignFinalPath(pathText?: string | null) { const text = String(pathText ?? "").trim(); if (!text)
    return null; const normalized = text.replace(/\\/g, "/").replace(/^\/*[A-Za-z]:\//, ""); const marker = "Artifacts/FunctionSlotRestructure/"; const index = normalized.indexOf(marker); return index >= 0 ? normalized.slice(index) : normalized; }

export function conversationHasTerminalAssistantTurn(conversation: AgentChatConversation | null | undefined, turnId: string | null | undefined) { if (!conversation || !turnId)
    return false; return (conversation.messages ?? []).some((message) => (message.role === "assistant" && message.turnId === turnId && isTerminalAgentTurnStatus(message.status))); }

export function normalizeConversationRevision(value: unknown) { const revision = typeof value === "number" ? value : Number(value); return Number.isFinite(revision) && revision > 0 ? Math.floor(revision) : null; }

export function buildConfirmationId(turnId: string | null) { const suffix = String(turnId ?? "turn").replace(/[^A-Za-z0-9_.-]+/g, "").slice(-8) || "turn"; return `confirm_${suffix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`; }

export function isConversationConflictError(error: unknown) { const apiError = error as {
    statusCode?: unknown;
    code?: unknown;
} | null; if (!apiError || typeof apiError !== "object")
    return false; return apiError.statusCode === 409 || String(apiError.code ?? "").includes("conversation_revision_conflict") || String(apiError.code ?? "").includes("conversation_archived"); }

export function buildContextUsageKey(threadId: string, usage: NonNullable<AgentTurnTimeline["activity"]["tokenUsage"]>) { return [threadId, usage.inputTokens ?? "input_unknown", usage.modelContextWindow ?? "window_unknown", usage.contextThresholdTokens ?? "threshold_unknown",].join(":"); }

export function resolveAutoDialogueReworkRunningTurn(current: RunningRestructureTurn, turn: Awaited<ReturnType<typeof collectAgentChatTurn>>): RunningRestructureTurn | null { const rework = turn.autoDialogueRework; if (!rework?.ok || !rework.turnId || rework.turnId === current.turnId)
    return null; return { conversationId: rework.conversationId ?? current.conversationId, role: rework.role ?? current.role ?? "function-slot-restructure", threadId: rework.threadId ?? current.threadId, turnId: rework.turnId, workspaceRoot: rework.workspaceRoot ?? current.workspaceRoot ?? null, }; }
