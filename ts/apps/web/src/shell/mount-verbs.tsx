import { borrowWords } from "./worksharing-note";
import type { VerbDecl } from "@pe/agent-contracts";
import { Button } from "@pe/kit/lang/button";
import { ReviewSurface } from "./review-surface";
import type { GraphMount } from "./mount-owner";
import {completeVerb} from "./verbs";

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
        {review
          ? `Commit ${verb.label}${borrowWords(review.ticket.presentation.worksharing) ? ` · ${borrowWords(review.ticket.presentation.worksharing)}` : ""}`
          : verb.label}
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
  return (
    <ReviewSurface
      label={verb.label}
      sentence={review.ticket.presentation.sentence}
      rows={review.ticket.presentation.rows}
      worksharing={review.ticket.presentation.worksharing}
      enabled={enabled}
      confirm={() => void owner.commitReview(id, review.ticket)}
      cancel={() => owner.stop()}
    />
  );
}
