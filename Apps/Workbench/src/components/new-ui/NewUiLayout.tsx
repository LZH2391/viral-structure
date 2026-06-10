import type { Dispatch, SetStateAction } from "react";
import type { NewUiTheme } from "../../utils/workbenchPreferences";
import type { AgentChatConversation } from "../../types";
import type { NewUiMaterialPackOption } from "./NewUiRestructureWorkspace";
import { NewUiLayoutRoot } from "./NewUiLayoutRoot";

type RestructureMaterialSelectionScope = "conversation" | "draft";

type NewUiLayoutProps = {
  active?: boolean;
  theme: NewUiTheme;
  onThemeChange: (theme: NewUiTheme) => void;
  onLeftCollapsedChange?: (collapsed: boolean) => void;
};

export function NewUiLayout(props: NewUiLayoutProps) {
  return <NewUiLayoutRoot {...props} />;
}

function materialPackOptionFromConversationDefault(ref: AgentChatConversation["defaultMaterialPackRef"] | null | undefined): NewUiMaterialPackOption | null {
  if (!ref?.sampleVideoId && !ref?.resultUri) return null;
  return {
    sampleVideoId: ref.sampleVideoId || ref.resultUri || "default-material-pack",
    artifactId: ref.artifactId ?? null,
    title: ref.title ?? ref.sampleVideoId ?? "默认素材包",
    traceId: ref.traceId ?? null,
    resultUri: ref.resultUri ?? null,
    coverUrl: null,
    durationSeconds: null,
    shotCardCount: ref.shotCardCount ?? null,
    materialGroupCount: ref.materialGroupCount ?? null,
    proofCoverageCount: ref.proofCoverageCount ?? null,
  };
}

export function resolveConversationDefaultMaterialPackSelection(
  current: NewUiMaterialPackOption | null,
  conversation: Pick<AgentChatConversation, "conversationId" | "defaultMaterialPackRef"> | null | undefined,
  activeConversationId: string | null | undefined,
  force = false,
) {
  const option = materialPackOptionFromConversationDefault(conversation?.defaultMaterialPackRef);
  if (!option) return current;
  if (force || current?.pending || activeConversationId === conversation?.conversationId) return option;
  return current ?? option;
}

export function upsertMaterialPackOption(options: NewUiMaterialPackOption[], next: NewUiMaterialPackOption) {
  const same = (item: NewUiMaterialPackOption) => isSameMaterialPackOptionIdentity(item, next);
  const existing = options.find(same) ?? null;
  const preferred = existing ? preferMaterialPackOption(existing, next) : next;
  return [preferred, ...options.filter((item) => !same(item))];
}

export function mergeMaterialPackOptions(primary: NewUiMaterialPackOption[], secondary: NewUiMaterialPackOption[]) {
  return [...secondary, ...primary].reduce<NewUiMaterialPackOption[]>((items, item) => upsertMaterialPackOption(items, item), []);
}

export function replacePendingMaterialPackSelection(selected: NewUiMaterialPackOption | null, readyOptions: NewUiMaterialPackOption[]) {
  if (!selected?.pending) return selected;
  const selectedUploadKey = normalizeMaterialUploadKey(selected.uploadKey);
  return readyOptions.find((item) => (
    isSameMaterialPackOptionIdentity(item, selected)
    && !item.pending
    && (!selectedUploadKey || Boolean(item.resultUri))
  )) ?? selected;
}

export function setRestructureMaterialPackSelectionForScope(
  scope: RestructureMaterialSelectionScope,
  value: SetStateAction<NewUiMaterialPackOption | null>,
  setConversationSelection: Dispatch<SetStateAction<NewUiMaterialPackOption | null>>,
  setDraftSelection: Dispatch<SetStateAction<NewUiMaterialPackOption | null>>,
) {
  if (scope === "draft") {
    setDraftSelection(value);
    return;
  }
  setConversationSelection(value);
}

function preferMaterialPackOption(current: NewUiMaterialPackOption, next: NewUiMaterialPackOption) {
  const currentPriority = materialPackOptionPriority(current);
  const nextPriority = materialPackOptionPriority(next);
  if (nextPriority > currentPriority) return next;
  if (currentPriority > nextPriority) return current;
  return next;
}

function materialPackOptionPriority(option: NewUiMaterialPackOption) {
  if (!option.pending && option.resultUri) return 4;
  if (option.failed) return 3.5;
  if (option.pending) return 3;
  if (!option.pending) return 2;
  return 1;
}

function isSameMaterialPackOptionIdentity(left: NewUiMaterialPackOption, right: NewUiMaterialPackOption) {
  const leftUploadKey = normalizeMaterialUploadKey(left.uploadKey);
  const rightUploadKey = normalizeMaterialUploadKey(right.uploadKey);
  if (leftUploadKey && rightUploadKey && leftUploadKey === rightUploadKey) return true;
  if (left.sampleVideoId === right.sampleVideoId) {
    return left.pending || right.pending || (left.artifactId ?? null) === (right.artifactId ?? null);
  }
  if (left.pending || right.pending) {
    const leftTitle = comparableMaterialPackTitle(left.title);
    const rightTitle = comparableMaterialPackTitle(right.title);
    if (leftTitle && rightTitle && leftTitle === rightTitle) return true;
  }
  return false;
}

function normalizeMaterialUploadKey(value?: string | null) {
  const text = String(value ?? "").trim();
  return text || null;
}

function comparableMaterialPackTitle(value?: string | null) {
  return stripMediaExtension(value)
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function stripMediaExtension(value?: string | null) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  return text.replace(/\.(mp4|mov|m4v|webm|mkv|avi|wmv|flv|mpeg|mpg)$/i, "");
}
