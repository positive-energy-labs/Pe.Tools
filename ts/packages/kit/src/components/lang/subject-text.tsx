/**
 * Subject text (doctrine I1): prose never prints a raw id. Each id a route can name becomes a
 * Subject, its short human name and a footnote number; the number is the same mark the picture
 * draws over the element (`.subject-badge`), so a reader matches text and picture at a glance.
 * Hovering a block lights all its Subjects; hovering or focusing one narrows to it; pressing one is
 * the route's one alias-click (`go`). A route supplies only what it has: a route with no picture
 * gives `nameOf` alone, and `refProps` makes each token answer the Revit element menu (N4).
 */
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useRevitTarget } from "./row";
import { TooltipHint } from "./tooltip";
import "./lang.css";

export type SubjectPart = string | { id: number; connector?: number };
export type SubjectReference = { id: number; name: string; number: number };
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
  const reference = (id: number, connector?: number): boolean => {
    const name = nameOf(id);
    if (!name) return false;
    let ref = references.find((r) => r.id === id);
    if (!ref) {
      ref = { id, name, number: references.length + 1 };
      references.push(ref);
    }
    seen.add(id);
    parts.push({ ...ref, connector });
    return true;
  };
  for (const part of source) {
    if (typeof part !== "string") {
      if (!reference(part.id, part.connector)) parts.push(`element ${part.id} (not in snapshot)`);
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
    if (seen.has(id) || !nameOf(id)) continue;
    parts.push(seen.size ? ", " : " · ");
    reference(id);
  }
  // Only what the parts name: a caller's numbering keeps numbers shared across texts, but a
  // number the reader cannot see in this text is never lit on the picture.
  return { parts, references: references.filter((r) => seen.has(r.id)) };
}

export type SubjectLighting = {
  ids: ReadonlySet<number>;
  references: readonly SubjectReference[];
  focus: number | null;
  owner?: string;
};
export const NO_LIGHTING: SubjectLighting = { ids: new Set(), references: [], focus: null };

/**
 * What the pointer is reaching for, outside React state: the lit Subjects, the hovered element and
 * the hovered issue. A hover writes here and only the marks that draw it re-render; a route-level
 * setState re-rendered every pane per pointer crossing, 170 to 550 ms each on Chadds SA 44 (ducts
 * reach audit, 2026-10-23).
 */
export type Reach = {
  lighting: SubjectLighting;
  hovered: number | null;
  issue: string | null;
};
export function reachStore() {
  let state: Reach = { lighting: NO_LIGHTING, hovered: null, issue: null };
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    /** `next` returns the same state to change nothing (no listener runs). */
    set(next: (state: Reach) => Reach) {
      const value = next(state);
      if (value === state) return;
      state = value;
      for (const listener of listeners) listener();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}
export type ReachStore = ReturnType<typeof reachStore>;
const IDLE = reachStore();
/** One slice of the reach state; `pick` must return a stable value (a field or a primitive). */
export function useReach<T>(store: ReachStore | null | undefined, pick: (state: Reach) => T): T {
  const s = store ?? IDLE;
  return useSyncExternalStore(s.subscribe, () => pick(s.get()));
}
/** The lit Subjects under the route's text context; nothing lit outside it. */
export const useSubjectLighting = () =>
  useReach(useContext(SubjectTextContext)?.reach, (state) => state.lighting);

export type SubjectTextScope = {
  nameOf: (id: number) => string | null;
  /** Omit on a route with no picture: nothing lights, tokens still name and number. */
  reach?: ReachStore;
  /** Badges for `references`; `ids` tints further elements the text stands for but does not name. */
  light?: (
    references: readonly SubjectReference[],
    focus: number | null,
    owner?: string,
    ids?: readonly number[],
  ) => void;
  clear?: (owner: string) => void;
  /** The pointer is still travelling over the picture: a pending clear waits for it. */
  hold?: () => void;
  /**
   * The one alias-click: a Subject named in text was pressed. Every Subject token on the route
   * calls this and nothing else, so "go to subject" applies the same way from any row, popover or
   * caption. Omitted, a token names without pressing.
   */
  go?: (id: number) => void;
  /** Attributes for a token, e.g. the Revit element target so right-click offers Selection Box. */
  refProps?: (id: number) => Record<string, string | undefined>;
};
export const SubjectTextContext = createContext<SubjectTextScope | null>(null);

/** Prose with each Subject as a numbered token; hover lights it in the picture, press goes to it. */
export function SubjectText({
  text,
  ids = [],
  revit,
  document,
  owner: blockOwner,
}: {
  text?: string | readonly SubjectPart[];
  ids?: readonly number[];
  revit?: readonly number[];
  document?: SubjectDocument;
  owner?: string;
}) {
  const target = useRevitTarget(revit ?? ids);
  const context = useContext(SubjectTextContext);
  const localOwner = useId();
  const owner = blockOwner ?? localOwner;
  const clear = context?.clear;
  useEffect(() => () => clear?.(owner), [clear, owner]);
  if (!context)
    return (
      <span {...target}>
        {typeof text === "string"
          ? text
          : document
            ? document.parts.map((p) => (typeof p === "string" ? p : p.name)).join("")
            : text?.map((p) => (typeof p === "string" ? p : `element ${p.id}`)).join("")}
      </span>
    );
  const doc =
    document ??
    subjectDocument(typeof text === "string" ? [text] : (text ?? []), context.nameOf, ids);
  const light = (id: number | null) => context.light?.(doc.references, id, owner);
  return (
    <span
      {...target}
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
  const lit = useReach(scope.reach, (state) => state.lighting.focus === part.id);
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
