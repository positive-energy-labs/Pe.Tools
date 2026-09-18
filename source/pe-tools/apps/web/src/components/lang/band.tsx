import type { ReactNode } from "react";
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
  reload?: () => void;
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
  reload,
  body,
  visible = count > 0,
  showRevision = true,
}: WorkBandProps) {
  // Unresolved is the band's own state and says itself even when nothing is staged.
  if (!visible && !unresolved.length) return null;
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
          {body}
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
  segment: string;
  write: (
    patches: RouteStatePatch[],
    expectedRevision?: number,
  ) => Promise<{ code: string; message: string } | null>;
  revision: number | null;
  lockOf?: (key: string) => string | null;
  baselineOf?: (key: string) => unknown;
}

const DRAWN = new Set<string>(["accept", "deny", "unstage"] satisfies CellTransitionKind[]);

const bindingOf = (wire: CellWire, kind: TransitionKind) =>
  transitionBinding(kind) === "bound" ? (wire.revision ?? undefined) : undefined;

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
      run: () =>
        wire.write(transitionPatches([wire.segment], key, cell, { kind }), bindingOf(wire, kind)),
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
    cellsPath: [wire.segment],
    actor: "human",
    lockOf: wire.lockOf,
  });
  const refusal = covered.length ? await wire.write(patches, bindingOf(wire, kind)) : null;
  return { kind, covered, skipped, refusal };
}

const PAST: Record<FanOutKind, string> = {
  accept: "accepted",
  deny: "denied",
  withdraw: "withdrawn",
  unstage: "unstaged",
};

/** An aggregate's outcome in words: n done · n skipped by reason, or the one refusal. */
export function fanOutWord({ kind, covered, skipped, refusal }: FanOutOutcome): string {
  if (refusal) return `refused · ${covered.length} cells · ${refusal.message}`;
  const by = new Map<SkipReason, number>();
  for (const skip of skipped) by.set(skip.reason, (by.get(skip.reason) ?? 0) + 1);
  const reasons = [...by].map(([reason, n]) => `${n} ${reason}`);
  return `${PAST[kind]} ${covered.length}${skipped.length ? ` · skipped ${skipped.length} (${reasons.join(", ")})` : ""}`;
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
}: {
  wire: CellWire;
  address: string;
  label: ReactNode;
  cell: TrichotomyCellLike;
  facts: StateCellProps;
  /** The caller's word for a counter-proposed value. */
  show?: (value: unknown) => string;
}) {
  const props = cellFromTrichotomy(cell, facts, show);
  return (
    <div className="grid grid-cols-[9rem_minmax(0,1fr)] items-baseline gap-3 py-2">
      <span className="truncate">{label}</span>
      <span className="flex min-w-0 flex-wrap items-baseline gap-2">
        <StateCell {...props} transitions={reviewTransitions(wire, address, cell)} />
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
