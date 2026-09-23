import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  availableTransitions,
  fanOut,
  transitionBinding,
  transitionPatches,
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
import { ActionButton } from "#/components/lang/action-button";
import { useScopeKeys } from "#/route/keys";

export interface WorkBandProps {
  count: number;
  noun: string;
  revision: number | null;
  read?: string;
  conflict?: boolean;
  busy?: boolean;
  discard: () => void;
  commit?: { label: string; reason: string; disabled?: boolean; run: () => void };
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
  body?: ReactNode;
  /** Compact heads may remain present for open proposals or transient asks with nothing staged. */
  visible?: boolean;
  /** Situation already carries this word beside its verb row. */
  showRevision?: boolean;
}

export const workBandWord = ({
  revision,
  count,
  noun,
  conflict,
  unreadable,
}: Pick<WorkBandProps, "revision" | "count" | "noun" | "conflict"> & { unreadable?: boolean }) =>
  `${unreadable ? "unreadable" : revision === null ? "unwritten" : `r${revision}`}${
    count > 0 ? ` · ${count} ${noun}${count === 1 ? "" : "s"} staged` : ""
  }${conflict ? " · changed elsewhere" : ""}`;

/** The Work frame used below route heads and inside compact composer heads. */
export function WorkBand({
  count,
  noun,
  revision,
  read,
  conflict,
  busy,
  discard,
  commit,
  unresolved = [],
  lifetime,
  receipt,
  reload,
  startFresh,
  startFreshAside,
  body,
  visible = count > 0,
  showRevision = true,
}: WorkBandProps) {
  // Unresolved is the band's own state and says itself even when nothing is staged.
  if (!visible && !unresolved.length && !receipt) return null;
  return (
    <>
      {visible ? (
        <div className="hairline-t flex flex-col gap-1 py-1.5 t-prose">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="w-[9rem] t-small t-upper text-ink-mute">staged</span>
            <span>
              <b className="font-semibold text-ink">
                {count} {noun}
                {count === 1 ? "" : "s"}
              </b>
              {read ? <span className="face-mono text-ink-mute"> · read {read}</span> : null}
            </span>
            <span className="ml-auto flex items-baseline gap-2">
              <Press
                frame="line"
                tone="quiet"
                size="value"
                state={busy ? "disabled" : "rest"}
                disabled={busy}
                onClick={discard}
              >
                discard
              </Press>
              {commit ? (
                <span className="flex items-baseline gap-2">
                  <Press
                    frame="line"
                    tone="neutral"
                    size="value"
                    state={commit.disabled || busy ? "disabled" : "rest"}
                    disabled={commit.disabled || busy}
                    title={commit.reason}
                    onClick={commit.run}
                  >
                    {commit.label}
                  </Press>
                  {commit.disabled ? (
                    // SPECIMEN: /design-system/band K5. A conflicting Work must say why plan refuses.
                    <span className="max-w-[36ch] t-small face-mono text-ink-2 italic">
                      {commit.reason}
                    </span>
                  ) : null}
                </span>
              ) : null}
              {showRevision ? (
                <span className="t-small face-mono text-ink-mute">
                  {workBandWord({ revision, count, noun, conflict })}
                </span>
              ) : null}
            </span>
          </div>
          {lifetime ? (
            <p className="t-small text-ink-2" role="note">
              {lifetime}
            </p>
          ) : null}
          {body}
        </div>
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
 * One changed address at card scale: its label, the StateCell carrying its own verbs, and whose
 * staged value it is in words (a compact head has no table to carry that).
 */
export function ReviewRow({
  wire,
  address,
  label,
  cell,
  facts,
  show,
  transitions,
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
}) {
  const props = cellFromTrichotomy(cell, facts, show);
  return (
    <div className="grid grid-cols-[9rem_minmax(0,1fr)] items-baseline gap-3 py-2">
      <span className="truncate">{label}</span>
      <span className="flex min-w-0 flex-wrap items-baseline gap-2">
        <StateCell {...props} transitions={transitions ?? reviewTransitions(wire, address, cell)} />
        {props.stagedBy ? (
          <span className="t-small text-ink-2">by {props.stagedBy === "pea" ? "Pea" : "you"}</span>
        ) : null}
      </span>
    </div>
  );
}

/** The addresses a reviewer draws: every cell carrying a proposal or a staged value. */
export const reviewAddresses = <C extends TrichotomyCellLike>(cells: Record<string, C>) =>
  Object.entries(cells).filter(([, cell]) => cell.proposal != null || cell.staged != null);

/** The band's discard: `unstage` fanned over every staged address. */
export const discardStaged = (wire: CellWire, cells: Record<string, TrichotomyCellLike>) =>
  runFanOut(
    wire,
    cells,
    Object.keys(cells).filter((key) => cells[key]?.staged != null),
    "unstage",
  );

/**
 * The consumer's commit verb on the band: refused while nothing is staged, or for the consumer's
 * own reason, which the band then says beside the verb.
 */
export const reviewCommit = (
  label: string,
  staged: number,
  run: () => void,
  refusal?: string | null,
): NonNullable<WorkBandProps["commit"]> => ({
  label,
  run,
  disabled: staged === 0 || refusal != null,
  reason:
    refusal ??
    (staged === 0
      ? "Nothing staged yet — accept a proposal first"
      : "Write every staged value through — this leaves the page"),
});

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
}: {
  wire: CellWire;
  cells: Record<string, TrichotomyCellLike>;
  keys: readonly string[];
  done: (outcome: FanOutOutcome) => void;
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
    <ActionButton
      label={armed ? `unstage ${staged} staged? press again` : `unstage all (${staged})`}
      reason={
        armed
          ? `Press again to clear your ${staged} staged values in one write; Escape cancels`
          : `Clear your ${staged} staged values in one write (asks first); Pea's proposals stay`
      }
      onClick={() => {
        if (!armed) return setArmed(true);
        setArmed(false);
        void runFanOut(wire, cells, keys, "unstage").then(done);
      }}
    />
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
