import {
  MASTRA_RESOURCE_ID_KEY,
  MASTRA_THREAD_ID_KEY,
  RequestContext,
} from "@mastra/core/request-context";
import type { PeaRuntimeResumeDecision } from "./pea-runtime-interrupts.js";

export interface PeaRuntimeContextEntry {
  value: string;
  description: string;
}

export interface PeaRuntimeContextInjection {
  protocol: "tui" | "acp" | "ag-ui" | "test";
  protocolSessionId?: string;
  threadId?: string;
  resourceId: string;
  entries?: PeaRuntimeContextEntry[];
  promptFragments?: string[];
  resumeDecisions?: PeaRuntimeResumeDecision[];
}

const peaRuntimeContextPromptKey = "pea.runtimeContextPrompt";
const peaRuntimeContextEntriesKey = "pea.runtimeContextEntries";
const peaRuntimeProtocolKey = "pea.runtimeProtocol";
const peaRuntimeProtocolSessionIdKey = "pea.runtimeProtocolSessionId";
const peaRuntimeResumeDecisionsKey = "pea.runtimeResumeDecisions";

export function createPeaRuntimeRequestContext(
  injection: PeaRuntimeContextInjection,
): RequestContext {
  const requestContext = new RequestContext();
  requestContext.set(MASTRA_RESOURCE_ID_KEY, injection.resourceId);
  if (injection.threadId) requestContext.set(MASTRA_THREAD_ID_KEY, injection.threadId);
  requestContext.set(peaRuntimeProtocolKey, injection.protocol);
  if (injection.protocolSessionId) {
    requestContext.set(peaRuntimeProtocolSessionIdKey, injection.protocolSessionId);
  }
  if (injection.resumeDecisions && injection.resumeDecisions.length > 0) {
    requestContext.set(peaRuntimeResumeDecisionsKey, injection.resumeDecisions);
  }

  const entries = normalizeContextEntries(injection.entries ?? []);
  const promptParts = normalizePromptFragments(injection.promptFragments ?? []);
  if (entries.length > 0) {
    requestContext.set(peaRuntimeContextEntriesKey, entries);
    promptParts.unshift(formatPeaRuntimeContext(entries));
  }
  if (promptParts.length > 0) {
    requestContext.set(peaRuntimeContextPromptKey, promptParts.join("\n\n"));
  }

  return requestContext;
}

export function getPeaRuntimeProtocolSessionId(requestContext: RequestContext): string | undefined {
  return requestContext.get(peaRuntimeProtocolSessionIdKey) as string | undefined;
}

export function getPeaRuntimeResumeDecisions(
  requestContext: RequestContext,
): PeaRuntimeResumeDecision[] {
  return (
    (requestContext.get(peaRuntimeResumeDecisionsKey) as PeaRuntimeResumeDecision[] | undefined) ??
    []
  );
}

export function appendPeaRuntimeContextPrompt(
  instructions: string,
  requestContext: RequestContext,
): string {
  const contextPrompt = requestContext.get(peaRuntimeContextPromptKey) as string | undefined;
  return contextPrompt ? `${instructions}\n\n${contextPrompt}` : instructions;
}

export function normalizeContextEntries(
  entries: PeaRuntimeContextEntry[],
): PeaRuntimeContextEntry[] {
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

function formatPeaRuntimeContext(entries: PeaRuntimeContextEntry[]): string {
  const content = entries
    .map(
      (entry) =>
        `<context description="${escapeXml(entry.description)}">${escapeXml(entry.value)}</context>`,
    )
    .join("\n");
  return `<pea-runtime-context>\n${content}\n</pea-runtime-context>`;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
