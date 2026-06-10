import { type ReactNode } from "react";
import { IconArrowRight, IconAtom } from "@tabler/icons-react";
import type { AgentChatConversation, AgentChatMessageSnapshot } from "../../types";
import { StoryboardResultSkeleton, StoryboardResultViewer } from "./StoryboardResultViewer";
import { ChevronGlyph, RestructureTimelineIcon } from "./RestructureWorkspaceGlyphs";
import { countSlotAtomDisplayAtoms, dialogueReviewDecisionIcon, dialogueReviewDecisionTone, formatDialogueReviewDecision, formatProcessMessageDetail, formatProcessMessageLabel, formatSlotAtomStatus, isDialogueReviewPassed, resolveMessagePlanTraceDisplay, resolveProcessMessageKind, resolveUserInputOriginDisplay, shouldShowSlotAtomDisplayPills, slotAtomStatusTone } from "./restructureWorkspaceMessageModel";
import { isMessagePlanConfirmed, resolveStoryboardPendingStatusLabel, resolveStoryboardResultStatusLabel, shouldShowConfirmedPlanStoryboardForMessage, shouldShowStoryboardPendingForMessage } from "./restructureWorkspaceStoryboard";
import type { NewUiPendingStoryboardConfirmation, RestructureMessageRenderItem, RestructureNotePillIcon, RestructureNotePillTone } from "./restructureWorkspaceTypes";
import { hasRenderableAssistantText, sanitizeDomId } from "./restructureWorkspaceUtils";

export function RestructureMessageWithStoryboardState({
  message,
  displayText,
  pseudoStreaming = false,
  conversation,
  onOpenPlanTrace,
  onConfirmPlan,
  actionsDisabled = false,
  openingPlanTrace = false,
  confirmingPlan = false,
  hasStoryboardResultForConfirmedPlan = false,
  pendingStoryboardConfirmation = null,
}: {
  message: AgentChatMessageSnapshot;
  displayText?: string;
  pseudoStreaming?: boolean;
  conversation: AgentChatConversation | null;
  onOpenPlanTrace?: (message: AgentChatMessageSnapshot) => Promise<void> | void;
  onConfirmPlan?: (message: AgentChatMessageSnapshot) => Promise<void> | void;
  actionsDisabled?: boolean;
  openingPlanTrace?: boolean;
  confirmingPlan?: boolean;
  hasStoryboardResultForConfirmedPlan?: boolean;
  pendingStoryboardConfirmation?: NewUiPendingStoryboardConfirmation | null;
}) {
  const showStoryboardPending = shouldShowStoryboardPendingForMessage(message, conversation, {
    confirmingPlan,
    hasStoryboardResultForConfirmedPlan,
  });
  const showConfirmedPlanStoryboard = !showStoryboardPending
    && shouldShowConfirmedPlanStoryboardForMessage(
      message,
      conversation,
      hasStoryboardResultForConfirmedPlan,
      pendingStoryboardConfirmation,
    );

  return (
    <>
      <RestructureMessage
        message={message}
        displayText={displayText}
        pseudoStreaming={pseudoStreaming}
        onOpenPlanTrace={onOpenPlanTrace}
        onConfirmPlan={onConfirmPlan}
        actionsDisabled={actionsDisabled}
        openingPlanTrace={openingPlanTrace}
        confirmingPlan={confirmingPlan}
        planAlreadyConfirmed={isMessagePlanConfirmed(message, conversation)}
      />
      {showConfirmedPlanStoryboard && conversation?.conversationId ? (
        <StoryboardResultViewer
          conversationId={conversation.conversationId}
          resultId={null}
          statusLabel={resolveStoryboardResultStatusLabel(conversation.confirmedPlan?.status)}
        />
      ) : showStoryboardPending ? (
        <StoryboardResultSkeleton
          message={confirmingPlan ? "故事板准备启动中" : "故事板准备中"}
          statusLabel={resolveStoryboardPendingStatusLabel(conversation?.confirmedPlan?.status)}
        />
      ) : null}
    </>
  );
}

export function RestructureMessage({
  message,
  displayText,
  pseudoStreaming = false,
  onOpenPlanTrace,
  onConfirmPlan,
  actionsDisabled = false,
  openingPlanTrace = false,
  confirmingPlan = false,
  planAlreadyConfirmed = false,
}: {
  message: AgentChatMessageSnapshot;
  displayText?: string;
  pseudoStreaming?: boolean;
  onOpenPlanTrace?: (message: AgentChatMessageSnapshot) => Promise<void> | void;
  onConfirmPlan?: (message: AgentChatMessageSnapshot) => Promise<void> | void;
  actionsDisabled?: boolean;
  openingPlanTrace?: boolean;
  confirmingPlan?: boolean;
  planAlreadyConfirmed?: boolean;
}) {
  const renderedText = displayText ?? message.text;
  const isThinking = message.role === "assistant" && message.status === "running" && !hasRenderableAssistantText(renderedText);
  const showDetails = !isThinking && !pseudoStreaming;
  const userInputOrigin = resolveUserInputOriginDisplay(message);
  const planTraceDisplay = resolveMessagePlanTraceDisplay(message);
  const slotAtomDisplay = shouldShowSlotAtomDisplayPills(message) ? message.slotAtomDisplay : null;
  const planTraceDisabled = actionsDisabled || openingPlanTrace || !planTraceDisplay?.displayJsonPath;
  const confirmPlanDisabled = actionsDisabled || confirmingPlan || !isDialogueReviewPassed(message);
  const confirmPlanActionLabel = planAlreadyConfirmed ? "重跑方案" : "确认方案";
  const confirmingPlanActionLabel = planAlreadyConfirmed ? "重跑中" : "确认中";
  const confirmPlanActionTooltip = planAlreadyConfirmed ? "重新触发故事板准备流水线" : "确认当前方案并触发故事板准备流水线";

  return (
    <article className={`new-ui-restructure-message is-${message.role} ${message.status ?? ""} ${pseudoStreaming ? "pseudo-streaming" : ""}`.trim()} aria-busy={isThinking || pseudoStreaming || undefined}>
      <div className="new-ui-restructure-message-body">
        <p className={isThinking ? "is-thinking-text" : undefined}>{isThinking ? "正在思考" : renderedText}</p>
        {showDetails && userInputOrigin ? (
          <div className="new-ui-restructure-message-note">
            <RestructureNotePill icon={userInputOrigin.icon} tone={userInputOrigin.tone} tooltip={userInputOrigin.tooltip}>
              {userInputOrigin.label}
            </RestructureNotePill>
          </div>
        ) : null}
        {showDetails && slotAtomDisplay ? (
          <div className="new-ui-restructure-message-note">
            <RestructureNotePill icon="slot">槽位 {slotAtomDisplay.slotCount ?? 0}</RestructureNotePill>
            <RestructureNotePill icon="atom">原子 {countSlotAtomDisplayAtoms(slotAtomDisplay)}</RestructureNotePill>
            {slotAtomDisplay.status ? (
              <RestructureNotePill icon="check" tone={slotAtomStatusTone(slotAtomDisplay.status)}>
                {formatSlotAtomStatus(slotAtomDisplay.status)}
              </RestructureNotePill>
            ) : null}
            {onOpenPlanTrace ? (
              <RestructureNotePill
                icon="trace"
                onClick={() => void onOpenPlanTrace(message)}
                disabled={planTraceDisabled}
                tooltip={planTraceDisplay?.displayJsonPath ? "预览当前方案溯源图" : "需要当前方案已生成 restructure.display.json"}
              >
                {openingPlanTrace ? "预览中" : "查看溯源图"}
              </RestructureNotePill>
            ) : null}
          </div>
        ) : null}
        {showDetails && message.dialogueRoboticReview ? (
          <RestructureProcessMessageItem
            message={message}
            displayText={formatProcessMessageDetail(message)}
            pseudoStreaming={false}
          />
        ) : null}
        {showDetails && message.dialogueRoboticReview ? (
          <div className="new-ui-restructure-message-note">
            <RestructureNotePill icon="review" tone="warning">台词审查</RestructureNotePill>
            {message.dialogueRoboticReview.decision ? (
              <RestructureNotePill icon={dialogueReviewDecisionIcon(message.dialogueRoboticReview.decision)} tone={dialogueReviewDecisionTone(message.dialogueRoboticReview.decision)}>
                {formatDialogueReviewDecision(message.dialogueRoboticReview.decision)}
              </RestructureNotePill>
            ) : null}
            <RestructureNotePill icon="issue">{message.dialogueRoboticReview.issueCount ?? 0} 项问题</RestructureNotePill>
            {onConfirmPlan && isDialogueReviewPassed(message) ? (
              <RestructureNotePill
                icon={planAlreadyConfirmed ? "rerun" : "confirm"}
                tone="success"
                onClick={() => void onConfirmPlan(message)}
                disabled={confirmPlanDisabled}
                tooltip={confirmPlanActionTooltip}
              >
                {confirmingPlan ? confirmingPlanActionLabel : confirmPlanActionLabel}
              </RestructureNotePill>
            ) : null}
          </div>
        ) : null}
      </div>
    </article>
  );
}

export function RestructureProcessMessageGroup({
  group,
  expanded,
  getDisplayText,
  isPseudoStreaming,
  onToggle,
}: {
  group: Extract<RestructureMessageRenderItem, { kind: "process_group" }>;
  expanded: boolean;
  getDisplayText: (message: AgentChatMessageSnapshot) => string;
  isPseudoStreaming: (message: AgentChatMessageSnapshot) => boolean;
  onToggle: () => void;
}) {
  const panelId = `new-ui-restructure-process-${sanitizeDomId(group.id)}`;
  return (
    <section className={`new-ui-restructure-activity-group ${expanded ? "is-expanded" : ""}`.trim()} aria-label="过程">
      <button
        className="new-ui-restructure-activity-toggle"
        type="button"
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={onToggle}
      >
        <span className="new-ui-restructure-activity-chevron" aria-hidden="true">
          <ChevronGlyph />
        </span>
        <span className="new-ui-restructure-activity-summary">
          <span>{expanded ? "收起过程" : "显示过程"}</span>
        </span>
      </button>
      <div id={panelId} className="new-ui-restructure-activity-group-body" aria-hidden={!expanded}>
        {group.messages.map((message) => {
          const pseudoStreaming = isPseudoStreaming(message);
          return (
            <RestructureProcessMessageItem
              key={message.id}
              message={message}
              displayText={getDisplayText(message)}
              pseudoStreaming={pseudoStreaming}
            />
          );
        })}
      </div>
    </section>
  );
}

export function RestructureProcessMessageItem({ message, displayText, pseudoStreaming }: { message: AgentChatMessageSnapshot; displayText: string; pseudoStreaming: boolean }) {
  return (
    <article className={`new-ui-restructure-activity is-process-message ${pseudoStreaming ? "pseudo-streaming" : ""}`.trim()} aria-busy={pseudoStreaming || undefined}>
      <span className="new-ui-restructure-activity-icon" aria-hidden="true">
        <ProcessMessageIcon message={message} />
      </span>
      <p>
        <span>{formatProcessMessageLabel(message)}</span>
        <strong>{displayText}</strong>
      </p>
    </article>
  );
}

function ProcessMessageIcon({ message }: { message: AgentChatMessageSnapshot }) {
  const kind = resolveProcessMessageKind(message);
  return <RestructureTimelineIcon kind={kind ?? "reasoning"} />;
}

function RestructureNotePill({
  children,
  icon,
  tone = "neutral",
  tooltip,
  onClick,
  disabled = false,
}: {
  children: ReactNode;
  icon: RestructureNotePillIcon;
  tone?: RestructureNotePillTone;
  tooltip?: string | null;
  onClick?: () => void;
  disabled?: boolean;
}) {
  const className = `new-ui-restructure-note-pill is-${tone} ${onClick ? "is-action" : ""}`.trim();
  if (onClick) {
    return (
      <button className={className} type="button" data-tooltip={tooltip || undefined} disabled={disabled} onClick={onClick}>
        <RestructureNotePillIcon icon={icon} />
        <span>{children}</span>
      </button>
    );
  }
  return (
    <span className={className} data-tooltip={tooltip || undefined} tabIndex={tooltip ? 0 : undefined}>
      <RestructureNotePillIcon icon={icon} />
      <span>{children}</span>
    </span>
  );
}

function RestructureNotePillIcon({ icon }: { icon: RestructureNotePillIcon }) {
  if (icon === "slot") {
    return (
      <svg viewBox="0 0 20 20" focusable="false" aria-hidden="true">
        <path d="M4.5 4.5h4v4h-4zM11.5 4.5h4v4h-4zM4.5 11.5h4v4h-4zM11.5 11.5h4v4h-4z" />
      </svg>
    );
  }
  if (icon === "atom") {
    return <IconAtom aria-hidden="true" focusable="false" />;
  }
  if (icon === "confirm") {
    return <IconArrowRight aria-hidden="true" focusable="false" />;
  }
  if (icon === "rerun") {
    return (
      <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
        <path d="M18.3 8.2A7 7 0 1 0 19 13" />
        <path d="M18.6 4.8v3.8h-3.8" />
      </svg>
    );
  }
  if (icon === "check") {
    return (
      <svg viewBox="0 0 20 20" focusable="false" aria-hidden="true">
        <path d="m4.6 10.4 3.3 3.2 7.5-7.2" />
      </svg>
    );
  }
  if (icon === "trace") {
    return (
      <svg viewBox="0 0 20 20" focusable="false" aria-hidden="true">
        <path d="M3.5 13.5 7.7 8.8l3.4 3.1 5.4-6.3" />
        <circle cx="3.5" cy="13.5" r="1.1" />
        <circle cx="7.7" cy="8.8" r="1.1" />
        <circle cx="11.1" cy="11.9" r="1.1" />
        <circle cx="16.5" cy="5.6" r="1.1" />
      </svg>
    );
  }
  if (icon === "review") {
    return (
      <svg viewBox="0 0 20 20" focusable="false" aria-hidden="true">
        <path d="M5.5 3.8h6.2l2.8 2.8v8.6a1 1 0 0 1-1 1h-8a1 1 0 0 1-1-1V4.8a1 1 0 0 1 1-1Z" />
        <path d="M11.5 4v3h3M7.2 10h4.8M7.2 13h3" />
      </svg>
    );
  }
  if (icon === "rework") {
    return (
      <svg viewBox="0 0 20 20" focusable="false" aria-hidden="true">
        <path d="M4.8 9a5.2 5.2 0 0 1 8.9-3.2L15.5 7" />
        <path d="M15.5 4.2V7h-2.8M15.2 11a5.2 5.2 0 0 1-8.9 3.2L4.5 13" />
        <path d="M4.5 15.8V13h2.8" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 20 20" focusable="false" aria-hidden="true">
      <path d="M10 3.6 17 15.8H3L10 3.6Z" />
      <path d="M10 7.8v3.8M10 14.1h.01" />
    </svg>
  );
}
