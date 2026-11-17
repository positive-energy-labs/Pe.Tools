import type { Many } from "../../../../packages/agent-contracts/src/route-kernel-page.ts";
import { subjectCode, subjectOf, type SubjectRefCode } from "../../../../packages/agent-contracts/src/subject-ref.ts";
import { elementIndex } from "../element-index.ts";
import { openSet } from "../shell/open-set.neutral.ts";
import { z } from "zod";
export const fanScopeSchema = z.object({ unitId: z.number().int().positive(), portIndex: z.number().int().nonnegative() });
export type FanScope = z.infer<typeof fanScopeSchema>;
/** A port walk's segments carry single canonical system names; equipment labels may combine names. */
export const fanSystems = (walk: { segments: readonly { systemName?: string | null; reason?: string | null }[] }, roster: readonly { name: string }[]) =>
  roster.filter(system => walk.segments.some(segment => segment.reason === "walked" && segment.systemName === system.name)).map(system => system.name);
export { namesOf } from "../route/typed-route.ts";
/** A duct system is the SubjectRef `system-name:<name>` (ADR 0035 rule 2). */
export const systemCode = (name: string) => subjectCode({ keyKind: "system-name", key: name });
export const activeName = (value: Many<SubjectRefCode>, roster: readonly string[]) => {
  const id = openSet((id: SubjectRefCode) => id, roster.map(systemCode)).active(value);
  return id ? String(subjectOf(id).key) : "";
};
export type DuctsDestination = { kind: "route" } | { kind: "rule"; key: string } | { kind: "subject"; code: SubjectRefCode };
export function ductsLink(
  ids: readonly string[] | FanScope | null,
  search: Readonly<Record<string, unknown>>,
  destination: DuctsDestination = { kind: "route" },
) {
  const params = new URLSearchParams();
  for (const key of ["target", "fixture", "thread"])
    if (typeof search[key] === "string") params.set(key, search[key]);
  if (ids && "unitId" in ids) params.set("fan", JSON.stringify({ unitId: ids.unitId, portIndex: ids.portIndex }));
  else if (Array.isArray(ids) && ids.length) params.set("system", JSON.stringify({ kind: "ids", ids: ids.map(systemCode) }));
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
