import type { InputProcessorOrWorkflow } from "@mastra/core/processors";
import type { ComputeStateSignalArgs, ComputeStateSignalResult } from "@mastra/core/processors";
import type { RequestContext } from "@mastra/core/request-context";
import { SignalProvider } from "@mastra/core/signals";
import {
  getRuntimeContextEntries,
  normalizeContextEntries,
  type RuntimeContextEntry,
} from "@pe/runtime";

export const peaContextStateId = "pea-workbench-context";
export const peaContextTagName = "pea-workbench-context";

export interface PeaContextStateSignalArgs {
  requestContext?: RequestContext;
  contextWindow: Pick<ComputeStateSignalArgs["contextWindow"], "hasSnapshot">;
  lastSnapshot?: ComputeStateSignalArgs["lastSnapshot"];
  tracking?: ComputeStateSignalArgs["tracking"];
}

export class PeaContextSignalProvider extends SignalProvider<"pea-context-signals"> {
  readonly id = "pea-context-signals";
  readonly #processor = new PeaContextStateProcessor();

  getInputProcessors(): InputProcessorOrWorkflow[] {
    return [this.#processor];
  }
}

export class PeaContextStateProcessor {
  readonly id = "pea-context-state";
  readonly stateId = peaContextStateId;

  computeStateSignal(args: PeaContextStateSignalArgs): ComputeStateSignalResult {
    const currentEntries = getRuntimeContextEntries(args.requestContext);
    const priorEntries = getEntriesFromSnapshot(args.lastSnapshot);

    if (currentEntries.length === 0 && priorEntries.length === 0) return;

    const entries = currentEntries.length > 0 ? currentEntries : priorEntries;
    const cacheKey = createContextCacheKey(entries);
    const unchanged = args.tracking?.currentCacheKey === cacheKey;
    if (unchanged && args.contextWindow.hasSnapshot) return;

    return {
      id: this.stateId,
      cacheKey,
      contents: renderContext(entries),
      mode: "snapshot",
      tagName: peaContextTagName,
      value: { entries },
      attributes: { count: entries.length },
    };
  }
}

function getEntriesFromSnapshot(
  snapshot: ComputeStateSignalArgs["lastSnapshot"],
): RuntimeContextEntry[] {
  const value = snapshot?.metadata?.value;
  if (!isContextSnapshotValue(value)) return [];

  return normalizeContextEntries(value.entries);
}

function isContextSnapshotValue(value: unknown): value is { entries: RuntimeContextEntry[] } {
  const entries = readRecord(value)?.entries;
  return Array.isArray(entries);
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function createContextCacheKey(entries: RuntimeContextEntry[]): string {
  return `pea-workbench-context:${entries
    .map(
      (entry) =>
        `${entry.description.length}:${entry.description}${entry.value.length}:${entry.value}`,
    )
    .join("")}`;
}

function renderContext(entries: RuntimeContextEntry[]): string {
  const context = entries
    .map(
      (entry) =>
        `<context description="${escapeXml(entry.description)}">${escapeXml(entry.value)}</context>`,
    )
    .join("\n");
  return `<pea-workbench-context>\n<guidance>This context is orientation, not truth. Inspect fresh Pe.Host/Revit state when precision matters.</guidance>\n${context}\n</pea-workbench-context>`;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
