import { PreviewAction } from "@pe/kit/lang/preview-action";
import type { ReactNode } from "react";
import type { ListRowParts } from "@pe/kit/lang/list-view";
import type { ListSearchable } from "@pe/kit/lang/collection";
import { STALE_WORDS, type InboxGroup, type PreviewState } from "../../inbox-rows";

export type RulingRow = Omit<ListRowParts, "actions"> & {
  key: string;
  title: string;
  group: InboxGroup;
  kind: string;
  statusText: string;
  search: ListSearchable;
  actions?: () => ReactNode;
  detail?: () => ReactNode;
  lit?: boolean;
  pick?: () => void;
};
import type { ActionHandle } from "#/route/handle";
import type { WriteRow } from "../../inbox-rows";
import { PreviewLines } from "./preview-lines";
import { SubjectText } from "../../subject-text-view";

/** The Write group's verbs: the route's own preview and apply, as the handle refuses or arms them. */
export interface WriteVerbs {
  preview: ActionHandle;
  apply: ActionHandle;
  busy: boolean;
  row: WriteRow;
  /** The preview that still describes this Work and snapshot, every change it plans one line; null with none. */
  held: PreviewState | null;
  /** A preview was run and the Work or snapshot has moved since. */
  stale: boolean;
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
        <PreviewAction
          label={write.preview.label}
          says="Ask Revit what the staged cells would write"
          refusal={write.preview.refusal}
          busy={write.busy}
          held={write.held && { ...write.held, lines: <PreviewLines lines={write.held.lines} /> }}
          stale={write.stale ? STALE_WORDS : null}
          preview={() => write.preview.run()}
          commit={{
            label: write.apply.label,
            says: "Write the staged cells to Revit",
            refusal: write.apply.refusal,
            run: () => write.apply.run(),
            done: "written to Revit",
          }}
        />
      </span>
    ),
    detail:
      write.apply.refusal || write.row.held
        ? () => (
            <>
              {write.apply.refusal ? (
                <p data-inbox-write-says="">
                  <SubjectText text={write.apply.refusal} />
                </p>
              ) : null}
              {write.row.held ? (
                <p data-inbox-write-held="">
                  <SubjectText text={write.row.held} />
                </p>
              ) : null}
            </>
          )
        : undefined,
  };

  return { writeSpec };
}
