import { selectWorkbenchChrome } from "@pe/agent-projection";
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
  const chrome = selectWorkbenchChrome(state);

  return (
    <WorkbenchLayout
      header={
        <>
          <div className="brand-lockup">
            <div className="brand-mark">pea</div>
            <div>
              <strong>{chrome.title}</strong>
              <span className="muted">{chrome.subtitle}</span>
            </div>
          </div>
          <div className="topbar-status">
            {loading ? <span className="status-pill loading">loading</span> : null}
            {error ? <span className="status-pill error">{error}</span> : null}
            <span className={`status-pill ${chrome.status}`}>{chrome.status}</span>
            <span>{chrome.modelLabel}</span>
            <span>{chrome.modeLabel}</span>
            <span>{chrome.threadLabel}</span>
          </div>
        </>
      }
      left={<ThreadPane state={state} commands={commands} />}
      center={
        <div className="center-stack">
          <ApprovalDock state={state} commands={commands} />
          <TranscriptPane state={state} chrome={chrome} />
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
