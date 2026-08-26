import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useAtomValue } from "@effect/atom-react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import type { WorkbenchAccessLevel, WorkbenchState } from "@pe/agent-contracts";

import { appAtomRegistry } from "#/state/registry";
import { useRouteStore } from "#/state/use-route-store";
import { useThreadClaim } from "./claims";
import { resolveWorkbenchConfig, type WorkbenchEndpointConfig } from "./config";
import {
  createChatStore,
  createLiveChatApi,
  type ChatStore,
  type StoredThreadSummary,
  type WorkbenchAttachment,
} from "./store";

export type { StoredThreadSummary, WorkbenchAttachment } from "./store";

interface WorkbenchContextValue {
  store: ChatStore;
  config: WorkbenchEndpointConfig;
  debug: { state: WorkbenchState; loading: boolean; error?: string };
  threads: StoredThreadSummary[];
  currentThreadId: string;
  isRunning: boolean;
  operationError?: string;
  readOnly: boolean;
  takeOverThread: () => void;
  sendPrompt: (text: string, attachments?: WorkbenchAttachment[]) => Promise<void>;
  cancel: () => void;
  newThread: () => void;
  switchThread: (threadId: string) => void;
  deleteThread: (threadId: string) => Promise<void>;
  resolveApproval: (requestId: string, optionId?: string) => Promise<void>;
  setModel: (modelId: string) => Promise<void>;
  setAccessLevel: (accessLevel: WorkbenchAccessLevel) => Promise<void>;
  forkThread: (messageId?: string) => Promise<void>;
  refreshProjection: () => void;
}

const WorkbenchContext = createContext<WorkbenchContextValue | undefined>(undefined);

interface ChatRouteSearch {
  thread?: string;
  mode: string;
  turn?: number;
  plugin?: "family" | "families" | "settings" | "parameter-links" | "schedule-grid";
  target?: string;
  prompt?: string;
}

export function WorkbenchProvider({ children }: { children: ReactNode }) {
  const search = useSearch({ from: "/chat" });
  return (
    <WorkbenchStoreOwner key={search.thread} search={search}>
      {children}
    </WorkbenchStoreOwner>
  );
}

function WorkbenchStoreOwner({
  children,
  search,
}: {
  children: ReactNode;
  search: ChatRouteSearch;
}) {
  const config = useMemo(resolveWorkbenchConfig, []);
  const api = useMemo(() => createLiveChatApi(config), [config]);
  const navigate = useNavigate({ from: "/chat" });
  const currentThreadId = search.thread ?? "";
  const claim = useThreadClaim(currentThreadId || "draft");
  const store = useRouteStore(() =>
    createChatStore({
      registry: appAtomRegistry,
      api,
      search: {
        ...search,
        patch: (partial, replace = false) =>
          void navigate({ search: (previous) => ({ ...previous, ...partial }), replace }),
      },
    }),
  );
  const state = useAtomValue(store.atoms.state);
  const threads: StoredThreadSummary[] = state.threads.items.map((thread) => ({
    id: thread.threadId,
    title:
      thread.title?.trim() ||
      (thread.threadId.length <= 12 ? thread.threadId : `${thread.threadId.slice(0, 8)}...`),
    updatedAt: thread.updatedAt ?? new Date(0).toISOString(),
    messageCount: 0,
    persisted: true,
    cwd: thread.cwd,
  }));
  const loading = useAtomValue(store.atoms.loading);
  const sliceError = useAtomValue(store.atoms.sliceError);
  const failure = useAtomValue(store.atoms.failure);
  const status = state.uiStatus.overall.status;
  const isRunning = status === "running" || status === "waiting";
  const operationError = failure?.message ?? sliceError ?? state.uiStatus.errors[0];
  const context = useMemo<WorkbenchContextValue>(() => ({
    store,
    config,
    debug: { state, loading, error: sliceError },
    threads,
    currentThreadId,
    isRunning,
    operationError,
    readOnly: Boolean(currentThreadId) && !claim.isOwner,
    takeOverThread: claim.takeOver,
    sendPrompt: (text, attachments) => store.actions.send(text, attachments),
    cancel: () => void store.actions.cancel().catch(() => undefined),
    newThread: () => void store.actions.newThread().catch(() => undefined),
    switchThread: store.actions.switchThread,
    deleteThread: store.actions.deleteThread,
    resolveApproval: store.actions.resolveApproval,
    setModel: store.actions.setModel,
    setAccessLevel: store.actions.setAccessLevel,
    forkThread: async () => { await store.actions.cloneThread(); },
    refreshProjection: () => void store.actions.refresh(),
  }), [store, config, state, loading, sliceError, threads, currentThreadId, isRunning, operationError, claim.isOwner, claim.takeOver]);

  return <WorkbenchContext.Provider value={context}>{children}</WorkbenchContext.Provider>;
}

export function useWorkbench(): WorkbenchContextValue {
  const context = useContext(WorkbenchContext);
  if (!context) throw new Error("useWorkbench must be used inside WorkbenchProvider.");
  return context;
}
