import type { Harness, HarnessConfig, Session } from "@mastra/core/harness";
import type { RuntimeAuthProfile } from "./auth/types.ts";
import type { RuntimeProtocol } from "./events.ts";

export interface RuntimeThreadSession {
  threadId: string;
  resourceId: string;
}

export interface RuntimeThreadInfo extends RuntimeThreadSession {
  title?: string;
  cwd?: string;
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
  parts?: RuntimeThreadMessagePart[];
  createdAt?: string;
  rawContent?: unknown;
}

export type RuntimeThreadMessagePart =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  | { type: "tool-call"; toolCallId: string; toolName: string; args?: unknown }
  | {
      type: "tool-result";
      toolCallId: string;
      toolName?: string;
      result?: unknown;
      isError?: boolean;
    }
  | { type: "om-status"; data: unknown }
  | { type: "raw"; raw: unknown };

export type RuntimeAccessLevel = "read-only" | "ask" | "trusted";

export interface RuntimeWorkspaceInfo {
  cwd?: string;
  root?: string;
  [key: string]: unknown;
}

export interface RuntimeHandleServices {
  authStorage?: unknown;
  hookManager?: unknown;
  mcpManager?: unknown;
}

export type RuntimeHandleHarness<_TState extends Record<string, unknown>> = object;

export interface RuntimeHandle<
  TState extends Record<string, unknown> = Record<string, unknown>,
  TServices extends RuntimeHandleServices = RuntimeHandleServices,
  THarness extends RuntimeHandleHarness<TState> = Harness<TState>,
> {
  harness: THarness;
  session?: Session<TState>;
  /** The harness's configured memory, surfaced so transports can do partial thread
   *  clones (forking) that still remap observational memory. */
  memory?: HarnessConfig<TState>["memory"];
  workspace?: RuntimeWorkspaceInfo;
  auth?: RuntimeAuthProfile;
  authStorage?: TServices["authStorage"];
  hookManager?: TServices["hookManager"];
  mcpManager?: TServices["mcpManager"];
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
