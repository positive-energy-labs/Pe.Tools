import { createContext } from "react";
import type {
  HarnessId,
  HarnessInfo,
  HarnessThreadSummary,
  PeaSessionDescriptor,
} from "@pe/agent-contracts";
import { type WorkbenchEndpointConfig } from "../config";
import { type ChatState, type ThreadBody } from "../chat-state";
import { type ChatPageStore } from "../store";
import { type WorkbenchAttachment } from "../prompt";
import type * as Atom from "effect/unstable/reactivity/Atom";
import type * as AsyncResult from "effect/unstable/reactivity/AsyncResult";

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
  harnesses: HarnessInfo[];
  /** Why "new" cannot run now (harnesses loading, none installed); undefined when it can. */
  newRefusal?: string;
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
  sendPrompt: (text: string, attachments?: WorkbenchAttachment[]) => Promise<void>;
  cancel: () => Promise<void>;
  newThread: (harness?: HarnessId) => Promise<void>;
  openThread: (threadId: string) => void;
  renameThread: (threadId: string, title: string) => Promise<void>;
  deleteThread: (threadId: string) => Promise<boolean>;
  patchThreadView: (partial: { turn?: number }, replace?: boolean) => Promise<void>;
  resolveApproval: (requestId: string, optionId: string) => Promise<void>;
  setModel: (modelId: string) => Promise<void>;
  setMode: (modeId: string) => Promise<void>;
}

export const WorkbenchContext = createContext<WorkbenchContextValue | undefined>(undefined);
