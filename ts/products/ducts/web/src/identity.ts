import type { Many } from "../../../../packages/agent-contracts/src/route-kernel-page.ts";
import { subjectCode, subjectOf, type SubjectRefCode } from "@pe/agent-contracts/subject-ref";
import { elementIndex } from "../../../../apps/web/src/element-index.ts";
import { openSet } from "../../../../apps/web/src/shell/open-set.neutral.ts";
export { namesOf } from "../../../../apps/web/src/route/typed-route.ts";
/** A duct system is the SubjectRef `system-name:<name>` (ADR 0035 rule 2). */
export const systemCode = (name: string) => subjectCode({ keyKind: "system-name", key: name });
export const activeName = (value: Many<SubjectRefCode>, roster: readonly string[]) => {
  const id = openSet((id: SubjectRefCode) => id, roster.map(systemCode)).active(value);
  return id ? String(subjectOf(id).key) : "";
};
export type DuctsDestination = { kind: "route" } | { kind: "rule"; key: string } | { kind: "subject"; code: SubjectRefCode };
export function ductsLink(
  ids: readonly string[] | "all",
  search: Readonly<Record<string, unknown>>,
  destination: DuctsDestination = { kind: "route" },
) {
  const params = new URLSearchParams();
  for (const key of ["target", "fixture", "thread"])
    if (typeof search[key] === "string") params.set(key, search[key]);
  if (ids === "all") params.set("system", JSON.stringify({ kind: "all" }));
  else if (ids.length) params.set("system", JSON.stringify({ kind: "ids", ids: ids.map(systemCode) }));
  // A rule is a route attention place, never a SubjectRef (ADR 0035 rule 9).
  if (destination.kind === "rule")
    params.set("selected", JSON.stringify([{ kind: "focus", id: `rule:${destination.key}` }]));
  // An element SubjectRef is the attention key /ducts selects on arrival (`elementKey`).
  if (destination.kind === "subject") params.set("selected", JSON.stringify([{ kind: "focus", id: destination.code }]));
  return `/ducts?${params}`;
}

/** A snapshot's elements as the attention bus knows them (ElementId <-> UniqueId). */
type Identified = { readonly id: number; readonly uniqueId?: string | null };
export const ductElements = (
  snapshot: { readonly nodes: readonly Identified[]; readonly segments: readonly Identified[] } | { readonly kind: string } | null | undefined,
) => elementIndex(snapshot && "nodes" in snapshot ? [...snapshot.nodes, ...snapshot.segments] : []);
