import {
  createContext,
  useContext,
  useEffect,
  useId,
  useSyncExternalStore,
  type ReactNode,
} from "react";
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
export const NO_LIGHTING: SubjectLighting = { ids: new Set(), references: [], focus: null };

/**
 * What the pointer is reaching for, outside React state: the lit Subjects, the hovered element and
 * the hovered issue. A hover writes here and only the marks that draw it (the picture, a token's
 * chip, the inbox rail) re-render; a route- or screen-level setState re-rendered every pane per
 * pointer crossing, 170 to 550 ms each on Chadds SA 44 (reach audit, 2026-10-23).
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
/** The lit Subjects under the screen's text context; nothing lit outside it. */
export const useSubjectLighting = () =>
  useReach(useContext(SubjectTextContext)?.reach, (state) => state.lighting);

export const SubjectTextContext = createContext<{
  nameOf: (id: number) => string | null;
  reach: ReachStore;
  /** Badges for `references`; `ids` tints further elements the text stands for but does not name. */
  light: (
    references: readonly SubjectReference[],
    focus: number | null,
    owner?: string,
    ids?: readonly number[],
  ) => void;
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
              reach={context.reach}
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
  reach,
  onHover,
  onGo,
}: {
  part: SubjectReference & { connector?: number };
  reach: ReachStore;
  onHover: (on: boolean) => void;
  onGo: () => void;
}) {
  const lit = useReach(reach, (state) => state.lighting.focus === part.id);
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
