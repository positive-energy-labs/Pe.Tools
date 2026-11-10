import * as Atom from "effect/reactivity/Atom";
import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { ElementIndexContext, elementIndex, useElementIndex, type ElementIndex } from "./element-index";
import {
  AttentionDocument,
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
  elements,
  children,
}: {
  doc: string;
  /** The pane's elements; ElementIds exist only through this index. */
  elements?: ElementIndex;
  selected: Atom.Atom<ReadonlySet<SubjectKey>>;
  members?: Members;
  children: ReactNode;
}) {
  useAttentionDocument(doc, selected);
  useMembers(doc, members);
  return (
    <ElementIndexContext value={elements ?? NO_INDEX}>
      <AttentionRoot doc={doc}>{children}</AttentionRoot>
    </ElementIndexContext>
  );
}
const NONE: Members = new Map();
const NO_INDEX = elementIndex([]);
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
  const elements = useElementIndex();
  const numeric = (keys: ReadonlySet<SubjectKey>) =>
    new Set([...keys].map(elements.idOf).filter(Number.isFinite));
  const onHover = useCallback(
    (id: number | null) => {
      const key = id == null ? null : elements.keyOf(id);
      if (doc) setHovered(registry, key === null ? null : { doc, key });
    },
    [registry, doc, elements],
  );
  return useMemo(
    () => ({
      lit: numeric(new Set([...state.lit, ...state.hovered])),
      hovered: numeric(state.hovered).values().next().value ?? null,
      selected: numeric(state.selected),
      citation: state.citation,
      onHover,
    }),
    [state, onHover, elements],
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
