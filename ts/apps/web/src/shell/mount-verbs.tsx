import { useState } from "react";
import type { VerbDecl } from "@pe/agent-contracts";
import { Button } from "@pe/kit/lang/button";
import { OutcomeLine } from "@pe/kit/lang/outcome";
import { Popover, SubjectPopoverContent } from "@pe/kit/lang/popover";
import type { GraphMount } from "./mount-owner";
import { completeVerb, type Worksharing } from "./verbs";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
/** The commit's borrow count; null when the document is not workshared or nothing new is borrowed. */
export const borrowWords = (w: Worksharing | null | undefined) => {
  const n = w?.elements.filter((e) => e.status === "borrows").length ?? 0;
  return w && (n || w.creates.length) ? `borrows ${plural(n + w.creates.length, "element")}` : null;
};

/** What committing does to the central: every element it borrows, held until the person syncs or relinquishes. */
export function WorksharingNote({ worksharing: w }: { worksharing: Worksharing }) {
  const borrows = w.elements.filter((e) => e.status === "borrows");
  const blocked = w.elements.filter((e) => e.status === "blocked");
  const central = w.cloud ? "cloud central" : "central";
  return (
    <section aria-label="Worksharing" className="flex flex-col">
      <OutcomeLine
        kind="advisory"
        label={
          borrowWords(w)
            ? `workshared: commit ${borrowWords(w)} from the ${central}`
            : `workshared: you already own every element this commit changes`
        }
        says="they stay borrowed until you sync with central or relinquish"
      />
      <span role="list" className="flex flex-col">
        {borrows.map((e) => (
          <span role="listitem" key={e.id}>
            borrows {e.name} [{e.id}]
          </span>
        ))}
        {w.creates.map((name) => (
          <span role="listitem" key={name}>
            creates {name}
          </span>
        ))}
      </span>
      {blocked.map((e) => (
        <OutcomeLine
          key={e.id}
          kind="refused"
          label={`${e.name} [${e.id}] is borrowed by ${e.owner ?? "another user"}`}
          says="Revit refuses this write until they sync or relinquish"
        />
      ))}
    </section>
  );
}

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
  const [anchor] = useState(() => document.activeElement);
  const press = () => void owner.commitReview(id, review.ticket);
  const borrows = borrowWords(review.ticket.presentation.worksharing);
  const commit = `Commit ${verb.label}${borrows ? ` · ${borrows}` : ""}`;
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
          {review.ticket.presentation.worksharing && (
            <WorksharingNote worksharing={review.ticket.presentation.worksharing} />
          )}
        </div>
        <div className="flex shrink-0 items-center justify-between gap-2">
          <Button
            kind="commit"
            label={commit}
            refusal={!enabled ? "This route is inactive" : null}
            onClick={press}
          >
            {commit}
          </Button>
          <Button label={`Cancel ${verb.label}`} onClick={() => owner.stop()}>
            Cancel
          </Button>
        </div>
      </SubjectPopoverContent>
    </Popover>
  );
}
