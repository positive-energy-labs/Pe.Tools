import type { RouteGraphJson } from "./route-kernel-data.ts";
import type { RouteBindings } from "./route-bodies.ts";

/** A local identity's decoded subject is the host workspace id. Encoded identity bytes
 * remain Page/selection transport and never become persisted Work keys. */
export function routeWorkSubject(
  data: RouteGraphJson,
  bindings: Pick<RouteBindings, "identities">,
  page: Readonly<Record<string, unknown>>,
): string | undefined {
  if (!data.workSubject) return undefined;
  const field = data.fields[data.workSubject];
  if (
    field?.role !== "subject" ||
    field.cardinality !== "one" ||
    typeof field.identity !== "string"
  )
    throw Error("workSubject requires one local subject identity");
  const identity = data.identities[field.identity];
  const codec = identity && bindings.identities[identity.codec];
  if (identity?.kind !== "local" || codec?.kind !== "local")
    throw Error("workSubject identity codec must decode to a local Work key");
  const value = page[data.workSubject];
  if (value == null) return "default";
  if (typeof value !== "string") throw Error("Invalid Work subject identity");
  const decoded = codec.decode(value) as { ok: boolean; value?: unknown; reason?: string };
  if (!decoded.ok) throw Error(decoded.reason ?? "Invalid Work subject identity");
  const parts = codec.parts(decoded.value) as { subject?: unknown };
  if (typeof parts?.subject !== "string" || !parts.subject.trim())
    throw Error("workSubject codec did not decode a Work key");
  return parts.subject;
}
