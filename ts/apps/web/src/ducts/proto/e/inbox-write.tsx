import { Button } from "@pe/kit/lang/button";
import type { ReactNode } from "react";
import type { ListRowParts } from "@pe/kit/lang/list-view";
import type { ListSearch } from "@pe/kit/lang/collection";
import type { InboxGroup } from "../../inbox-rows";

export type RulingRow = ListRowParts & {
  key: string;
  title: string;
  group: InboxGroup;
  kind: string;
  statusText: string;
  search: ListSearch;
  detail?: ReactNode;
  lit?: boolean;
  pick?: () => void;
};
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
  const writeSpec: RulingRow = {
    key: "write",
    group: "write",
    kind: "write",
    statusText: write.row.status,
    search: { text: [write.row.title, write.row.status] },
    label: write.row.title,
    title: write.row.title,
    meta: (
      <span
        className="inline-flex max-w-full min-w-0 flex-wrap items-center gap-1"
        data-inbox-write=""
      >
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
  const reviewSpecs: RulingRow[] = write.review.map((line) => ({
    key: line.key,
    group: "write",
    kind: "write-review",
    statusText: line.outcome,
    search: { text: [line.element, line.what, line.from, line.to, line.reason] },
    label: `${line.element} · ${line.what}`,
    title: `${line.element} · ${line.what}`,
    stage: "staged",
    stagedBy: "you",
    meta: (
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
