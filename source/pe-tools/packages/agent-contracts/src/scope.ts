import { z } from "zod";
import { addressSchema, type Address } from "./reading.ts";

/**
 * Scope: what the user CHOSE for a chat thread. Two states, no nulls. `document` is the normal day;
 * the session is derived from the one holder on every call. `pin` is a tiebreak, not a claim: it
 * names the session the user picked when two held the document, and it counts only while that
 * session still holds the document and is eligible. There is no session scope; an idle Revit is
 * reached by opening a document into it (an instances verb), and a doc-free call takes any eligible
 * session. What the fleet RESOLVED is a different type (`ScopeResolution`), computed per call and
 * never stored. Verdict kaitpw 2026-09-05: the lean model, session scope deleted.
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

/** A Scope plus the revision the host stamped on it; the head and every tool card show the revision. */
export const headSchema = z.object({
  scope: scopeSchema,
  revision: z.number().int().nonnegative(),
});
export type Head = z.infer<typeof headSchema>;

/* ── Fleet: what the host reports about connected sessions ────────────────────────────────── */

/**
 * One connected session. `year` is the Revit year; it is the eligibility key, because a file opens
 * only in the year that saved it (upgrade is a separate, never implicit, human verb).
 */
export interface FleetSession {
  id: SdkSessionId;
  year: number;
  document: Address | null;
}

/* ── Resolution: what the fleet says about a Scope, right now ─────────────────────────────── */

/** How the session was chosen: the only one running, the one holder, or the user's pin. */
export type ResolvedVia = "only" | "holder" | "pin";

export type ScopeResolution =
  | { kind: "resolved"; via: ResolvedVia; session: SdkSessionId; document: Address | null }
  /**
   * The chosen document is open nowhere. `eligible` lists sessions of the document's year, so the
   * recovery verb is: one, open into it; several, pin one; none, start that year.
   */
  | { kind: "unheld"; document: Address; eligible: SdkSessionId[] }
  /** Two or more sessions hold the chosen document; the user picks one, which pins it. */
  | { kind: "ambiguous"; document: Address; holders: SdkSessionId[] }
  /** Nothing chosen and the fleet has zero or several sessions; the user picks a document. */
  | { kind: "unchosen"; sessions: SdkSessionId[] };

/**
 * Resolve a Scope against the fleet. Pure and total; nothing here is stored, so it cannot go stale.
 * `fileYear` is the chosen document's saved Revit year when known. Unknown (null) means every
 * session is eligible; the SDK's own `doc open` refuses a wrong-year open, so the backstop holds.
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
  const eligible = fleet.filter((s) => fileYear === null || s.year === fileYear).map((s) => s.id);
  return { kind: "unheld", document, eligible };
}

/** What a call actually ran against, as the host resolved it; every pe_do/pe_read result carries one. */
export const resolvedTargetSchema = z.object({
  session: z.string().nullable(),
  document: z.string().nullable(),
});
export type ResolvedTarget = z.infer<typeof resolvedTargetSchema>;
