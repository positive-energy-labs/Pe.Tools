import { createContext, useContext, useEffect, useId, type ReactNode } from "react";
import { ClaimElement } from "./claims";
import {
  subjectDocument,
  type SubjectDocument,
  type SubjectPart,
  type SubjectReference,
} from "./subject-text";

export type SubjectLighting = {
  ids: ReadonlySet<number>;
  references: readonly SubjectReference[];
  focus: number | null;
  owner?: string;
};
export const SubjectTextContext = createContext<{
  nameOf: (id: number) => string | null;
  lighting: SubjectLighting;
  light: (references: readonly SubjectReference[], focus: number | null, owner?: string) => void;
  clear: (owner: string) => void;
  pick?: (id: number) => void;
} | null>(null);

/** Issue prose uses the existing element link and the screen's one row-hover channel. */
export function SubjectText({
  text,
  ids = [],
  document,
  owner: blockOwner,
}: {
  text?: string | readonly SubjectPart[];
  ids?: readonly number[];
  document?: SubjectDocument;
  owner?: string;
}) {
  const context = useContext(SubjectTextContext);
  const localOwner = useId();
  const owner = blockOwner ?? localOwner;
  const clear = context?.clear;
  useEffect(() => () => clear?.(owner), [clear, owner]);
  if (!context)
    return (
      <>
        {typeof text === "string"
          ? text
          : document
            ? document.parts.map((p) => (typeof p === "string" ? p : p.name)).join("")
            : text?.map((p) => (typeof p === "string" ? p : `element ${p.id}`)).join("")}
      </>
    );
  const doc =
    document ??
    subjectDocument(typeof text === "string" ? [text] : (text ?? []), context.nameOf, ids);
  const light = (id: number | null) => context.light(doc.references, id, owner);
  return (
    <span
      data-subject-text=""
      onMouseEnter={() => light(null)}
      onMouseMove={(e) => e.stopPropagation()}
      onMouseLeave={() => context.clear(owner)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) context.clear(owner);
      }}
    >
      {doc.parts.map(
        (part, i): ReactNode =>
          typeof part === "string" ? (
            part
          ) : (
            <ClaimElement
              key={i}
              part={{ ...part, dot: false }}
              footnote={part.number}
              connector={part.connector}
              onHover={light}
              onPick={(id) => context.pick?.(id)}
              onShown={() => {}}
            />
          ),
      )}
    </span>
  );
}
