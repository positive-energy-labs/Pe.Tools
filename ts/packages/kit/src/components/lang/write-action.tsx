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
import { useEffect, useState, useReducer, type ReactNode } from "react";
import { z } from "zod";
import { writeResponseSchema } from "@pe/agent-contracts";
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
  group?: string;
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

export interface PlanReview {
  preview?: unknown;
  sentence: string | null;
  rows: readonly string[];
  cells?: readonly WriteCell[];
  stale: boolean;
}

/** Structural plan handle supplied by the shell; kit owns no Work, consent or transport. */
export interface PlanHandle {
  readonly pending?: boolean;
  readonly refusal?: string | null;
  readonly failure?: string | null;
  readonly consent?: { until: string; run(): void; content?:ReactNode } | null;
  plan(): unknown;
  apply(): unknown;
  cancel(): unknown;
  read(): PlanReview | null;
}
const reviewSchema = z.object({
  preview: z.unknown().optional(),
  sentence: z.string().nullable(),
  rows: z.array(z.string()),
  cells: z.array(z.object({ key: z.string(), group: z.string().optional(),
        label: z.string(), before: z.string().nullable(),
    after: z.string(), author: z.enum(["pea", "human", "unknown"]) ,
      }),
    ).optional(),
  stale: z.boolean(),
});

/** The handle stays authoritative across remounts; local state only redraws after a gesture. */
export function PreviewAction({ handle, label, children, says = `Plan ${label} from current Work`, ...props }: {
  handle: PlanHandle;
  children?:ReactNode;
  label: string;
  says?: string;
} & Pick<WriteActionProps, "refusal" | "busy" | "failed" | "reject" | "icon">) {
  const [, redraw] = useReducer((value ) => value + 1, 0);
  const raw = handle.read();
  const parsed = reviewSchema.safeParse(raw);
  const review = parsed.success ? parsed.data : null;
  const nativeWrites = z.object({ value: z.object({ writes: z.array(z.object({ outcome: z.string() })) }) }).safeParse(review?.preview);
  const empty = nativeWrites.success && (!nativeWrites.data.value.writes.some((write ) => write.outcome === "planned") ||
      nativeWrites.data.value.writes.some((write) => write.outcome === "refused"));
  const sealed = !!review && !review.stale && writeResponseSchema.safeParse(review.preview).success;
  const run = async (action: () => unknown): WriteRun => {
    try { await action(); return null; }
    catch (error) { return { message: error instanceof Error ? error.message : String(error) }; }
    finally { redraw(); }
  };
  const consent=handle.consent??props.reject;
  return (
    <WriteAction {...props} busy={handle.pending ?? props.busy} refusal={handle.refusal ?? props.refusal} reject={consent?{...consent,content:children??consent.content}:null} label={`plan ${label}`} says={says}
    failed={raw != null && !parsed.success ? "Plan review unavailable" : (handle.failure ?? props.failed)
      }
    held={review && !review.stale ? {
      word: writeWord(label, review.cells?.length || review.rows.length, false),
      summary: review.sentence ?? "",
      ...(review.cells?.length ? { cells: review.cells } : { rows: review.rows }),
    } : null}
    stale={review?.stale ? "changed since plan" : null}
    plan={() => run(() => handle.plan())}
    apply={{ hidden: empty, label, says: `${label} what the plan sealed`, refusal: sealed ? null : "Plan the current Work first",
      run: () => run(() => handle.apply()), done: `${label} sent` ,
      }} />);
}
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
  /** The caller's refusal of a plan that failed after `plan` settled; shown like a refused run. */
  failed?: string | null;
  plan: () => WriteRun;
  apply: {
    hidden?: boolean;
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
  reject?: { until: string; run: () => void; content?: ReactNode } | null;
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
  failed = null,
  plan,
  apply,
  reject = null,
  icon,
}: WriteActionProps) {
  const [phase, setPhase] = useState<"planning" | "applying" | null>(null);
  const [open, setOpen] = useState(false);
  const [ran, setOutcome] = useState<Outcome | null>(null);
  const outcome: Outcome | null = ran ?? (failed ? { kind: "refused", text: failed } : null);
  const armed = held !== null;
  const shown = open && (armed || outcome !== null);
  // A disarmed button holds no popover: when the inputs move, the next arming opens fresh.
  useEffect(() => {
    if (!armed && ran === null) setOpen(false);
  }, [armed, ran]);

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
            {held.cells?.map((cell, index) => (
              <div key={cell.key} data-write-cell={cell.key} className="flex flex-col">
                {cell.group && cell.group !== held.cells?.[index - 1]?.group ? (
                  <p className="t-small">{cell.group}</p>
                ) : null}
                <span className="t-small text-ink-2">
                  {cell.label} ·<span data-write-author={cell.author}>{AUTHOR[cell.author]}</span>
                </span>
                <StateCell value={cell.after} modelValue={cell.before ?? "unknown"} agree="drift" author={cell.author} stage="edit" />
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
        {reject?.content}
        {(armed || reject) && outcome?.kind !== "done" ? (
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
            ) : !apply.hidden ? (
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
            ) : null}
            <span className="face-mono text-ink-mute t-small">Esc</span>
          </div>
        ) : null}
      </PopoverContent>
    </Popover.Root>
  );
}
