import type { Dispatch, SetStateAction } from "react";
import { getSampleArtifact, runtimeUrl } from "../../api/client";
import type { AgentChatConversation, AgentChatMaterialPackRef, ErrorSummary, FullAnalysisBatchItem, FullAnalysisBatchRun } from "../../types";
import type { AnalysisHistoryItem } from "./analysisHistoryData";
import type { NewUiMaterialPackOption } from "./NewUiRestructureWorkspace";
import type { RestructureMaterialSelectionScope } from "./NewUiLayoutTypes";

export function runtimeUrlSafe(uri?: string | null) { return runtimeUrl(uri) ?? null; }

export type RestructureMaterialAnalysisItem = {
    sampleVideoId: string;
    artifactId?: string | null;
    title?: string | null;
    traceId?: string | null;
    coverUri?: string | null;
    durationSeconds?: number | null;
    artifact?: {
        userMaterialPack?: {
            type?: string | null;
            schemaVersion?: string | null;
            artifactId?: string | null;
            shotCards?: unknown[];
            materialGroups?: unknown[];
            proofCoverage?: unknown[];
        } | null;
        userMaterialPackRef?: {
            uri?: string | null;
        } | null;
        userMaterialPackHistory?: Array<{
            resultUri?: string | null;
        }> | null;
    } | null;
};

export function isTerminalFailedMaterialQueueItem(queueItem: FullAnalysisBatchItem) { const status = String(queueItem.status ?? "").toLowerCase(); return status === "failed" || status === "partial_failed" || status === "canceled" || status === "cancelled"; }

export function materialFailureMessage(errorSummary?: ErrorSummary | null) { return errorSummary?.message?.trim() || "素材识别失败，请重新上传"; }

export function materialAnalysisItemFromBatchQueueItem(queueItem: FullAnalysisBatchItem, batch: FullAnalysisBatchRun, fallbackTitle?: string | null): RestructureMaterialAnalysisItem { return { sampleVideoId: queueItem.sampleVideoId ?? pendingMaterialSampleId(batch.batchRunId, queueItem.queueItemId), artifactId: null, title: stripMediaExtension(fallbackTitle ?? queueItem.filename), traceId: null, coverUri: null, durationSeconds: null, }; }

export function materialAnalysisItemFromHistoryItem(item: AnalysisHistoryItem): RestructureMaterialAnalysisItem { return { sampleVideoId: item.sampleVideoId, artifactId: item.artifactId ?? null, title: item.title ?? item.sampleVideoId, traceId: item.traceId ?? null, coverUri: item.coverUri ?? null, durationSeconds: item.durationSeconds ?? null, artifact: item.artifact ?? null, }; }

export function materialHistoryItemFromBatchQueueItem(queueItem: FullAnalysisBatchItem, batch: FullAnalysisBatchRun, fallbackTitle?: string | null): AnalysisHistoryItem { return { sampleVideoId: queueItem.sampleVideoId ?? "", workflowRunId: queueItem.workflowRunId ?? null, workflowKey: batch.workflowKey, title: stripMediaExtension(fallbackTitle ?? queueItem.filename ?? queueItem.sampleVideoId), status: queueItem.status, updatedAt: queueItem.updatedAt, createdAt: queueItem.createdAt, artifactId: null, traceId: null, runId: null, stageId: null, durationSeconds: null, width: null, height: null, coverUri: null, videoUri: null, hasFunctionSlotAtomization: false, hasUserMaterialPack: false, isIncomplete: false, isRunning: true, artifact: null, workflowRun: null, runtimeState: null, }; }

export async function loadMaterialPackItemFromSampleArtifact(sampleVideoId: string, fallback: RestructureMaterialAnalysisItem) { const artifact = await getSampleArtifact(sampleVideoId).catch(() => null); if (!artifact?.userMaterialPack)
    return null; return { ...fallback, sampleVideoId, artifactId: artifact.userMaterialPack.artifactId ?? fallback.artifactId ?? null, title: artifact.sampleVideo?.original?.summary ?? fallback.title, traceId: artifact.userMaterialPack.traceId ?? artifact.trace?.traceId ?? fallback.traceId ?? null, coverUri: artifact.cover?.uri ?? artifact.frames?.[0]?.imageUri ?? fallback.coverUri ?? null, durationSeconds: artifact.metadata?.durationSeconds ?? fallback.durationSeconds ?? null, artifact, }; }

export function materialPackReady(item: RestructureMaterialAnalysisItem) { const pack = item.artifact?.userMaterialPack ?? null; return Boolean(pack?.type === "user-material-pack" && pack.schemaVersion === "user-material-pack.stable" && materialPackResultUri(item)); }

export function materialPackOptionFromAnalysisItem(item: RestructureMaterialAnalysisItem, fallbackTitle?: string | null, uploadKey?: string | null): NewUiMaterialPackOption { const pack = item.artifact?.userMaterialPack ?? null; return { sampleVideoId: item.sampleVideoId, artifactId: pack?.artifactId ?? item.artifactId ?? null, title: stripMediaExtension(item.title ?? fallbackTitle ?? item.sampleVideoId), traceId: item.traceId ?? null, resultUri: materialPackResultUri(item), coverUrl: runtimeUrlSafe(item.coverUri), durationSeconds: item.durationSeconds ?? null, shotCardCount: Array.isArray(pack?.shotCards) ? pack.shotCards.length : null, materialGroupCount: Array.isArray(pack?.materialGroups) ? pack.materialGroups.length : null, proofCoverageCount: Array.isArray(pack?.proofCoverage) ? pack.proofCoverage.length : null, uploadKey: uploadKey ?? null, }; }

export function materialPackResultUri(item: RestructureMaterialAnalysisItem) { return item.artifact?.userMaterialPackRef?.uri ?? item.artifact?.userMaterialPackHistory?.find((entry) => entry.resultUri)?.resultUri ?? null; }

export function materialPackPendingOptionFromAnalysisItem(item: RestructureMaterialAnalysisItem, fallbackTitle?: string | null, uploadKey?: string | null): NewUiMaterialPackOption { return { ...materialPackOptionFromAnalysisItem(item, fallbackTitle, uploadKey), artifactId: item.artifactId ?? null, pending: true, }; }

export function materialPackPendingOptionFromBatchQueueItem(queueItem: FullAnalysisBatchItem, batch: FullAnalysisBatchRun, fallbackTitle?: string | null, uploadKey?: string | null): NewUiMaterialPackOption { return { sampleVideoId: queueItem.sampleVideoId ?? pendingMaterialSampleId(batch.batchRunId, queueItem.queueItemId), artifactId: null, title: stripMediaExtension(fallbackTitle ?? queueItem.filename ?? "上传素材"), traceId: null, coverUrl: null, durationSeconds: null, uploadKey: uploadKey ?? materialUploadKey(batch.batchRunId, queueItem.queueItemId), pending: true, }; }

export function materialPackFailedOptionFromBatchQueueItem(queueItem: FullAnalysisBatchItem, batch: FullAnalysisBatchRun, fallbackTitle?: string | null, uploadKey?: string | null): NewUiMaterialPackOption { return { sampleVideoId: queueItem.sampleVideoId ?? pendingMaterialSampleId(batch.batchRunId, queueItem.queueItemId), artifactId: null, title: stripMediaExtension(fallbackTitle ?? queueItem.filename ?? "上传素材"), traceId: null, coverUrl: null, durationSeconds: null, uploadKey: uploadKey ?? materialUploadKey(batch.batchRunId, queueItem.queueItemId), failed: true, errorMessage: materialFailureMessage(queueItem.errorSummary ?? queueItem.lastFailure ?? null), }; }

export function materialPackOptionFromConversationDefault(ref: AgentChatMaterialPackRef | null | undefined): NewUiMaterialPackOption | null { if (!ref?.sampleVideoId && !ref?.resultUri)
    return null; return { sampleVideoId: ref.sampleVideoId || ref.resultUri || "default-material-pack", artifactId: ref.artifactId ?? null, title: ref.title ?? ref.sampleVideoId ?? "默认素材包", traceId: ref.traceId ?? null, resultUri: ref.resultUri ?? null, coverUrl: null, durationSeconds: null, shotCardCount: ref.shotCardCount ?? null, materialGroupCount: ref.materialGroupCount ?? null, proofCoverageCount: ref.proofCoverageCount ?? null, }; }

export function resolveConversationDefaultMaterialPackSelection(current: NewUiMaterialPackOption | null, conversation: Pick<AgentChatConversation, "conversationId" | "defaultMaterialPackRef"> | null | undefined, activeConversationId: string | null | undefined, force = false) { const option = materialPackOptionFromConversationDefault(conversation?.defaultMaterialPackRef); if (!option)
    return current; if (force || current?.pending || activeConversationId === conversation?.conversationId)
    return option; return current ?? option; }

export function pendingMaterialSampleId(batchRunId: string, queueItemId: string) { return `pending:${batchRunId}:${queueItemId}`; }

export function materialUploadKey(batchRunId: string, queueItemId: string) { return `upload:${batchRunId}:${queueItemId}`; }

export function parseMaterialUploadKey(value?: string | null) { const text = normalizeMaterialUploadKey(value); if (!text)
    return null; const match = /^upload:([^:]+):(.+)$/.exec(text); const batchRunId = match?.[1] ?? null; const queueItemId = match?.[2] ?? null; return batchRunId && queueItemId ? { batchRunId, queueItemId } : null; }

export function upsertMaterialPackOption(options: NewUiMaterialPackOption[], next: NewUiMaterialPackOption) { const same = (item: NewUiMaterialPackOption) => isSameMaterialPackOptionIdentity(item, next); const existing = options.find(same) ?? null; const preferred = existing ? preferMaterialPackOption(existing, next) : next; return [preferred, ...options.filter((item) => !same(item))]; }

export function mergeMaterialPackOptions(primary: NewUiMaterialPackOption[], secondary: NewUiMaterialPackOption[]) { return [...secondary, ...primary].reduce<NewUiMaterialPackOption[]>((items, item) => upsertMaterialPackOption(items, item), []); }

export function replacePendingMaterialPackSelection(selected: NewUiMaterialPackOption | null, readyOptions: NewUiMaterialPackOption[]) { if (!selected?.pending)
    return selected; const selectedUploadKey = normalizeMaterialUploadKey(selected.uploadKey); return readyOptions.find((item) => (isSameMaterialPackOptionIdentity(item, selected) && !item.pending && (!selectedUploadKey || Boolean(item.resultUri)))) ?? selected; }

export function setRestructureMaterialPackSelectionForScope(scope: RestructureMaterialSelectionScope, value: SetStateAction<NewUiMaterialPackOption | null>, setConversationSelection: Dispatch<SetStateAction<NewUiMaterialPackOption | null>>, setDraftSelection: Dispatch<SetStateAction<NewUiMaterialPackOption | null>>) { if (scope === "draft") {
    setDraftSelection(value);
    return;
} setConversationSelection(value); }

export function getReadyMaterialPackOptions(options: NewUiMaterialPackOption[]) { return options.filter((item) => !item.pending); }

export function preferMaterialPackOption(current: NewUiMaterialPackOption, next: NewUiMaterialPackOption) { const currentPriority = materialPackOptionPriority(current); const nextPriority = materialPackOptionPriority(next); if (nextPriority > currentPriority)
    return next; if (currentPriority > nextPriority)
    return current; return next; }

export function materialPackOptionPriority(option: NewUiMaterialPackOption) { if (!option.pending && option.resultUri)
    return 4; if (option.failed)
    return 3.5; if (option.pending)
    return 3; if (!option.pending)
    return 2; return 1; }

export function isSameMaterialPackOptionIdentity(left: NewUiMaterialPackOption, right: NewUiMaterialPackOption) { const leftUploadKey = normalizeMaterialUploadKey(left.uploadKey); const rightUploadKey = normalizeMaterialUploadKey(right.uploadKey); if (leftUploadKey && rightUploadKey && leftUploadKey === rightUploadKey)
    return true; if (left.sampleVideoId === right.sampleVideoId) {
    return left.pending || right.pending || (left.artifactId ?? null) === (right.artifactId ?? null);
} if (left.pending || right.pending) {
    const leftTitle = comparableMaterialPackTitle(left.title);
    const rightTitle = comparableMaterialPackTitle(right.title);
    if (leftTitle && rightTitle && leftTitle === rightTitle)
        return true;
} return false; }

export function isSameMaterialUpload(option: NewUiMaterialPackOption, uploadKey: string, pendingSampleVideoId: string) { return normalizeMaterialUploadKey(option.uploadKey) === uploadKey || option.sampleVideoId === pendingSampleVideoId; }

export function isRestructureMaterialSelectionCancelled(option: NewUiMaterialPackOption, cancelledKeys: Set<string>) { const uploadKey = normalizeMaterialUploadKey(option.uploadKey); const sampleVideoId = option.sampleVideoId; return Boolean((sampleVideoId && cancelledKeys.has(sampleVideoId)) || (uploadKey && cancelledKeys.has(uploadKey))); }

export function normalizeMaterialUploadKey(value?: string | null) { const text = String(value ?? "").trim(); return text || null; }

export function comparableMaterialPackTitle(value?: string | null) { return stripMediaExtension(value).replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim().toLowerCase(); }

export function stripMediaExtension(value?: string | null) { const text = String(value ?? "").trim(); if (!text)
    return ""; return text.replace(/\.(mp4|mov|m4v|webm|mkv|avi|wmv|flv|mpeg|mpg)$/i, ""); }
