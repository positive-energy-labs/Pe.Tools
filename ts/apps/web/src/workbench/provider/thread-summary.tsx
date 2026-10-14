import { createContext } from "react";
import type {
  DocumentRequest,
  HarnessThreadSummary,
  PeaSessionDescriptor,
  UpdateThreadRequest,
} from "@pe/agent-contracts";
import { type WorkbenchEndpointConfig } from "../config";
import { type ChatState, type ThreadBody } from "../chat-state";
import { type ChatPageStore } from "../store";
import type * as Atom from "effect/unstable/reactivity/Atom";
import type * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import type { HeadDraft, ProvidersState } from "./providers";
import type { PromptRequest } from "./harness-client";

export type StoredThreadSummary = HarnessThreadSummary;

export interface WorkbenchContextValue {
  store: ChatPageStore;
  config: WorkbenchEndpointConfig;
  chat: ChatState;
  /** The selected thread body; only the transcript reads it with Suspense. */
  bodyAtom: Atom.Atom<AsyncResult.AsyncResult<ThreadBody, Error>>;
  loading: boolean;
  error?: string;
  threads: StoredThreadSummary[];
  providers: ProvidersState;
  /** The head a thread binds at first send; read only while no thread is open. */
  draft: HeadDraft;
  setDraft: (draft: HeadDraft) => void;
  draftTarget: DocumentRequest | null;
  setDraftTarget: (target: DocumentRequest | null) => void;
  /** Why a send cannot go now (none ready, the pick or the bound provider not ready); else undefined. */
  sendRefusal?: string;
  /** The URL's thread is one the host does not know (404). */
  missingThread: boolean;
  /** Empty until a thread exists: the first send or a "new" creates one. */
  currentThreadId: string;
  turn?: number;
  prompt?: string;
  /** The last turn's error, until the next prompt. */
  turnFailure?: string;
  revit?: boolean;
  world?: PeaSessionDescriptor;
  isRunning: boolean;
  operationError?: string;
  sendPrompt: (input: PromptRequest) => Promise<void>;
  cancel: () => Promise<void>;
  /** Opens an empty draft; the thread is created at its first send. */
  newThread: (target?: DocumentRequest | null) => Promise<void>;
  updateThread: (threadId: string, change: UpdateThreadRequest) => Promise<boolean>;
  openThread: (threadId: string) => void;
  renameThread: (threadId: string, title: string) => Promise<void>;
  deleteThread: (threadId: string) => Promise<boolean>;
  patchThreadView: (partial: { turn?: number }, replace?: boolean) => Promise<void>;
  resolveApproval: (requestId: string, optionId: string) => Promise<void>;
  answerQuestion: (
    requestId: string,
    action: "accept" | "decline",
    content?: Record<string, unknown>,
  ) => Promise<void>;
  /** Forks `threadId` (default: the current thread) onto `providerId` (default: its own), opens it. */
  forkThread: (providerId?: string, threadId?: string) => Promise<void>;
  setModel: (modelId: string) => Promise<void>;
  setTrait: (id: string, value: string | boolean) => Promise<void>;
}

export const WorkbenchContext = createContext<WorkbenchContextValue | undefined>(undefined);
