/**
 * The jacks: the documents table, recents of every installed year merged with what each Revit
 * holds now. Its filters band is the one place the source (recent, this PC, cloud, a pasted
 * path), the search and the saved year live (host MAP Q16): the switchers write the same query
 * the box shows as chips, so a click and a typed `where=cloud` are one state. A row click picks
 * the jack; it never launches.
 */
import { useMemo, type ReactNode } from "react";

import { EmptyState } from "@pe/kit/lang/empty";
import { OutcomeLine } from "@pe/kit/lang/outcome";
import { PidChip } from "#/components/lang/process";
import { StateCell } from "@pe/kit/lang/cell";
import { Switcher } from "@pe/kit/lang/switcher";
import type { Column, QueryCommand, TableState } from "@pe/kit/table/model";
import { Table } from "@pe/kit/table/table";
import { TableFrame } from "#/components/master-table/table-frame";
import { queryWords, quoted, readClause } from "@pe/kit/table/view";
import { pidOf } from "#/machine/session";
import { accessOf, type DocRow } from "#/open/model";
import { TooltipHint } from "@pe/kit/lang/tooltip";

const folderOf = (path: string) => path.replace(/[\\/][^\\/]+$/, "");

export type Source = "all" | "recent" | "pc" | "cloud";
const SOURCE_SAYS: Record<Exclude<Source, "all">, string> = {
  recent: "documents a Revit on this PC opened recently",
  pc: "local and network paths; a pasted path joins them",
  cloud: "cloud models from the recents; browsing a hub is owed",
};

/** The query with one field's clauses replaced by `clause` (none when null). */
function withClause(query: string, label: string, clause: string | null): string {
  const kept = queryWords(query).filter((word) => {
    const read = readClause(word);
    return !(read.kind === "field" && read.label.toLowerCase() === label.toLowerCase());
  });
  return [...kept, ...(clause ? [clause] : [])].join(" ");
}

/** The one `label=value` clause a query holds, when it holds exactly one. */
function clauseValue(query: string, label: string): string | null {
  const found = queryWords(query)
    .map(readClause)
    .filter(
      (read) =>
        read.kind === "field" && read.label.toLowerCase() === label.toLowerCase() && !read.not,
    );
  return found.length === 1 && found[0]!.kind === "field" && found[0].op === "="
    ? found[0].value
    : null;
}

const sourceOf = (query: string): Source => {
  const value = clauseValue(query, "where");
  return value === "recent" || value === "pc" || value === "cloud" ? value : "all";
};

/** The documents table's columns; the bay reads the same ones for its visible rows. */
export function documentColumns(layout: "row" | "stack"): Column<DocRow>[] {
  return [
    {
      key: "document",
      label: "document",
      search: (row) => `${row.title} ${row.path}`.toLowerCase(),
      sort: (row) => row.title.toLowerCase(),
      cell: (row) => <StateCell scale="row" value={row.title} />,
    },
    {
      key: "where",
      label: "where",
      title: "recent, this PC or cloud; `where=cloud` keeps the cloud models",
      width: layout === "stack" ? "w-16" : undefined,
      facet: (row) => (row.cloud ? "cloud" : "pc"),
      match: (row, value) =>
        value === "recent" ? row.lastYear !== null : value === "cloud" ? row.cloud : !row.cloud,
      options: [
        { value: "recent", label: "recent" },
        { value: "pc", label: "this PC" },
        { value: "cloud", label: "cloud" },
      ],
      cell: (row) => (
        <TooltipHint content={row.path}>
          <span className="block max-w-64 truncate face-mono text-ink-2">
            {row.cloud ? "cloud" : layout === "stack" ? "pc" : folderOf(row.path)}
          </span>
        </TooltipHint>
      ),
    },
    {
      key: "saved",
      label: "saved",
      header: "saved in",
      title: "the Revit year the file was last saved in; `saved>2023` keeps the newer ones",
      width: "w-16",
      sort: (row) => row.savedYear ?? 0,
      condition: { kind: "number", read: (row) => row.savedYear },
      cell: (row) =>
        row.savedYear ? (
          <span className="face-mono">{row.savedYear}</span>
        ) : row.savedYearFailure ? (
          <TooltipHint content={row.savedYearFailure}>
            <span className="face-mono" data-tone="caution">
              unknown
            </span>
          </TooltipHint>
        ) : (
          <span className="text-ink-mute">—</span>
        ),
    },
    ...(layout === "row"
      ? [
          {
            key: "last",
            label: "opened",
            header: "last opened in",
            title: "the Revit year whose recents list it; `opened=2025` keeps that year's",
            width: "w-24",
            sort: (row: DocRow) => row.lastYear ?? 0,
            condition: { kind: "number" as const, read: (row: DocRow) => row.lastYear },
            cell: (row: DocRow) => (
              <span className="face-mono text-ink-2">{row.lastYear ?? "—"}</span>
            ),
          },
          {
            key: "open",
            label: "open now in",
            width: "w-32",
            facet: (row: DocRow) => (row.openIn ? "open" : "closed"),
            cell: (row: DocRow) =>
              row.openIn ? (
                <span className="flex items-center gap-1.5">
                  {pidOf(row.openIn.session.row) ? (
                    <PidChip pid={pidOf(row.openIn.session.row)!} />
                  ) : null}
                  <span
                    className="face-mono text-ink-2"
                    data-tone={row.openIn.session.whose === "pea" ? "pea" : undefined}
                  >
                    {row.openIn.session.whose === "pea" ? "Pea's " : ""}
                    {row.openIn.session.row.year}
                  </span>
                  {row.openIn.document.isModified ? (
                    <span className="font-semibold">unsaved</span>
                  ) : null}
                  {accessOf(row.openIn.session, row.openIn.document)?.kind === "target" ? (
                    <TooltipHint content="you added this document to a thread">
                      <span data-tone="done">in a thread</span>
                    </TooltipHint>
                  ) : null}
                </span>
              ) : (
                <span className="text-ink-mute">—</span>
              ),
          },
        ]
      : []),
  ];
}

export function ModelTable({
  rows,
  columns,
  state,
  onStateChange,
  picked,
  onPick,
  loading,
  command,
  actions,
}: {
  rows: readonly DocRow[];
  columns: readonly Column<DocRow>[];
  state: TableState;
  onStateChange: (state: TableState) => void;
  picked: string | null;
  onPick: (row: DocRow) => void;
  loading: boolean;
  /** The command line after `→`: the bay's sockets and options. */
  command?: QueryCommand;
  actions?: ReactNode;
}) {
  const years = useMemo(
    () =>
      [...new Set(rows.map((row) => row.savedYear).filter((year): year is number => !!year))].sort(
        (a, b) => a - b,
      ),
    [rows],
  );
  const source = sourceOf(state.query);
  const saved = clauseValue(state.query, "saved") ?? "";
  const write = (query: string) => onStateChange({ ...state, query });
  const label = "documents";
  return (
    <TableFrame
      label={label}
      rows={rows}
      columns={columns}
      rowKey={(row) => row.key}
      state={state}
      onStateChange={onStateChange}
      search
      command={command}
      actions={actions}
      filters={
        <>
          <Switcher
            ariaLabel="source"
            value={source}
            onChange={(next) =>
              write(withClause(state.query, "where", next === "all" ? null : `where=${next}`))
            }
            options={[
              {
                value: "all",
                label: "all",
                title: "every document the recents and the Revits know",
              },
              { value: "recent", label: "recent", title: SOURCE_SAYS.recent },
              { value: "pc", label: "this PC", title: SOURCE_SAYS.pc },
              { value: "cloud", label: "cloud", title: SOURCE_SAYS.cloud },
            ]}
          />
          {years.length ? (
            <Switcher
              ariaLabel="saved year"
              value={saved}
              onChange={(next) =>
                write(
                  withClause(
                    state.query,
                    "saved",
                    next === "" ? null : `${quoted("saved")}=${next}`,
                  ),
                )
              }
              options={[
                { value: "", label: "any year", title: "saved in any Revit year" },
                ...years.map((year) => ({
                  value: String(year),
                  label: <span className="face-mono">{year}</span>,
                  title: `saved in Revit ${year}; type saved>${year} for newer ones`,
                })),
              ]}
            />
          ) : null}
        </>
      }
    >
      <Table
        rows={rows}
        columns={columns}
        rowKey={(row) => row.key}
        label={label}
        state={state}
        onStateChange={onStateChange}
        activeKey={picked ?? undefined}
        onRowClick={onPick}
        // A held document's row is a cable's end (bay.tsx): drawn even scrolled away, so the cable
        // clamps to the grid's edge instead of falling back to the jacks.
        keep={(row) => row.openIn != null}
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
