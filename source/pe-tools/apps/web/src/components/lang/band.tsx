import type { ReactNode } from "react";
import { Check, Undo2, X } from "lucide-react";
import type { RouteStatePatch, TrichotomyCellLike } from "@pe/agent-contracts";

import { ActionButton } from "#/components/lang/action-button";
import { cellFromTrichotomy, StateCell, type StateCellProps } from "#/components/lang/cell";
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
}: Pick<WorkBandProps, "revision" | "count" | "noun" | "conflict">) =>
  `${revision === null ? "unwritten" : `r${revision}`}${
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
  if (!visible) return null;
  return (
    <>
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

/** A trichotomy cell as the reviewer reads it; a proposal or staged rung may delete. */
export type ReviewCell = Pick<TrichotomyCellLike, "proposal" | "staged"> & {
  proposal?: { delete?: true } | null;
  staged?: { value?: unknown; delete?: true } | null;
};

export interface ReviewHandlers {
  onAccept: (address: string) => void;
  onDeny: (address: string) => void;
  onUnstage: (address: string) => void;
  busy?: boolean;
}

/** Open or contested, read through the one reader so equality is canonical JSON. */
const reviewRead = (cell: ReviewCell) => {
  const read = cellFromTrichotomy(cell, { value: null });
  return { standing: read.stage === "proposed" || read.counterValue != null, read };
};

/**
 * The one verb set for a trichotomy cell, at every scale. A proposal that differs from what is
 * staged is standing (open, or a counter-proposal) and takes accept/deny; anything staged takes
 * unstage. A contested cell therefore offers all three (journeys review 2). A clean or pea-less
 * cell draws nothing.
 */
export function ReviewActions({
  address,
  cell,
  onAccept,
  onDeny,
  onUnstage,
  busy,
}: ReviewHandlers & { address: string; cell: ReviewCell }) {
  const { standing, read } = reviewRead(cell);
  const counter = read.counterValue != null;
  if (!standing && cell.staged == null) return null;
  return (
    <span className="flex gap-1">
      {standing ? (
        <>
          <ActionButton
            tone="agent"
            icon={Check}
            label="accept"
            disabled={busy}
            reason={
              counter
                ? "Stage Pea's counter-proposal in place of your staged value"
                : "Stage Pea's proposal"
            }
            onClick={() => onAccept(address)}
          />
          <ActionButton
            icon={X}
            label="deny"
            disabled={busy}
            reason={
              counter
                ? "Clear Pea's counter-proposal; your staged value stays"
                : "Clear Pea's proposal"
            }
            onClick={() => onDeny(address)}
          />
        </>
      ) : null}
      {cell.staged != null ? (
        <ActionButton
          icon={Undo2}
          label="unstage"
          disabled={busy}
          reason="Clear the staged value; restore the standing proposal or baseline"
          onClick={() => onUnstage(address)}
        />
      ) : null}
    </span>
  );
}

/**
 * One changed address at card scale: its label, the StateCell, whose staged value it is in words
 * (a compact head has no table to carry that), and the verbs.
 */
export function ReviewRow({
  address,
  label,
  cell,
  facts,
  show,
  ...handlers
}: ReviewHandlers & {
  address: string;
  label: ReactNode;
  cell: ReviewCell;
  facts: StateCellProps;
  /** The caller's word for a counter-proposed value. */
  show?: (value: unknown) => string;
}) {
  const props = cellFromTrichotomy(cell, facts, show);
  return (
    <div className="grid grid-cols-[9rem_minmax(0,1fr)_auto] items-baseline gap-3 py-2">
      <span className="truncate">{label}</span>
      <span className="flex min-w-0 flex-wrap items-baseline gap-2">
        <StateCell {...props} />
        {props.stagedBy ? (
          <span className="t-small text-ink-2">by {props.stagedBy === "pea" ? "Pea" : "you"}</span>
        ) : null}
      </span>
      <ReviewActions address={address} cell={cell} {...handlers} />
    </div>
  );
}

/** The addresses a reviewer draws: every cell carrying a proposal or a staged value. */
export const reviewAddresses = <C extends ReviewCell>(cells: Record<string, C>) =>
  Object.entries(cells).filter(([, cell]) => cell.proposal != null || cell.staged != null);

/**
 * The Work patches behind the verbs, over one segment of a route document (`fields`, `cells`).
 * Accept stages the proposal's rung; deny clears the proposal; unstage clears `staged`.
 */
export const reviewPatches = (segment: string) => ({
  accept: (address: string, cell: ReviewCell): RouteStatePatch[] => [
    {
      path: [segment, address, "staged"],
      value: cell.proposal?.delete === true ? { delete: true } : { value: cell.proposal?.value },
    },
  ],
  deny: (address: string): RouteStatePatch[] => [{ path: [segment, address, "proposal"] }],
  unstage: (address: string): RouteStatePatch[] => [{ path: [segment, address, "staged"] }],
});

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
