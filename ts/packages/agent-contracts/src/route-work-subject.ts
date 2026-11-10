import type { RouteGraphJson } from "./route-kernel-data.ts";
import { decode } from "./subject-ref.ts";

/** A workspace SubjectRef's key is the host workspace id. Encoded codes remain Page/selection
 * transport and never become persisted Work keys. */
export function routeWorkSubject(
  data: RouteGraphJson,
  page: Readonly<Record<string, unknown>>,
): string | undefined {
  if (!data.workSubject) return undefined;
  const field = data.fields[data.workSubject];
  if (field?.role !== "subject" || field.cardinality !== "one")
    throw Error("workSubject requires one subject field");
  const value = page[data.workSubject];
  if (value == null) return "default";
  if (typeof value !== "string") throw Error("Invalid Work subject identity");
  const ref = decode(value);
  if (!ref.ok) throw Error(ref.reason);
  if (ref.value.keyKind !== "workspace") throw Error("workSubject must name a workspace SubjectRef");
  return ref.value.key;
}
