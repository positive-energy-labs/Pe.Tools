import type { VerbDecl } from "@pe/agent-contracts";
import { useList } from "@pe/kit/lang/collection";
import { PlainList } from "@pe/kit/lang/list-view";
import { Button } from "@pe/kit/lang/button";
import { OutcomeLine } from "@pe/kit/lang/outcome";
import { ReviewSurface } from "./review-surface";
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
  const list = useList({
    items: [...borrows.map((e) => ({ key: `borrow:${e.id}`, label: `borrows ${e.name} [${e.id}]` })),
      ...w.creates.map((name) => ({ key: `create:${name}`, label: `creates ${name}` }))],
    keyOf: (row) => row.key,
    search: (row) => ({ text: [row.label] }),
    select: "none",
  });
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
      <PlainList list={list} aria-label="Borrowed and created elements"
        row={(row) => ({ label: row.label })}
        empty={{ message: "No new borrowing", exit: "All changed elements are already owned" }} />
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
