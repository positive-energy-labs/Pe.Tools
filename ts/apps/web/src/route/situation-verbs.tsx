/** The Situation's verb row: each verb button with its flag, and the board that stands them up. */
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import {
  Popover,
  SubjectPopoverContent as PopoverContent,
  PopoverTrigger,
} from "@pe/kit/lang/popover";
import type { LucideIcon } from "lucide-react";
import { Button } from "@pe/kit/lang/button";
import { changedInRevit } from "#/host/resource-state";
import type { ActionHandle, RouteHandle } from "./handle";
import { useSituationPresentation } from "#/navigation/route-controls";

const DONE_FADE_MS = 5000;

/** A verb's standing question, by verb name, drawn in its flag (ruling 39: apply's stale cells). */
const ActionFlag = createContext<Readonly<Record<string, ReactNode>>>({});

/** A verb button with its flag: refused persists until Esc or the next press; busy counts; done fades. */
export function SituationAction({
  handle,
  name,
  action,
  chord = action.chord,
  commit,
  icon: Icon,
  tone: standing,
}: {
  handle: RouteHandle<any, any, any, any>;
  name: string;
  action: ActionHandle;
  /** The chord drawn beside it; defaults to the manifest's. A stage passes its own (`stage.ts`). */
  chord?: string;
  commit?: boolean;
  /** Draw the verb as a single-icon press (kaitpw, 2026-10-12: new, fork, send). The label is
   *  its accessible name; the title still says what it does, why it is refused, and its chord. */
  icon?: LucideIcon;
  /** The verb's standing tone (Stop's alarm); a refusal or a stale read's caution outranks it. */
  tone?: "alarm";
}) {
  const outcome = handle.outcome?.key === name ? handle.outcome : null;
  const busy = handle.busy?.key === name ? handle.busy : null;
  const [dismissed, setDismissed] = useState<number | null>(null);
  const [faded, setFaded] = useState<number | null>(null);
  useEffect(() => {
    if (!outcome || outcome.refusal) return;
    const timer = setTimeout(() => setFaded(outcome.at), DONE_FADE_MS);
    return () => clearTimeout(timer);
  }, [outcome]);
  const flag = useContext(ActionFlag)[name];
  const presented = useSituationPresentation(handle.manifest.key);
  // A route's standing question for this verb (schedules' stale resolve) holds its popover open.
  const shown =
    busy !== null ||
    flag !== undefined ||
    (outcome !== null &&
      dismissed !== outcome.at &&
      // A refusal that names cells draws on those cells; the verb only tints.
      (outcome.refusal !== null ? !outcome.refusal.cells?.length : faded !== outcome.at));
  const refusedNow = Boolean(outcome?.refusal) && dismissed !== outcome?.at;
  const stopped = action.refusal !== null || (handle.busy !== null && busy === null);
  // The read verb wears Revit's change mark on what it reads (MAP ruling 5); never a second button.
  const rereads = (handle.manifest.actions as Record<string, { rereads?: string } | undefined>)?.[
    name
  ]?.rereads;
  const stale =
    rereads === undefined
      ? false
      : rereads in handle.readings
        ? changedInRevit(handle.readings[rereads])
        : rereads === "work" && handle.work.changed;
  const reason = `${action.refusal ?? `${stale ? "Revit changed this document since the last read. " : ""}${action.says}`}${chord ? ` · ${chord}` : ""}`;
  const refusal = stopped ? (action.refusal ?? "Another action is running") : null;
  const tone = refusedNow || stale ? "caution" : standing;
  return (
    <span className="relative inline-flex">
      <Popover
        open={shown && presented}
        onOpenChange={(o) => !o && presented && outcome && setDismissed(outcome.at)}
      >
        <PopoverTrigger
          render={
            Icon ? (
              // One glyph (kaitpw, 2026-10-12): the label is its name and its tooltip.
              <Button
                kind={commit ? "commit" : "framed"}
                icon={Icon}
                label={`${action.label}: ${action.says}${chord ? ` · ${chord}` : ""}`}
                refusal={refusal}
                data-tone={tone}
                onClick={() => void action.run()}
              />
            ) : (
              <Button
                kind={commit ? "commit" : "framed"}
                label={action.label}
                reason={reason}
                refusal={refusal === null ? null : reason}
                data-tone={tone}
                onClick={() => void action.run()}
              >
                <span className="t-sentence">{action.label}</span>
                {action.count !== null ? (
                  <span className="face-mono text-ink-2">{action.count}</span>
                ) : null}
              </Button>
            )
          }
        />
        <PopoverContent
          // N1: an automatic status/refusal flag reports the action without taking focus.
          initialFocus={false}
          data-tone={outcome?.refusal ? "caution" : undefined}
          className="w-auto max-w-[60ch] px-3 py-1.5 t-prose"
        >
          {busy ? (
            <span className="flex items-baseline gap-3">
              <span>
                running <span className="face-mono">{busy.seconds} s</span>
              </span>
              <Button
                label="stop"
                reason="Signal the running operation. It stops at its next checkpoint; what it already wrote stands."
                onClick={handle.stop}
              >
                stop
              </Button>
            </span>
          ) : outcome?.refusal ? (
            <span>
              {outcome.refusal.message}
              {outcome.refusal.detail ? (
                <details className="t-small text-ink-2">
                  <summary>detail</summary>
                  <span>{outcome.refusal.detail}</span>
                </details>
              ) : null}
              {flag}
            </span>
          ) : flag !== undefined ? (
            flag
          ) : outcome?.stopped ? (
            <span className="text-ink-2">{action.label} · stopped waiting; see the log</span>
          ) : (
            <span className="text-ink-2">{action.label} · ran</span>
          )}
          {!busy ? <span className="ml-3 face-mono text-ink-mute">Esc</span> : null}
        </PopoverContent>
      </Popover>
    </span>
  );
}
