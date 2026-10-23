/**
 * Go to a subject: the kit picker over every system and every element of the read snapshot.
 * Type a name, a family, a size, a system or an element id; hovering a row lights the element in
 * the picture, picking one travels there (the canvas's alias flight). `/` in the picture opens it.
 * It replaces the tree's go-to field (`navigate.ts`, deleted 2026-10-22 with no stated reason).
 * Listed: this system's elements, every system, and elsewhere only the parts people name by tag
 * (grilles, units); any other element answers its typed id (the list's create row). Listing all
 * eleven thousand elements of a large model cost a 200 ms open (Chadds, 2026-10-23).
 */
import { useMemo, useState } from "react";
import { Search } from "lucide-react";

import { useScopeKeys } from "@pe/kit/keys";
import { ListPopup } from "@pe/kit/lang/list-popup";
import { NO_SYSTEM, systemScope, systemsOf } from "@pe/ducts-domain/system-scope";
import type { DuctSnapshot } from "@pe/ducts-domain/types";

export type GoTarget = { system: string; id: number | null };
type Item = GoTarget & { key: string; name: string; detail: string; group: string; meta: string };

const HERE = "In this system";
const ELSEWHERE = "Elsewhere";
const SYSTEMS = "Systems";

function itemsOf(
  snapshot: DuctSnapshot,
  system: string,
  nameOf: (id: number) => string,
): Item[] {
  const here = system ? systemScope(snapshot, system).members : new Set<number>();
  const systemsOfGroup = new Map(snapshot.groups.map((g) => [g.id, g.systemNames]));
  const tagged = (e: DuctSnapshot["nodes"][number] | DuctSnapshot["segments"][number]) =>
    here.has(e.id) || ("kind" in e && (e.kind === "terminal" || e.kind === "equipment"));
  const elements = [...snapshot.nodes, ...snapshot.segments].filter(tagged).map((e): Item => {
    // Its own system, else the first of the network it sits in (the old go-to's rule).
    const into = e.systemName || (e.groupId && systemsOfGroup.get(e.groupId)?.[0]) || NO_SYSTEM;
    const kind = ("size" in e ? [e.type, e.size] : [e.family, e.type])
      .filter(Boolean)
      .join(" · ");
    return {
      key: `e${e.id}`,
      system: here.has(e.id) ? system : into,
      id: e.id,
      name: nameOf(e.id),
      detail: `${kind} ${into} ${"category" in e ? (e.category ?? "") : "duct"} ${e.id}`,
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
  const [open, setOpen] = useState(false);
  // Built only while open: naming eleven thousand elements is not a render's work.
  const items = useMemo(
    () => (open ? itemsOf(snapshot, system, nameOf) : []),
    [open, snapshot, system, nameOf],
  );
  const byKey = useMemo(() => new Map(items.map((i) => [i.key, i])), [items]);
  useScopeKeys([
    {
      hotkey: "/",
      label: "go to",
      says: "Go to a subject: type a name, family, size, system or element id",
      callback: () => setOpen(true),
    },
  ]);
  return (
    <ListPopup<Item>
      anchor="trigger"
      face="icon"
      trigger={<Search aria-hidden />}
      triggerLabel="go to a subject"
      title="Go to a subject · /"
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) onHover(null);
      }}
      aria-label="go to a subject"
      purpose="autocomplete"
      items={items}
      keyOf={(i) => i.key}
      labelOf={(i) => i.name}
      detailOf={(i) => i.detail}
      groupOf={(i) => i.group}
      leadingGroups={system ? [HERE, SYSTEMS, ELSEWHERE] : [SYSTEMS, ELSEWHERE]}
      groupCap={8}
      filter="words"
      select="single"
      searchAbove={0}
      searchPlaceholder="name, family, size, system or id"
      empty="nothing read yet"
      noMatch="no system or element matches"
      maxHeight="24rem"
      onCursorChange={(key) => onHover((key ? byKey.get(key)?.id : null) ?? null)}
      onPick={(i) => onGo({ system: i.system, id: i.id })}
      onCreate={(text) => {
        const to = byId(snapshot, text);
        if (to) onGo(to);
        setOpen(false);
      }}
      createLabel={(text) =>
        byId(snapshot, text) ? `go to element ${text.trim()}` : `${text.trim()}: no element by that id`
      }
      row={(i) => ({ label: i.name, meta: i.meta })}
    />
  );
}
