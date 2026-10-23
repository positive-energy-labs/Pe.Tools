import {
  useReachState,
  reachProps,
  SubjectTextContext,
  type SubjectTextScope,
  type SubjectReference,
} from "./reach";
import { useContext, useEffect, useId, type ReactNode } from "react";
import { useRevitTarget } from "./revit-target";
import { TooltipHint } from "./tooltip";
import "./lang.css";

/** One word for a subject whose snapshot supplies no human name. */
export const nameOrFallback = (name?: string | null): string => name?.trim() || "unnamed element";

export type SubjectPart = string | { id: number; connector?: number };
export type SubjectDocument = {
  parts: (string | (SubjectReference & { connector?: number }))[];
  references: SubjectReference[];
};

/** Structured references first; numbers in free prose resolve only when the route knows them. */
export function subjectDocument(
  source: readonly SubjectPart[],
  nameOf: (id: number) => string | null,
  ids: readonly number[] = [],
  numbering: readonly SubjectReference[] = [],
): SubjectDocument {
  const references: SubjectReference[] = [...numbering];
  const parts: SubjectDocument["parts"] = [];
  const seen = new Set<number>();
  const reference = (id: number, connector?: number) => {
    const name = nameOrFallback(nameOf(id));
    let ref = references.find((r) => r.id === id);
    if (!ref) {
      ref = { id, name, number: references.length + 1 };
      references.push(ref);
    }
    seen.add(id);
    parts.push({ ...ref, connector });
  };
  for (const part of source) {
    if (typeof part !== "string") {
      reference(part.id, part.connector);
      continue;
    }
    let at = 0;
    for (const match of part.matchAll(/(?<![\w.])\d+(?::\d+)?(?!\w|\.\d)/g)) {
      const [id, connector] = match[0].split(":").map(Number);
      if (!nameOf(id!)) continue;
      parts.push(part.slice(at, match.index));
      reference(id!, connector);
      at = match.index + match[0].length;
    }
    parts.push(part.slice(at));
  }
  // Rows know their subjects even when the description contains no id (e.g. "No flow").
  for (const id of new Set(ids)) {
    if (seen.has(id)) continue;
    parts.push(seen.size ? ", " : " · ");
    reference(id);
  }
  // Only what the parts name: a caller's numbering keeps numbers shared across texts, but a
  // number the reader cannot see in this text is never lit on the picture.
  return { parts, references: references.filter((r) => seen.has(r.id)) };
}

/** The lit Subjects under the route's text context; nothing lit outside it. */
export const useSubjectLighting = () =>
  useReachState(useContext(SubjectTextContext)?.reach, (state) => state.lighting);

/** Prose with each Subject as a numbered token; hover lights it in the picture, press goes to it. */
export function SubjectText({
  text,
  revit = [],
  document,
  owner: blockOwner,
}: {
  text?: string | readonly SubjectPart[];
  revit?: readonly number[];
  document?: SubjectDocument;
  owner?: string;
}) {
  const target = useRevitTarget(revit);
  const context = useContext(SubjectTextContext);
  const localOwner = useId();
  const owner = blockOwner ?? localOwner;
  const clear = context?.clear;
  useEffect(() => () => clear?.(owner), [clear, owner]);
  const doc =
    document ??
    subjectDocument(
      typeof text === "string" ? [text] : (text ?? []),
      context?.nameOf ?? (() => null),
      revit,
    );
  // Plain text stays plain: a span appears only when there is a Revit target to carry.
  if (!context) {
    const plain = doc.parts.map((p) => (typeof p === "string" ? p : p.name)).join("");
    return revit?.length ? <span {...target}>{plain}</span> : <>{plain}</>;
  }
  const light = (id: number | null) => context.light?.(doc.references, id, owner);
  return (
    <span
      {...target}
      {...reachProps()}
      data-subject-text=""
      onMouseEnter={() => light(null)}
      onMouseMove={(e) => e.stopPropagation()}
      onMouseLeave={() => context.clear?.(owner)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) context.clear?.(owner);
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
              scope={context}
              onHover={(on) => light(on ? part.id : null)}
            />
          ),
      )}
    </span>
  );
}

/** One Subject in prose: its name as a link-like token, then its footnote number as the shared mark. */
function SubjectRef({
  part,
  scope,
  onHover,
}: {
  part: SubjectReference & { connector?: number };
  scope: SubjectTextScope;
  onHover: (on: boolean) => void;
}) {
  const target = useRevitTarget([part.id]);
  const lit = useReachState(scope.reach, (state) => state.lighting.focus === part.id);
  const port = part.connector != null ? ` port ${part.connector}` : "";
  const go = scope.go;
  return (
    <TooltipHint
      content={
        <>
          {part.name}
          {port} <span className="face-mono">{part.id}</span>
          {go ? ": go to it" : ""}
        </>
      }
    >
      <button
        type="button"
        {...reachProps(lit ? "reach" : "rest")}
        className="subject-ref"
        data-claim-element={part.id}
        data-lit={lit ? "" : undefined}
        {...target}
        {...scope.refProps?.(part.id)}
        aria-label={`${go ? "go to " : ""}${part.name}${port}, reference ${part.number}`}
        aria-disabled={go ? undefined : true}
        onMouseEnter={() => onHover(true)}
        onMouseLeave={() => onHover(false)}
        onFocus={() => onHover(true)}
        onBlur={() => onHover(false)}
        onClick={(e) => {
          e.stopPropagation();
          go?.(part.id);
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
