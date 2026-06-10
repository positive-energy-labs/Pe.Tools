import type { Harness } from "@mastra/core/harness";
import type { RuntimeAuthProfile } from "./auth/types.ts";
import type { RuntimeContextEntry } from "./context.ts";
import type { RuntimeEvent, RuntimeProtocol } from "./events.ts";
import type { RuntimeResumeDecision } from "./interrupts.ts";

export interface RuntimeThreadSession {
  threadId: string;
  resourceId: string;
}

export interface RuntimeSendMessageOptions {
  content: string;
  context?: RuntimeContextEntry[];
  resumeDecisions?: RuntimeResumeDecision[];
  protocol?: RuntimeProtocol;
  protocolSessionId?: string;
}

export interface RuntimeSessions {
  createThreadSession(options?: { title?: string }): Promise<RuntimeThreadSession>;
  switchThread(options: { threadId: string }): Promise<void>;
  sendMessage(options: RuntimeSendMessageOptions): Promise<void>;
  abort(): void;
  subscribe(listener: (event: RuntimeEvent) => void | Promise<void>): () => void;
}

export interface RuntimeWorkspaceInfo {
  cwd?: string;
  root?: string;
  [key: string]: unknown;
}

export interface RuntimeDescriptor {
  id: string;
  modeName: string;
  agentName: string;
  title: string;
  description: string;
}

export function createRuntimeDescriptor(
  id: string,
  overrides: Partial<Omit<RuntimeDescriptor, "id">> = {},
): RuntimeDescriptor {
  const title = overrides.title ?? id;
  return {
    id,
    modeName: overrides.modeName ?? title,
    agentName: overrides.agentName ?? title,
    title,
    description: overrides.description ?? `${title} runtime`,
  };
}

export interface RuntimeHandle<TState extends Record<string, unknown> = Record<string, unknown>> {
  harness: Harness<TState>;
  sessions: RuntimeSessions;
  workspace?: RuntimeWorkspaceInfo;
  auth?: RuntimeAuthProfile;
  authStorage?: unknown;
  hookManager?: unknown;
  mcpManager?: unknown;
  metadata?: Record<string, unknown>;
  close?: () => Promise<void> | void;
}

export interface RuntimeCreateRequest {
  protocol: RuntimeProtocol;
  cwd?: string;
  workspaceRoot?: string;
  additionalDirectories?: string[];
  metadata?: Record<string, unknown>;
}

export interface RuntimeFactory<TState extends Record<string, unknown> = Record<string, unknown>> {
  descriptor: RuntimeDescriptor;
  auth?: RuntimeAuthProfile;
  create(request: RuntimeCreateRequest): Promise<RuntimeHandle<TState>>;
}

export function createRuntimeFactory<TState extends Record<string, unknown>>(
  descriptor: RuntimeDescriptor,
  create: (request: RuntimeCreateRequest) => Promise<RuntimeHandle<TState>>,
  auth?: RuntimeAuthProfile,
): RuntimeFactory<TState> {
  return { descriptor, auth, create };
}
