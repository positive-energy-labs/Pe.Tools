import { applyWorkbenchEvent, createWorkbenchState } from "@pe/agent-projection";
import type { WorkbenchEvent, WorkbenchState } from "@pe/agent-contracts";
import { createBrowserWorkbenchClient, type BrowserWorkbenchClient } from "@pe/workbench-transport";
import { useEffect, useMemo, useState } from "react";

export interface WorkbenchCommands {
  start(): Promise<void>;
  send(text: string): Promise<void>;
  refreshThreads(): Promise<void>;
  loadThread(threadId: string): Promise<void>;
  resolveApproval(requestId: string, optionId?: string): Promise<void>;
  cancel(): Promise<void>;
  setModel(modelId: string): Promise<void>;
  setMode(modeId: string): Promise<void>;
}

export interface WorkbenchViewModel {
  state: WorkbenchState;
  events: WorkbenchEvent[];
  loading: boolean;
  error?: string;
  commands: WorkbenchCommands;
}

const eventLogLimit = 500;

export function useWorkbench(): WorkbenchViewModel {
  const client = useMemo(() => createBrowserWorkbenchClient({ baseUrl: resolveApiBaseUrl() }), []);
  const [state, setState] = useState<WorkbenchState>(() => createWorkbenchState());
  const [events, setEvents] = useState<WorkbenchEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let canceled = false;
    void (async () => {
      try {
        const snapshot = await client.getState();
        if (canceled) return;
        setState(snapshot);

        if (!snapshot.agent.session) {
          const started = await client.start();
          if (canceled) return;
          setState(started);
        }

        setLoading(false);
      } catch (reason: unknown) {
        if (canceled) return;
        setError(errorMessage(reason));
        setLoading(false);
      }
    })();

    const unsubscribe = client.subscribe((event) => {
      setState((current) => applyWorkbenchEvent(current, event));
      setEvents((current) => [event, ...current].slice(0, eventLogLimit));
    });

    return () => {
      canceled = true;
      unsubscribe();
    };
  }, [client]);

  const commands = useMemo(() => createCommands(client, setState, setError), [client]);
  return { state, events, loading, error, commands };
}

function createCommands(
  client: BrowserWorkbenchClient,
  setState: (updater: WorkbenchState | ((state: WorkbenchState) => WorkbenchState)) => void,
  setError: (message: string | undefined) => void,
): WorkbenchCommands {
  const run = async (action: () => Promise<WorkbenchState>) => {
    setError(undefined);
    try {
      setState(await action());
    } catch (reason: unknown) {
      setError(errorMessage(reason));
    }
  };

  return {
    start: () => run(() => client.start()),
    send: (text) => run(() => client.send(text)),
    refreshThreads: () => run(() => client.refreshThreads()),
    loadThread: (threadId) => run(() => client.loadThread(threadId)),
    resolveApproval: (requestId, optionId) =>
      run(() => client.resolveApproval(requestId, optionId)),
    cancel: () => run(() => client.cancel()),
    setModel: (modelId) => run(() => client.setModel(modelId)),
    setMode: (modeId) => run(() => client.setMode(modeId)),
  };
}

function resolveApiBaseUrl(): string {
  const params = new URLSearchParams(window.location.search);
  return params.get("api") ?? import.meta.env.VITE_PE_WORKBENCH_API_URL ?? "";
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}
