import type { TypedMount } from "./typed-mount";
/**
 * ADR 0027 rule 3: the Situation is one line. The route's name and context lead, one primary verb
 * stands framed, the rest wait in an overflow, and the Timeline head closes the line. Layout only:
 * typed-shell.tsx renders each verb and each context control; this file owns where they sit.
 */
import { useSyncExternalStore, type ReactNode } from "react";
import { MoreHorizontal, Redo2, Undo2 } from "lucide-react";
import { Button, ButtonOutcome } from "@pe/kit/lang/button";
import { Popover, PopoverTrigger, SubjectPopoverContent } from "@pe/kit/lang/popover";
import { activityTime } from "./timeline";
import "./situation-band.css";

export function SituationBand({
  label = "Situation",
  name,
  context,
  verbs,
  alerts,
  timeline,
}: {
  label?: string;
  name: string;
  /** Document target, stage switch, subject words and situation fields, in that order. */
  context: ReactNode;
  /** Declared order is the ranking: the first is the primary verb, the rest overflow. */
  verbs: readonly ReactNode[];
  /** Conflict, unaccepted edit, Stop and refusals: they interrupt, so they never overflow. */
  alerts: ReactNode;
  timeline?: ReactNode;
}) {
  const [primary, ...rest] = verbs;
  return (
    <section aria-label={label} data-slot="situation-band" data-surface="page">
      <b data-slot="situation-name">{name}</b>
      <span data-slot="situation-context">{context}</span>
      <span data-slot="situation-alerts">{alerts}</span>
      <span data-slot="situation-verbs">
        {primary}
        {rest.length > 0 && (
          <Popover>
            <PopoverTrigger
              aria-label={`${rest.length} more ${name} verbs`}
              data-slot="situation-more"
            >
              <MoreHorizontal aria-hidden className="size-4" />
              {rest.length}
            </PopoverTrigger>
            <SubjectPopoverContent aria-label={`More ${name} verbs`}>
              <span data-slot="situation-overflow">{rest}</span>
            </SubjectPopoverContent>
          </Popover>
        )}
      </span>
      {timeline}
    </section>
  );
}

export type TimelineOwner = Pick<TypedMount, "subscribe" | "revision" | "timeline" | "stepTimeline" | "timelineRefusal" | "pendingEdits" | "discardIntent" | "stopCommand" | "reviewProblem">;

export function TimelineButtons({ owner }: { owner: TimelineOwner }) {
  useSyncExternalStore(owner.subscribe, owner.revision, owner.revision);
  const timeline = owner.timeline();
  return <>{(["undo", "redo"] as const).map(direction => {
    const message = owner.reviewProblem(`work.${direction}`);
    return <ButtonOutcome.Provider key={direction} value={message ? { kind: "refused", label: message } : null}>
    <Button kind="quiet"
    icon={direction === "undo" ? Undo2 : Redo2}
    label={timeline?.[direction] ? `${direction === "undo" ? "Undo" : "Redo"} ${timeline[direction]!.label}` : direction === "undo" ? "Undo" : "Redo"}
    refusal={owner.timelineRefusal() ?? timeline?.refusal[direction] ?? (timeline?.[direction] ? null : `Nothing to ${direction}`)}
    onPress={async () => { await owner.stepTimeline(direction); }} /></ButtonOutcome.Provider>;
  })}</>;
}

export function TimelineHead({ owner, history }: { owner: TimelineOwner; history: ReactNode }) {
  useSyncExternalStore(owner.subscribe, owner.revision, owner.revision);
  const last = owner.timeline()?.rows.at(-1);
  return <span data-slot="timeline-head" role="group" aria-label="Timeline">
    <Popover>
      <PopoverTrigger aria-label="Open the Timeline" data-slot="timeline-trigger">
        <span>{last ? last.kind === "home-write" ? last.place : last.kind === "point" ? last.reason : last.label : owner.timelineRefusal() ?? "No activity yet"}</span>
        {last && <span data-slot="timeline-state">{activityTime(last.at)}</span>}
      </PopoverTrigger>
      <SubjectPopoverContent aria-label="Timeline" className="max-h-(--available-height) overflow-y-auto p-(--gutter)">{history}</SubjectPopoverContent>
    </Popover>
    <TimelineButtons owner={owner} />
  </span>;
}
