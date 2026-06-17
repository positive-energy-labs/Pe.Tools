import type { WorkbenchChromeModel } from "@pe/agent-projection";
import type { WorkbenchMessage, WorkbenchMessagePart, WorkbenchState } from "@pe/agent-contracts";
import { useEffect, useRef } from "react";
import { JsonBlock } from "../debug/JsonBlock.tsx";

export function TranscriptPane({
  state,
  chrome,
}: {
  state: WorkbenchState;
  chrome: WorkbenchChromeModel;
}) {
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [state.transcript.messages.length]);

  return (
    <section className="section transcript-section">
      <div className="section-heading">
        <h2>Transcript</h2>
        <span className={`status-pill ${state.uiStatus.overall.status}`}>
          {state.uiStatus.overall.status}
        </span>
      </div>
      {state.transcript.error ? <div className="error-text">{state.transcript.error}</div> : null}
      <div className="transcript-list">
        {state.transcript.messages.length === 0 ? <WorkbenchLanding chrome={chrome} /> : null}
        {state.transcript.messages.map((message) => (
          <MessageCard key={message.id} message={message} />
        ))}
        <div ref={endRef} />
      </div>
    </section>
  );
}

function WorkbenchLanding({ chrome }: { chrome: WorkbenchChromeModel }) {
  return (
    <div className="workbench-landing">
      <div className="hero-logo" aria-hidden="true">
        <span>pea</span>
      </div>
      <div className="hero-copy">
        <h1>{chrome.title}</h1>
        <p>{chrome.subtitle}</p>
      </div>
      <div className="command-strip">
        {chrome.launchCommands.map((item) => (
          <button
            key={item.id}
            type="button"
            className="command-card"
            onClick={() => void navigator.clipboard?.writeText(item.command)}
            title={item.description}
          >
            <code>{item.command}</code>
            <span>copy</span>
          </button>
        ))}
      </div>
      <div className="feature-grid">
        {chrome.featureCards.map((card) => (
          <article
            key={card.id}
            className={`feature-card ${card.enabled ? "enabled" : "disabled"}`}
          >
            <div className="feature-card-head">
              <strong>{card.title}</strong>
              {card.hotkey ? <code>{card.hotkey}</code> : null}
            </div>
            <p>{card.description}</p>
          </article>
        ))}
      </div>
    </div>
  );
}

function MessageCard({ message }: { message: WorkbenchMessage }) {
  return (
    <article className={`message-card ${message.role}`}>
      <div className="message-head">
        <strong>{message.role}</strong>
        <span>{message.status}</span>
      </div>
      <div className="message-parts">
        {message.parts.map((part, index) => (
          <MessagePart key={`${message.id}:${index}`} part={part} />
        ))}
      </div>
    </article>
  );
}

function MessagePart({ part }: { part: WorkbenchMessagePart }) {
  switch (part.kind) {
    case "text":
    case "reasoning":
    case "thought":
      return <p className={`part ${part.kind}`}>{part.text}</p>;
    case "tool_call_ref":
      return (
        <div className="part ref tool-ref">
          Tool call: {part.label ?? part.toolCallId} {part.status ? `(${part.status})` : ""}
        </div>
      );
    case "tool_result_ref":
      return (
        <div className="part ref tool-result-ref">
          Tool result: {part.label ?? part.toolCallId} {part.status ? `(${part.status})` : ""}
        </div>
      );
    case "approval_ref":
      return <div className="part ref approval-ref">Approval: {part.label ?? part.approvalId}</div>;
    case "status":
      return <div className="part ref status-ref">{part.text}</div>;
    case "error":
      return <div className="part error-text">{part.message}</div>;
    case "raw":
      return <JsonBlock value={part.value} />;
  }
}
