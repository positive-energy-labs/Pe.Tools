import * as Atom from "effect/unstable/reactivity/Atom";
import type * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { createContext, useContext, useEffect } from "react";
import { HOVER_GRACE } from "./hover-grace";

/**
 * `<kind>:<short id>`. Kinds are open: each feature declares its own in its module; kit owns only
 * `e:` (a Revit element id, which kit rows and prose already speak). A plural mark gets a short id
 * of its own and declares its members with `useMembers`, never a key that spells them out.
 */
export type SubjectKey = `${string}:${string}`;
export type Ref = { doc: string; key: SubjectKey };
export type SubjectReference = Ref & { name: string; number: number };
export type Citation = { owner: string; refs: readonly SubjectReference[]; focus: Ref | null };
/** `cited` is the footnote a prose chip points at. It is not keyboard focus: `focus` is that rung's. */
export type Rung = "selected" | "cited" | "hover" | "reach" | "rest";
const empty: ReadonlySet<SubjectKey> = new Set();
const label = (name: string) => Atom.withLabel(`attention/${name}`);
export const hovered = Atom.make<Ref | null>(null).pipe(Atom.keepAlive, label("hovered"));
export const citation = Atom.make<Citation | null>(null).pipe(Atom.keepAlive, label("citation"));
// Atom.family keys plain objects by identity, so a Ref is serialized for its node.
const refId = (ref: Ref) => JSON.stringify([ref.doc, ref.key]);
/** One atom per declared key, so a declaration recomputes only the rungs that read that key. */
const memberOf = Atom.family((id: string) =>
  Atom.make<readonly SubjectKey[] | null>(null).pipe(Atom.keepAlive, label(`${id}/members`)),
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
/** The leaves under `keys`: transitive and cycle-bounded; an undeclared key is its own leaf. */
const expand = (get: Atom.AtomContext, doc: string, keys: Iterable<SubjectKey>) => {
  const found = new Set<SubjectKey>();
  const seen = new Set<SubjectKey>();
  const visit = (key: SubjectKey) => {
    if (seen.has(key)) return;
    seen.add(key);
    const children = get(memberOf(refId({ doc, key })));
    if (children) children.forEach(visit);
    else found.add(key);
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
    const over = get(hoverIn(doc));
    const current = get(citationIn(doc));
    const source = get(selection(doc));
    return {
      hovered: over ? expand(get, doc, [over]) : empty,
      lit: expand(
        get,
        doc,
        current
          ? current.focus
            ? current.focus.doc === doc
              ? [current.focus.key]
              : []
            : current.refs.filter((ref) => ref.doc === doc).map((ref) => ref.key)
          : [],
      ),
      cited: current?.focus?.doc === doc ? expand(get, doc, [current.focus.key]) : empty,
      selected: source ? expand(get, doc, get(source)) : empty,
      citation: current,
    };
  }).pipe(label(`${doc}/sets`)),
);
/** A ref lights when it or any of its members is selected, cited, hovered or reached. */
const rungFamily = Atom.family((id: string) => {
  const [doc, key] = JSON.parse(id) as [string, SubjectKey];
  return Atom.make((get): Rung => {
    const state = get(attention(doc));
    const targets = expand(get, doc, [key]);
    const intersects = (set: ReadonlySet<SubjectKey>) => [...targets].some((k) => set.has(k));
    if (intersects(state.selected)) return "selected";
    if (intersects(state.cited)) return "cited";
    if (intersects(state.hovered)) return "hover";
    return intersects(state.lit) ? "reach" : "rest";
  }).pipe(label(`${doc}/${key}/rung`));
});
export const rung = (ref: Ref) => rungFamily(refId(ref));
/**
 * Whether a key is lit (hovered, reached or cited) in `doc` right now, without a rung atom per key:
 * for a surface that tests many keys at once (a list's scrollbar marks). Null when nothing is lit.
 */
export function litTest(registry: AtomRegistry.AtomRegistry, doc: string) {
  const state = registry.get(attention(doc));
  const sets = [state.hovered, state.lit, state.cited].filter((set) => set.size);
  if (!sets.length) return null;
  // The plain mirror of `memberOf`: reading the family per key would create an atom per row.
  const plain = declared.get(registry);
  const seen = new Set<SubjectKey>();
  const hit = (key: SubjectKey): boolean => {
    if (seen.has(key)) return false;
    seen.add(key);
    const children = plain?.get(refId({ doc, key }));
    return children ? children.some(hit) : sets.some((set) => set.has(key));
  };
  return (key: SubjectKey) => {
    seen.clear();
    return hit(key);
  };
}
export const useAttention = (doc: string) => useAtomValue(attention(doc));

export type Members = ReadonlyMap<SubjectKey, readonly SubjectKey[]>;
/** Declared members per registry, by ref id, written beside `memberOf` for `litTest`. */
const declared = new WeakMap<AtomRegistry.AtomRegistry, Map<string, readonly SubjectKey[]>>();
/** Declare plural subjects' members; the returned release withdraws them. */
export function declareMembers(registry: AtomRegistry.AtomRegistry, doc: string, members: Members) {
  const plain = declared.get(registry) ?? new Map<string, readonly SubjectKey[]>();
  declared.set(registry, plain);
  const atoms = [...members].map(([key, keys]) => {
    const id = refId({ doc, key });
    const atom = memberOf(id);
    registry.set(atom, keys);
    plain.set(id, keys);
    return [id, atom, keys] as const;
  });
  return () => {
    // ponytail: last writer wins; a key two mounted surfaces declare differently keeps the later one.
    for (const [id, atom, keys] of atoms)
      if (registry.get(atom) === keys) {
        registry.set(atom, null);
        plain.delete(id);
      }
  };
}
/** Declare plural subjects' members for as long as the declaring surface is mounted. */
export function useMembers(doc: string, members: Members) {
  const registry = useContext(RegistryContext);
  useEffect(() => declareMembers(registry, doc, members), [doc, members, registry]);
}

/**
 * Installs one delegated pointer listener. JSX owns identity; this effect alone owns a Subject's
 * data-reach. Enrollment is incremental: a mutation touches only the nodes it added or removed,
 * so a virtual list's scroll costs its new rows, not the whole scope.
 */
export function useAttentionScope(host: Element | null) {
  const registry = useContext(RegistryContext);
  useEffect(() => {
    if (!host) return;
    const enrolled = new Map<Element, { ref: Ref; stop: () => void }>();
    const refOf = (node: Element): Ref | null => {
      const doc = node.getAttribute("data-subject-doc");
      const key = node.getAttribute("data-subject") as SubjectKey | null;
      return doc && key ? { doc, key } : null;
    };
    const release = (node: Element) => {
      enrolled.get(node)?.stop();
      enrolled.delete(node);
    };
    const enroll = (node: Element) => {
      release(node);
      const ref = refOf(node);
      if (!ref || !host.contains(node)) return;
      const atom = rung(ref);
      const draw = () => node.setAttribute("data-reach", registry.get(atom));
      enrolled.set(node, { ref, stop: registry.subscribe(atom, draw) });
      draw();
    };
    const subjects = (node: Node) =>
      node instanceof Element
        ? [
            ...(node.matches("[data-subject]") ? [node] : []),
            ...node.querySelectorAll("[data-subject]"),
          ]
        : [];
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === "attributes") enroll(record.target as Element);
        record.removedNodes.forEach((node) => subjects(node).forEach(release));
        record.addedNodes.forEach((node) => subjects(node).forEach(enroll));
      }
    });
    const hover = (event: Event) => {
      const node = event.target instanceof Element ? event.target.closest("[data-subject]") : null;
      const ref = node && host.contains(node) ? refOf(node) : null;
      setHovered(registry, ref);
    };
    const leave = () => {
      const current = registry.get(hovered);
      if (current && [...enrolled.values()].some((entry) => sameRef(entry.ref, current)))
        setHovered(registry, null);
    };
    observer.observe(host, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-subject", "data-subject-doc"],
    });
    host.addEventListener("pointerover", hover);
    host.addEventListener("pointerleave", leave);
    subjects(host).forEach(enroll);
    return () => {
      observer.disconnect();
      leave();
      enrolled.forEach((entry) => entry.stop());
      host.removeEventListener("pointerover", hover);
      host.removeEventListener("pointerleave", leave);
    };
  }, [host, registry]);
}

/** Bind a route's real Page projection for as long as its document is displayed. */
export function useAttentionDocument(doc: string, selected: Atom.Atom<ReadonlySet<SubjectKey>>) {
  const registry = useContext(RegistryContext);
  useEffect(() => {
    registry.set(selection(doc), selected);
    const release = registry.mount(selection(doc));
    return () => {
      if (registry.get(selection(doc)) === selected) registry.set(selection(doc), null);
      release();
    };
  }, [doc, selected, registry]);
}
