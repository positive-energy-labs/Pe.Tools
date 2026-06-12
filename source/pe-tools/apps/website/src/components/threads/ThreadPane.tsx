import type { WorkbenchState, WorkbenchThreadInfo } from "@pe/agent-contracts";
import type { WorkbenchCommands } from "../../workbench/use-workbench.ts";

export function ThreadPane({
  state,
  commands,
}: {
  state: WorkbenchState;
  commands: WorkbenchCommands;
}) {
  const currentId = state.threads.selectedThreadId ?? state.threads.activeThreadId;
  return (
    <section className="section fill">
      <div className="section-heading">
        <h2>Threads</h2>
        <button type="button" onClick={() => void commands.refreshThreads()}>
          Refresh
        </button>
      </div>
      <div className="muted small">{state.threads.status}</div>
      {state.threads.error ? <div className="error-text">{state.threads.error}</div> : null}
      <div className="thread-list">
        {state.threads.items.length === 0 ? <div className="empty">No threads loaded.</div> : null}
        {state.threads.items.map((thread) => (
          <ThreadButton
            key={thread.threadId}
            active={thread.threadId === state.threads.activeThreadId}
            selected={thread.threadId === currentId}
            thread={thread}
            onLoad={() => void commands.loadThread(thread.threadId)}
          />
        ))}
      </div>
      <div className="section-subpanel">
        <h3>Session</h3>
        <dl className="meta-list">
          <dt>Agent</dt>
          <dd>{state.agent.info?.title ?? state.agent.info?.name ?? "Not initialized"}</dd>
          <dt>Session</dt>
          <dd>{state.agent.session?.sessionId ?? "None"}</dd>
          <dt>CWD</dt>
          <dd>{state.agent.session?.cwd ?? "-"}</dd>
        </dl>
      </div>
    </section>
  );
}

function ThreadButton({
  thread,
  active,
  selected,
  onLoad,
}: {
  thread: WorkbenchThreadInfo;
  active: boolean;
  selected: boolean;
  onLoad: () => void;
}) {
  return (
    <button
      type="button"
      className={`thread-row ${active ? "active" : ""} ${selected ? "selected" : ""}`}
      onClick={onLoad}
    >
      <span className="thread-title">{thread.title ?? thread.threadId}</span>
      <span className="thread-meta">
        {thread.updatedAt ?? thread.cwd ?? thread.sessionId ?? ""}
      </span>
    </button>
  );
}
