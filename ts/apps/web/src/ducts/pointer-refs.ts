import type { DuctSnapshot } from "@pe/ducts-domain/types";
import { systemScope } from "@pe/ducts-domain/system-scope";
import { elementKey, type SubjectReference } from "@pe/kit/lang/attention";

/*
 * Pointer place → the route's own refs (ADR 0030 rule 10). Pea writes `place` with this route's
 * attention codecs: `fan` and `system` are JSON of `{kind:"ids", ids:[localId]}` where a local id is
 * `JSON.stringify([namespace, subject])`. Refs are the snapshot's real element keys (`e:<id>`), the
 * same keys NativeObservationScope and SubjectText cite; nothing here writes the page.
 */
const ids = (text: string | undefined): string[] => {
  if (text === undefined) return [];
  const value = JSON.parse(text) as { kind: string; ids?: unknown[] };
  return value.kind === "ids" && Array.isArray(value.ids)
    ? value.ids.map((id) => (JSON.parse(String(id)) as [string, string])[1])
    : [];
};

/** The elements a pointer names in this snapshot, numbered for the citation; unknown subjects drop. */
export function pointerRefs(
  place: Readonly<Record<string, string>>,
  snapshot: DuctSnapshot,
  doc: string,
  nameOf: (id: number) => string | null,
): SubjectReference[] {
  const elements = [...snapshot.nodes, ...snapshot.segments];
  // A fan's canonical id is `<unit uniqueId>@<port>`: the unit is the snapshot element with that uniqueId.
  const fans = ids(place.fan).flatMap((subject) => {
    const unique = subject.slice(0, subject.lastIndexOf("@"));
    return elements.filter((e) => e.uniqueId === unique).map((e) => e.id);
  });
  const systems = ids(place.system).flatMap((name) =>
    snapshot.systems.some((s) => s.name === name) ? [...systemScope(snapshot, name).members] : [],
  );
  return [...new Set([...fans, ...systems])].map((id, index) => ({
    doc,
    key: elementKey(id),
    name: nameOf(id) ?? `element ${id}`,
    number: index + 1,
  }));
}
