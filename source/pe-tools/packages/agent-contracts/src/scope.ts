import { z } from "zod";
import { addressSchema, type Address } from "./reading.ts";

/**
 * Scope: what the user CHOSE for a chat thread. The host owns one Head per thread; the chat head
 * is its only human writer and pea proposes a change through `scope_set`. Nothing else names a
 * target.
 *
 * Two states, no nulls. `document` is the normal day; the session is derived from the one holder
 * on every call. `pin` is a tiebreak, not a claim: it names the session the user picked when two
 * held the document, and it counts only while that session still holds it. There is no session
 * scope: an idle Revit is reached by opening a document into it (an instances verb), and a
 * doc-free call takes any eligible session. What the fleet RESOLVED is a different type
 * (`ScopeResolution`), computed per call and never stored. ADR 0010.
 */
export const sdkSessionIdSchema = z.string().regex(/^[a-z0-9._-]{1,64}$/);
export type SdkSessionId = z.infer<typeof sdkSessionIdSchema>;

export const scopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }).strict(),
  z
    .object({
      kind: z.literal("document"),
      document: addressSchema,
      pin: sdkSessionIdSchema.optional(),
    })
    .strict(),
]);
export type Scope = z.infer<typeof scopeSchema>;
export const emptyScope: Scope = Object.freeze({ kind: "none" });

/** The document the user named, if any. */
export const scopeDocument = (scope: Scope): Address | null =>
  scope.kind === "document" ? scope.document : null;
/** The session the user pinned, if any. Never a derived session; ask `resolveScope` for those. */
export const scopePin = (scope: Scope): SdkSessionId | null =>
  scope.kind === "document" ? (scope.pin ?? null) : null;

/** A Scope plus the revision the host stamped on it; the head and every tool card show the revision. */
export const headSchema = z.object({
  scope: scopeSchema,
  revision: z.number().int().nonnegative(),
});
export type Head = z.infer<typeof headSchema>;

/**
 * The persisted key a Scope-keyed route document lives under. The pin is a tiebreak on which
 * Revit answers, never part of the document's identity, so it is not in the key.
 */
export const scopeKey = (scope: Scope): string => `scope:${scopeDocument(scope) ?? ""}`;

/**
 * The host bridge selector for a Scope. The selector grammar is the adapter between the typed
 * Scope and the bridge: `doc:<Address>` asks the host for the one holder (zero or several refuse);
 * `pin:<session>|doc:<Address>` lets the pinned session win while it is a holder; undefined lets
 * the host pick the only session.
 */
export function bridgeSelector(scope: Scope): string | undefined {
  if (scope.kind === "none") return undefined;
  return scope.pin ? `pin:${scope.pin}|doc:${scope.document}` : `doc:${scope.document}`;
}

/* ── Fleet: what the host reports about connected sessions ────────────────────────────────── */

/**
 * One connected session. `year` is the Revit year and the eligibility key: a file opens only in
 * the year that saved it, and an upgrade is a separate, never implicit, human verb.
 */
export interface FleetSession {
  id: SdkSessionId;
  /** Null when the fleet does not report it; an unknown year stays eligible. */
  year: number | null;
  document: Address | null;
}

/* ── Resolution: what the fleet says about a Scope, right now ─────────────────────────────── */

/** How the session was chosen: the only one running, the one holder, or the user's pin. */
export type ResolvedVia = "only" | "holder" | "pin";

export type ScopeResolution =
  | { kind: "resolved"; via: ResolvedVia; session: SdkSessionId; document: Address | null }
  /**
   * The chosen document is open nowhere. `eligible` lists the sessions of the document's year, so
   * the recovery verb is: one, open into it; several, pin one; none, start that year.
   */
  | { kind: "unheld"; document: Address; eligible: SdkSessionId[] }
  /** Two or more sessions hold the chosen document; the user picks one, which pins it. */
  | { kind: "ambiguous"; document: Address; holders: SdkSessionId[] }
  /** Nothing chosen and the fleet has zero or several sessions; the user picks a document. */
  | { kind: "unchosen"; sessions: SdkSessionId[] };

/**
 * Resolve a Scope against the fleet. Pure and total: the head renders it, a tool card explains a
 * refusal with it, and the host applies the same rules through its selector grammar. Nothing
 * here is stored, so it cannot go stale. `fileYear` is the chosen document's saved Revit year when
 * known; null means every session is eligible, and the SDK's own `doc open` version refusal is
 * the backstop.
 */
export function resolveScope(
  scope: Scope,
  fleet: readonly FleetSession[],
  fileYear: number | null = null,
): ScopeResolution {
  if (scope.kind === "none") {
    return fleet.length === 1
      ? { kind: "resolved", via: "only", session: fleet[0]!.id, document: fleet[0]!.document }
      : { kind: "unchosen", sessions: fleet.map((s) => s.id) };
  }
  const { document, pin } = scope;
  const holders = fleet.filter((s) => s.document === document);
  if (pin !== undefined && holders.some((h) => h.id === pin))
    return { kind: "resolved", via: "pin", session: pin, document };
  if (holders.length === 1)
    return { kind: "resolved", via: "holder", session: holders[0]!.id, document };
  if (holders.length > 1) return { kind: "ambiguous", document, holders: holders.map((h) => h.id) };
  const eligible = fleet
    .filter((s) => fileYear === null || s.year === null || s.year === fileYear)
    .map((s) => s.id);
  return { kind: "unheld", document, eligible };
}

/** What a call actually ran against, as the host resolved it; every pe_do/pe_read result carries one. */
export const resolvedTargetSchema = z.object({
  session: z.string().nullable(),
  document: z.string().nullable(),
});
export type ResolvedTarget = z.infer<typeof resolvedTargetSchema>;

/* ── Writes: every write says what it read ────────────────────────────────────────────────── */

/** `PUT /pe/scope/:thread`. `turn` is set only by pea's approved `scope_set` from inside a turn. */
export const putScopeSchema = z.object({
  scope: scopeSchema,
  expectedRevision: z.number().int().nonnegative(),
  turn: z.uuid().optional(),
});
export type PutScope = z.infer<typeof putScopeSchema>;

export const putScopeResultSchema = z.discriminatedUnion("why", [
  z.object({ ok: z.literal(true), why: z.literal("set"), head: headSchema }),
  /** Someone wrote first; `head` is current, re-read and decide again. */
  z.object({ ok: z.literal(false), why: z.literal("stale"), head: headSchema }),
  /** Pea is mid-turn and the write did not come from that turn; wait or stop it. */
  z.object({ ok: z.literal(false), why: z.literal("in-turn") }),
]);
export type PutScopeResult = z.infer<typeof putScopeResultSchema>;

/* ── Turn: the Head frozen at admission ───────────────────────────────────────────────────── */

/** The turn context frozen at admission and read by every tool through requestContext. */
export const turnContextKey = "pea.turn";
export const turnSchema = headSchema.extend({ id: z.uuid(), thread: z.string().min(1) });
export type Turn = z.infer<typeof turnSchema>;
export function turnOf(context: unknown): Turn | null {
  const requestContext = (context as { requestContext?: unknown } | undefined)?.requestContext;
  const raw =
    requestContext && typeof requestContext === "object" && "get" in requestContext
      ? (requestContext as { get(key: string): unknown }).get(turnContextKey)
      : (requestContext as Record<string, unknown> | undefined)?.[turnContextKey];
  return turnSchema.safeParse(raw).data ?? null;
}
