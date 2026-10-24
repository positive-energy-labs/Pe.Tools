import * as Atom from "effect/unstable/reactivity/Atom";
import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import {
  AttentionDocument,
  elementKey,
  hovered,
  setHovered,
  useAttention,
  useAttentionDocument,
  useAttentionScope,
  useMembers,
  type Members,
  type SubjectKey,
} from "@pe/kit/lang/attention";

export function AttentionScope({
  doc,
  selected,
  members = NONE,
  children,
}: {
  doc: string;
  selected: Atom.Atom<ReadonlySet<SubjectKey>>;
  members?: Members;
  children: ReactNode;
}) {
  useAttentionDocument(doc, selected);
  useMembers(doc, members);
  return <AttentionRoot doc={doc}>{children}</AttentionRoot>;
}
const NONE: Members = new Map();
export function AttentionRoot({ doc, children }: { doc: string; children: ReactNode }) {
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  useAttentionScope(root);
  return (
    <AttentionDocument value={doc}>
      <div ref={setRoot} className="contents">
        {children}
      </div>
    </AttentionDocument>
  );
}

/** Numeric IDs stop at the native scene adapter; attention itself only carries Subject keys. */
export function useElementAttention() {
  const doc = useContext(AttentionDocument) ?? "";
  const registry = useContext(RegistryContext);
  const state = useAttention(doc);
  const numeric = (keys: ReadonlySet<SubjectKey>) =>
    new Set(
      [...keys]
        .filter((key) => key.startsWith("e:"))
        .map((key) => Number(key.slice(2)))
        .filter(Number.isFinite),
    );
  const onHover = useCallback(
    (id: number | null) => {
      if (doc) setHovered(registry, id == null ? null : { doc, key: elementKey(id) });
    },
    [registry, doc],
  );
  return useMemo(
    () => ({
      lit: numeric(new Set([...state.lit, ...state.hovered])),
      hovered: numeric(state.hovered).values().next().value ?? null,
      selected: numeric(state.selected),
      citation: state.citation,
      onHover,
    }),
    [state, onHover],
  );
}
export function useIssueHover() {
  const doc = useContext(AttentionDocument) ?? "";
  const registry = useContext(RegistryContext);
  return useCallback(
    (key: string | null) => {
      if (!doc) return;
      if (key === null) {
        const current = registry.get(hovered);
        if (current?.doc !== doc || !current.key.startsWith("issue:")) return;
      }
      setHovered(registry, key === null ? null : { doc, key: `issue:${key}` });
    },
    [doc, registry],
  );
}
export function useHoveredIssue() {
  const doc = useContext(AttentionDocument) ?? "";
  return useAtomValue(hoveredIssue(doc));
}
const hoveredIssue = Atom.family((doc: string) =>
  Atom.make((get) => {
    const ref = get(hovered);
    return ref?.doc === doc && ref.key.startsWith("issue:") ? ref.key.slice(6) : null;
  }).pipe(Atom.withLabel(`attention/${doc}/hoveredIssue`)),
);
