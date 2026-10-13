import { z } from "zod";
import { addressSchema, documentRefSchema } from "./target.ts";

/* ── Caller identity (ADR 0017 D2) ───────────────────────────────────────────────────── */

/** D12 shape only: `page:@pages/<slug>` or `page:@<pod>/pages/<page>`. */
export const pageKeySchema = z.string().regex(/^page:@[^/]+\/.+$/);

/** How a human reached the host: a browser on loopback or the tailnet, or their own terminal. */
export const humanViaSchema = z.enum(["local", "tailnet", "cli"]);
export type HumanVia = z.infer<typeof humanViaSchema>;

/**
 * Who is crossing. The host mints it from the transport and `x-pe-context`; it is never parsed
 * from a request body or a page header. The receipt's `caller`, `basis`, `destination` and `id`
 * together are the caller context ADR 0017 names (principal, thread, head revision, exact
 * destination, request id).
 */
export const callerSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("human"), via: humanViaSchema, login: z.string().optional() }),
  // A harness child and its shell, bound to one thread at spawn.
  z.strictObject({ kind: z.literal("pea"), context: z.string(), thread: z.string() }),
  z.strictObject({ kind: z.literal("external-mcp"), context: z.string(), label: z.string() }),
  z.strictObject({ kind: z.literal("page"), page: pageKeySchema }),
  // Reads only (D2).
  z.strictObject({ kind: z.literal("anonymous") }),
]);
export type Caller = z.infer<typeof callerSchema>;

/** Why a crossing was admitted; stored on the receipt and rechecked at every step begin (D4). */
export const basisSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("human") }),
  z.strictObject({ kind: z.literal("pea-session"), session: z.string() }),
  z.strictObject({
    kind: z.literal("grant"),
    thread: z.string(),
    headRevision: z.number().int(),
    lifetime: documentRefSchema,
  }),
  z.strictObject({ kind: z.literal("empty-user-session"), session: z.string() }),
]);
export type Basis = z.infer<typeof basisSchema>;

export const refusalCodes = [
  "context.missing",
  "context.unknown",
  "context.foreign-thread",
  "human.only",
  "grant.required",
  "grant.expired",
  "grant.revoked",
  "grant.other-lifetime",
  "grant.context-cannot-hold",
  "lifecycle.user-session",
  "lifecycle.ungranted-documents",
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

/** D10: a Page's target, host-written to `<page>/.state/binding.json`. Slice D consumes it. */
export const pageBindingSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("thread"), thread: z.string() }),
  z.strictObject({ kind: z.literal("pinned"), address: addressSchema }),
  z.strictObject({ kind: z.literal("none") }),
]);
export type PageBinding = z.infer<typeof pageBindingSchema>;

/** The capability eligibility `human` admits only a human caller; a page is not one. */
export const eligibleCaller = (actor: "any" | "human" | "agent" | undefined, caller: Caller) =>
  actor === undefined || actor === "any" || (actor === "human") === (caller.kind === "human");
