/**
 * Go to a subject: the kit picker over every system and the named elements of the read snapshot.
 * Type a name, a family, a size, a system or an element id; picking an element flies the picture
 * there, picking a system adds it beside what is open (kaitpw 2026-11-03: it never replaces).
 * `/` in the picture opens it. Listed: what is open here, every system, and elsewhere only the
 * parts people name by tag (grilles, units); any other element answers its typed id. Listing all
 * eleven thousand elements of a large model cost a 200 ms open (Chadds, 2026-10-23).
 */
import { GoToPopup } from "@pe/kit/lang/go-to";
import { NO_SYSTEM, systemsOf } from "@pe/ducts-domain/system-scope";
import type { DuctSnapshot } from "@pe/ducts-domain/types";

export type GoTarget = { system: string; id: number | null };
type Item = GoTarget & { uniqueId?: string | null; key: string; name: string; detail: string; group: string; meta: string };
type Element = DuctSnapshot["nodes"][number] | DuctSnapshot["segments"][number];

const HERE = "Open here";
const ELSEWHERE = "Elsewhere";
const SYSTEMS = "Systems";

/** Its own system, else the first of the network it sits in. */
const systemOf = (snapshot: DuctSnapshot, e: Element) =>
  e.systemName || snapshot.groups.find((g) => g.id === e.groupId)?.systemNames[0] || NO_SYSTEM;

function itemsOf(
  snapshot: DuctSnapshot,
  here: ReadonlySet<number>,
  opens: (system: string) => boolean,
  nameOf: (id: number) => string,
): Item[] {
  const tagged = (e: Element) =>
    here.has(e.id) || ("kind" in e && (e.kind === "terminal" || e.kind === "equipment"));
  const elements = [...snapshot.nodes, ...snapshot.segments].filter(tagged).map((e): Item => {
    const into = systemOf(snapshot, e);
    const kind = ("size" in e ? [e.type, e.size] : [e.family, e.type]).filter(Boolean).join(" · ");
    return {
      key: `e${e.id}`,
      system: into,
      id: e.id,
      uniqueId: e.uniqueId,
      name: nameOf(e.id),
      detail: `${kind} ${into} ${"category" in e ? (e.category ?? "") : "duct"}`,
      group: here.has(e.id) ? HERE : ELSEWHERE,
      meta: here.has(e.id) ? kind : `${kind} · ${into}`,
    };
  });
  const systems = systemsOf(snapshot)
    .filter((s) => opens(s.name))
    .map(
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

export function GoToSubject({
  snapshot,
  here,
  opens,
  nameOf,
  onGo,
}: {
  snapshot: DuctSnapshot;
  /** The elements open here: listed first. */
  here: ReadonlySet<number>;
  /** Whether picking this system opens anything; a system that opens nothing is not listed. */
  opens: (system: string) => boolean;
  nameOf: (id: number) => string;
  onGo: (target: GoTarget) => void;
}) {
  return (
    <GoToPopup<Item>
      items={() => itemsOf(snapshot, here, opens, nameOf)}
      leadingGroups={[HERE, SYSTEMS, ELSEWHERE]}
      onGo={onGo}
      resolveId={(text) => {
        const id = Number(text.trim());
        const e = Number.isSafeInteger(id)
          ? (snapshot.nodes.find((n) => n.id === id) ?? snapshot.segments.find((s) => s.id === id))
          : undefined;
        return e
          ? {
              key: `e${e.id}`,
              system: systemOf(snapshot, e),
              id: e.id,
              uniqueId: e.uniqueId,
              name: nameOf(e.id),
              detail: "",
              group: ELSEWHERE,
              meta: "",
            }
          : null;
      }}
    />
  );
}
