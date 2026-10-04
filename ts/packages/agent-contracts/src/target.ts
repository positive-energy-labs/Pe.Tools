import { z } from "zod";
import { capabilityNeedsSchema } from "./capability.ts";

const documentAddressPattern =
  /^(?:[A-Za-z]:[\\/]|\\\\)|^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A Revit document's cloud model GUID or absolute Windows path. */
export const addressSchema = z
  .string()
  .refine(
    (value) => documentAddressPattern.test(value),
    "an Address must be a cloud model GUID or absolute path",
  )
  .brand<"Address">();
export type Address = z.infer<typeof addressSchema>;

export const address = (value: string): Address => addressSchema.parse(value);

/** GUID case and Windows path case/separators do not distinguish documents. */
export const sameAddress = (a: Address, b: Address): boolean =>
  a.replaceAll("/", "\\").toLowerCase() === b.replaceAll("/", "\\").toLowerCase();

// The bridge identity already includes process incarnation. SDK labels are recovery choices,
// never execution identities. openId must be minted for each Document lifetime by Revit.
export const documentRefSchema = z.strictObject({
  session: z.string().min(1),
  openId: z.string().min(1),
});
export type DocumentRef = z.infer<typeof documentRefSchema>;

export const documentRequestSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("open"), ref: documentRefSchema }),
  z.strictObject({
    kind: z.literal("named"),
    session: z.string().min(1),
    address: addressSchema,
  }),
]);
export type DocumentRequest = z.infer<typeof documentRequestSchema>;

/** `needs` comes from the host's capability record, never from untrusted call input.
 * A call override never rewrites thread scope or authored work. */
export const callTargetSchema = z.discriminatedUnion("needs", [
  z.strictObject({ needs: z.literal("nothing") }),
  z.strictObject({ needs: z.literal("session"), target: z.string().min(1) }),
  z.strictObject({
    needs: capabilityNeedsSchema.exclude(["nothing", "session"]),
    target: documentRequestSchema.optional(),
  }),
]);
export type CallTarget = z.infer<typeof callTargetSchema>;

export const targetInventorySchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("checking") }),
  z.strictObject({ kind: z.literal("failed"), message: z.string() }),
  z.strictObject({
    kind: z.literal("ready"),
    // Absence is authoritative only in a complete registry snapshot. A bridge outage keeps
    // the session here with checking/failed documents until process closure is confirmed.
    sessions: z.record(
      z.string().min(1),
      z.discriminatedUnion("kind", [
        z.strictObject({ kind: z.literal("checking") }),
        z.strictObject({ kind: z.literal("failed"), message: z.string() }),
        z.strictObject({
          kind: z.literal("ready"),
          // All open documents, including inactive, cloud and unsaved documents.
          values: z.array(
            z.strictObject({
              openId: z.string().min(1),
              address: addressSchema.nullable(),
              kind: z.enum(["project", "family"]),
            }),
          ),
        }),
      ]),
    ),
  }),
]);
export type TargetInventory = z.infer<typeof targetInventorySchema>;

export const executionTargetSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("host") }),
  z.strictObject({ kind: z.literal("session"), session: z.string().min(1) }),
  z.strictObject({ kind: z.literal("document"), ref: documentRefSchema }),
]);
export type ExecutionTarget = z.infer<typeof executionTargetSchema>;

export type TargetResolution =
  | {
      kind: "resolved";
      target: ExecutionTarget;
    }
  | { kind: "checking" }
  | { kind: "failed"; message: string }
  | {
      kind: "choose";
      reason: "missing" | "session-gone" | "document-closed" | "wrong-document-kind" | "ambiguous";
    };

/** Callers retain the request for recovery; this function never chooses another session. */
export function resolveCallTarget(
  call: CallTarget,
  defaultDocument: DocumentRequest | null,
  inventory: TargetInventory,
): TargetResolution {
  if (call.needs === "nothing") return { kind: "resolved", target: { kind: "host" } };
  const request =
    call.needs === "session"
      ? { kind: "session" as const, session: call.target }
      : (call.target ?? defaultDocument);
  if (!request) return { kind: "choose", reason: "missing" };
  if (inventory.kind !== "ready") return inventory;
  const session = request.kind === "open" ? request.ref.session : request.session;
  const found = Object.hasOwn(inventory.sessions, session)
    ? inventory.sessions[session]
    : undefined;
  if (!found) return { kind: "choose", reason: "session-gone" };
  if (request.kind === "session") return { kind: "resolved", target: { kind: "session", session } };
  if (found.kind !== "ready") return found;
  const documents = found.values.filter((doc) =>
    request.kind === "open"
      ? doc.openId === request.ref.openId
      : doc.address !== null && sameAddress(doc.address, request.address),
  );
  if (documents.length === 0) return { kind: "choose", reason: "document-closed" };
  if (documents.length > 1) return { kind: "choose", reason: "ambiguous" };
  const document = documents[0]!;
  if (
    (call.needs === "family-document" && document.kind !== "family") ||
    (call.needs === "project-document" && document.kind !== "project")
  ) {
    return { kind: "choose", reason: "wrong-document-kind" };
  }
  return {
    kind: "resolved",
    target: { kind: "document", ref: { session, openId: document.openId } },
  };
}

/** The stable key of a Target request; null is the empty key. */
export const targetKey = (target: DocumentRequest | null): string =>
  target === null
    ? ""
    : target.kind === "open"
      ? `open:${target.ref.session}/${target.ref.openId}`
      : `named:${target.session}/${target.address}`;

/* ── Thread head: the default Target a thread carries ───────────────────────────────── */

/**
 * What the user chose for a chat thread: one default Target request plus the revision the host
 * stamped on it. A default is not an execution target; every call resolves it through
 * `resolveCallTarget` against the live inventory and never rewrites it.
 */
export const threadHeadSchema = z.object({
  defaultTarget: documentRequestSchema.nullable(),
  revision: z.number().int().nonnegative(),
});
export type ThreadHead = z.infer<typeof threadHeadSchema>;

/** `PUT /pe/scope/:thread`. */
export const putTargetSchema = z.object({
  defaultTarget: documentRequestSchema.nullable(),
  expectedRevision: z.number().int().nonnegative(),
});
export type PutTarget = z.infer<typeof putTargetSchema>;

export const putTargetResultSchema = z.discriminatedUnion("why", [
  z.object({ ok: z.literal(true), why: z.literal("set"), head: threadHeadSchema }),
  /** Someone wrote first; `head` is current, re-read and decide again. */
  z.object({ ok: z.literal(false), why: z.literal("stale"), head: threadHeadSchema }),
]);
export type PutTargetResult = z.infer<typeof putTargetResultSchema>;
