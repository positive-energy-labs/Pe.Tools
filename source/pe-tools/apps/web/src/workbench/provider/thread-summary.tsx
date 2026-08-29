import { createContext } from "react";
import { MastraClient, type PlanResume } from "@mastra/client-js";
import type { PeaWorldDescriptor } from "@pe/agent-contracts";
import { type WorkbenchEndpointConfig } from "../config";
import { type AccessLevel, type ChatState } from "../chat-state";
import { type ChatPageStore, type WorkbenchAttachment } from "../store";

export type { WorkbenchAttachment } from "../store";

export interface StoredThreadSummary {
  id: string;
  title: string;
  updatedAt: string;
}

export type ToolResume = string | string[] | PlanResume;

export type MessageFile = { data: string; mediaType: string; filename?: string };

export const MESSAGE_LIMIT = 200;

export type SessionClient = ReturnType<ReturnType<MastraClient["getAgentController"]>["session"]>;

export interface WorkbenchContextValue {
  store: ChatPageStore;
  config: WorkbenchEndpointConfig;
  chat: ChatState;
  loading: boolean;
  error?: string;
  threads: StoredThreadSummary[];
  currentThreadId: string;
  revit?: boolean;
  world?: PeaWorldDescriptor;
  isRunning: boolean;
  operationError?: string;
  sendPrompt: (text: string, attachments?: WorkbenchAttachment[]) => Promise<void>;
  cancel: () => void;
  newThread: () => void;
  forkThread: () => Promise<void>;
  openThread: (threadId: string) => void;
  deleteThread: (threadId: string) => Promise<void>;
  resolveApproval: (toolCallId: string, optionId?: string) => Promise<void>;
  setModel: (modelId: string) => Promise<void>;
  setAccessLevel: (accessLevel: AccessLevel) => Promise<void>;
}

export const WorkbenchContext = createContext<WorkbenchContextValue | undefined>(undefined);
