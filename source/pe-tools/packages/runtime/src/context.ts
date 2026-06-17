import {
  MASTRA_RESOURCE_ID_KEY,
  MASTRA_THREAD_ID_KEY,
  RequestContext,
} from "@mastra/core/request-context";
import type { RuntimeProtocol } from "./events.ts";
import type { RuntimeResumeDecision } from "./interrupts.ts";

export interface RuntimeContextEntry {
  value: string;
  description: string;
}

export interface RuntimeContextInjection {
  protocol: RuntimeProtocol;
  protocolSessionId?: string;
  threadId?: string;
  resourceId: string;
  entries?: RuntimeContextEntry[];
  promptFragments?: string[];
  resumeDecisions?: RuntimeResumeDecision[];
}

export interface RuntimeThreadSettingsContext {
  setThreadSetting: (options: { key: string; value: unknown }) => Promise<void> | void;
}

const runtimeContextPromptKey = "runtime.contextPrompt";
const runtimeContextEntriesKey = "runtime.contextEntries";
const runtimeProtocolKey = "runtime.protocol";
const runtimeProtocolSessionIdKey = "runtime.protocolSessionId";
const runtimeResumeDecisionsKey = "runtime.resumeDecisions";
const runtimeThreadSettingsKey = "runtime.threadSettings";

export function createRuntimeRequestContext(injection: RuntimeContextInjection): RequestContext {
  const requestContext = new RequestContext();
  requestContext.set(MASTRA_RESOURCE_ID_KEY, injection.resourceId);
  if (injection.threadId) requestContext.set(MASTRA_THREAD_ID_KEY, injection.threadId);
  requestContext.set(runtimeProtocolKey, injection.protocol);
  if (injection.protocolSessionId) {
    requestContext.set(runtimeProtocolSessionIdKey, injection.protocolSessionId);
  }
  if (injection.resumeDecisions && injection.resumeDecisions.length > 0) {
    requestContext.set(runtimeResumeDecisionsKey, injection.resumeDecisions);
  }

  const entries = normalizeContextEntries(injection.entries ?? []);
  const promptParts = normalizePromptFragments(injection.promptFragments ?? []);
  if (entries.length > 0) {
    requestContext.set(runtimeContextEntriesKey, entries);
    promptParts.unshift(formatRuntimeContext(entries));
  }
  if (promptParts.length > 0) {
    requestContext.set(runtimeContextPromptKey, promptParts.join("\n\n"));
  }

  return requestContext;
}

export function getRuntimeProtocolSessionId(requestContext: RequestContext): string | undefined {
  return requestContext.get(runtimeProtocolSessionIdKey) as string | undefined;
}

export function getRuntimeContextEntries(
  requestContext: Pick<RequestContext, "get"> | undefined,
): RuntimeContextEntry[] {
  return normalizeContextEntries(
    (requestContext?.get(runtimeContextEntriesKey) as RuntimeContextEntry[] | undefined) ?? [],
  );
}

export function getRuntimeResumeDecisions(requestContext: RequestContext): RuntimeResumeDecision[] {
  return (
    (requestContext.get(runtimeResumeDecisionsKey) as RuntimeResumeDecision[] | undefined) ?? []
  );
}

export function setRuntimeThreadSettings(
  requestContext: RequestContext,
  settings: RuntimeThreadSettingsContext,
): void {
  requestContext.set(runtimeThreadSettingsKey, settings);
}

export function getRuntimeThreadSettings(
  requestContext: Pick<RequestContext, "get"> | undefined,
): RuntimeThreadSettingsContext | undefined {
  return requestContext?.get(runtimeThreadSettingsKey) as RuntimeThreadSettingsContext | undefined;
}

export function appendRuntimeContextPrompt(
  instructions: string,
  requestContext: RequestContext,
): string {
  const contextPrompt = requestContext.get(runtimeContextPromptKey) as string | undefined;
  return contextPrompt ? `${instructions}\n\n${contextPrompt}` : instructions;
}

export function normalizeContextEntries(entries: RuntimeContextEntry[]): RuntimeContextEntry[] {
  return entries
    .map((entry) => ({
      value: entry.value.trim(),
      description: entry.description.trim(),
    }))
    .filter((entry) => entry.value.length > 0 && entry.description.length > 0);
}

function normalizePromptFragments(fragments: string[]): string[] {
  return fragments.map((fragment) => fragment.trim()).filter(Boolean);
}

function formatRuntimeContext(entries: RuntimeContextEntry[]): string {
  const content = entries
    .map(
      (entry) =>
        `<context description="${escapeXml(entry.description)}">${escapeXml(entry.value)}</context>`,
    )
    .join("\n");
  return `<runtime-context>\n${content}\n</runtime-context>`;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
