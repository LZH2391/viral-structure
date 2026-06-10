import type { AgentChatMessageSnapshot } from "../../types";
import type { NewUiTurnTimelineTarget } from "./NewUiRestructureWorkspace";

export type NewUiSectionId = "analysis" | "library" | "restructure";

export type NewUiAnalysisChildId = "structureAnalysis" | "materialRecognition";

export type NewUiLibraryChildId = "sampleStructure" | "semanticGovernance" | "planTrace";

export type RestructureMaterialSelectionScope = "conversation" | "draft";

export type NewUiSection = {
    id: NewUiSectionId;
    label: string;
    children?: NewUiNavChild[];
};

export type NewUiNavChild = {
    id: string;
    label: string;
    updatedAgoLabel?: string | null;
    errorMessage?: string | null;
};

export const NEW_UI_SECTIONS: NewUiSection[] = [{ id: "analysis", label: "分析", children: [{ id: "structureAnalysis", label: "结构分析" }, { id: "materialRecognition", label: "素材识别" },], }, { id: "library", label: "库", children: [{ id: "sampleStructure", label: "样例结构图" }, { id: "semanticGovernance", label: "语义治理库" }, { id: "planTrace", label: "方案溯源图" },], }, { id: "restructure", label: "重组" },];

export const NEW_UI_THREE_PANE_STORAGE_KEY = "new-ui:three-pane-layout";

export const RESTRUCTURE_CONVERSATION_ERROR_STORAGE_KEY = "new-ui:restructure-conversation-errors";

export const ANALYSIS_WORKFLOW_MOUNT_DELAY_MS = 280;

export const PANE_TRANSITION_GUARD_MS = 420;

export const LEFT_PANE_ANIMATION_MS = 280;

export const RESTRUCTURE_TURN_POLL_INTERVAL_MS = 1600;

export const RESTRUCTURE_CONVERSATION_PAGE_SIZE = 15;

export const RESTRUCTURE_MATERIAL_POLL_MAX_ATTEMPTS = 240;

export const analysisOpenRequestResolvers = new Map<number, (result: {
    ok: boolean;
    message?: string | null;
}) => void>();

export type NewUiThreePanePreference = {
    leftCollapsed?: boolean;
    rightCollapsed?: boolean;
    right?: unknown;
    rightRatio?: unknown;
};

export type StructureGraphReturnState = {
    artifactId: string;
    title: string;
} | null;

export type AnalysisOpenRequest = {
    requestId: number;
    mode?: NewUiAnalysisChildId;
    sampleVideoId: string;
    artifactId?: string | null;
    title?: string | null;
} | null;

export type RunningRestructureTurn = {
    conversationId: string;
    role?: string | null;
    threadId: string;
    turnId: string;
    workspaceRoot?: string | null;
};

export type OptimisticRestructureGeneration = {
    id: string;
    conversationId?: string | null;
    draftId?: string | null;
    userMessage: AgentChatMessageSnapshot;
    message: AgentChatMessageSnapshot;
    target: NewUiTurnTimelineTarget;
    turnId?: string | null;
};

export type RestructureSendResult = {
    conversationId?: string | null;
    turnId?: string | null;
} | null;
