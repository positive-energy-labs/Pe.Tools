import type { Many } from "../../../../packages/agent-contracts/src/route-kernel-page.ts";
import { subjectCode, subjectOf, type SubjectRefCode } from "../../../../packages/agent-contracts/src/subject-ref.ts";
import { subjectSchema } from "@pe/agent-contracts/route-kernel-codecs";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import { systemScope } from "@pe/ducts-domain/system-scope";
import { elementKey, type SubjectReference } from "@pe/kit/lang/attention";
import { openSet } from "../shell/open-set.neutral.ts";
export { namesOf } from "../route/typed-route.ts";
/** A duct system is the SubjectRef `system-name:<name>` (ADR 0035 rule 2). */
export const systemCode = (name: string) => subjectCode({ keyKind: "system-name", key: name });
export const activeName = (value: Many<SubjectRefCode>, roster: readonly string[]) => {
  const id = openSet((id: SubjectRefCode) => id, roster.map(systemCode)).active(value);
  return id ? String(subjectOf(id).key) : "";
};
export type DuctsDestination = { kind: "route" } | { kind: "rule"; key: string };
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
  return `/ducts?${params}`;
}

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
  return [...new Set([...fans, ...systems])].map((id, index) => ({
    doc,
    key: elementKey(id),
    name: nameOf(id) ?? `element ${id}`,
    number: index + 1,
  }));
}
