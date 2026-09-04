import { z } from "zod";
import { addressSchema } from "./reading.ts";

/**
 * Scope — the ONE target a chat thread acts on: an SDK session and a Revit document, either
 * absent. The host owns one Scope per thread; every pea tool call resolves its target from the
 * frozen Scope revision its turn was admitted under. Nothing else names a target.
 */
export const sdkSessionIdSchema = z.string().regex(/^[a-z0-9._-]{1,64}$/);
export const scopeSchema = z
  .object({ session: sdkSessionIdSchema.nullable(), document: addressSchema.nullable() })
  .strict();
export type Scope = z.infer<typeof scopeSchema>;
export const emptyScope: Scope = Object.freeze({ session: null, document: null });

/** A Scope plus the revision the host stamped on it; the head and every tool card show the revision. */
export const scopeRevisionSchema = z.object({
  scope: scopeSchema,
  revision: z.number().int().nonnegative(),
});
export type ScopeRevision = z.infer<typeof scopeRevisionSchema>;
export const scopeKey = (scope: Scope): string =>
  `scope:${scope.session ?? ""}|${scope.document ?? ""}`;
/** The host bridge selector for a Scope's session; undefined lets the host pick the only session. */
export const bridgeSelector = (scope: Scope): string | undefined =>
  scope.session ? `session:${scope.session}` : undefined;

/** The turn context frozen at admission and read by every tool through requestContext. */
export const turnContextKey = "pea.turn";
export const turnSchema = scopeRevisionSchema.extend({ id: z.uuid(), thread: z.string().min(1) });
export type Turn = z.infer<typeof turnSchema>;
export function turnOf(context: unknown): Turn | null {
  const requestContext = (context as { requestContext?: unknown } | undefined)?.requestContext;
  const raw =
    requestContext && typeof requestContext === "object" && "get" in requestContext
      ? (requestContext as { get(key: string): unknown }).get(turnContextKey)
      : (requestContext as Record<string, unknown> | undefined)?.[turnContextKey];
  return turnSchema.safeParse(raw).data ?? null;
}
