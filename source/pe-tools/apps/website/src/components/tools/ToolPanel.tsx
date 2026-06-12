import { selectActiveToolCalls, selectRecentCompletedToolCalls } from "@pe/agent-projection";
import type { WorkbenchState, WorkbenchToolCall } from "@pe/agent-contracts";
import { useMemo, useState } from "react";
import { JsonBlock } from "../debug/JsonBlock.tsx";

export function ToolPanel({ state }: { state: WorkbenchState }) {
  const active = selectActiveToolCalls(state);
  const recent = selectRecentCompletedToolCalls(state);
  const all = useMemo(
    () => mergeTools(active, recent, state.tools.calls),
    [active, recent, state.tools.calls],
  );
  const [selectedId, setSelectedId] = useState<string>();
  const selected = all.find((tool) => tool.id === selectedId) ?? all[0];

  return (
    <section className="section tools-section">
      <div className="section-heading">
        <h2>Tools</h2>
        <span className="muted small">
          raw IO {state.tools.rawIoAvailable ? "available" : "partial"}
        </span>
      </div>
      <div className="tool-list">
        {all.length === 0 ? <div className="empty">No tool calls yet.</div> : null}
        {all.map((tool) => (
          <button
            key={tool.id}
            type="button"
            className={`tool-row ${tool.id === selected?.id ? "selected" : ""}`}
            onClick={() => setSelectedId(tool.id)}
          >
            <span>{tool.title}</span>
            <span>{tool.status ?? "unknown"}</span>
          </button>
        ))}
      </div>
      {selected ? <ToolDetail tool={selected} /> : null}
    </section>
  );
}

function ToolDetail({ tool }: { tool: WorkbenchToolCall }) {
  return (
    <article className="tool-detail">
      <h3>{tool.title}</h3>
      <dl className="meta-list">
        <dt>ID</dt>
        <dd>{tool.id}</dd>
        <dt>Status</dt>
        <dd>{tool.status ?? "unknown"}</dd>
        <dt>Kind</dt>
        <dd>{tool.kind ?? "-"}</dd>
      </dl>
      {tool.error ? <div className="error-text">{tool.error}</div> : null}
      {tool.content ? <pre className="content-preview">{tool.content}</pre> : null}
      {tool.locations?.length ? (
        <div>
          <h4>Locations</h4>
          <ul className="compact-list">
            {tool.locations.map((location, index) => (
              <li key={`${tool.id}:location:${index}`}>
                {location.path ?? location.uri}:{location.line ?? 0}:{location.column ?? 0}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {tool.timeline?.length ? (
        <div>
          <h4>Timeline</h4>
          <ul className="compact-list">
            {tool.timeline.map((entry) => (
              <li key={entry.id}>
                <strong>{entry.status ?? entry.label ?? "event"}</strong>{" "}
                {entry.summary ?? entry.timestamp ?? ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <details open>
        <summary>Raw input</summary>
        <JsonBlock value={tool.rawInput ?? null} />
      </details>
      <details>
        <summary>Raw output</summary>
        <JsonBlock value={tool.rawOutput ?? null} />
      </details>
    </article>
  );
}

function mergeTools(...groups: WorkbenchToolCall[][]): WorkbenchToolCall[] {
  const byId = new Map<string, WorkbenchToolCall>();
  for (const group of groups) for (const tool of group) byId.set(tool.id, tool);
  return [...byId.values()];
}
