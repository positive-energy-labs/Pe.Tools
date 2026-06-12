import type { WorkbenchDebugEvent, WorkbenchEvent, WorkbenchState } from "@pe/agent-contracts";
import { useState } from "react";
import { JsonBlock } from "../debug/JsonBlock.tsx";
import { ModelModePanel } from "../model-mode/ModelModePanel.tsx";
import type { WorkbenchCommands } from "../../workbench/use-workbench.ts";

export function InspectorPanel({
  state,
  events,
  commands,
}: {
  state: WorkbenchState;
  events: WorkbenchEvent[];
  commands: WorkbenchCommands;
}) {
  const [tab, setTab] = useState("system");
  return (
    <section className="section fill">
      <div className="tabs">
        {["system", "context", "raw", "memory", "config", "debug", "state"].map((item) => (
          <button
            key={item}
            type="button"
            className={tab === item ? "selected" : ""}
            onClick={() => setTab(item)}
          >
            {item}
          </button>
        ))}
      </div>
      {tab === "system" ? <SystemPrompt state={state} /> : null}
      {tab === "context" ? <EntryList entries={contextEntries(state)} /> : null}
      {tab === "raw" ? <EntryList entries={rawEntries(state, events)} /> : null}
      {tab === "memory" ? <MemoryView state={state} /> : null}
      {tab === "config" ? <ModelModePanel state={state} commands={commands} /> : null}
      {tab === "debug" ? <DebugEvents state={state} events={events} /> : null}
      {tab === "state" ? <JsonBlock value={state} /> : null}
    </section>
  );
}

function SystemPrompt({ state }: { state: WorkbenchState }) {
  const prompt = state.inspector.systemPrompt;
  if (!prompt) return <div className="empty">No system prompt snapshot.</div>;
  return (
    <article className="inspector-detail">
      <div className="muted small">{prompt.source ?? "system"}</div>
      <pre className="content-preview">{prompt.content}</pre>
    </article>
  );
}

function EntryList({
  entries,
}: {
  entries: Array<{ id: string; title: string; content: unknown; updatedAt?: string }>;
}) {
  if (entries.length === 0) return <div className="empty">No entries.</div>;
  return (
    <div className="entry-list">
      {entries.map((entry) => (
        <details key={entry.id} open>
          <summary>
            {entry.title} <span className="muted small">{entry.updatedAt ?? ""}</span>
          </summary>
          <JsonBlock value={entry.content} />
        </details>
      ))}
    </div>
  );
}

function MemoryView({ state }: { state: WorkbenchState }) {
  if (state.memory.entries.length === 0)
    return <div className="empty">No memory entries projected for this thread.</div>;
  return <JsonBlock value={state.memory.entries} />;
}

function contextEntries(state: WorkbenchState) {
  if (state.inspector.contextEntries.length > 0) return state.inspector.contextEntries;
  const entries = [];
  if (state.agent.info) entries.push({ id: "agent", title: "Agent", content: state.agent.info });
  if (state.agent.session)
    entries.push({ id: "session", title: "Session", content: state.agent.session });
  if (state.threads.activeThreadId)
    entries.push({
      id: "active-thread",
      title: "Active thread",
      content: state.threads.items.find(
        (thread) => thread.threadId === state.threads.activeThreadId,
      ),
    });
  return entries;
}

function rawEntries(state: WorkbenchState, events: WorkbenchEvent[]) {
  if (state.inspector.rawMessages.length > 0) return state.inspector.rawMessages;
  return [
    { id: "transcript", title: "Projected transcript", content: state.transcript.messages },
    { id: "tools", title: "Projected tool calls", content: state.tools.calls },
    { id: "events", title: "Recent workbench events", content: events.slice(0, 100) },
  ];
}

function DebugEvents({ state, events }: { state: WorkbenchState; events: WorkbenchEvent[] }) {
  const combined: Array<WorkbenchEvent | WorkbenchDebugEvent> = [
    ...events,
    ...state.debug.events,
  ].slice(0, 500);
  if (combined.length === 0) return <div className="empty">No debug events.</div>;
  return (
    <div className="entry-list">
      {combined.map((event, index) => (
        <details key={`${event.type}:${index}`}>
          <summary>
            {"source" in event ? `${event.source}:` : "event:"}
            {event.type}{" "}
            <span className="muted small">{"timestamp" in event ? event.timestamp : ""}</span>
          </summary>
          <JsonBlock value={event} />
        </details>
      ))}
    </div>
  );
}
