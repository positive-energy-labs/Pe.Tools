import { Button } from "@pe/kit/lang/button";
import type { InboxRowSpec } from "@pe/kit/lang/inbox";
import type { ActionHandle } from "#/route/handle";
import type { WriteRow } from "../../inbox-rows";
import type { ReviewLine } from "../../write-review";

/** The Write group's verbs: the route's own preview and apply, as the handle refuses or arms them. */
export interface WriteVerbs {
  preview: ActionHandle;
  apply: ActionHandle;
  busy: boolean;
  row: WriteRow;
  /** Every change a fresh preview plans, one line each; empty with no fresh preview. */
  review: readonly ReviewLine[];
}

export function inboxWriteRows(write: WriteVerbs) {
  const writeSpec: InboxRowSpec = {
    key: "write",
    "data-kind": "write",
    title: write.row.title,
    status: (
      <span className="inline-flex items-center gap-1" data-inbox-write="">
        <span>{write.row.status}</span>
        {/* The handle's own words, so the button reads as the Situation's does. */}
        <Button
          kind="framed"
          label={write.preview.label}
          reason="Ask Revit what the staged cells would write"
          refusal={write.preview.refusal}
          busy={write.busy}
          onClick={() => void write.preview.run()}
        >
          {write.preview.label}
        </Button>
        <Button
          kind="commit"
          label={write.apply.label}
          reason="Write the staged cells to Revit"
          refusal={write.apply.refusal}
          busy={write.busy}
          onClick={() => void write.apply.run()}
        >
          {write.apply.label}
        </Button>
      </span>
    ),
    detail:
      write.apply.refusal || write.row.held ? (
        <>
          {write.apply.refusal ? <p data-inbox-write-says="">{write.apply.refusal}</p> : null}
          {write.row.held ? <p data-inbox-write-held="">{write.row.held}</p> : null}
        </>
      ) : undefined,
  };

  // Every change the fresh preview plans, one row each: element · what, old -> new; a refusal says why.
  const reviewSpecs: InboxRowSpec[] = write.review.map((line) => ({
    key: line.key,
    "data-kind": "write-review",
    title: `${line.element} · ${line.what}`,
    titleText: `${line.element} · ${line.what}`,
    status: (
      <span
        data-tone={line.outcome === "refused" ? "alarm" : undefined}
        data-outcome={line.outcome}
      >
        {line.outcome === "refused"
          ? `refused: ${line.reason ?? "no reason given"}`
          : `${line.from} → ${line.to}`}
      </span>
    ),
    detail: (
      <p>
        {line.outcome === "refused"
          ? `refused: ${line.reason ?? "no reason given"}`
          : `${line.from} → ${line.to}`}
      </p>
    ),
  }));

  return { writeSpec, reviewSpecs };
}
