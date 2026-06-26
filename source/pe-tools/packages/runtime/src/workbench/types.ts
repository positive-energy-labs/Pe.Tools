import type { AvailableModel, Session } from "@mastra/core/harness";
import type { ContextBreakdownSkill, ContextBreakdownTool } from "../context-breakdown.ts";
import type { RuntimeWorkspaceInfo } from "../runtime.ts";

export type RuntimeWorkbenchSession = Session<any>;

export interface RuntimeWorkbenchHarness {
  listAvailableModels(): Promise<AvailableModel[]>;
  listModes(): Array<{ id: string; name: string }>;
}

/** Minimal slice of `@mastra/memory` needed to fork while preserving OM records. */
export interface RuntimeWorkbenchMemory {
  cloneThread(args: {
    sourceThreadId: string;
    resourceId?: string;
    title?: string;
    options?: { messageFilter?: { endDate?: Date; messageIds?: string[] } };
  }): Promise<{ thread: { id: string } }>;
}

export interface RuntimeWorkbenchHandle {
  harness: RuntimeWorkbenchHarness;
  session?: RuntimeWorkbenchSession;
  memory?: RuntimeWorkbenchMemory;
  workspace?: RuntimeWorkspaceInfo;
  metadata?: Record<string, unknown>;
  close?: () => Promise<void> | void;
}

export interface NativeBreakdownMeta {
  tools: ContextBreakdownTool[];
  systemPromptText?: string;
  skills: ContextBreakdownSkill[];
}

export interface WorkbenchContext {
  label: string;
  title: string;
  runtime: RuntimeWorkbenchHandle;
  session: RuntimeWorkbenchSession;
  /** Cached native breakdown inputs (tools+schemas, system prompt), keyed by mode. */
  nativeMeta?: { modeId?: string; promise: Promise<NativeBreakdownMeta | undefined> };
}

export interface WorkbenchRunAttachment {
  data: string;
  mediaType: string;
  filename?: string;
}

export interface WorkbenchRunRequest {
  threadId: string;
  text: string;
  attachments?: WorkbenchRunAttachment[];
  clientId?: string;
  signal?: AbortSignal;
  emit(payload: unknown): Promise<void> | void;
}

export type WorkbenchAccessLevel = "read-only" | "ask" | "trusted";

export interface WorkbenchStateOptions {
  skipOMRefresh?: boolean;
}
