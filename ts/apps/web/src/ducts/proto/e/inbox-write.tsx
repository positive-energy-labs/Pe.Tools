import type { ReactNode } from "react";
import type { ListRowParts } from "@pe/kit/lang/list-view";
import type { ListSearchable } from "@pe/kit/lang/collection";
import type { Ref } from "@pe/kit/lang/attention";
import { compactStatus, type InboxGroup } from "../../inbox-rows";

export type RulingRow = Omit<ListRowParts, "actions" | "subject"> & {
  key: string;
  subject?: Ref;
  title: string;
  group: InboxGroup;
  kind: string;
  statusText: string;
  search: ListSearchable;
  actions?: () => ReactNode;
  detail?: () => ReactNode;
  lit?: boolean;
};
import type { WriteRow } from "../../inbox-rows";
import { SubjectText } from "@pe/kit/lang/subject-text";

/** The Write row uses the same kernel placement and ticket as the Situation. */
export interface WriteVerbs {
  control: ReactNode;
  row: WriteRow;
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
      <span className="inline-flex min-w-0 items-center gap-1.5" data-inbox-write="">
        <span>{compactStatus(write.row.status)}</span>
        {write.control}
      </span>
    ),
    detail: write.row.held
      ? () => (
          <p data-inbox-write-held="">
            <SubjectText text={write.row.held!} />
          </p>
        )
      : undefined,
  };
  return { writeSpec };
}
