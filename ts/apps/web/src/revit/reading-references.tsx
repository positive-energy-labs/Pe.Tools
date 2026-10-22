import {
  actionReceiptSchema,
  scheduleReadingSchema,
  type ActionReceipt,
} from "@pe/agent-contracts";
import { readRecord } from "@pe/agent-contracts/chat-state";
import { FactChip } from "@pe/kit/lang/chip";
import type { RevitElementReference } from "@pe/kit/lang/row";
import { frozenDemo } from "#/host/demo-client";
import {
  prepareElements,
  revitReferences,
  revitScope,
  type RevitObservationScope,
} from "./element-target";

type Reference = RevitElementReference & { label: string };
const records = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value)
    ? value.flatMap((item) => {
        const record = readRecord(item);
        return record ? [record] : [];
      })
    : [];

/** Only named native response contracts expose references. Arbitrary JSON IDs stay ordinary text. */
function referencesOf(key: string, data: unknown, request?: unknown): Reference[] {
  const value = readRecord(data);
  if (!value) return [];
  if (key === "revit.context.show-elements" && Array.isArray(value.shown)) {
    const expected = readRecord(readRecord(request)?.expectedUniqueIds);
    return value.shown
      .filter((id): id is number => typeof id === "number")
      .map((elementId) => ({
        elementId,
        uniqueId:
          typeof expected?.[elementId] === "string" ? (expected[elementId] as string) : null,
        kind: "Element",
        label: `selected element ${elementId}`,
      }));
  }
  if (key === "revit.resolve.references") {
    return records(value.candidates)
      .flatMap((candidate) => [candidate.handle, ...records(candidate.relatedHandles)])
      .flatMap((item) => {
        const handle = readRecord(item);
        if (!handle) return [];
        return [
          {
            elementId: typeof handle.elementId === "number" ? handle.elementId : null,
            uniqueId: typeof handle.uniqueId === "string" ? handle.uniqueId : null,
            // Preserve unsupported nesting at this projection boundary, including malformed paths.
            linkInstanceIds:
              handle.linkInstanceIds == null
                ? undefined
                : Array.isArray(handle.linkInstanceIds)
                  ? (handle.linkInstanceIds as number[])
                  : [NaN],
            documentKey: typeof handle.documentKey === "string" ? handle.documentKey : undefined,
            kind: typeof handle.kind === "string" ? handle.kind : "Unknown",
            label: typeof handle.label === "string" ? handle.label : "native reference",
          },
        ];
      });
  }
  if (key === "revit.detail.elements") {
    return records(value.entries).map((entry) => ({
      elementId: typeof entry.elementId === "number" ? entry.elementId : null,
      uniqueId: typeof entry.elementUniqueId === "string" ? entry.elementUniqueId : null,
      kind: "Element",
      label: typeof entry.name === "string" ? entry.name : `element ${String(entry.elementId)}`,
    }));
  }
  return [];
}

/** The result/receipt owns execution identity. A resolved path or the current chat head cannot replace it. */
export function NativeReadingReferences({
  result,
  receipt,
}: {
  result?: unknown;
  receipt?: ActionReceipt;
}) {
  const outer = readRecord(readRecord(result)?.structuredContent) ?? readRecord(result);
  const operation = readRecord(outer?.result);
  const parsedReceipt = receipt
    ? { success: true as const, data: receipt }
    : actionReceiptSchema.safeParse(operation?.action ?? outer?.result);
  const action = parsedReceipt.success ? parsedReceipt.data : undefined;
  const key = action?.key ?? (typeof outer?.key === "string" ? outer.key.replace(/^op:/, "") : "");
  const data: unknown = action && "result" in action ? action.result : outer?.result;
  let scope: RevitObservationScope | null =
    action?.state === "succeeded" && action.destination.kind === "document"
      ? { document: action.destination.ref, source: "native" }
      : null;
  let references: Reference[];
  if (key === "schedule.grid.snapshot" && outer?.ok === true) {
    const reading = scheduleReadingSchema.safeParse(data);
    if (!reading.success) return null;
    scope = { document: reading.data.target, source: "native" };
    references = [...new Set(reading.data.snapshot.rows.flatMap((row) => row.subjectIds))].map(
      (elementId) => ({ elementId, kind: "Element", label: `element ${elementId}` }),
    );
  } else {
    if (!action && (outer?.ok !== true || outer?.kind !== "op")) return null;
    references = referencesOf(key, data, action?.request);
  }
  if (!references.length) return null;
  const document = readRecord(readRecord(data)?.document);
  const documentKey = readRecord(data)?.documentKey ?? document?.documentKey;
  if (scope && typeof documentKey === "string") scope = { ...scope, documentKey };
  if (frozenDemo() !== null) scope = { document: null, source: "fixture" };
  return (
    <div className="flex flex-wrap items-center gap-1" {...revitScope(scope)}>
      {references.slice(0, 50).map((reference, index) => {
        const prepared = prepareElements({ ids: [], refs: [reference], scope }, false);
        return (
          <span key={index} tabIndex={0} {...revitReferences([reference])}>
            <FactChip
              title={`${reference.kind ?? "Element"} ${reference.elementId ?? "unknown"}: ${prepared.kind === "ready" ? "right-click or BX in the recorded native lifetime" : prepared.message}`}
            >
              {reference.label}
            </FactChip>
          </span>
        );
      })}
      {references.length > 50 ? (
        <span>{references.length - 50} more native references in the raw result</span>
      ) : null}
    </div>
  );
}
