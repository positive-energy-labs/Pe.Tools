import type {
  WorkbenchRawLedgerEntry,
  WorkbenchRawMessage,
  WorkbenchRawThreadSnapshot,
  WorkbenchState,
} from "./contracts.ts";

export type WorkbenchRawThreadVariant = "strata" | "matrix" | "prompt";
export type WorkbenchRawBlockKind =
  | "system"
  | "xml"
  | "user"
  | "assistant"
  | "tool"
  | "om"
  | "runtime"
  | "protocol"
  | "database"
  | "error";

export interface WorkbenchRawBlock {
  id: string;
  kind: WorkbenchRawBlockKind;
  title: string;
  subtitle?: string;
  createdAt?: string;
  text?: string;
  value?: unknown;
  weight: number;
}

export type WorkbenchPromptSignalKind =
  | "system"
  | "context"
  | "raw-message"
  | "metadata"
  | "db-ledger";

export interface WorkbenchPromptSignal {
  id: string;
  kind: WorkbenchPromptSignalKind;
  title: string;
  source?: string;
  updatedAt?: string;
  text: string;
  value?: unknown;
}

export interface WorkbenchRawBlockStat {
  kind: WorkbenchRawBlockKind;
  count: number;
}

export const workbenchRawThreadVariants: Array<{
  id: WorkbenchRawThreadVariant;
  label: string;
}> = [
  { id: "strata", label: "Strata" },
  { id: "matrix", label: "Matrix" },
  { id: "prompt", label: "Prompt" },
];

export function selectRawThreadBlocks(
  snapshot: WorkbenchRawThreadSnapshot | undefined,
  state: WorkbenchState,
): WorkbenchRawBlock[] {
  const blocks: WorkbenchRawBlock[] = [];
  const push = (block: Omit<WorkbenchRawBlock, "weight"> & { weight?: number }) => {
    const text = block.text ?? stringify(block.value);
    blocks.push({ ...block, weight: block.weight ?? Math.max(500, text.length) });
  };

  if (state.inspector.systemPrompt?.content) {
    push({
      id: "raw-system-workbench",
      kind: "system",
      title: "Workbench system prompt snapshot",
      subtitle: state.inspector.systemPrompt.source,
      text: state.inspector.systemPrompt.content,
      value: state.inspector.systemPrompt,
    });
  }

  snapshot?.errors?.forEach((error, index) =>
    push({ id: `raw-error-${index}`, kind: "error", title: "Raw snapshot error", text: error }),
  );
  snapshot?.database?.errors?.forEach((error, index) =>
    push({
      id: `raw-db-error-${index}`,
      kind: "error",
      title: "Database snapshot error",
      text: error,
    }),
  );

  snapshot?.messages?.forEach((message, index) => {
    const text = message.text ?? "";
    push({
      id: `raw-message-${message.id ?? index}`,
      kind: messageKind(message),
      title: `${message.role ?? "message"} message`,
      subtitle: message.createdAt ?? message.id,
      createdAt: message.createdAt,
      text,
      value: message,
    });
    pushXml(
      text,
      `raw-message-xml-${message.id ?? index}`,
      "XML block from message",
      message.createdAt ?? message.id,
    );
  });

  snapshot?.database?.messageRows?.forEach((row, index) => {
    const content = row.content;
    const text = typeof content === "string" ? content : stringify(content ?? row);
    push({
      id: `raw-db-message-${stringValue(row.id) ?? index}`,
      kind: "database",
      title: `DB message ${stringValue(row.role) ?? stringValue(row.type) ?? ""}`.trim(),
      subtitle: stringValue(row.createdAt) ?? stringValue(row.id),
      text,
      value: row,
    });
    pushXml(
      text,
      `raw-db-message-xml-${stringValue(row.id) ?? index}`,
      "XML block from DB message",
      stringValue(row.createdAt) ?? stringValue(row.id),
    );
  });

  snapshot?.ledger?.forEach((entry, index) => {
    const kind = ledgerKind(entry);
    const text = ledgerText(entry);
    push({
      id: `raw-ledger-${entry.sequence ?? index}`,
      kind,
      title: entry.type ?? "ledger",
      subtitle: entry.rawEventType ?? entry.createdAt,
      createdAt: entry.createdAt,
      text,
      value: entry,
    });
    pushXml(text, `raw-ledger-xml-${entry.sequence ?? index}`, "XML block from ledger", entry.type);
  });

  snapshot?.database?.observationalMemoryRows?.forEach((row, index) => {
    const active = stringValue(row.activeObservations);
    const bufferedReflection = stringValue(row.bufferedReflection);
    const chunks = Array.isArray(row.bufferedObservationChunks)
      ? row.bufferedObservationChunks
      : [];
    const scope = stringValue(row.scope) ?? "memory";
    const generationCount = numberOrString(row.generationCount) ?? "?";
    push({
      id: `raw-om-${index}`,
      kind: "om",
      title: `OM ${scope} generation ${generationCount}`,
      subtitle: stringValue(row.lookupKey) ?? stringValue(row.updatedAt),
      text: [active, bufferedReflection].filter(Boolean).join("\n\n"),
      value: row,
    });
    chunks.forEach((chunk, chunkIndex) =>
      push({
        id: `raw-om-${index}-chunk-${chunkIndex}`,
        kind: "om",
        title: "Buffered OM observation chunk",
        subtitle: stringValue(readRecord(chunk).cycleId) ?? stringValue(row.lookupKey),
        text: stringValue(readRecord(chunk).observations) ?? stringify(chunk),
        value: chunk,
      }),
    );
  });

  for (const [name, rows] of Object.entries({
    thread: snapshot?.database?.threadRows,
    resource: snapshot?.database?.resourceRows,
    threadState: snapshot?.database?.threadStateRows,
  })) {
    rows?.forEach((row, index) =>
      push({
        id: `raw-db-${name}-${index}`,
        kind: "database",
        title: `DB ${name}`,
        subtitle: stringValue(row.id) ?? stringValue(row.type),
        text: databaseRowText(row),
        value: row,
      }),
    );
  }

  return blocks;

  function pushXml(text: string, id: string, title: string, subtitle?: string): void {
    if (!looksXml(text)) return;
    push({ id, kind: "xml", title, subtitle, text });
  }
}

export function selectPromptLifecycleSignals(
  snapshot: WorkbenchRawThreadSnapshot | undefined,
  state: WorkbenchState,
): WorkbenchPromptSignal[] {
  const signals: WorkbenchPromptSignal[] = [];
  const push = (signal: WorkbenchPromptSignal | undefined) => {
    if (!signal || signal.text.trim().length === 0) return;
    if (signals.some((candidate) => candidate.id === signal.id)) return;
    signals.push(signal);
  };

  if (state.inspector.systemPrompt?.content) {
    push({
      id: "prompt-signal-workbench-system",
      kind: "system",
      title: "Current workbench system prompt",
      source: state.inspector.systemPrompt.source,
      updatedAt: state.inspector.systemPrompt.updatedAt,
      text: state.inspector.systemPrompt.content,
      value: state.inspector.systemPrompt,
    });
  }

  state.inspector.contextEntries.forEach((entry, index) =>
    push(
      inspectorEntryPromptSignal("context", `prompt-signal-context-${entry.id ?? index}`, entry),
    ),
  );
  state.inspector.rawMessages.forEach((entry, index) =>
    push(
      inspectorEntryPromptSignal(
        "raw-message",
        `prompt-signal-raw-message-${entry.id ?? index}`,
        entry,
      ),
    ),
  );

  snapshot?.history?.forEach((entry, index) => {
    push(
      metadataPromptSignal(
        readRecord(readRecord(entry).payload).value ?? readRecord(entry).payload,
        `prompt-signal-history-${index}`,
        "AG-UI history metadata",
      ),
    );
  });

  snapshot?.ledger?.forEach((entry, index) => {
    push(
      metadataPromptSignal(
        readRecord(entry.event).metadata ?? readRecord(entry.rawEvent).value ?? entry.payload,
        `prompt-signal-ledger-${entry.sequence ?? index}`,
        `${entry.type ?? "ledger"} ${entry.rawEventType ?? ""}`.trim(),
        entry.createdAt,
      ),
    );
  });

  snapshot?.database?.threadStateRows?.forEach((row, index) => {
    const value = readRecord(row.value);
    const entries = Array.isArray(value.entries) ? value.entries : [];
    entries.forEach((entry, entryIndex) => {
      const record = readRecord(entry);
      push(
        metadataPromptSignal(
          readRecord(record.event).metadata ?? readRecord(record.rawEvent).value ?? record.payload,
          `prompt-signal-db-ledger-${index}-${entryIndex}`,
          `${stringValue(record.type) ?? "db ledger"} ${stringValue(record.rawEventType) ?? ""}`.trim(),
          stringValue(record.createdAt),
          "db-ledger",
        ),
      );
    });
  });

  return signals.sort((left, right) => (left.updatedAt ?? "").localeCompare(right.updatedAt ?? ""));
}

export function selectRawThreadBlockStats(blocks: WorkbenchRawBlock[]): WorkbenchRawBlockStat[] {
  const counts = new Map<WorkbenchRawBlockKind, number>();
  blocks.forEach((block) => counts.set(block.kind, (counts.get(block.kind) ?? 0) + 1));
  return Array.from(counts.entries()).map(([kind, count]) => ({ kind, count }));
}

export function centerlinePrompt(signals: WorkbenchPromptSignal[]): string | undefined {
  return [...signals].reverse().find((signal) => signal.kind === "system")?.text;
}

export function promptSignalCounts(
  signals: WorkbenchPromptSignal[],
): Array<{ kind: WorkbenchPromptSignalKind; count: number }> {
  const counts = new Map<WorkbenchPromptSignalKind, number>();
  signals.forEach((signal) => counts.set(signal.kind, (counts.get(signal.kind) ?? 0) + 1));
  return Array.from(counts.entries()).map(([kind, count]) => ({ kind, count }));
}

export function blockText(block: WorkbenchRawBlock): string {
  return block.text ?? stringify(block.value);
}

function inspectorEntryPromptSignal(
  kind: Extract<WorkbenchPromptSignalKind, "context" | "raw-message">,
  id: string,
  entry: { title?: string; content?: unknown; updatedAt?: string },
): WorkbenchPromptSignal {
  return {
    id,
    kind,
    title: entry.title ?? (kind === "context" ? "Context entry" : "Raw message"),
    updatedAt: entry.updatedAt,
    text: typeof entry.content === "string" ? entry.content : stringify(entry.content),
    value: entry,
  };
}

function metadataPromptSignal(
  value: unknown,
  id: string,
  fallbackTitle: string,
  updatedAt?: string,
  fallbackKind: WorkbenchPromptSignalKind = "metadata",
): WorkbenchPromptSignal | undefined {
  const metadata = readRecord(value);
  const systemPrompt = readRecord(metadata.systemPrompt);
  if (typeof systemPrompt.content === "string") {
    return {
      id: `${id}-system`,
      kind: "system",
      title: "System prompt metadata",
      source: stringValue(systemPrompt.source) ?? fallbackTitle,
      updatedAt: stringValue(systemPrompt.updatedAt) ?? updatedAt,
      text: systemPrompt.content,
      value,
    };
  }

  const contextEntries = Array.isArray(metadata.contextEntries) ? metadata.contextEntries : [];
  const rawMessages = Array.isArray(metadata.rawMessages) ? metadata.rawMessages : [];
  const content = [...contextEntries, ...rawMessages]
    .map((entry) => stringify(readRecord(entry).content ?? entry))
    .filter((text) => text.trim().length > 0)
    .join("\n\n");
  if (!content) return undefined;
  return { id, kind: fallbackKind, title: fallbackTitle, updatedAt, text: content, value };
}

function messageKind(message: WorkbenchRawMessage): WorkbenchRawBlockKind {
  if (message.role === "system") return "system";
  if (message.role === "user") return "user";
  if (message.role === "assistant") return "assistant";
  if (message.role === "tool") return "tool";
  return "runtime";
}

function ledgerKind(entry: WorkbenchRawLedgerEntry): WorkbenchRawBlockKind {
  const type = entry.type ?? "";
  const rawType = entry.rawEventType ?? "";
  const text = `${type} ${rawType}`.toLowerCase();
  if (type === "protocol_event") return "protocol";
  if (type === "raw_mastra_event" || type === "runtime_event" || type === "queue_event") {
    if (text.includes("tool")) return "tool";
    return "runtime";
  }
  if (type === "thread_message") return messageKind(entry.message ?? {});
  if (type === "user_prompt") return "user";
  return "database";
}

function ledgerText(entry: WorkbenchRawLedgerEntry): string {
  if (entry.content) return entry.content;
  if (entry.message?.text) return entry.message.text;
  if (entry.event) return stringify(entry.event);
  if (entry.rawEvent) return stringify(entry.rawEvent);
  if (entry.payload) return stringify(entry.payload);
  return stringify(entry);
}

function databaseRowText(row: Record<string, unknown>): string {
  const value = row.value;
  if (value !== undefined) return typeof value === "string" ? value : stringify(value);
  const workingMemory = row.workingMemory;
  if (typeof workingMemory === "string") return workingMemory;
  return stringify(row);
}

function looksXml(text: string): boolean {
  return /<[/A-Za-z][^>]{1,120}>/.test(text) && /<\/[A-Za-z][^>]{0,80}>/.test(text);
}

function stringify(value: unknown): string {
  if (value === undefined) return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

function readRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function numberOrString(value: unknown): string | number | undefined {
  return typeof value === "number" || typeof value === "string" ? value : undefined;
}
