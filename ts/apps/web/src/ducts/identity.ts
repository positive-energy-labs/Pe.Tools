import type { Many } from "../../../../packages/agent-contracts/src/route-kernel-page.ts";
import { subjectCode, subjectOf, type SubjectRefCode } from "../../../../packages/agent-contracts/src/subject-ref.ts";
import { subjectSchema } from "@pe/agent-contracts/route-kernel-codecs";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import { systemScope } from "@pe/ducts-domain/system-scope";
import type { SubjectReference } from "@pe/kit/lang/attention";
import { elementIndex } from "../element-index.ts";
import { openSet } from "../shell/open-set.neutral.ts";
export { namesOf } from "../route/typed-route.ts";
/** A duct system is the SubjectRef `system-name:<name>` (ADR 0035 rule 2). */
export const systemCode = (name: string) => subjectCode({ keyKind: "system-name", key: name });
export const activeName = (value: Many<SubjectRefCode>, roster: readonly string[]) => {
  const id = openSet((id: SubjectRefCode) => id, roster.map(systemCode)).active(value);
  return id ? String(subjectOf(id).key) : "";
};
export type DuctsDestination = { kind: "route" } | { kind: "rule"; key: string } | { kind: "subject"; code: SubjectRefCode }
  /** An element the caller cannot name by UniqueId (outside its read): /ducts resolves the ElementId on arrival. */
  | { kind: "element"; id: number };
export function ductsLink(
  ids: readonly string[],
  search: Readonly<Record<string, unknown>>,
  destination: DuctsDestination = { kind: "route" },
) {
  const params = new URLSearchParams();
  for (const key of ["target", "fixture", "thread"])
    if (typeof search[key] === "string") params.set(key, search[key]);
  if (ids.length) params.set("system", JSON.stringify({ kind: "ids", ids: ids.map(systemCode) }));
  // A rule is a route attention place, never a SubjectRef (ADR 0035 rule 9).
  if (destination.kind === "rule")
    params.set("selected", JSON.stringify([{ kind: "focus", id: `rule:${destination.key}` }]));
  // An element SubjectRef is the attention key /ducts selects on arrival (`elementKey`).
  if (destination.kind === "subject") params.set("selected", JSON.stringify([{ kind: "focus", id: destination.code }]));
  if (destination.kind === "element") params.set("selected", JSON.stringify([{ kind: "focus", id: String(destination.id) }]));
  return `/ducts?${params}`;
}

/** A snapshot's elements as the attention bus knows them (ElementId <-> UniqueId). */
type Identified = { readonly id: number; readonly uniqueId?: string | null };
export const ductElements = (
  snapshot: { readonly nodes: readonly Identified[]; readonly segments: readonly Identified[] } | { readonly kind: string } | null | undefined,
) => elementIndex(snapshot && "nodes" in snapshot ? [...snapshot.nodes, ...snapshot.segments] : []);

/** The elements a Pointer place names in this snapshot (ADR 0030 rule 10), numbered for the
 * citation. Each `fan`/`system` id decodes through the one codec; an unknown subject drops. */
export function pointerRefs(
  place: Readonly<Record<string, string>>,
  snapshot: DuctSnapshot,
  doc: string,
  nameOf: (id: number) => string | null,
): SubjectReference[] {
  const refs = (text: string | undefined) => {
    const set = text === undefined ? null : subjectSchema(512).parse(JSON.parse(text));
    return set?.kind === "ids" ? set.ids.map(subjectOf) : [];
  };
  const elements = [...snapshot.nodes, ...snapshot.segments];
  const fans = refs(place.fan).flatMap((ref) =>
    ref.keyKind === "UniqueId" ? elements.filter((e) => e.uniqueId === ref.key).map((e) => e.id) : [],
  );
  const systems = refs(place.system).flatMap((ref) =>
    ref.keyKind === "system-name" && snapshot.systems.some((s) => s.name === ref.key)
      ? [...systemScope(snapshot, ref.key).members]
      : [],
  );
  const index = ductElements(snapshot);
  return [...new Set([...fans, ...systems])].flatMap((id, number) => {
    const key = index.keyOf(id);
    return key === null ? [] : [{
    doc,
    key,
    name: nameOf(id) ?? `element ${id}`,
    number: number + 1,
  }];
  });
}
