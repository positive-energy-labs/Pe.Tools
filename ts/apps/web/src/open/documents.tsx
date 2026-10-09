/**
 * The documents table: recents of every installed year merged with what each Revit holds now.
 * Where it lives, the year it was saved in, the year that last opened it, and the Revit holding
 * it now. A row click puts the document in the launcher; it never launches.
 */
import { useMemo } from "react";

import { EmptyState } from "#/components/lang/empty";
import { OutcomeLine } from "#/components/lang/outcome";
import { PidChip } from "#/components/lang/process";
import { StateCell } from "#/components/lang/cell";
import type { Column } from "#/components/master-table/model";
import { Table } from "#/components/master-table/table";
import { TableFrame } from "#/components/master-table/table-frame";
import { useTableState } from "#/components/master-table/view";
import { pidOf } from "#/machine/session";
import type { DocRow } from "#/open/model";

const folderOf = (path: string) => path.replace(/[\\/][^\\/]+$/, "");

export function ModelTable({
  rows,
  picked,
  onPick,
  loading,
}: {
  rows: readonly DocRow[];
  picked: string | null;
  onPick: (row: DocRow) => void;
  loading: boolean;
}) {
  const [state, setState] = useTableState();
  const columns = useMemo<Column<DocRow>[]>(
    () => [
      {
        key: "document",
        label: "document",
        search: (row) => row.title.toLowerCase(),
        sort: (row) => row.title.toLowerCase(),
        cell: (row) => <StateCell scale="row" value={row.title} />,
      },
      {
        key: "where",
        label: "where",
        search: (row) => row.path.toLowerCase(),
        facet: (row) => (row.cloud ? "cloud" : "local"),
        cell: (row) => (
          <span className="block max-w-64 truncate face-mono text-ink-2" title={row.path}>
            {row.cloud ? "cloud" : folderOf(row.path)}
          </span>
        ),
      },
      {
        key: "saved",
        label: "saved in",
        width: "w-20",
        sort: (row) => row.savedYear ?? 0,
        cell: (row) =>
          row.savedYear ? (
            <span className="face-mono">{row.savedYear}</span>
          ) : row.savedYearFailure ? (
            <span className="face-mono" data-tone="caution" title={row.savedYearFailure}>
              unknown
            </span>
          ) : (
            <span className="text-ink-mute">—</span>
          ),
      },
      {
        key: "last",
        label: "last opened in",
        width: "w-28",
        sort: (row) => row.lastYear ?? 0,
        cell: (row) => <span className="face-mono text-ink-2">{row.lastYear ?? "—"}</span>,
      },
      {
        key: "open",
        label: "open now in",
        width: "w-44",
        facet: (row) => (row.openIn ? "open" : "closed"),
        cell: (row) =>
          row.openIn ? (
            <span className="flex items-center gap-1.5">
              {pidOf(row.openIn.session.row) ? (
                <PidChip pid={pidOf(row.openIn.session.row)!} />
              ) : null}
              <span className="face-mono text-ink-2">{row.openIn.session.row.year}</span>
              {row.openIn.document.isModified ? (
                <span className="font-semibold">unsaved</span>
              ) : null}
            </span>
          ) : (
            <span className="text-ink-mute">—</span>
          ),
      },
    ],
    [],
  );
  const label = "documents: recent in every installed year, and what is open now";
  return (
    <TableFrame
      label={label}
      rows={rows}
      columns={columns}
      rowKey={(row) => row.key}
      state={state}
      onStateChange={setState}
      searchPlaceholder="filter by name or path"
    >
      <Table
        rows={rows}
        columns={columns}
        rowKey={(row) => row.key}
        label={label}
        state={state}
        onStateChange={setState}
        activeKey={picked ?? undefined}
        onRowClick={onPick}
        empty={
          loading ? (
            <OutcomeLine kind="busy" label="reading recents and the machine" />
          ) : (
            <EmptyState story="scope" exit="open a model in Revit once and it appears here">
              no recent documents in any installed year
            </EmptyState>
          )
        }
      />
    </TableFrame>
  );
}
