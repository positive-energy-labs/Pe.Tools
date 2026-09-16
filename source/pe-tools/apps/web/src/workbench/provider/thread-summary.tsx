import { createContext } from "react";
import { MastraClient, type PlanResume } from "@mastra/client-js";
import type { PeaSessionDescriptor } from "@pe/agent-contracts";
import { type WorkbenchEndpointConfig } from "../config";
import { type AccessLevel, type ChatState } from "../chat-state";
import { type ChatPageStore } from "../store";
import { type WorkbenchAttachment } from "../prompt";

export type { WorkbenchAttachment } from "../prompt";

export interface StoredThreadSummary {
  id: string;
  title: string;
  updatedAt: string;
}

export type ToolResume = string | string[] | PlanResume;

export type MessageFile = { data: string; mediaType: string; filename?: string };

export type SessionClient = ReturnType<ReturnType<MastraClient["getAgentController"]>["session"]>;

export interface WorkbenchContextValue {
  store: ChatPageStore;
  config: WorkbenchEndpointConfig;
  /**
   * The live session client, or undefined until the host answers. The chat MANIFEST's two actions
   * refuse without it, and the provider never handed it out — so `chat/manifest.ts`'s `send` and
   * `cancel` were unreachable from the route shell, refusing "Session is not ready" forever while
   * the composer's own copy of the same two actions ran. One session, one owner.
   */
  session?: SessionClient;
  chat: ChatState;
  loading: boolean;
  error?: string;
  threads: StoredThreadSummary[];
  currentThreadId: string;
  prompt?: string;
  revit?: boolean;
  world?: PeaSessionDescriptor;
  isRunning: boolean;
  operationError?: string;
  sendPrompt: (text: string, attachments?: WorkbenchAttachment[]) => Promise<void>;
  cancel: () => void;
  newThread: () => void;
  forkThread: () => Promise<void>;
  openThread: (threadId: string) => void;
  renameThread: (threadId: string, title: string) => void | Promise<void>;
  deleteThread: (threadId: string) => Promise<void>;
  resolveApproval: (toolCallId: string, response?: ToolResume) => Promise<void>;
  setModel: (modelId: string) => Promise<void>;
  /** Store a provider API key in the host's auth.json and refresh the model choices. */
  addApiKey: (provider: string, apiKey: string) => Promise<void>;
  setAccessLevel: (accessLevel: AccessLevel) => Promise<void>;
}

export const WorkbenchContext = createContext<WorkbenchContextValue | undefined>(undefined);
