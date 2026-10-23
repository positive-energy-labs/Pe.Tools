import {
  useReachState,
  reachProps,
  SubjectTextContext,
  type SubjectTextScope,
  type SubjectReference,
} from "./reach";
import { useContext, useEffect, useId, useRef, type ReactNode } from "react";
import { useRevitTarget } from "./revit-target";
import { Tooltip, TooltipTrigger, TooltipContent } from "./tooltip";
import { focusQuiet } from "../../lib/utils";
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

function hasContact(element: HTMLElement | null) {
  if (!element) return false;
  if (element.matches(":hover, :focus-within")) return true;
  return [element, ...element.querySelectorAll(".subject-ref")].some((reference) =>
    reference
      .getAttribute("aria-describedby")
      ?.split(/\s+/)
      .some((id) => reference.ownerDocument.getElementById(id)?.matches(":hover, :focus-within")),
  );
}

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
  const block = useRef<HTMLSpanElement>(null);
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
  const dismiss = () => {
    if (!hasContact(block.current)) context.clear?.(owner);
  };
  return (
    <span
      ref={block}
      {...target}
      data-subject-text=""
      onMouseEnter={() => light(null)}
      onMouseMove={(e) => e.stopPropagation()}
      onMouseLeave={dismiss}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) dismiss();
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
              onLeave={() => context.clear?.(owner)}
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
  onLeave,
}: {
  part: SubjectReference & { connector?: number };
  scope: SubjectTextScope;
  onHover: (on: boolean) => void;
  onLeave: () => void;
}) {
  const target = useRevitTarget([part.id]);
  const reference = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const lit = useReachState(scope.reach, (state) => state.lighting.focus === part.id);
  const port = part.connector != null ? ` port ${part.connector}` : "";
  const go = scope.go;
  const contact = reachProps(
    lit
      ? reference.current?.matches(":focus-within") || popup.current?.matches(":focus-within")
        ? "focus"
        : "hover"
      : "rest",
  );
  const leave = () => {
    if (
      !reference.current?.matches(":hover, :focus-within") &&
      !popup.current?.matches(":focus-within")
    )
      onLeave();
  };
  return (
    <Tooltip>
      <TooltipTrigger
        className=""
        closeOnClick={false}
        render={
          <button
            ref={reference}
            type="button"
            {...contact}
            className="subject-ref"
            data-claim-element={part.id}
            {...target}
            {...scope.refProps?.(part.id)}
            aria-label={`${go ? "go to " : ""}${part.name}${port}, reference ${part.number}`}
            aria-disabled={go ? undefined : true}
            onMouseEnter={() => onHover(true)}
            onMouseLeave={(e) => {
              if (!e.currentTarget.matches(":focus-within")) onHover(false);
            }}
            onFocus={(e) => {
              contact.onFocus(e);
              onHover(true);
            }}
            onBlur={(e) => {
              contact.onBlur(e);
              if (!hasContact(e.currentTarget) && !popup.current?.contains(e.relatedTarget))
                onHover(false);
            }}
            onClick={(e) => {
              e.stopPropagation();
              focusQuiet(e.currentTarget);
              onHover(true);
              go?.(part.id);
            }}
          >
            {part.name}
            {port}
            <span className="subject-mark" data-subject-footnote={part.number} aria-hidden>
              {part.number}
            </span>
          </button>
        }
      />
      <TooltipContent
        ref={popup}
        onMouseEnter={() => onHover(true)}
        onMouseLeave={leave}
        onFocusCapture={() => {
          reference.current?.setAttribute("data-reach", "focus");
          onHover(true);
        }}
        onBlurCapture={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget)) leave();
        }}
      >
        {part.name}
        {port} <span className="face-mono">{part.id}</span>
        {go ? ": go to it" : ""}
      </TooltipContent>
    </Tooltip>
  );
}
