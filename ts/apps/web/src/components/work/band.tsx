import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Undo2 } from "lucide-react";
import {
  availableTransitions,
  fanOut,
  summarize,
  transitionPatches,
  type CellGroup,
  type FanOutKind,
  type RouteStatePatch,
  type SkipReason,
  type TransitionKind,
  type CellLike,
} from "@pe/agent-contracts";

import {
  cellFromDraft,
  StateCell,
  type CellTransition,
  type CellTransitionKind,
  type StateCellProps,
} from "@pe/kit/lang/cell";
import { Button } from "@pe/kit/lang/button";
import { Verdict } from "@pe/kit/lang/verdict";
import { useScopeKeys } from "@pe/kit/keys";
import { TooltipHint } from "@pe/kit/lang/tooltip";

interface WorkStandingProps {
  conflict?: boolean;
  unresolved?: readonly string[];
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
 * A Work's standing lines, none of them cells: what is unresolved (a lost write, a conflicting
 * writer, the last refusal).
 */
export function WorkStanding({
  conflict,
  unresolved = [],
  reload,
  startFresh,
  startFreshAside,
}: WorkStandingProps) {
  return (
    <>
      {unresolved.length ? (
        <div
          className="hairline-t flex flex-wrap items-baseline gap-x-2 gap-y-1 py-1.5 t-prose"
          data-tone="caution"
          role="status"
        >
          <span className="w-[9rem] t-small t-upper text-ink-mute">unresolved</span>
          <span>{unresolved.join(" · ")}</span>
          {conflict && reload ? (
            <Button kind="framed" label="reload" onClick={reload}>
              reload
            </Button>
          ) : null}
          {startFresh ? <StartFresh run={startFresh} aside={startFreshAside} /> : null}
        </div>
      ) : null}
    </>
  );
}

/** Proposed, edit and contested cells over a set of groups. */
export const tally = (groups: readonly Pick<CellGroup, "proposed" | "staged" | "contested">[]) => {
  const sum = (field: "proposed" | "staged" | "contested") =>
    groups.reduce((total, group) => total + group[field], 0);
  return { proposed: sum("proposed"), edit: sum("staged"), contested: sum("contested") };
};

/** A Work's cells at head scale: the tally, the contract's groups, and how many at each named depth. */
export interface WorkSummary extends ReturnType<typeof tally> {
  groups: CellGroup[];
  /** Distinct groups at each depth the route names ("3 families"). */
  spans: { noun: string; count: number }[];
}

/** The one summary the Situation's Work slot and Chat's suggestion head read (ruling 14). */
export function workSummary(
  cells: Record<string, CellLike>,
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
    context?: { press: string },
  ) => Promise<{ code: string; message: string } | null>;
  pending?: (press: string) => boolean;
  discard?: (press: string) => void;
  revision: number | null;
  lockOf?: (key: string) => string | null;
  baselineOf?: (key: string) => unknown;
}

/** Where a wire's cells sit in its Work: under its segment, or at the root. */
const cellsPath = (wire: CellWire) => (wire.segment === null ? [] : [wire.segment]);

/** Revert removes the edit; a cell with no standing proposal has no reason to remain in Work. */
const clearPatch = (wire: CellWire, key: string, cell: CellLike): RouteStatePatch => ({
  path: [...cellsPath(wire), key, ...(cell.suggestion != null ? ["edit"] : [])],
});

const DRAWN = new Set<string>(["take", "unsuggest", "clear"] satisfies CellTransitionKind[]);

/** Every cell command carries the Work revision the person saw. */
const writeKind = (wire: CellWire, _kind: TransitionKind, patches: RouteStatePatch[]) =>
  wire.revision === null
    ? Promise.resolve({
        code: "not-ready",
        message: "Work has not been read yet; nothing on screen to act on",
      })
    : wire.write(patches, wire.revision);

/** The cell's verbs: exactly what the contract makes available to a person on it. */
export function reviewTransitions(wire: CellWire, key: string, cell: CellLike): CellTransition[] {
  // Wording only: the reader says whether Pea is arguing against a edit value.
  const counter = cellFromDraft(cell, { value: null }).counterValue != null;
  const reason: Record<CellTransitionKind, string> = {
    take: counter
      ? "Use the suggestion in place of the current edit"
      : "Use this suggestion as the edit",
    unsuggest: counter ? "Clear the suggestion; the current edit stays" : "Clear this suggestion",
    clear: "Clear the edit value; restore the standing suggestion or baseline",
  };
  return availableTransitions(cell, { lock: wire.lockOf?.(key) ?? null })
    .filter((kind): kind is CellTransitionKind => DRAWN.has(kind))
    .map((kind) => ({
      kind,
      reason: reason[kind],
      run: () =>
        writeKind(
          wire,
          kind,
          kind === "clear"
            ? [clearPatch(wire, key, cell)]
            : transitionPatches(cellsPath(wire), key, cell, { kind }),
        ),
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
  cells: Record<string, CellLike>,
  keys: readonly string[],
  kind: FanOutKind,
): Promise<FanOutOutcome> {
  const { patches, covered, skipped } = fanOut(cells, keys, kind, {
    cellsPath: cellsPath(wire),

    lockOf: wire.lockOf,
  });
  const refusal = covered.length
    ? await writeKind(
        wire,
        kind,
        kind === "clear" ? covered.map((key) => clearPatch(wire, key, cells[key]!)) : patches,
      )
    : null;
  return { kind, covered, skipped, refusal };
}

const PAST: Record<FanOutKind, string> = {
  take: "accepted",
  unsuggest: "denied",
  clear: "unstaged",
};

/**
 * An aggregate's outcome in words, from counts only: `accepted 11 · skipped 7 (contested: 1,
 * no-suggestion: 6)`. A refused write wrote nothing and says the write's own refusal verbatim.
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
  mark = true,
}: {
  wire: CellWire;
  address: string;
  label: ReactNode;
  cell: CellLike;
  facts: StateCellProps;
  /** The caller's word for a counter-proposed value. */
  show?: (value: unknown) => string;
  /** The consumer's own verbs for this address, when the contract's defaults don't say it. */
  transitions?: readonly CellTransition[];
  /**
   * The table's own cell for this address, editable: drawn in place of the read-only value so a
   * edit value is refined where it is reviewed. Its verbs are its own.
   */
  editor?: ReactNode;
  /**
   * The trailing `proposed · pea` word. A narrow sidebar card turns it off (ruled 2026-10-06,
   * kaitpw): the cell's own proposed state is the indicator and its title carries the author.
   */
  mark?: boolean;
}) {
  const props = cellFromDraft(cell, facts, show);
  const verbs = transitions ?? reviewTransitions(wire, address, cell);
  const by = props.stage === "edit" ? props.author : "pea";
  return (
    <div
      className={`dl-review my-px grid h-(--item-h) items-center gap-2 ${
        mark
          ? "grid-cols-[minmax(6rem,14rem)_minmax(0,22rem)_7rem]"
          : "grid-cols-[minmax(6rem,14rem)_minmax(0,22rem)]"
      }`}
      style={{ "--acts": verbs.length } as CSSProperties}
    >
      <span className="min-w-0 truncate">{label}</span>
      {editor ?? <StateCell {...props} scale="row" transitions={verbs} />}
      {mark ? (
        <span
          className="truncate t-small face-mono text-ink-2"
          data-tone={by === "pea" ? "pea" : undefined}
        >
          {props.counterValue != null ? "contested" : props.stage} · {by === "pea" ? "pea" : "you"}
        </span>
      ) : null}
    </div>
  );
}

/** The addresses a reviewer draws: every cell carrying a suggestion or a edit value. */
export const reviewAddresses = <C extends CellLike>(cells: Record<string, C>) =>
  Object.entries(cells).filter(([, cell]) => cell.suggestion != null || cell.edit != null);

/** How long the unstage confirm waits for its second press. */
const CONFIRM_MS = 4000;

/**
 * BULK UNSTAGE (F-J1-8): one `unstage` fanOut over the edit cells among `keys`, where the
 * aggregate accept/deny live. It removes the person's own work, so it asks on the SAME control:
 * the first press arms it ("unstage N edit? press again") for about 4 s, Escape cancels, and only
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
  cells: Record<string, CellLike>;
  keys: readonly string[];
  done: (outcome: FanOutOutcome) => void;
  /** A framed revert button with its count, for a one-line row; the words move to the title. */
  compact?: boolean;
}) {
  const edit = useMemo(
    () =>
      fanOut(cells, keys, "clear", {
        cellsPath: cellsPath(wire),

        lockOf: wire.lockOf,
      }).covered.length,
    [cells, keys, wire],
  );
  const [armed, setArmed] = useState<{
    press: string;
    patches: RouteStatePatch[];
    outcome: FanOutOutcome;
    revision: number | null;
    confirmed: boolean;
    registered?: boolean;
  } | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const sending = useRef(false);
  const cancel = () => {
    if (armed) wire.discard?.(armed.press);
    setArmed(null);
    setFailure(null);
  };
  useEffect(() => {
    if (!armed || armed.confirmed) return;
    const lapse = setTimeout(() => setArmed(null), CONFIRM_MS);
    return () => clearTimeout(lapse);
  }, [armed]);
  useEffect(() => {
    if (!armed?.confirmed || !wire.pending) return;
    if (wire.pending(armed.press) && !armed.registered) setArmed({ ...armed, registered: true });
    else if (!wire.pending(armed.press) && armed.registered && !sending.current) {
      setArmed(null);
      setFailure(null);
    }
  }, [armed, wire]);
  useScopeKeys(
    armed
      ? [
          {
            hotkey: "Escape",
            callback: cancel,
            label: "cancel unstage",
            says: "cancel the armed unstage-all before it writes",
            options: { enabled: !!armed },
          },
        ]
      : [],
  );
  const count = armed?.outcome.covered.length ?? edit;
  if (!count) return null;
  const title = armed
    ? `Press again to clear your ${count} edit values in one write; Escape cancels`
    : `Clear your ${edit} edit values in one write (asks first); Pea's proposals stay`;
  const press = async () => {
    if (sending.current) return;
    if (!armed) {
      const { covered, skipped } = fanOut(cells, keys, "clear", {
        cellsPath: cellsPath(wire),
        lockOf: wire.lockOf,
      });
      return setArmed({
        press: crypto.randomUUID(),
        confirmed: false,
        revision: wire.revision,
        patches: structuredClone(covered.map((key) => clearPatch(wire, key, cells[key]!))),
        outcome: { kind: "clear", covered, skipped, refusal: null },
      });
    }
    const intent = armed;
    setArmed({ ...intent, confirmed: true });
    sending.current = true;
    try {
      const revision = intent.confirmed ? wire.revision : intent.revision;
      const refusal =
        revision === null
          ? {
              code: "not-ready",
              message: "Work has not been read yet; reload before retrying this revert",
            }
          : await wire.write(intent.patches, revision, { press: intent.press });
      if (refusal) setFailure(refusal.message);
      else {
        setArmed(null);
        setFailure(null);
        done({ ...intent.outcome, refusal: null });
      }
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : String(cause));
    } finally {
      sending.current = false;
    }
  };
  return (
    <>
      {compact ? (
        <Button
          kind="framed"
          icon={Undo2}
          label={`Revert ${count} edit`}
          reason={title}
          onClick={() => void press()}
        >
          <span className="face-mono">{armed ? `${count}? again` : count}</span>
        </Button>
      ) : (
        <TooltipHint content={title}>
          <Verdict kind="clear" onClick={() => void press()}>
            {armed ? `unstage ${count} edit? press again` : `unstage all (${count})`}
          </Verdict>
        </TooltipHint>
      )}
      {failure && (
        <span role="alert" data-tone="caution">
          Revert was not saved: {failure}. Press again to retry; Escape cancels.
        </span>
      )}
    </>
  );
}

/**
 * Start fresh, confirmed: the first press shows what is set aside (read-only), the second sets it
 * aside. No lapse, so the person can read it; Escape or "keep it" cancels. Pea cannot do this.
 */
function StartFresh({ run, aside }: { run: () => void; aside?: ReactNode }) {
  const [armed, setArmed] = useState(false);
  useScopeKeys(
    armed
      ? [
          {
            hotkey: "Escape",
            callback: () => setArmed(false),
            label: "cancel start fresh",
            says: "keep the saved Work; nothing is set aside",
            options: { enabled: armed },
          },
        ]
      : [],
  );
  return (
    <span className="flex flex-col gap-1">
      <span className="flex items-baseline gap-2">
        <Button
          kind="framed"
          label={armed ? "start fresh? press again" : "start fresh"}
          reason={
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
        </Button>
        {armed ? (
          <Button kind="framed" label="keep it" onClick={() => setArmed(false)}>
            keep it
          </Button>
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
 * The Work slot's default render (ruling 14): shared edit and suggestion counts, followed by
 * the groups the route names. Counts do not infer authors. Accept and deny all are one
 * `runFanOut` over every cell; clear all is the discard. Nothing pending draws nothing.
 */
export function WorkSentence({
  summary,
  cells,
  wire,
  commit,
}: {
  summary: WorkSummary;
  cells: Record<string, CellLike>;
  wire: CellWire;
  /** The consumer's commit verb, drawn while something is edit. */
  commit?: ReactNode;
}) {
  const [outcome, setOutcome] = useState<FanOutOutcome | null>(null);
  const { edit, proposed, contested, spans } = summary;
  if (!edit && !proposed) return null;
  const keys = Object.keys(cells);
  const all = (kind: "take" | "unsuggest") =>
    void runFanOut(wire, cells, keys, kind).then(setOutcome);
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 t-prose">
      <span className="text-ink-2">
        {edit ? <b className="font-semibold text-ink">{plural(edit, "edited cell")}</b> : null}
        {edit && proposed ? ", " : null}
        {proposed ? <span>{plural(proposed, "suggestion")}</span> : null}
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
            <TooltipHint content="Accept every open suggestion in one write; cells you edit are skipped. Nothing reaches Revit until apply.">
              <Verdict kind="take" onClick={() => all("take")}>
                accept all
              </Verdict>
            </TooltipHint>
            <TooltipHint content="Clear every open suggestion in one write. Staged values stay.">
              <Verdict kind="unsuggest" onClick={() => all("unsuggest")}>
                deny all
              </Verdict>
            </TooltipHint>
          </>
        ) : null}
        <UnstageAll wire={wire} cells={cells} keys={keys} done={setOutcome} />
        {edit ? commit : null}
      </span>
    </div>
  );
}
