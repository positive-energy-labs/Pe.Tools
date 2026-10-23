import { createContext, useContext, useEffect, useId, type ReactNode } from "react";
import { TooltipHint } from "@pe/kit/lang/tooltip";
import { revitTarget } from "@pe/kit/lang/row";
import { observedElements, useNativeObservation } from "#/revit/observation";
import { revitScope } from "#/revit/element-menu";
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
  /**
   * The one alias-click: a Subject named in text was pressed. Every Subject token on the route
   * calls this and nothing else, so the screen's "go to subject" (select it and bring it into
   * view) applies the same way from any row, popover or caption.
   */
  go: (id: number) => void;
} | null>(null);

/** Issue prose with each Subject as a numbered token; hover lights it in the picture, press goes to it. */
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
            <SubjectRef
              key={i}
              part={part}
              lit={context.lighting.focus === part.id}
              onHover={(on) => light(on ? part.id : null)}
              onGo={() => context.go(part.id)}
            />
          ),
      )}
    </span>
  );
}

/** One Subject in prose: its name as a link-like token, then its footnote number as the shared mark. */
function SubjectRef({
  part,
  lit,
  onHover,
  onGo,
}: {
  part: SubjectReference & { connector?: number };
  lit: boolean;
  onHover: (on: boolean) => void;
  onGo: () => void;
}) {
  const observation = useNativeObservation();
  const target = observedElements(observation, [part.id]);
  const port = part.connector != null ? ` port ${part.connector}` : "";
  return (
    <TooltipHint content={`${part.name}${port} · element ${part.id}: go to it`}>
      <button
        type="button"
        className="subject-ref"
        data-claim-element={part.id}
        data-lit={lit ? "" : undefined}
        {...revitScope(observation.scope)}
        {...revitTarget(target.ids, target.refs)}
        aria-label={`go to ${part.name}${port}, reference ${part.number}`}
        onMouseEnter={() => onHover(true)}
        onMouseLeave={() => onHover(false)}
        onFocus={() => onHover(true)}
        onBlur={() => onHover(false)}
        onClick={(e) => {
          e.stopPropagation();
          onGo();
        }}
      >
        {part.name}
        {port}
        <span className="subject-mark" data-subject-footnote={part.number} aria-hidden>
          {part.number}
        </span>
      </button>
    </TooltipHint>
  );
}
