import type { WorkbenchState } from "@pe/agent-contracts";
import { useState } from "react";
import type { WorkbenchCommands } from "../../workbench/use-workbench.ts";

export function Composer({
  state,
  commands,
}: {
  state: WorkbenchState;
  commands: WorkbenchCommands;
}) {
  const [draft, setDraft] = useState("");
  const running =
    state.uiStatus.overall.status === "running" || state.uiStatus.send.status === "running";
  const disabled = running || !state.agent.info;

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    void commands.send(text);
  };

  return (
    <section className="composer">
      <div className="composer-context">
        <span>Model: {state.models.currentModelId ?? "default"}</span>
        <span>Mode: {state.modes.currentModeId ?? "default"}</span>
        <span>Run: {state.uiStatus.overall.status}</span>
      </div>
      <textarea
        value={draft}
        disabled={disabled}
        placeholder={state.agent.info ? "Send a prompt…" : "Start the workbench first…"}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) send();
        }}
      />
      <div className="composer-actions">
        <button
          type="button"
          onClick={() => void commands.start()}
          disabled={state.uiStatus.start.status === "running"}
        >
          Start
        </button>
        <button type="button" onClick={send} disabled={disabled || draft.trim().length === 0}>
          Send
        </button>
        <button type="button" onClick={() => void commands.cancel()} disabled={!running}>
          Cancel
        </button>
      </div>
    </section>
  );
}
