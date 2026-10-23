/**
 * One verb that previews before it does. Idle it is a single button; pressing it runs the preview
 * and, when the result is in, opens a popover on that button with what will change and the commit.
 * Clicking away or Escape closes the popover and leaves the button armed (pressed, "heal · previewed
 * 3"); pressing it again reopens the popover without previewing. The result is the caller's
 * (`held`): the route keeps it, so an armed button survives a remount and the popover is a view.
 * When the inputs the preview rested on change the caller drops `held` and passes `stale`: the
 * button is idle again with that reason beside it.
 */
import { useEffect, useState, type ReactNode } from "react";
import { Popover } from "@base-ui/react/popover";
import type { LucideIcon } from "lucide-react";

import { Button } from "./button";
import { PopoverContent } from "./popover";

/** What a run left behind: a sentence when it was refused or failed, null when it went through. */
export type PreviewRun = Promise<{ readonly message: string } | null>;

export interface PreviewHeld {
  /** The armed button's word: "heal · previewed 3". */
  word: string;
  /** The counts line over the list: "3 pass · 1 refused". */
  summary: string;
  /** The before/after list the verb already produces; drawn under the counts. */
  lines?: ReactNode;
}

export interface PreviewActionProps {
  /** The idle button's word: the verb ("preview heal"). */
  label: string;
  says: string;
  /** Why the preview cannot run now; keeps the button focusable and inert. */
  refusal?: string | null;
  /** Another action holds the route. */
  busy?: boolean;
  /** The preview that still describes the inputs, or null. */
  held: PreviewHeld | null;
  /** Why a preview that was held no longer is ("changed since preview"); null when none was. */
  stale?: string | null;
  preview: () => PreviewRun;
  commit: {
    label: string;
    says: string;
    /** Why the commit is not armed even with a preview held. */
    refusal?: string | null;
    run: () => PreviewRun;
    /** What the popover says once it went through. */
    done: string;
  };
  /** Draw the button as one glyph (a dense row); `label` is its name and tooltip. */
  icon?: LucideIcon;
}

type Outcome = { kind: "done" | "refused"; text: string };

export function PreviewAction({
  label,
  says,
  refusal = null,
  busy = false,
  held,
  stale = null,
  preview,
  commit,
  icon,
}: PreviewActionProps) {
  const [phase, setPhase] = useState<"previewing" | "committing" | null>(null);
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
  const runPreview = async () => {
    setOutcome(null);
    setPhase("previewing");
    const refused = await preview().finally(() => setPhase(null));
    if (refused) settle("refused", refused.message);
    else setOpen(true);
  };
  const runCommit = async () => {
    setPhase("committing");
    const refused = await commit.run().finally(() => setPhase(null));
    settle(refused ? "refused" : "done", refused ? refused.message : commit.done);
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
        else if (!refusal && !busy && phase === null) void runPreview();
      }}
    >
      <Popover.Trigger
        render={
          <Button
            kind="framed"
            icon={icon}
            label={word}
            reason={armed ? `${says}. Previewed; press to see it again` : reason}
            // A refused preview (no document, nothing staged) still leaves a held one to look at.
            refusal={armed ? null : refusal}
            busy={busy || phase === "previewing"}
            pressed={armed}
            data-tone={stale && !armed ? "caution" : undefined}
            data-preview-action={armed ? "armed" : stale ? "stale" : "idle"}
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
        data-preview-popover=""
        // A portal's clicks bubble through React to the row that holds the button.
        onClick={(event) => event.stopPropagation()}
      >
        {armed ? (
          <div className="flex flex-col gap-1.5">
            <div className="t-small face-mono text-ink-2">{held.summary}</div>
            {held.lines}
          </div>
        ) : null}
        {outcome ? (
          <p
            data-preview-outcome={outcome.kind}
            data-tone={outcome.kind === "refused" ? "caution" : undefined}
            className="t-prose"
          >
            {outcome.text}
          </p>
        ) : null}
        {armed && outcome?.kind !== "done" ? (
          <div className="mt-2 flex items-center justify-between gap-2">
            <Button
              kind="commit"
              label={commit.label}
              reason={commit.says}
              refusal={commit.refusal}
              busy={phase === "committing"}
              onClick={() => void runCommit()}
            >
              {commit.label}
            </Button>
            <span className="face-mono text-ink-mute t-small">Esc</span>
          </div>
        ) : null}
      </PopoverContent>
    </Popover.Root>
  );
}
