import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import {
  availableTransitions,
  fanOut,
  summarize,
  transitionBinding,
  transitionPatches,
  type CellGroup,
  type FanOutKind,
  type RouteStatePatch,
  type SkipReason,
  type TransitionKind,
  type TrichotomyCellLike,
} from "@pe/agent-contracts";

import {
  cellFromTrichotomy,
  StateCell,
  type CellTransition,
  type CellTransitionKind,
  type StateCellProps,
} from "#/components/lang/cell";
import { Press } from "#/components/lang/press";
import { Verdict } from "#/components/lang/verdict";
import { useScopeKeys } from "#/route/keys";

interface WorkStandingProps {
  conflict?: boolean;
  unresolved?: readonly string[];
  /** One standing line about this Work's own lifetime; not a toast, it stays while it holds. */
  lifetime?: string;
  /** What was discarded when a Work's lifetime ended, dismissable and never a confirm. */
  receipt?: { text: string; dismiss: () => void };
  reload?: () => void;
  /** Offered only on unreadable saved Work: set it aside, untouched, and start an empty one. */
  startFresh?: () => void;
  /** What the confirm shows, read-only, of the Work start fresh sets aside (a route's salvage). */
  startFreshAside?: ReactNode;
}

/** The Work in one word for meters and ledgers: "r4 · changed elsewhere"; the sentence owns counts. */
export const workWord = ({
  revision,
  conflict,
  unreadable,
}: {
  revision: number | null;
  conflict?: boolean;
  unreadable?: boolean;
}) =>
  `${unreadable ? "unreadable" : revision === null ? "unwritten" : `r${revision}`}${
    conflict ? " · changed elsewhere" : ""
  }`;

/**
 * A Work's standing lines, none of them cells: its own lifetime, what a closed document
 * discarded, and what is unresolved (a lost write, a conflicting writer, the last refusal).
 */
export function WorkStanding({
  conflict,
  unresolved = [],
  lifetime,
  receipt,
  reload,
  startFresh,
  startFreshAside,
}: WorkStandingProps) {
  return (
    <>
      {lifetime ? (
        <p className="t-small text-ink-2" role="note">
          {lifetime}
        </p>
      ) : null}
      {receipt ? (
        <div
          className="hairline-t flex flex-wrap items-baseline gap-x-2 gap-y-1 py-1.5 t-prose"
          role="status"
        >
          <span className="w-[9rem] t-small t-upper text-ink-mute">discarded</span>
          <span>{receipt.text}</span>
          <span className="ml-auto">
            <Press frame="line" tone="quiet" size="value" onClick={receipt.dismiss}>
              dismiss
            </Press>
          </span>
        </div>
      ) : null}
      {unresolved.length ? (
        <div
          className="hairline-t flex flex-wrap items-baseline gap-x-2 gap-y-1 py-1.5 t-prose"
          data-tone="caution"
          role="status"
        >
          <span className="w-[9rem] t-small t-upper text-ink-mute">unresolved</span>
          <span>{unresolved.join(" · ")}</span>
          {conflict && reload ? (
            <Press frame="line" tone="quiet" size="value" onClick={reload}>
              reload
            </Press>
          ) : null}
          {startFresh ? <StartFresh run={startFresh} aside={startFreshAside} /> : null}
        </div>
      ) : null}
    </>
  );
}

/** Proposed, staged and contested cells over a set of groups. */
export const tally = (groups: readonly Pick<CellGroup, "proposed" | "staged" | "contested">[]) => {
  const sum = (field: "proposed" | "staged" | "contested") =>
    groups.reduce((total, group) => total + group[field], 0);
  return { proposed: sum("proposed"), staged: sum("staged"), contested: sum("contested") };
};

/** A Work's cells at head scale: the tally, the contract's groups, and how many at each named depth. */
export interface WorkSummary extends ReturnType<typeof tally> {
  groups: CellGroup[];
  /** Distinct groups at each depth the route names ("3 families"). */
  spans: { noun: string; count: number }[];
}

/** The one summary the Situation's Work slot and Chat's proposal head read (ruling 14). */
export function workSummary(
  cells: Record<string, TrichotomyCellLike>,
  ctx: Pick<CellWire, "baselineOf" | "lockOf"> & { groupOf: (key: string) => string[] },
  nouns: readonly string[] = [],
): WorkSummary {
  const { groups } = summarize(cells, {
    groupOf: ctx.groupOf,
    baselineOf: (key) => ctx.baselineOf?.(key),
    lockOf: ctx.lockOf,
  });
  return {
    ...tally(groups),
    groups,
    spans: nouns.map((noun, depth) => ({
      noun,
      count: new Set(groups.map((group) => group.path[depth])).size,
    })),
  };
}

/**
 * How a consumer's cells are written: its route-document segment, its write, and the Work
 * revision the cells were rendered at. Bound kinds (accept, deny) carry that revision, so a
 * foreign write in between refuses instead of landing on a value the person never saw.
 */
export interface CellWire {
  /** The Work segment holding the cells; null = the cells sit at the Work's root (`launch`). */
  segment: string | null;
  write: (
    patches: RouteStatePatch[],
    expectedRevision?: number,
  ) => Promise<{ code: string; message: string } | null>;
  revision: number | null;
  lockOf?: (key: string) => string | null;
  baselineOf?: (key: string) => unknown;
}

/** Where a wire's cells sit in its Work: under its segment, or at the root. */
const cellsPath = (wire: CellWire) => (wire.segment === null ? [] : [wire.segment]);

const DRAWN = new Set<string>(["accept", "deny", "unstage"] satisfies CellTransitionKind[]);

/**
 * One write of a transition's patches. A bound kind (accept, deny) carries the rendered revision;
 * with nothing rendered to bind to it refuses and writes nothing, never an unbound write.
 */
const writeKind = (wire: CellWire, kind: TransitionKind, patches: RouteStatePatch[]) =>
  transitionBinding(kind) !== "bound"
    ? wire.write(patches)
    : wire.revision === null
      ? Promise.resolve({
          code: "not-ready",
          message: "Work has not been read yet; nothing on screen to act on",
        })
      : wire.write(patches, wire.revision);

/** The cell's verbs: exactly what the contract makes available to a person on it. */
export function reviewTransitions(
  wire: CellWire,
  key: string,
  cell: TrichotomyCellLike,
): CellTransition[] {
  // Wording only: the reader says whether Pea is arguing against a staged value.
  const counter = cellFromTrichotomy(cell, { value: null }).counterValue != null;
  const reason: Record<CellTransitionKind, string> = {
    accept: counter
      ? "Stage Pea's counter-proposal in place of your staged value"
      : "Stage Pea's proposal",
    deny: counter
      ? "Clear Pea's counter-proposal; your staged value stays"
      : "Clear Pea's proposal",
    unstage: "Clear the staged value; restore the standing proposal or baseline",
  };
  return availableTransitions(cell, "human", { lock: wire.lockOf?.(key) ?? null })
    .filter((kind): kind is CellTransitionKind => DRAWN.has(kind))
    .map((kind) => ({
      kind,
      reason: reason[kind],
      run: () => writeKind(wire, kind, transitionPatches(cellsPath(wire), key, cell, { kind })),
    }));
}

export interface FanOutOutcome {
  kind: FanOutKind;
  covered: string[];
  skipped: { key: string; reason: SkipReason }[];
  refusal: { code: string; message: string } | null;
}

/**
 * Every aggregate (the band's discard, a column's accept-all, a Chat count) is this: one kind over
 * many keys as ONE write through the contract's `fanOut`. It owns no path, state or wording.
 */
export async function runFanOut(
  wire: CellWire,
  cells: Record<string, TrichotomyCellLike>,
  keys: readonly string[],
  kind: FanOutKind,
): Promise<FanOutOutcome> {
  const { patches, covered, skipped } = fanOut(cells, keys, kind, {
    cellsPath: cellsPath(wire),
    actor: "human",
    lockOf: wire.lockOf,
  });
  const refusal = covered.length ? await writeKind(wire, kind, patches) : null;
  return { kind, covered, skipped, refusal };
}

const PAST: Record<FanOutKind, string> = {
  accept: "accepted",
  deny: "denied",
  withdraw: "withdrawn",
  unstage: "unstaged",
};

/**
 * An aggregate's outcome in words, from counts only: `accepted 11 · skipped 7 (contested: 1,
 * no-proposal: 6)`. A refused write wrote nothing and says the write's own refusal verbatim.
 */
export function fanOutWord({ kind, covered, skipped, refusal }: FanOutOutcome): string {
  if (refusal) return refusal.message;
  const by = new Map<SkipReason, number>();
  for (const skip of skipped) by.set(skip.reason, (by.get(skip.reason) ?? 0) + 1);
  const reasons = [...by].map(([reason, n]) => `${reason}: ${n}`).join(", ");
  return `${PAST[kind]} ${covered.length}${skipped.length ? ` · skipped ${skipped.length} (${reasons})` : ""}`;
}

/**
 * One changed address on ONE line, browsable as a list: what · its value at row scale (the
 * table's own grammar: wash, fold, counter, clipped) · state and origin in one word · the verbs,
 * always drawn. Facts that do not fit (drift, lock reason, notes) ride the cell's title.
 */
export function ReviewRow({
  wire,
  address,
  label,
  cell,
  facts,
  show,
  transitions,
  editor,
}: {
  wire: CellWire;
  address: string;
  label: ReactNode;
  cell: TrichotomyCellLike;
  facts: StateCellProps;
  /** The caller's word for a counter-proposed value. */
  show?: (value: unknown) => string;
  /** The consumer's own verbs for this address, when the contract's defaults don't say it. */
  transitions?: readonly CellTransition[];
  /**
   * The table's own cell for this address, editable: drawn in place of the read-only value so a
   * staged value is refined where it is reviewed. Its verbs are its own.
   */
  editor?: ReactNode;
}) {
  const props = cellFromTrichotomy(cell, facts, show);
  const verbs = transitions ?? reviewTransitions(wire, address, cell);
  const by = props.stage === "staged" ? props.stagedBy : "pea";
  return (
    <div
      className="dl-review my-px grid h-(--item-h) grid-cols-[minmax(6rem,14rem)_minmax(0,22rem)_7rem] items-center gap-2"
      style={{ "--acts": verbs.length } as CSSProperties}
    >
      <span className="min-w-0 truncate">{label}</span>
      {editor ?? <StateCell {...props} scale="row" transitions={verbs} />}
      <span
        className="truncate t-small face-mono text-ink-2"
        data-tone={by === "pea" ? "pea" : undefined}
      >
        {props.counterValue != null ? "contested" : props.stage} · {by === "pea" ? "pea" : "you"}
      </span>
    </div>
  );
}

/** The addresses a reviewer draws: every cell carrying a proposal or a staged value. */
export const reviewAddresses = <C extends TrichotomyCellLike>(cells: Record<string, C>) =>
  Object.entries(cells).filter(([, cell]) => cell.proposal != null || cell.staged != null);

/** How long the unstage confirm waits for its second press. */
const CONFIRM_MS = 4000;

/**
 * BULK UNSTAGE (F-J1-8): one `unstage` fanOut over the staged cells among `keys`, where the
 * aggregate accept/deny live. It removes the person's own work, so it asks on the SAME control:
 * the first press arms it ("unstage N staged? press again") for about 4 s, Escape cancels, and only
 * the second press writes. The unstage transition's own rule decides what it covers; Pea's
 * proposals on those cells stay.
 */
export function UnstageAll({
  wire,
  cells,
  keys,
  done,
  compact,
}: {
  wire: CellWire;
  cells: Record<string, TrichotomyCellLike>;
  keys: readonly string[];
  done: (outcome: FanOutOutcome) => void;
  /** An icon and a count, for a one-line row; the words move to the title. */
  compact?: boolean;
}) {
  const staged = useMemo(
    () =>
      fanOut(cells, keys, "unstage", {
        cellsPath: cellsPath(wire),
        actor: "human",
        lockOf: wire.lockOf,
      }).covered.length,
    [cells, keys, wire],
  );
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const lapse = setTimeout(() => setArmed(false), CONFIRM_MS);
    return () => clearTimeout(lapse);
  }, [armed]);
  useScopeKeys([
    {
      hotkey: "Escape",
      callback: () => setArmed(false),
      label: "cancel unstage",
      says: "cancel the armed unstage-all before it writes",
      options: { enabled: armed },
    },
  ]);
  if (!staged) return null;
  return (
    <Verdict
      kind="unstage"
      title={
        armed
          ? `Press again to clear your ${staged} staged values in one write; Escape cancels`
          : `Clear your ${staged} staged values in one write (asks first); Pea's proposals stay`
      }
      onClick={() => {
        if (!armed) return setArmed(true);
        setArmed(false);
        void runFanOut(wire, cells, keys, "unstage").then(done);
      }}
    >
      {armed
        ? compact
          ? `${staged}? again`
          : `unstage ${staged} staged? press again`
        : compact
          ? String(staged)
          : `unstage all (${staged})`}
    </Verdict>
  );
}

/**
 * Start fresh, confirmed: the first press shows what is set aside (read-only), the second sets it
 * aside. No lapse, so the person can read it; Escape or "keep it" cancels. Pea cannot do this.
 */
function StartFresh({ run, aside }: { run: () => void; aside?: ReactNode }) {
  const [armed, setArmed] = useState(false);
  useScopeKeys([
    {
      hotkey: "Escape",
      callback: () => setArmed(false),
      label: "cancel start fresh",
      says: "keep the saved Work; nothing is set aside",
      options: { enabled: armed },
    },
  ]);
  return (
    <span className="flex flex-col gap-1">
      <span className="flex items-baseline gap-2">
        <Press
          frame="line"
          tone="quiet"
          size="value"
          title={
            armed
              ? "Press again to set the saved Work aside, untouched on disk, and start an empty one; Escape keeps it"
              : "Sets the saved Work aside, untouched on disk, and starts a new empty Work here (asks first). Pea cannot do this."
          }
          onClick={() => {
            if (!armed) return setArmed(true);
            setArmed(false);
            run();
          }}
        >
          {armed ? "start fresh? press again" : "start fresh"}
        </Press>
        {armed ? (
          <Press frame="line" tone="quiet" size="value" onClick={() => setArmed(false)}>
            keep it
          </Press>
        ) : null}
      </span>
      {armed ? aside : null}
    </span>
  );
}

/** `3 families`: a count and its English plural. */
export const plural = (n: number, noun: string) =>
  `${n} ${n === 1 ? noun : noun.endsWith("y") ? `${noun.slice(0, -1)}ies` : `${noun}s`}`;

/**
 * The Work slot's default render (ruling 14): one sentence of what you staged and Pea proposed, on
 * how many of each group the route names, then the aggregates. Accept and deny all are one
 * `runFanOut` over every cell; unstage all is the discard. Nothing pending draws nothing.
 */
export function WorkSentence({
  summary,
  cells,
  wire,
  commit,
}: {
  summary: WorkSummary;
  cells: Record<string, TrichotomyCellLike>;
  wire: CellWire;
  /** The consumer's commit verb, drawn while something is staged. */
  commit?: ReactNode;
}) {
  const [outcome, setOutcome] = useState<FanOutOutcome | null>(null);
  const { staged, proposed, contested, spans } = summary;
  if (!staged && !proposed) return null;
  const keys = Object.keys(cells);
  const all = (kind: "accept" | "deny") => void runFanOut(wire, cells, keys, kind).then(setOutcome);
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 t-prose">
      <span className="text-ink-2">
        {staged ? (
          <b className="font-semibold text-ink">{plural(staged, "cell")} staged by you</b>
        ) : null}
        {staged && proposed ? ", " : null}
        {proposed ? <span data-tone="pea">{proposed} proposed by Pea</span> : null}
        {contested ? <span data-tone="caution"> · {contested} contested</span> : null}
        {spans.map((span) => ` · ${plural(span.count, span.noun)}`)}
      </span>
      {outcome ? (
        <span className="t-small text-ink-2" data-tone={outcome.refusal ? "caution" : undefined}>
          {fanOutWord(outcome)}
        </span>
      ) : null}
      <span className="ml-auto flex items-baseline gap-1">
        {proposed ? (
          <>
            <Verdict
              kind="accept"
              title="Accept every open proposal in one write; cells you staged are skipped. Nothing reaches Revit until apply."
              onClick={() => all("accept")}
            >
              accept all
            </Verdict>
            <Verdict
              kind="deny"
              title="Clear every open proposal in one write. Staged values stay."
              onClick={() => all("deny")}
            >
              deny all
            </Verdict>
          </>
        ) : null}
        <UnstageAll wire={wire} cells={cells} keys={keys} done={setOutcome} />
        {staged ? commit : null}
      </span>
    </div>
  );
}
