import type { Many } from "@pe/agent-contracts/route-kernel-page";
import { subjectCode, subjectOf, type SubjectRefCode } from "@pe/agent-contracts/subject-ref";
import { elementIndex } from "@pe/web-kernel/element-index";
import { openSet } from "@pe/web-kernel/shell/subject-set";
import type { FanScope } from "@pe/ducts-contract/fan-scope.neutral";
export { fanScopeSchema, fanSystems, type FanScope } from "@pe/ducts-contract/fan-scope.neutral";
export { namesOf } from "@pe/web-kernel/route/typed-route";
/** A duct system is the SubjectRef `system-name:<name>` (ADR 0035 rule 2). */
export const systemCode = (name: string) => subjectCode({ keyKind: "system-name", key: name });
export const activeName = (value: Many<SubjectRefCode>, roster: readonly string[]) => {
  const id = openSet((id: SubjectRefCode) => id, roster.map(systemCode)).active(value);
  return id ? String(subjectOf(id).key) : "";
};
export type DuctsDestination =
  | { kind: "route" }
  | { kind: "rule"; key: string }
  | { kind: "subject"; code: SubjectRefCode };
export function ductsLink(
  ids: readonly string[] | FanScope | null,
  search: Readonly<Record<string, unknown>>,
  destination: DuctsDestination = { kind: "route" },
) {
  const params = new URLSearchParams();
  for (const key of ["target", "fixture", "thread"])
    if (typeof search[key] === "string") params.set(key, search[key]);
  // A link owns both scope fields. An omitted field would reopen the remembered scope.
  const fan = ids && "unitId" in ids ? { unitId: ids.unitId, portIndex: ids.portIndex } : null;
  params.set("fan", JSON.stringify(fan));
  params.set(
    "system",
    JSON.stringify({ kind: "ids", ids: Array.isArray(ids) ? ids.map(systemCode) : [] }),
  );
  // A rule is a route attention place, never a SubjectRef (ADR 0035 rule 9).
  if (destination.kind === "rule")
    params.set("selected", JSON.stringify([{ kind: "focus", id: `rule:${destination.key}` }]));
  // An element SubjectRef is the attention key /ducts selects on arrival (`elementKey`).
  if (destination.kind === "subject")
    params.set("selected", JSON.stringify([{ kind: "focus", id: destination.code }]));
  return `/duct-systems?${params}`;
}

/** A snapshot's elements as the attention bus knows them (ElementId <-> UniqueId). */
type Identified = { readonly id: number; readonly uniqueId?: string | null };
export const ductElements = (
  snapshot:
    | { readonly nodes: readonly Identified[]; readonly segments: readonly Identified[] }
    | { readonly kind: string }
    | null
    | undefined,
) => elementIndex(snapshot && "nodes" in snapshot ? [...snapshot.nodes, ...snapshot.segments] : []);
