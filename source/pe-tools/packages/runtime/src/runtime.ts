import type { Harness } from "@mastra/core/harness";
import type { RuntimeAuthProfile } from "./auth/types.ts";
import type { RuntimeContextEntry } from "./context.ts";
import type { RuntimeEvent, RuntimeProtocol } from "./events.ts";
import {
  openMostRecentUnlockedRuntimeThread,
  type RuntimeStartupThreadSelection,
} from "./harness/thread-selection.ts";
import type { RuntimeResumeDecision } from "./interrupts.ts";

export interface RuntimeThreadSession {
  threadId: string;
  resourceId: string;
}

export interface RuntimeThreadInfo extends RuntimeThreadSession {
  title?: string;
  createdAt?: string;
  updatedAt?: string;
  metadata?: Record<string, unknown>;
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
  listThreadSessions?(): Promise<RuntimeThreadInfo[]>;
  deleteThreadSession?(options: { threadId: string }): Promise<void>;
  getResourceId?(): string;
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

export interface RuntimeStartupThreadPolicy<TState extends Record<string, unknown>> {
  createTitle?: string;
  enabled?: boolean | ((request: RuntimeCreateRequest) => boolean);
  onThreadOpened?: (context: {
    request: RuntimeCreateRequest;
    handle: RuntimeHandle<TState>;
    selection: RuntimeStartupThreadSelection;
  }) => Promise<void> | void;
}

export interface RuntimeFactoryOptions<TState extends Record<string, unknown>> {
  auth?: RuntimeAuthProfile;
  startupThread?: false | RuntimeStartupThreadPolicy<TState>;
}

export interface RuntimeFactory<TState extends Record<string, unknown> = Record<string, unknown>> {
  descriptor: RuntimeDescriptor;
  auth?: RuntimeAuthProfile;
  create(request: RuntimeCreateRequest): Promise<RuntimeHandle<TState>>;
}

export function createRuntimeFactory<TState extends Record<string, unknown>>(
  descriptor: RuntimeDescriptor,
  create: (request: RuntimeCreateRequest) => Promise<RuntimeHandle<TState>>,
  authOrOptions?: RuntimeAuthProfile | RuntimeFactoryOptions<TState>,
): RuntimeFactory<TState> {
  const options = resolveRuntimeFactoryOptions(authOrOptions);
  return {
    descriptor,
    auth: options.auth,
    create: async (request) => {
      const handle = await create(request);
      await applyRuntimeStartupThreadPolicy(handle, request, options.startupThread);
      return handle;
    },
  };
}

function resolveRuntimeFactoryOptions<TState extends Record<string, unknown>>(
  authOrOptions: RuntimeAuthProfile | RuntimeFactoryOptions<TState> | undefined,
): RuntimeFactoryOptions<TState> {
  if (!authOrOptions) return {};
  if ("descriptor" in authOrOptions) return { auth: authOrOptions };
  return authOrOptions;
}

async function applyRuntimeStartupThreadPolicy<TState extends Record<string, unknown>>(
  handle: RuntimeHandle<TState>,
  request: RuntimeCreateRequest,
  policy: RuntimeFactoryOptions<TState>["startupThread"],
): Promise<void> {
  if (policy === false) return;

  const enabled = typeof policy?.enabled === "function" ? policy.enabled(request) : policy?.enabled;
  if (!(enabled ?? request.protocol === "tui")) return;

  const selection = await openMostRecentUnlockedRuntimeThread(
    handle.harness as Harness<Record<string, unknown>>,
    { createTitle: policy?.createTitle ?? "New thread" },
  );
  await policy?.onThreadOpened?.({ request, handle, selection });
}
