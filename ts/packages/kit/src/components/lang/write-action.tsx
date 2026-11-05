/**
 * The one write button (ADR 0030 rule 6): idle, then plan or rehearse, then apply. Idle it is a
 * single button; pressing it runs the plan and, when the seal is in, opens a popover on that button
 * with the before and after cells, their authors, and the apply. Clicking away or Escape closes the
 * popover and leaves the button armed (pressed, "heal · planned 3"); pressing it again reopens it
 * without planning. The held plan is the caller's: the route keeps it, so an armed button survives a
 * remount and the popover is a view. When any consumed input changes the caller drops `held` and
 * passes `stale`: the button is idle again with that reason beside it. Whether the word says
 * "checked in Revit" is the caller's, derived from the plan entry's catalog effect (a TransactRead
 * rehearsal) and never from a response flag.
 */
import { useEffect, useState } from "react";
import { Popover } from "@base-ui/react/popover";
import type { LucideIcon } from "lucide-react";

import { Button } from "./button";
import { StateCell } from "./cell";
import { PopoverContent } from "./popover-internal";

/** What a run left behind: a sentence when it was refused or failed, null when it went through. */
export type WriteRun = Promise<{ readonly message: string } | null>;

/** One consumed value the write changes: the model's value, the staged one, and who staged it. */
export interface WriteCell {
  key: string;
  label: string;
  before: string | null;
  after: string;
  author: "pea" | "human" | "unknown";
}

export interface WriteHeld {
  /** The armed button's word: "heal · planned 3" or "heal · checked in Revit 3". */
  word: string;
  /** The counts line over the list: "3 pass · 1 refused". */
  summary: string;
  /** Before and after with their authors (ADR 0030 rules 6 and 8); drawn under the counts. */
  cells?: readonly WriteCell[];
  /** Lines the plan names that carry no cell (a presentation row). */
  rows?: readonly string[];
}

const AUTHOR = { pea: "Pea", human: "you", unknown: "unknown author" } as const;
/** The armed word. A plan is a Read: only a successful declared rehearsal says "checked in Revit". */
export const writeWord = (verb: string, count: number, rehearsed: boolean) =>
  `${verb} · ${rehearsed ? "checked in Revit" : "planned"} ${count}`;

export interface WriteActionProps {
  /** The idle button's word: the verb ("plan heal"). */
  label: string;
  says: string;
  /** Why the plan cannot run now; keeps the button focusable and inert. */
  refusal?: string | null;
  /** Another action holds the route. */
  busy?: boolean;
  /** The plan that still describes the consumed inputs, or null. */
  held: WriteHeld | null;
  /** Why a plan that was held no longer is ("changed since plan"); null when none was. */
  stale?: string | null;
  plan: () => WriteRun;
  apply: {
    label: string;
    says: string;
    /** Why apply is not armed even with a plan held. */
    refusal?: string | null;
    run: () => WriteRun;
    /** What the popover says once it went through. */
    done: string;
  };
  /**
   * The open Reject? window (ADR 0027): apply lands at `until` unless rejected. Present only while a
   * receipt's consent window is open; the popover keeps the before and after visible meanwhile.
   */
  reject?: { until: string; run: () => void } | null;
  /** Draw the button as one glyph (a dense row); `label` is its name and tooltip. */
  icon?: LucideIcon;
}

type Outcome = { kind: "done" | "refused"; text: string };

export function WriteAction({
  label,
  says,
  refusal = null,
  busy = false,
  held,
  stale = null,
  plan,
  apply,
  reject = null,
  icon,
}: WriteActionProps) {
  const [phase, setPhase] = useState<"planning" | "applying" | null>(null);
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const armed = held !== null;
  const shown = open && (armed || outcome !== null);
  // A disarmed button holds no popover: when the inputs move, the next arming opens fresh.
  useEffect(() => {
    if (!armed && outcome === null) setOpen(false);
  }, [armed, outcome]);

  const settle = (kind: Outcome["kind"], text: string) => {
    setOutcome({ kind, text });
    setOpen(true);
  };
  const runPlan = async () => {
    setOutcome(null);
    setPhase("planning");
    const refused = await plan().finally(() => setPhase(null));
    if (refused) settle("refused", refused.message);
    else setOpen(true);
  };
  const runApply = async () => {
    setPhase("applying");
    const refused = await apply.run().finally(() => setPhase(null));
    settle(refused ? "refused" : "done", refused ? refused.message : apply.done);
  };

  const word = armed ? held.word : label;
  const reason = stale ? `${says}. ${stale}` : says;
  return (
    <Popover.Root
      open={shown}
      onOpenChange={(next) => {
        if (!next) {
          setOpen(false);
          setOutcome(null);
        } else if (armed) setOpen(true);
        else if (!refusal && !busy && phase === null) void runPlan();
      }}
    >
      <Popover.Trigger
        render={
          <Button
            kind="framed"
            icon={icon}
            label={word}
            reason={armed ? `${says}. Planned; press to see it again` : reason}
            // A refused plan (no document, nothing edit) still leaves a held one to look at.
            refusal={armed ? null : refusal}
            busy={busy || phase === "planning"}
            pressed={armed}
            data-tone={stale && !armed ? "caution" : undefined}
            data-write-action={armed ? "armed" : stale ? "stale" : "idle"}
          >
            {icon ? undefined : word}
            {!icon && stale && !armed ? <span className="text-ink-mute">· {stale}</span> : null}
          </Button>
        }
      />
      <PopoverContent
        side="bottom"
        align="start"
        className="w-96"
        data-write-popover=""
        // A portal's clicks bubble through React to the row that holds the button.
        onClick={(event) => event.stopPropagation()}
      >
        {armed ? (
          <div className="flex flex-col gap-1.5">
            <div className="t-small face-mono text-ink-2">{held.summary}</div>
            {held.cells?.map((cell) => (
              <div key={cell.key} data-write-cell={cell.key} className="flex flex-col">
                <span className="t-small text-ink-2">
                  {cell.label} · was <span data-write-before="">{cell.before ?? "unknown"}</span> ·{" "}
                  <span data-write-author={cell.author}>{AUTHOR[cell.author]}</span>
                </span>
                <StateCell value={cell.after} author={cell.author} stage="edit" />
              </div>
            ))}
            {held.rows?.map((row, index) => (
              <p key={index} className="t-small">
                {row}
              </p>
            ))}
          </div>
        ) : null}
        {outcome ? (
          <p
            data-write-outcome={outcome.kind}
            data-tone={outcome.kind === "refused" ? "caution" : undefined}
            className="t-prose"
          >
            {outcome.text}
          </p>
        ) : null}
        {armed && outcome?.kind !== "done" ? (
          <div className="mt-2 flex items-center justify-between gap-2">
            {reject ? (
              <Button
                kind="framed"
                label="Reject?"
                reason={`Lands at ${reject.until}`}
                onClick={reject.run}
                data-write-reject=""
              >
                Reject? · {reject.until}
              </Button>
            ) : (
              <Button
                kind="commit"
                label={apply.label}
                reason={apply.says}
                refusal={apply.refusal}
                busy={phase === "applying"}
                onClick={() => void runApply()}
              >
                {apply.label}
              </Button>
            )}
            <span className="face-mono text-ink-mute t-small">Esc</span>
          </div>
        ) : null}
      </PopoverContent>
    </Popover.Root>
  );
}
