import { useState } from "react";
import type { VerbDecl } from "@pe/agent-contracts";
import { Button } from "@pe/kit/lang/button";
import { Popover, SubjectPopoverContent } from "@pe/kit/lang/popover";
import type { GraphMount } from "./mount-owner";
import { completeVerb } from "./verbs";

/** Key actions for verb ids: one control per verb, armed only while the route is live. */
export function verbActions<P, W>(
  owner: GraphMount<P, W>,
  ids: readonly string[],
  live: () => boolean,
  row?: unknown,
  placement?: string,
) {
  return Object.fromEntries(
    ids.map((id) => {
      const control = placement ? owner.control(id, row, placement) : owner.control(id);
      return [
        id,
        {
          available: live,
          refusal: control.refusal,
          invoke: () => {
            if (live()) void control.run();
          },
        },
      ];
    }),
  );
}

export function GraphVerb<P, W>({
  id,
  verb,
  owner,
  row,
  enabled,
  pane,
}: {
  id: string;
  verb: VerbDecl;
  owner: GraphMount<P, W>;
  row?: unknown;
  enabled: boolean;
  pane?: string;
}) {
  const control = owner.control(id, row, pane ? `pane:${pane}` : "stage");
  const review = control.review;
  const delivered = owner.results.get(id);
  const result = delivered ? completeVerb(delivered, delivered.outcome?.input) : undefined;
  return (
    <span
      role="group"
      aria-label={verb.label}
      onFocusCapture={() => {
        if (pane && row !== undefined) owner.focusRow(pane, row);
      }}
    >
      <Button
        data-graph-verb={id}
        kind={review ? "commit" : "framed"}
        label={verb.label}
        pressed={!!review}
        refusal={!enabled ? "This route is inactive" : control.refusal}
        onClick={() => void control.run()}
      >
        {review ? `Commit ${verb.label}` : verb.label}
      </Button>
      {result && (
        <span role="status">
          {result.outcome.state}
          {result.outcome.reason ? ` | ${result.outcome.reason}` : ""}
        </span>
      )}
    </span>
  );
}

/** One ticket gets one portal, even when several row controls represent its original placement. */
export function GraphReview<P, W>({
  id,
  owner,
  enabled,
}: {
  id: string;
  owner: GraphMount<P, W>;
  enabled: boolean;
}) {
  const review = owner.reviews.get(id)!;
  const verb = owner.verbs[id]!;
  const [anchor] = useState(() => document.activeElement);
  const press = () => void owner.commitReview(id, review.ticket);
  return (
    <Popover
      open
      replaceOnSiblingOpen={false}
      onOpenChange={(open, details) => {
        if (open) return;
        if (details.reason === "escape-key") owner.stop();
        else details.cancel();
      }}
    >
      <SubjectPopoverContent
        anchor={anchor}
        aria-label={`${verb.label} review`}
        className="flex max-h-(--available-height) flex-col gap-2"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="min-h-0 overflow-y-auto">
          <output>{review.ticket.presentation.sentence}</output>
          {review.ticket.presentation.rows.length > 0 && (
            <span role="list" className="flex flex-col">
              {review.ticket.presentation.rows.map((row, index) => (
                <span role="listitem" key={index}>
                  {row}
                </span>
              ))}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center justify-between gap-2">
          <Button
            kind="commit"
            label={`Commit ${verb.label}`}
            refusal={!enabled ? "This route is inactive" : null}
            onClick={press}
          >
            Commit {verb.label}
          </Button>
          <Button label={`Cancel ${verb.label}`} onClick={() => owner.stop()}>
            Cancel
          </Button>
        </div>
      </SubjectPopoverContent>
    </Popover>
  );
}
