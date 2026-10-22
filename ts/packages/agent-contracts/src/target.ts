import { sdkSessionSelectionSchema } from "./sdk-session.ts";
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
  z.strictObject({ needs: z.literal("session"), target: sdkSessionSelectionSchema.optional() }),
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
  z.strictObject({ kind: z.literal("sdk-session"), selection: sdkSessionSelectionSchema }),
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
      reason:
        | "missing"
        | "several-targets"
        | "session-gone"
        | "document-closed"
        | "wrong-document-kind"
        | "ambiguous";
    };

/**
 * Callers retain the request for recovery; this function never chooses another session. An
 * explicit call target wins; with none, a thread with exactly one target uses it and a thread with
 * several refuses (`several-targets`): a write names one. Whether the call may write the resolved
 * document is admission's question (`admitCrossing`), not this one's.
 */
export function resolveCallTarget(
  call: Exclude<CallTarget, { needs: "session" }>,
  targets: readonly DocumentRequest[],
  inventory: TargetInventory,
): TargetResolution {
  if (call.needs === "nothing") return { kind: "resolved", target: { kind: "host" } };
  if (!call.target && targets.length > 1) return { kind: "choose", reason: "several-targets" };
  const request = call.target ?? targets[0];
  if (!request) return { kind: "choose", reason: "missing" };
  if (inventory.kind !== "ready") return inventory;
  const session = request.kind === "open" ? request.ref.session : request.session;
  const found = Object.hasOwn(inventory.sessions, session)
    ? inventory.sessions[session]
    : undefined;
  if (!found) return { kind: "choose", reason: "session-gone" };
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

/**
 * D10 pinned: one Address against every session. One open copy resolves; none is
 * `document-closed`; two (the same file open in two Revits) is `ambiguous`, never a pick. A session
 * still checking or failed answers for the whole inventory, since its absence proves nothing.
 */
export function resolvePinned(pinned: Address, inventory: TargetInventory): TargetResolution {
  if (inventory.kind !== "ready") return inventory;
  const hits: ExecutionTarget[] = [];
  for (const [session, found] of Object.entries(inventory.sessions)) {
    if (found.kind !== "ready") return found;
    for (const doc of found.values)
      if (doc.address !== null && sameAddress(doc.address, pinned))
        hits.push({ kind: "document", ref: { session, openId: doc.openId } });
  }
  return hits.length === 1
    ? { kind: "resolved", target: hits[0]! }
    : { kind: "choose", reason: hits.length ? "ambiguous" : "document-closed" };
}

/** The stable key of a Target request; null is the empty key. */
export const targetKey = (target: DocumentRequest | null): string =>
  target === null
    ? ""
    : target.kind === "open"
      ? `open:${target.ref.session}/${target.ref.openId}`
      : `named:${target.session}/${target.address}`;

/* ── Thread head: the documents a thread targets (ADR 0021) ──────────────────────────── */

/**
 * The host's admission record for a user document a human added to a thread (ADR 0017 rule 4,
 * ADR 0021 rule 5). It is a host invariant, not a user-facing noun: no clock, no renewal. The
 * document's authority ends when its lifetime closes or a human removes it from the targets.
 */
export const headAdmissionSchema = z.strictObject({
  /** The head revision that added it; a re-add after removal is a new admission (fencing). */
  revision: z.number().int().nonnegative(),
  /** Host clock at the human PUT that added it. */
  at: z.iso.datetime(),
  via: z.enum(["local", "tailnet", "cli", "lan", "ssh"]),
  device: z.string().optional(),
  /** Authenticated tailnet login that added it; never supplied by the PUT body. */
  login: z.string().optional(),
});
export type HeadAdmission = z.infer<typeof headAdmissionSchema>;

export const headTargetSchema = z
  .strictObject({
    request: documentRequestSchema,
    /** Display snapshot only. It never participates in target resolution or admission. */
    label: z.string().max(300).optional(),
    /** Host-written; set only when a human added an exact open lifetime Pea did not acquire. */
    admission: headAdmissionSchema.nullable(),
  })
  .refine(
    (target) => target.admission === null || target.request.kind === "open",
    "an admission binds an exact open lifetime, never a named address",
  );
export type HeadTarget = z.infer<typeof headTargetSchema>;

/**
 * What a chat thread targets: a set of document requests plus the revision the host stamped on
 * it. A target is not an execution target; every call resolves it through `resolveCallTarget`
 * against the live inventory and never rewrites it.
 */
export const threadHeadSchema = z.object({
  targets: z.array(headTargetSchema),
  revision: z.number().int().nonnegative(),
});
export type ThreadHead = z.infer<typeof threadHeadSchema>;
export const emptyThreadHead: ThreadHead = { targets: [], revision: 0 };

/**
 * How a set of targets reads in one line: the one document's label, or a count when several. The
 * targeted document names are the visible consent (ADR 0021 rule 4); null when none is named.
 */
export const targetsLabel = (targets: readonly { label?: string | undefined }[]): string | null =>
  targets.length > 1 ? `${targets.length} documents` : (targets[0]?.label ?? null);

/** The document requests a thread targets, for `resolveCallTarget`. */
export const headRequests = (head: ThreadHead): DocumentRequest[] =>
  head.targets.map((target) => target.request);

/** `PUT /pe/scope/:thread`: the whole target set. The host keeps admissions it already holds. */
export const putTargetSchema = z.object({
  targets: z.array(
    z.strictObject({ request: documentRequestSchema, label: z.string().max(300).optional() }),
  ),
  expectedRevision: z.number().int().nonnegative(),
});
export type PutTarget = z.infer<typeof putTargetSchema>;

export const putTargetResultSchema = z.discriminatedUnion("why", [
  z.object({ ok: z.literal(true), why: z.literal("set"), head: threadHeadSchema }),
  /** Someone wrote first; `head` is current, re-read and decide again. */
  z.object({ ok: z.literal(false), why: z.literal("stale"), head: threadHeadSchema }),
]);
export type PutTargetResult = z.infer<typeof putTargetResultSchema>;
