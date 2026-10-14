import { z } from "zod";
import { pageKeySchema } from "./contribution.ts";
import { addressSchema, documentRefSchema, type TargetResolution } from "./target.ts";

/* ── Caller identity (ADR 0017 D2) ───────────────────────────────────────────────────── */

/** How a human reached the host: a browser on loopback or the tailnet, or their own terminal. */
export const humanViaSchema = z.enum(["local", "tailnet", "lan", "ssh", "cli"]);
export type HumanVia = z.infer<typeof humanViaSchema>;

/**
 * Who is crossing. The host mints it from the transport and `x-pe-context`; it is never parsed
 * from a request body or a page header. The receipt's `caller`, `basis`, `destination` and `id`
 * together are the caller context ADR 0017 names (principal, thread, head revision, exact
 * destination, request id).
 */
export const callerSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("human"),
    via: humanViaSchema,
    login: z.string().optional(),
    device: z.string().optional(),
  }),
  // A harness child and its shell, bound to one thread at spawn.
  z.strictObject({ kind: z.literal("pea"), context: z.string(), thread: z.string() }),
  z.strictObject({
    kind: z.literal("external-mcp"),
    context: z.string(),
    label: z.string(),
    device: z.string().optional(),
  }),
  z.strictObject({ kind: z.literal("page"), page: pageKeySchema }),
  // SDK claim token, scoped to its own shutdown/window doors.
  z.strictObject({ kind: z.literal("service"), service: z.string() }),
  // Reads only (D2).
  z.strictObject({ kind: z.literal("anonymous") }),
]);
export type Caller = z.infer<typeof callerSchema>;

/** Why a crossing was admitted; stored on the receipt and rechecked at every step begin (D4). */
export const basisSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("human") }),
  /** Document scope is rechecked at step begin; release must survive its own close. */
  z.strictObject({
    kind: z.literal("acquisition"),
    id: z.string(),
    scope: z.discriminatedUnion("kind", [
      z.strictObject({ kind: z.literal("document"), lifetime: documentRefSchema }),
      z.strictObject({ kind: z.literal("process"), session: z.string() }),
      z.strictObject({ kind: z.literal("release") }),
    ]),
  }),
  z.strictObject({
    kind: z.literal("grant"),
    thread: z.string(),
    headRevision: z.number().int(),
    device: z.string().optional(),
    lifetime: documentRefSchema,
  }),
  z.strictObject({ kind: z.literal("empty-user-session"), session: z.string() }),
]);
export type Basis = z.infer<typeof basisSchema>;

export const refusalCodes = [
  "context.missing",
  "device.unpaired",
  "device.revoked",
  "device.pairing",
  "identity.remote-administration",
  "context.unknown",
  "context.foreign-thread",
  "permission.undeclared",
  "human.only",
  "grant.required",
  "grant.expired",
  "grant.revoked",
  "grant.other-lifetime",
  "grant.context-cannot-hold",
  "acquisition.unproven",
  "acquisition.changed-after-handover",
  "lifecycle.ungranted-documents",
  "script.ungranted-documents",
  "page.unbound",
  "page.binding-not-yours",
  "page.use-page-door",
] as const;
export type RefusalCode = (typeof refusalCodes)[number];

/** Every door refuses with this shape: its own name, the reason, and what the person can do. */
export const refusalSchema = z.strictObject({
  code: z.enum(refusalCodes),
  door: z.string(),
  reason: z.string(),
  remedy: z.string().optional(),
  lifetime: documentRefSchema.optional(),
});
export type Refusal = z.infer<typeof refusalSchema>;

/**
 * D10: what one slot of a Page targets. `thread` follows that thread's head (and writes under its
 * grant); `pinned` names a document by Address, so it survives a reopen; `none` writes nothing.
 */
export const pageChoiceSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("thread"), thread: z.string().min(1) }),
  z.strictObject({ kind: z.literal("pinned"), address: addressSchema }),
  z.strictObject({ kind: z.literal("none") }),
]);
export type PageChoice = z.infer<typeof pageChoiceSchema>;

/**
 * A Page's binding record, host-written to `<page>/.state/binding.json`. Named slots let a
 * cross-document report bind several documents later; wave 1 builds and renders `default` only.
 * `boundBy` names who set each slot: a human's bind is their consent to the Page's ReadOnly
 * scripts on that document. A slot with no entry was not bound by a human.
 */
export const pageBindingSchema = z.strictObject({
  slots: z.object({ default: pageChoiceSchema }).catchall(pageChoiceSchema),
  boundBy: z.record(z.string(), z.enum(["human", "agent"])).default({}),
});
export type PageBinding = z.infer<typeof pageBindingSchema>;
export const unboundPage: PageBinding = { slots: { default: { kind: "none" } }, boundBy: {} };

/** What a write from a Page's slot would do now, decided as its act door decides. */
export type PageWrite =
  | { kind: "pea" }
  | { kind: "rw"; thread: string; expiresAt: string }
  | { kind: "read"; refusal: Refusal };
/** `GET /pages/<slug>/target`: one slot, resolved against the live Revits. Never a guess. */
export type PageTargetReading = {
  page: string;
  slot: "default";
  binding: PageChoice;
  resolution: TargetResolution;
  document: { session: string; openId: string; title: string } | null;
  write: PageWrite | null;
  /** Host clock, so an rw countdown never trusts the browser's. */
  hostNow: string;
};

/** The capability eligibility `human` admits only a human caller; a page is not one. */
export const eligibleCaller = (actor: "any" | "human" | "agent" | undefined, caller: Caller) =>
  actor === undefined || actor === "any" || (actor === "human") === (caller.kind === "human");
