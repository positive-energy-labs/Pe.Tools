import { z } from "zod";
import { addressSchema, type Address } from "./reading.ts";

/**
 * Scope — what the user CHOSE for a chat thread. The host owns one Head per thread; the chat head
 * is its only writer and pea proposes a change through `scope_set`. Nothing else names a target.
 *
 * Four states, no nulls: `document` is the normal day (the session is derived from the one holder
 * on every call); `session` is an idle Revit with nothing open (a lifecycle target); `pinned` is a
 * document AND the session the user chose when two sessions held it; `none` is not yet chosen.
 * What the host RESOLVED is a different type (`ScopeResolution`), computed per call and never stored.
 */
export const sdkSessionIdSchema = z.string().regex(/^[a-z0-9._-]{1,64}$/);
export type SdkSessionId = z.infer<typeof sdkSessionIdSchema>;

export const scopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }).strict(),
  z.object({ kind: z.literal("document"), document: addressSchema }).strict(),
  z.object({ kind: z.literal("session"), session: sdkSessionIdSchema }).strict(),
  z
    .object({ kind: z.literal("pinned"), session: sdkSessionIdSchema, document: addressSchema })
    .strict(),
]);
export type Scope = z.infer<typeof scopeSchema>;
export const emptyScope: Scope = Object.freeze({ kind: "none" });

/** The session the user NAMED, if any. Derived sessions are not here; ask `resolve` for those. */
export const scopeSession = (scope: Scope): SdkSessionId | null =>
  scope.kind === "session" || scope.kind === "pinned" ? scope.session : null;
/** The document the user named, if any. */
export const scopeDocument = (scope: Scope): Address | null =>
  scope.kind === "document" || scope.kind === "pinned" ? scope.document : null;

/** A Scope plus the revision the host stamped on it; the head and every tool card show the revision. */
export const headSchema = z.object({
  scope: scopeSchema,
  revision: z.number().int().nonnegative(),
});
export type Head = z.infer<typeof headSchema>;

/** The persisted key a Scope-keyed route document lives under. */
export const scopeKey = (scope: Scope): string =>
  `scope:${scopeSession(scope) ?? ""}|${scopeDocument(scope) ?? ""}`;

/**
 * The host bridge selector for a Scope. The host's selector grammar is the adapter between the
 * typed Scope and the bridge: a named session wins, else the document (the host derives the one
 * holder and refuses two), else undefined so the host picks the only session.
 */
export function bridgeSelector(scope: Scope): string | undefined {
  switch (scope.kind) {
    case "none":
      return undefined;
    case "document":
      return `doc:${scope.document}`;
    case "session":
    case "pinned":
      return `session:${scope.session}`;
  }
}

/* ── Resolution: what the fleet says about a Scope, right now ─────────────────────────────── */

/** One connected session as the fleet reports it: its id and the document it has active. */
export interface FleetSession {
  id: SdkSessionId;
  document: Address | null;
}

export type ScopeResolution =
  | { kind: "resolved"; session: SdkSessionId; document: Address | null }
  /** The named document is open nowhere; `sessions` names every connected session. */
  | { kind: "unheld"; document: Address; sessions: SdkSessionId[] }
  /** Two or more sessions hold the named document; the user picks one, which pins it. */
  | { kind: "ambiguous"; document: Address; holders: SdkSessionId[] }
  /** The named session left the fleet. */
  | { kind: "gone"; session: SdkSessionId }
  /** Nothing chosen and the fleet has zero or several sessions, so nothing can be picked for the user. */
  | { kind: "nothing"; sessions: SdkSessionId[] };

/**
 * Resolve a Scope against the fleet. Pure and total: the head renders it, a tool card explains a
 * refusal with it, and the host applies the same rules through its selector grammar. Nothing
 * here is stored, so it cannot go stale.
 */
export function resolveScope(scope: Scope, fleet: readonly FleetSession[]): ScopeResolution {
  const ids = fleet.map((session) => session.id);
  switch (scope.kind) {
    case "none":
      return fleet.length === 1
        ? { kind: "resolved", session: fleet[0]!.id, document: fleet[0]!.document }
        : { kind: "nothing", sessions: ids };
    case "session": {
      const session = fleet.find((entry) => entry.id === scope.session);
      return session
        ? { kind: "resolved", session: session.id, document: session.document }
        : { kind: "gone", session: scope.session };
    }
    case "document": {
      const holders = fleet.filter((entry) => entry.document === scope.document);
      if (holders.length === 1)
        return { kind: "resolved", session: holders[0]!.id, document: scope.document };
      if (holders.length === 0) return { kind: "unheld", document: scope.document, sessions: ids };
      return { kind: "ambiguous", document: scope.document, holders: holders.map((h) => h.id) };
    }
    case "pinned": {
      const session = fleet.find((entry) => entry.id === scope.session);
      if (!session) return { kind: "gone", session: scope.session };
      if (session.document !== scope.document)
        return {
          kind: "unheld",
          document: scope.document,
          sessions: fleet.filter((entry) => entry.document === scope.document).map((h) => h.id),
        };
      return { kind: "resolved", session: session.id, document: scope.document };
    }
  }
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
  z.object({ ok: z.literal(false), why: z.literal("in-turn"), turn: z.uuid() }),
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
