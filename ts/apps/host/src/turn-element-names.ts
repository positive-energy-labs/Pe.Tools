import type { RevitDetailElements } from "@pe/host-contracts/generated";
import { z } from "zod";
import type { DocumentRef } from "@pe/agent-contracts";
// Root exports this contract when wiring the Reading and prompt-event owners.
import {
  TURN_ELEMENT_NAMES_LIMIT,
  TURN_ELEMENT_NAME_MAX_LENGTH,
  TURN_ELEMENT_UNIQUE_ID_MAX_LENGTH,
  turnElementNamesObservationSchema,
  turnElementNamesRequestSchema,
  turnElementNamesSnapshotSchema,
  type TurnElementName,
  type TurnElementNamesObservation,
  type TurnElementNamesRequest,
  type TurnElementNamesSnapshot,
} from "../../../packages/agent-contracts/src/turn-element-names.ts";

export const TURN_ELEMENT_NAMES_OPERATION = "revit.detail.elements";

/** Dispatch only this declared read to the exact ref. Fail closed on closure or replacement. */
export type TurnElementNamesNativeRead = (
  operation: typeof TURN_ELEMENT_NAMES_OPERATION,
  request: RevitDetailElements.Req.Request,
  target: Readonly<DocumentRef>,
) => Promise<{ value: unknown; target?: { documentRef?: DocumentRef } }>;

const nativeNamesSchema = z.object({
  queryKind: z.literal("ElementReferences"),
  requestedElementCount: z.number().int().nonnegative(),
  resolvedElementCount: z.number().int().nonnegative(),
  entries: z
    .array(
      z.object({
        elementId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
        elementUniqueId: z.string().min(1).max(TURN_ELEMENT_UNIQUE_ID_MAX_LENGTH),
        name: z.string().max(TURN_ELEMENT_NAME_MAX_LENGTH),
      }),
    )
    .max(TURN_ELEMENT_NAMES_LIMIT),
  issues: z
    .array(z.object({ code: z.string(), severity: z.enum(["Info", "Warning", "Error"]) }))
    .max(TURN_ELEMENT_NAMES_LIMIT),
});
const targetKey = (target: DocumentRef) => JSON.stringify([target.session, target.openId]);
const snapshotKey = (snapshot: TurnElementNamesSnapshot) =>
  JSON.stringify([
    snapshot.thread,
    snapshot.turnId,
    snapshot.complete,
    [...new Set(snapshot.targets.map(targetKey))].sort(),
  ]);

/**
 * Resolve only new ids. The thread owner serializes reads and persists the returned observation
 * before publishing it, then passes that observation as `previous` on the next read. No cache,
 * transcript or writable Work lives here; old observations never consult today's model again.
 */
export async function readTurnElementNames(
  pinned: TurnElementNamesSnapshot,
  input: TurnElementNamesRequest,
  readNative: TurnElementNamesNativeRead,
  previous?: TurnElementNamesObservation,
): Promise<TurnElementNamesObservation> {
  // Parsing copies caller-owned objects before the first await, including the pinned target set.
  const snapshot = turnElementNamesSnapshotSchema.parse(pinned);
  const request = turnElementNamesRequestSchema.parse(input);
  if (request.thread !== snapshot.thread || request.turnId !== snapshot.turnId)
    throw new Error("Element names must use this turn's pinned targets");
  const prior = previous ? turnElementNamesObservationSchema.parse(previous) : undefined;
  if (prior && snapshotKey(prior.snapshot) !== snapshotKey(snapshot))
    throw new Error("Element name observations cannot be rebound to another turn or document");
  const entries = new Map<number, TurnElementName>();
  for (const entry of prior?.entries ?? []) {
    if (entries.has(entry.elementId)) throw new Error("Duplicate pinned element name");
    if (
      entry.state === "resolved" &&
      !snapshot.targets.some((target) => targetKey(target) === targetKey(entry.target))
    )
      throw new Error("Pinned element name is outside the turn's targets");
    entries.set(entry.elementId, entry);
  }
  const ids = [...new Set(request.ids)].filter((id) => !entries.has(id));
  if (entries.size + ids.length > TURN_ELEMENT_NAMES_LIMIT)
    throw new Error(`A turn can resolve at most ${TURN_ELEMENT_NAMES_LIMIT} unique element ids`);
  const targets = [
    ...new Map(snapshot.targets.map((target) => [targetKey(target), target])).values(),
  ];
  const unresolved = (reason: Extract<TurnElementName, { state: "unresolved" }>["reason"]) => {
    for (const elementId of ids) entries.set(elementId, { state: "unresolved", elementId, reason });
  };
  if (!snapshot.complete) unresolved("targets-unpinned");
  else if (!targets.length) unresolved("no-targets");
  else if (ids.length) {
    const batches = await Promise.all(
      targets.map(async (target) => {
        try {
          const answer = await readNative(
            TURN_ELEMENT_NAMES_OPERATION,
            { query: { kind: "ElementReferences", elementIds: [...ids] } },
            Object.freeze({ ...target }),
          );
          if (
            !answer.target?.documentRef ||
            targetKey(answer.target.documentRef) !== targetKey(target)
          )
            throw new Error("Native element read did not confirm the exact document lifetime");
          const value = nativeNamesSchema.parse(answer.value);
          if (
            value.requestedElementCount !== ids.length ||
            value.resolvedElementCount !== value.entries.length ||
            value.issues.some((issue) => issue.code !== "ElementContextElementIdNotFound")
          )
            throw new Error("Native element read could not establish a complete census");
          const seen = new Set<number>();
          for (const entry of value.entries) {
            if (!ids.includes(entry.elementId) || seen.has(entry.elementId))
              throw new Error("Native element read returned an unexpected or duplicate id");
            seen.add(entry.elementId);
          }
          return { target, entries: value.entries };
        } catch {
          return null;
        }
      }),
    );
    // A failed document cannot prove absence. Do not turn a partial census into a unique hit.
    if (batches.some((batch) => batch === null)) unresolved("read-unavailable");
    else
      for (const elementId of ids) {
        const hits = batches.flatMap((batch) =>
          batch!.entries
            .filter((entry) => entry.elementId === elementId)
            .map((entry) => ({ ...entry, target: batch!.target })),
        );
        const hit = hits[0];
        entries.set(
          elementId,
          hits.length > 1
            ? { state: "ambiguous", elementId }
            : hit && hit.name.trim()
              ? {
                  state: "resolved",
                  elementId,
                  target: hit.target,
                  uniqueId: hit.elementUniqueId,
                  name: hit.name.trim(),
                }
              : { state: "unresolved", elementId, reason: "missing" },
        );
      }
  }
  return { snapshot, observedAt: new Date().toISOString(), entries: [...entries.values()] };
}
