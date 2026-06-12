import {
  selectActiveThread,
  selectCurrentModeLabel,
  selectCurrentModelLabel,
  selectOverallRunStatus,
} from "@pe/agent-projection";
import { ApprovalDock } from "./components/approvals/ApprovalDock.tsx";
import { Composer } from "./components/composer/Composer.tsx";
import { InspectorPanel } from "./components/inspector/InspectorPanel.tsx";
import { WorkbenchLayout } from "./components/layout/WorkbenchLayout.tsx";
import { ThreadPane } from "./components/threads/ThreadPane.tsx";
import { ToolPanel } from "./components/tools/ToolPanel.tsx";
import { TranscriptPane } from "./components/transcript/TranscriptPane.tsx";
import { useWorkbench } from "./workbench/use-workbench.ts";

export function App() {
  const { state, events, loading, error, commands } = useWorkbench();
  const activeThread = selectActiveThread(state);
  return (
    <WorkbenchLayout
      header={
        <>
          <div>
            <strong>
              {state.agent.info?.runtime?.title ?? state.agent.info?.title ?? "Pe Workbench"}
            </strong>
            <span className="muted">
              {state.agent.info?.runtime?.description ?? "React contract probe"}
            </span>
          </div>
          <div className="topbar-status">
            {loading ? <span className="status-pill loading">loading</span> : null}
            {error ? <span className="status-pill error">{error}</span> : null}
            <span className="status-pill">{selectOverallRunStatus(state)}</span>
            <span>{selectCurrentModelLabel(state) ?? "model: default"}</span>
            <span>{selectCurrentModeLabel(state) ?? "mode: default"}</span>
            <span>{activeThread?.title ?? activeThread?.threadId ?? "no thread"}</span>
          </div>
        </>
      }
      left={<ThreadPane state={state} commands={commands} />}
      center={
        <div className="center-stack">
          <ApprovalDock state={state} commands={commands} />
          <TranscriptPane state={state} />
          <Composer state={state} commands={commands} />
        </div>
      }
      right={
        <div className="right-stack">
          <ToolPanel state={state} />
          <InspectorPanel state={state} events={events} commands={commands} />
        </div>
      }
    />
  );
}
