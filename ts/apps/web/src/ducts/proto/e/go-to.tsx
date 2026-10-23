/**
 * Go to a subject: the kit picker over every system and every element of the read snapshot.
 * Type a name, a family, a size, a system or an element id; hovering a row lights the element in
 * the picture, picking one travels there (the canvas's alias flight). `/` in the picture opens it.
 * It replaces the tree's go-to field (`navigate.ts`, deleted 2026-10-22 with no stated reason).
 * Listed: this system's elements, every system, and elsewhere only the parts people name by tag
 * (grilles, units); any other element answers its typed id (the list's create row). Listing all
 * eleven thousand elements of a large model cost a 200 ms open (Chadds, 2026-10-23).
 */
import { GoToPopup } from "@pe/kit/lang/go-to";
import { NO_SYSTEM, systemScope, systemsOf } from "@pe/ducts-domain/system-scope";
import type { DuctSnapshot } from "@pe/ducts-domain/types";

export type GoTarget = { system: string; id: number | null };
type Item = GoTarget & { key: string; name: string; detail: string; group: string; meta: string };

const HERE = "In this system";
const ELSEWHERE = "Elsewhere";
const SYSTEMS = "Systems";

function itemsOf(snapshot: DuctSnapshot, system: string, nameOf: (id: number) => string): Item[] {
  const here = system ? systemScope(snapshot, system).members : new Set<number>();
  const systemsOfGroup = new Map(snapshot.groups.map((g) => [g.id, g.systemNames]));
  const tagged = (e: DuctSnapshot["nodes"][number] | DuctSnapshot["segments"][number]) =>
    here.has(e.id) || ("kind" in e && (e.kind === "terminal" || e.kind === "equipment"));
  const elements = [...snapshot.nodes, ...snapshot.segments].filter(tagged).map((e): Item => {
    // Its own system, else the first of the network it sits in (the old go-to's rule).
    const into = e.systemName || (e.groupId && systemsOfGroup.get(e.groupId)?.[0]) || NO_SYSTEM;
    const kind = ("size" in e ? [e.type, e.size] : [e.family, e.type]).filter(Boolean).join(" · ");
    return {
      key: `e${e.id}`,
      system: here.has(e.id) ? system : into,
      id: e.id,
      name: nameOf(e.id),
      detail: `${kind} ${into} ${"category" in e ? (e.category ?? "") : "duct"}`,
      group: here.has(e.id) ? HERE : ELSEWHERE,
      meta: here.has(e.id) ? kind : `${kind} · ${into}`,
    };
  });
  const systems = systemsOf(snapshot).map(
    (s): Item => ({
      key: `s${s.name}`,
      system: s.name,
      id: null,
      name: s.name,
      detail: s.classification ?? "",
      group: SYSTEMS,
      meta: s.classification ?? "",
    }),
  );
  return [...elements, ...systems];
}

/** The element a typed id names, anywhere in the snapshot, as a go-to target. */
function byId(snapshot: DuctSnapshot, text: string): GoTarget | null {
  const id = Number(text.trim());
  const e = Number.isSafeInteger(id)
    ? (snapshot.nodes.find((n) => n.id === id) ?? snapshot.segments.find((s) => s.id === id))
    : undefined;
  if (!e) return null;
  const system =
    e.systemName || snapshot.groups.find((g) => g.id === e.groupId)?.systemNames[0] || NO_SYSTEM;
  return { system, id: e.id };
}

export function GoToSubject({
  snapshot,
  system,
  nameOf,
  onGo,
  onHover,
}: {
  snapshot: DuctSnapshot;
  system: string;
  nameOf: (id: number) => string;
  onGo: (target: GoTarget) => void;
  onHover: (id: number | null) => void;
}) {
  return (
    <GoToPopup<Item>
      items={() => itemsOf(snapshot, system, nameOf)}
      leadingGroups={system ? [HERE, SYSTEMS, ELSEWHERE] : [SYSTEMS, ELSEWHERE]}
      onGo={onGo}
      hover={(item) => onHover(item?.id ?? null)}
      resolveId={(text) => {
        const target = byId(snapshot, text);
        return target
          ? {
              ...target,
              key: `e${target.id}`,
              name: nameOf(target.id!),
              detail: "",
              group: ELSEWHERE,
              meta: "",
            }
          : null;
      }}
    />
  );
}
