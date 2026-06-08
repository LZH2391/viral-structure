import type { AgentChatConversation, AgentChatMessageSnapshot } from "../../types";
import { shortId } from "../../utils/format";

type NewUiRestructureWorkspaceProps = {
  conversation: AgentChatConversation | null;
  creatingConversation: boolean;
  onNewConversation: () => void;
};

export function NewUiRestructureWorkspace({
  conversation,
  creatingConversation,
  onNewConversation,
}: NewUiRestructureWorkspaceProps) {
  const messages = conversation?.messages ?? [];
  const latestAssistantMessage = findLatestAssistantMessage(messages);
  const latestUserMessage = findLatestUserMessage(messages);
  const statusLabel = resolveConversationStatusLabel(conversation);
  const updatedLabel = formatDateTime(conversation?.updatedAt ?? conversation?.createdAt);
  const confirmedPlan = conversation?.confirmedPlan ?? null;

  if (!conversation) {
    return (
      <section className="new-ui-restructure-workspace is-empty" aria-label="重组工作区">
        <div className="new-ui-restructure-empty">
          <div>
            <span className="new-ui-restructure-kicker">function-slot-restructure</span>
            <h1>重组会话</h1>
            <p>选择左侧会话，或创建一个新的结构重组对话。</p>
          </div>
          <button className="new-ui-restructure-primary" type="button" disabled={creatingConversation} onClick={onNewConversation}>
            <NewConversationGlyph />
            <span>{creatingConversation ? "创建中" : "新会话"}</span>
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="new-ui-restructure-workspace" aria-label="重组工作区">
      <header className="new-ui-restructure-header">
        <div className="new-ui-restructure-title-block">
          <span className="new-ui-restructure-kicker">function-slot-restructure</span>
          <h1 data-tooltip={conversation.title ?? undefined}>{conversation.title || "重组会话"}</h1>
          <div className="new-ui-restructure-meta">
            <span>{statusLabel}</span>
            {updatedLabel ? <span>{updatedLabel}</span> : null}
            {conversation.revision ? <span>rev {conversation.revision}</span> : null}
            {conversation.threadId ? <span>thread {shortId(conversation.threadId)}</span> : null}
          </div>
        </div>
        <div className="new-ui-restructure-actions" aria-label="重组会话操作">
          <button type="button" data-tooltip="新会话" disabled={creatingConversation} onClick={onNewConversation}>
            <NewConversationGlyph />
          </button>
        </div>
      </header>

      <div className="new-ui-restructure-shell">
        <main className="new-ui-restructure-chat" aria-label="重组对话">
          {messages.length ? (
            <div className="new-ui-restructure-message-list">
              {messages.map((message) => (
                <RestructureMessage key={message.id} message={message} />
              ))}
            </div>
          ) : (
            <div className="new-ui-restructure-thread-empty">
              <h2>还没有消息</h2>
              <p>这个会话已创建，等待第一条重组 brief。</p>
            </div>
          )}

          <div className="new-ui-restructure-composer" aria-label="重组输入区">
            <textarea rows={3} placeholder="描述目标品类、素材情况、想迁移的结构或要返工的点" disabled />
            <button type="button" disabled>
              发送
            </button>
          </div>
        </main>

        <aside className="new-ui-restructure-context" aria-label="重组上下文">
          <section className="new-ui-restructure-panel">
            <h2>会话状态</h2>
            <dl className="new-ui-restructure-facts">
              <div>
                <dt>状态</dt>
                <dd>{statusLabel}</dd>
              </div>
              <div>
                <dt>消息</dt>
                <dd>{messages.length}</dd>
              </div>
              <div>
                <dt>最近更新</dt>
                <dd>{updatedLabel || "未知"}</dd>
              </div>
            </dl>
          </section>

          <section className="new-ui-restructure-panel">
            <h2>最新输入</h2>
            <p className="new-ui-restructure-excerpt">{latestUserMessage?.text || "暂无用户 brief"}</p>
          </section>

          <section className="new-ui-restructure-panel">
            <h2>最新输出</h2>
            <p className="new-ui-restructure-excerpt">{latestAssistantMessage?.text || "暂无 Agent 输出"}</p>
          </section>

          <section className="new-ui-restructure-panel">
            <h2>方案产物</h2>
            {confirmedPlan ? (
              <div className="new-ui-restructure-artifacts">
                <ArtifactRow label="确认状态" value={confirmedPlan.status ?? "confirmed"} />
                <ArtifactRow label="确认时间" value={formatDateTime(confirmedPlan.confirmedAt) || "未知"} />
                <ArtifactRow label="display" value={confirmedPlan.displayArtifact?.artifactId ? shortId(confirmedPlan.displayArtifact.artifactId) : "未登记"} />
                <ArtifactRow label="storyboard" value={confirmedPlan.storyboardArtifact?.artifactId ? shortId(confirmedPlan.storyboardArtifact.artifactId) : "未登记"} />
              </div>
            ) : (
              <p className="new-ui-restructure-excerpt">尚未确认方案。</p>
            )}
          </section>
        </aside>
      </div>
    </section>
  );
}

function RestructureMessage({ message }: { message: AgentChatMessageSnapshot }) {
  const roleLabel = message.role === "assistant" ? "Agent" : message.role === "user" ? "User" : "System";
  const timeLabel = formatDateTime(message.updatedAt ?? message.createdAt);
  return (
    <article className={`new-ui-restructure-message is-${message.role} ${message.status ?? ""}`.trim()}>
      <div className="new-ui-restructure-message-rail">
        <span>{roleLabel.slice(0, 1)}</span>
      </div>
      <div className="new-ui-restructure-message-body">
        <header>
          <b>{roleLabel}</b>
          {timeLabel ? <time dateTime={message.updatedAt ?? message.createdAt ?? undefined}>{timeLabel}</time> : null}
        </header>
        <p>{message.text}</p>
        {message.slotAtomDisplay ? (
          <div className="new-ui-restructure-message-note">
            <span>槽位 {message.slotAtomDisplay.slotCount ?? 0}</span>
            <span>原子 {message.slotAtomDisplay.atomBindingCount ?? 0}</span>
            {message.slotAtomDisplay.status ? <span>{message.slotAtomDisplay.status}</span> : null}
          </div>
        ) : null}
        {message.dialogueRoboticReview ? (
          <div className="new-ui-restructure-message-note">
            <span>台词审查</span>
            {message.dialogueRoboticReview.decision ? <span>{message.dialogueRoboticReview.decision}</span> : null}
            <span>{message.dialogueRoboticReview.issueCount ?? 0} 项</span>
          </div>
        ) : null}
      </div>
    </article>
  );
}

function ArtifactRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}

function findLatestAssistantMessage(messages: AgentChatMessageSnapshot[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === "assistant") return messages[index];
  }
  return null;
}

function findLatestUserMessage(messages: AgentChatMessageSnapshot[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === "user") return messages[index];
  }
  return null;
}

function resolveConversationStatusLabel(conversation: AgentChatConversation | null) {
  if (!conversation) return "未选择";
  if (conversation.invalidated) return "thread 失效";
  if (conversation.threadStopped) return "thread 已停止";
  if (conversation.confirmedPlan) return "方案已确认";
  if (conversation.status === "archived") return "已归档";
  return "进行中";
}

function formatDateTime(value: string | null | undefined) {
  const timestamp = Date.parse(value ?? "");
  if (!Number.isFinite(timestamp)) return "";
  return new Date(timestamp).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function NewConversationGlyph() {
  return (
    <svg viewBox="0 0 20 20" focusable="false" aria-hidden="true">
      <path d="M10 4v12M4 10h12" />
    </svg>
  );
}
