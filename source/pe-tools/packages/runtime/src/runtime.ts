import type { Harness } from "@mastra/core/harness";
import type { RuntimeAuthProfile } from "./auth/types.ts";
import type { RuntimeContextEntry } from "./context.ts";
import type { RuntimeEvent, RuntimeJsonValue, RuntimeProtocol } from "./events.ts";
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
  lock?: RuntimeThreadLockInfo;
  metadata?: Record<string, unknown>;
}

export interface RuntimeThreadLockInfo {
  status: "unlocked" | "owned" | "locked" | "unknown";
  ownerPid?: number;
}

export interface RuntimeThreadMessage {
  id: string;
  role: "user" | "assistant" | "system" | "tool" | "signal";
  type?: string;
  text: string;
  createdAt?: string;
}

export type RuntimeKernelSessionStatus = "draft" | "materialized";
export type RuntimeAccessLevel = "read-only" | "ask" | "trusted";

export interface RuntimeSessionControls {
  currentModelId?: string;
  accessLevel: RuntimeAccessLevel;
}

export type RuntimeQueueDecision = "queued_follow_up" | "sent_immediately";

export interface RuntimeKernelSession {
  sessionId: string;
  status: RuntimeKernelSessionStatus;
  title?: string;
  protocol?: RuntimeProtocol;
  externalThreadId?: string;
  threadId?: string;
  resourceId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RuntimeCreateDraftSessionOptions {
  title?: string;
  protocol?: RuntimeProtocol;
  externalThreadId?: string;
}

export interface RuntimeResumeThreadSessionOptions {
  sessionId: string;
  threadId: string;
  resourceId?: string;
  title?: string;
  protocol?: RuntimeProtocol;
  externalThreadId?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface RuntimeForkSessionOptions {
  sourceThreadId: string;
  resourceId?: string;
  title?: string;
}

export interface RuntimeLedgerBaseEntry {
  sequence: number;
  createdAt: string;
  threadId?: string;
  resourceId?: string;
}

export type RuntimeLedgerEntry =
  | (RuntimeLedgerBaseEntry & {
      type: "session_identity";
      sessionId: string;
      status: RuntimeKernelSessionStatus;
      title?: string;
      protocol?: RuntimeProtocol;
      externalThreadId?: string;
      provenance: {
        source: "kernel";
      };
    })
  | (RuntimeLedgerBaseEntry & {
      type: "raw_mastra_event";
      rawEventType?: string;
      rawEvent: RuntimeJsonValue;
    })
  | (RuntimeLedgerBaseEntry & {
      type: "runtime_event";
      event: RuntimeEvent;
      provenance: {
        source: "mastra";
        rawEventSequence?: number;
        rawEventType?: string;
      };
    })
  | (RuntimeLedgerBaseEntry & {
      type: "thread_message";
      message: RuntimeThreadMessage;
      provenance: {
        source: "memory";
      };
    })
  | (RuntimeLedgerBaseEntry & {
      type: "user_prompt";
      content: string;
      protocol?: RuntimeProtocol;
      protocolSessionId?: string;
      provenance: {
        source: "kernel";
      };
    })
  | (RuntimeLedgerBaseEntry & {
      type: "queue_event";
      decision: RuntimeQueueDecision;
      content: string;
      protocol?: RuntimeProtocol;
      protocolSessionId?: string;
      provenance: {
        source: "kernel";
      };
    })
  | (RuntimeLedgerBaseEntry & {
      type: "protocol_event";
      protocol: RuntimeProtocol;
      payload: RuntimeJsonValue;
      projection?: {
        id?: string;
        sourceSequence?: number;
      };
      provenance: {
        source: "projection";
      };
    });

export interface RuntimeSendMessageOptions {
  content: string;
  context?: RuntimeContextEntry[];
  resumeDecisions?: RuntimeResumeDecision[];
  protocol?: RuntimeProtocol;
  protocolSessionId?: string;
  resourceId?: string;
  threadId?: string;
}

export interface RuntimeQueueMessageResult {
  queued: boolean;
}

export interface RuntimeQueueSessionMessageResult extends RuntimeQueueMessageResult {
  session: RuntimeKernelSession;
}

export interface RuntimeReadThreadRequest {
  threadId: string;
  resourceId?: string;
}

export interface RuntimeRecordProtocolEventRequest {
  threadId?: string;
  resourceId?: string;
  protocol: RuntimeProtocol;
  payload: unknown;
  projection?: {
    id?: string;
    sourceSequence?: number;
  };
}

export interface RuntimeKernel {
  initialize(): Promise<void>;
  createDraftSession(options?: RuntimeCreateDraftSessionOptions): RuntimeKernelSession;
  readSession(sessionId: string): RuntimeKernelSession | undefined;
  readThreadSession(options: { threadId: string }): RuntimeKernelSession | undefined;
  listSessions(): RuntimeKernelSession[];
  materializeSession(
    sessionId: string,
    options?: { title?: string },
  ): Promise<RuntimeKernelSession>;
  forkSession(sessionId: string, options: RuntimeForkSessionOptions): Promise<RuntimeKernelSession>;
  resumeThreadSession(options: RuntimeResumeThreadSessionOptions): Promise<RuntimeKernelSession>;
  cancelSession(sessionId: string): void;
  closeSession(sessionId: string): Promise<void>;
  sendSessionMessage(
    sessionId: string,
    options: RuntimeSendMessageOptions,
  ): Promise<RuntimeKernelSession>;
  queueSessionMessage(
    sessionId: string,
    options: RuntimeSendMessageOptions,
  ): Promise<RuntimeQueueSessionMessageResult>;
  createThreadSession(options?: { title?: string }): Promise<RuntimeThreadSession>;
  cloneThreadSession(options: RuntimeForkSessionOptions): Promise<RuntimeThreadSession>;
  switchThread(options: { threadId: string }): Promise<void>;
  listThreadSessions(): Promise<RuntimeThreadInfo[]>;
  readThreadMessages(options: RuntimeReadThreadRequest): Promise<RuntimeThreadMessage[]>;
  readThreadLedger(options: RuntimeReadThreadRequest): Promise<RuntimeLedgerEntry[]>;
  readSessionMessages(sessionId: string): Promise<RuntimeThreadMessage[]>;
  readSessionLedger(sessionId: string): Promise<RuntimeLedgerEntry[]>;
  deleteThreadSession(options: { threadId: string }): Promise<void>;
  getResourceId(): string;
  readControls(): RuntimeSessionControls;
  setModel(options: { modelId: string }): Promise<RuntimeSessionControls>;
  setAccessLevel(options: { accessLevel: RuntimeAccessLevel }): Promise<RuntimeSessionControls>;
  recordUserPrompt(options: RuntimeSendMessageOptions): RuntimeLedgerEntry;
  recordProtocolEvent(options: RuntimeRecordProtocolEventRequest): RuntimeLedgerEntry;
  recordSessionProtocolEvent(
    sessionId: string,
    options: Pick<RuntimeRecordProtocolEventRequest, "protocol" | "payload" | "projection">,
  ): RuntimeLedgerEntry;
  snapshotSessionLedger(sessionId: string): RuntimeLedgerEntry[];
  snapshotLedger(options?: { threadId?: string; resourceId?: string }): RuntimeLedgerEntry[];
  flushLedger(): Promise<void>;
  sendMessage(options: RuntimeSendMessageOptions): Promise<void>;
  queueMessage(options: RuntimeSendMessageOptions): Promise<RuntimeQueueMessageResult>;
  abort(): void;
  subscribe(listener: (event: RuntimeEvent) => void | Promise<void>): () => void;
}

export interface RuntimeSessions {
  createThreadSession(options?: { title?: string }): Promise<RuntimeThreadSession>;
  switchThread(options: { threadId: string }): Promise<void>;
  listThreadSessions?(): Promise<RuntimeThreadInfo[]>;
  readThreadMessages?(options: RuntimeReadThreadRequest): Promise<RuntimeThreadMessage[]>;
  readThreadLedger?(options: RuntimeReadThreadRequest): Promise<RuntimeLedgerEntry[]>;
  deleteThreadSession?(options: { threadId: string }): Promise<void>;
  getResourceId?(): string;
  recordUserPrompt?(options: RuntimeSendMessageOptions): RuntimeLedgerEntry;
  recordProtocolEvent?(options: RuntimeRecordProtocolEventRequest): RuntimeLedgerEntry;
  snapshotLedger?(options?: { threadId?: string; resourceId?: string }): RuntimeLedgerEntry[];
  sendMessage(options: RuntimeSendMessageOptions): Promise<void>;
  queueMessage?(options: RuntimeSendMessageOptions): Promise<RuntimeQueueMessageResult>;
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
  kernel?: RuntimeKernel;
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
  if (enabled !== true) return;

  const selection = await openMostRecentUnlockedRuntimeThread(
    handle.harness as Harness<Record<string, unknown>>,
    { createTitle: policy?.createTitle ?? "New thread" },
  );
  await policy?.onThreadOpened?.({ request, handle, selection });
}
