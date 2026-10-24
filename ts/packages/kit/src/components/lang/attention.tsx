import * as Atom from "effect/unstable/reactivity/Atom";
import type * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { createContext, useContext, useEffect } from "react";
import { HOVER_GRACE } from "./hover-grace";

export type SubjectKind = "e" | "run" | "leg" | "system" | "room" | "issue";
// The payload is opaque. A future link kind can carry a link path without changing Ref.
export type SubjectKey = `${SubjectKind}:${string}`;
export type Ref = { doc: string; key: SubjectKey };
export type SubjectReference = Ref & { name: string; number: number };
export type Citation = { owner: string; refs: readonly SubjectReference[]; focus: Ref | null };
export type Rung = "selected" | "focus" | "hover" | "reach" | "rest";
export type Members = (key: SubjectKey) => readonly SubjectKey[];
/** Composite hover targets carry Subject keys, so their members can later include link keys. */
export const memberKey = (keys: readonly SubjectKey[]): SubjectKey =>
  keys.length === 1 ? keys[0]! : `leg:${JSON.stringify(keys)}`;
export const resolveMembers: Members = (key) =>
  key.startsWith("leg:[") ? (JSON.parse(key.slice(4)) as SubjectKey[]) : [key];
const identity = resolveMembers;
const empty: ReadonlySet<SubjectKey> = new Set();
const label = (name: string) => Atom.withLabel(`attention/${name}`);
export const hovered = Atom.make<Ref | null>(null).pipe(Atom.keepAlive, label("hovered"));
export const citation = Atom.make<Citation | null>(null).pipe(Atom.keepAlive, label("citation"));
export const members = Atom.family((doc: string) =>
  Atom.make<{ resolve: Members }>({ resolve: identity }).pipe(label(`${doc}/members`)),
);
/** A reference to Page's derived atom, never a second writable selection. */
export const selection = Atom.family((doc: string) =>
  Atom.make<Atom.Atom<ReadonlySet<SubjectKey>> | null>(null).pipe(label(`${doc}/selection`)),
);
export const picture = Atom.family((doc: string) =>
  Atom.make<{ box: (() => DOMRect | null) | null }>({ box: null }).pipe(label(`${doc}/picture`)),
);
export const AttentionDocument = createContext<string | null>(null);
export const sameRef = (a: Ref | null, b: Ref | null) => a?.doc === b?.doc && a?.key === b?.key;
export const elementKey = (id: number | string): SubjectKey => `e:${id}`;
export const citationOwner = (doc: string, owner: string) => JSON.stringify([doc, owner]);
export const mention = (ref: Ref) => ({ "data-subject": ref.key, "data-subject-doc": ref.doc });
export function useMention() {
  const doc = useContext(AttentionDocument);
  return (key: SubjectKey | null | undefined) => (doc && key ? mention({ doc, key }) : {});
}
export function setHovered(registry: AtomRegistry.AtomRegistry, ref: Ref | null) {
  if (!sameRef(registry.get(hovered), ref)) registry.set(hovered, ref);
}
export function clearCitation(registry: AtomRegistry.AtomRegistry, owner: string) {
  if (registry.get(citation)?.owner === owner) registry.set(citation, null);
}
const clearTimers = new WeakMap<AtomRegistry.AtomRegistry, ReturnType<typeof setTimeout>>();
export function holdCitation(registry: AtomRegistry.AtomRegistry) {
  clearTimeout(clearTimers.get(registry));
  clearTimers.delete(registry);
}
export function leaveCitation(registry: AtomRegistry.AtomRegistry, owner: string) {
  holdCitation(registry);
  clearTimers.set(
    registry,
    setTimeout(() => {
      clearTimers.delete(registry);
      clearCitation(registry, owner);
    }, HOVER_GRACE),
  );
}
export function cite(registry: AtomRegistry.AtomRegistry, value: Citation) {
  holdCitation(registry);
  const old = registry.get(citation);
  if (
    old?.owner === value.owner &&
    sameRef(old.focus, value.focus) &&
    old.refs.length === value.refs.length &&
    old.refs.every(
      (ref, i) =>
        sameRef(ref, value.refs[i]!) &&
        ref.number === value.refs[i]!.number &&
        ref.name === value.refs[i]!.name,
    )
  )
    return;
  registry.set(citation, value);
}
const expand = (keys: Iterable<SubjectKey>, resolve: Members) => {
  const found = new Set<SubjectKey>();
  const seen = new Set<SubjectKey>();
  const visit = (key: SubjectKey) => {
    if (seen.has(key)) return;
    seen.add(key);
    const children = resolve(key);
    if (children.length === 1 && children[0] === key) found.add(key);
    else children.forEach(visit);
  };
  for (const key of keys) visit(key);
  return found;
};
const hoverIn = Atom.family((doc: string) =>
  Atom.make((get) => {
    const ref = get(hovered);
    return ref?.doc === doc ? ref.key : null;
  }),
);
const citationIn = Atom.family((doc: string) =>
  Atom.make((get) => {
    const value = get(citation);
    return value?.refs.some((ref) => ref.doc === doc) ? value : null;
  }),
);
export const attention = Atom.family((doc: string) =>
  Atom.make((get) => {
    const resolve = get(members(doc)).resolve;
    const over = get(hoverIn(doc));
    const current = get(citationIn(doc));
    const source = get(selection(doc));
    return {
      hovered: over ? expand([over], resolve) : empty,
      lit: expand(
        current
          ? current.focus
            ? current.focus.doc === doc
              ? [current.focus.key]
              : []
            : current.refs.filter((ref) => ref.doc === doc).map((ref) => ref.key)
          : [],
        resolve,
      ),
      selected: source ? expand(get(source), resolve) : empty,
      citation: current,
    };
  }).pipe(label(`${doc}/sets`)),
);
// Atom.family uses identity for plain objects. Serialize the pair so equivalent Refs share a node.
const rungFamily = Atom.family((id: string) => {
  const ref = JSON.parse(id) as Ref;
  return Atom.make((get): Rung => {
    const state = get(attention(ref.doc));
    const resolve = get(members(ref.doc)).resolve;
    const targets = expand([ref.key], resolve);
    const intersects = (set: ReadonlySet<SubjectKey>) => [...targets].some((key) => set.has(key));
    if (intersects(state.selected)) return "selected";
    const focus = state.citation?.focus;
    if (focus?.doc === ref.doc && intersects(expand([focus.key], resolve))) return "focus";
    if (intersects(state.hovered)) return "hover";
    return intersects(state.lit) ? "reach" : "rest";
  }).pipe(label(`${ref.doc}/${ref.key}/rung`));
});
export const rung = (ref: Ref) => rungFamily(JSON.stringify({ doc: ref.doc, key: ref.key }));
export const useAttention = (doc: string) => useAtomValue(attention(doc));
export const useRung = (ref: Ref) => useAtomValue(rung(ref));

/** Installs one delegated pointer listener. JSX owns identity; this effect alone owns data-reach. */
export function useAttentionScope(host: Element | null) {
  const registry = useContext(RegistryContext);
  useEffect(() => {
    if (!host) return;
    let release: (() => void)[] = [];
    const refOf = (node: Element): Ref | null => {
      const doc = node.getAttribute("data-subject-doc");
      const key = node.getAttribute("data-subject") as SubjectKey | null;
      return doc && key ? { doc, key } : null;
    };
    const paint = () => {
      release.forEach((stop) => stop());
      release = [];
      const nodes = [...host.querySelectorAll("[data-subject]")];
      if (host.matches("[data-subject]")) nodes.push(host);
      for (const node of nodes) {
        const ref = refOf(node);
        if (!ref) continue;
        const atom = rung(ref);
        const draw = () => node.setAttribute("data-reach", registry.get(atom));
        release.push(registry.subscribe(atom, draw));
        draw();
      }
    };
    const hover = (event: Event) => {
      const node = event.target instanceof Element ? event.target.closest("[data-subject]") : null;
      const ref = node && host.contains(node) ? refOf(node) : null;
      setHovered(registry, ref);
    };
    const leave = () => {
      const current = registry.get(hovered);
      if (
        current &&
        [...host.querySelectorAll("[data-subject]")].some((node) => sameRef(refOf(node), current))
      )
        setHovered(registry, null);
    };
    const observer = new MutationObserver(paint);
    observer.observe(host, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-subject", "data-subject-doc"],
    });
    host.addEventListener("pointerover", hover);
    host.addEventListener("pointerleave", leave);
    paint();
    return () => {
      observer.disconnect();
      release.forEach((stop) => stop());
      host.removeEventListener("pointerover", hover);
      host.removeEventListener("pointerleave", leave);
      leave();
    };
  }, [host, registry]);
}

/** Bind a route's real Page projection and membership for as long as its document is displayed. */
export function useAttentionDocument(
  doc: string,
  selected: Atom.Atom<ReadonlySet<SubjectKey>>,
  resolve: Members = identity,
) {
  const registry = useContext(RegistryContext);
  useEffect(() => {
    registry.set(selection(doc), selected);
    registry.set(members(doc), { resolve });
    const release = [registry.mount(selection(doc)), registry.mount(members(doc))];
    return () => {
      if (registry.get(selection(doc)) === selected) registry.set(selection(doc), null);
      if (registry.get(members(doc)).resolve === resolve)
        registry.set(members(doc), { resolve: identity });
      release.forEach((stop) => stop());
    };
  }, [doc, selected, resolve, registry]);
}
