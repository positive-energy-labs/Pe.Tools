import { token } from "#/lib/token";
import { useEffect, useMemo, useState } from "react";
import { MasterTable } from "#/components/master-table/master-table";
import { fmtNum, type Column, type TableState } from "#/components/master-table/model";
import { FactChip as Chip } from "#/components/lang/chip";
import { cn } from "#/lib/utils";
import { type RunIndexEntry } from "../world";
import { Press } from "#/components/lang/press";
import type { RunRow } from "./plan-dock";
import { Delta, PartialityChip, fmtTime, partialTitle, possiblyPartialTitle } from "./unknown";
import { buildLedgerRows, runName, scoreCell } from "./no-scores";
import { PressContent } from "#/components/anatomy/press-content";
import { useRunsSource } from "../source";

export function LedgerDock(props: {
  runs: RunIndexEntry[];
  pool: string | null;
  curId: string | null;
  prevId: string | null;
  open: boolean;
  onToggle: () => void;
  onPickCur: (id: string) => void;
  onPickBaseline: (id: string) => void;
}) {
  const source = useRunsSource();
  const { runs, pool, curId, prevId, open, onToggle, onPickCur, onPickBaseline } = props;
  const [rows, setRows] = useState<RunRow[] | null>(null);
  const [tableState, setTableState] = useState<TableState>({
    filters: {},
    sorts: [{ key: "run", dir: "desc" }],
    query: "",
  });

  useEffect(() => {
    if (!open || rows !== null || runs.length === 0) return;
    buildLedgerRows(runs, source).then(setRows, (err: unknown) =>
      console.error("combo ledger:", err),
    );
  }, [open, rows, runs, source]);

  const columns = useMemo<Column<RunRow>[]>(
    () => [
      {
        key: "run",
        label: "run",
        lock: true,
        width: "w-52",
        title:
          "The run's label (or options-hash name) and when the harness persisted it. Sorted descending = newest first. Click the row to make it the CURRENT run (B).",
        sort: (row) => row.id,
        search: (row) => `${row.label ?? ""} ${row.hash} ${row.id}`,
        cell: (row) => (
          <span className="flex min-w-0 items-baseline gap-1.5 px-1.5">
            <span className={cn("truncate", row.label ? "" : "")}>{runName(row)}</span>
            <span className="shrink-0">{fmtTime(row.when)}</span>
            <PartialityChip part={row.partiality} compact />
          </span>
        ),
      },
      {
        key: "options",
        label: "options",
        width: "w-20",
        title:
          "Solver options generation — runs sharing a hash ran identical options; a hash change means the knobs moved.",
        facet: (row) => row.hash,
        cell: (row) => (
          <span className="flex px-1">
            <Chip tone="meta" title={`optionsHash ${row.hash} — same hash = same solver options.`}>
              {row.hash.slice(0, 6)}
            </Chip>
          </span>
        ),
      },
      {
        key: "mark",
        label: "a/b",
        width: "w-14",
        title:
          "The sheet's A/B selection. B (current) follows the clicked row; this cell sets/clears A (baseline).",
        cell: (row) => {
          if (row.id === curId) {
            return <span className="block px-1.5">B</span>;
          }
          const isA = row.id === prevId;
          const caveat =
            row.partiality.kind === "partial"
              ? ` WARNING: ${partialTitle(row.partiality.zone)}`
              : row.partiality.kind === "possibly-partial"
                ? ` WARNING: ${possiblyPartialTitle(row.partiality.zones, row.partiality.modal)}`
                : "";
          return (
            <Press
              type="button"
              tone="quiet"
              state={isA ? "selected" : "rest"}
              onClick={() => onPickBaseline(row.id)}
              title={
                (isA
                  ? "This is the baseline (A) — click to clear it."
                  : "Set this run as the baseline (A).") + caveat
              }
              style={{ height: "1.75rem" }}
            >
              <PressContent geometry="block">{isA ? "A" : "set A"}</PressContent>
            </Press>
          );
        },
      },
      {
        key: "solved",
        label: "solved",
        group: "board",
        right: true,
        width: "w-16",
        title: "Zones the triage verdict marked solve, over all zones the run partitioned.",
        sort: (row) => row.board.solved,
        cell: (row) => (
          <span className="block px-1.5 text-right">
            {row.board.solved}/{row.board.zones}
          </span>
        ),
      },
      {
        key: "rooms",
        label: "rooms",
        group: "board",
        right: true,
        width: "w-14",
        title: "Accepted rooms across every solved zone.",
        sort: (row) => row.board.acceptedRooms ?? Number.NEGATIVE_INFINITY,
        cell: (row) => (
          <span className="block px-1.5 text-right">{row.board.acceptedRooms ?? "?"}</span>
        ),
      },
      {
        key: "sqft",
        label: "accepted sf",
        group: "board",
        right: true,
        width: "w-20",
        title: "Accepted square footage across every solved zone.",
        sort: (row) => row.board.acceptedSqft ?? Number.NEGATIVE_INFINITY,
        cell: (row) => (
          <span className="block px-1.5 text-right">
            {row.board.acceptedSqft === null ? "unavailable" : fmtNum(row.board.acceptedSqft, 0)}
          </span>
        ),
      },
      {
        key: "held",
        label: "held sf",
        group: "board",
        right: true,
        width: "w-16",
        title: "Square footage in held rooms — area the solver found but did not trust.",
        sort: (row) => row.board.heldSqft ?? Number.NEGATIVE_INFINITY,
        cell: (row) => (
          <span className="block px-1.5 text-right">
            {row.board.heldSqft === null ? "unavailable" : fmtNum(row.board.heldSqft, 0)}
          </span>
        ),
      },
      // scores.json columns (SHIMS.md #1 close): the python scorer's board, read from the run
      {
        key: "saved",
        label: "saved",
        group: "scores.json",
        right: true,
        width: "w-16",
        title:
          "Board savedWork under currency v1.1 (cleaned oracle), from the package's scores.json. The python scorer (score-looks-good.py) is the only author of this number.",
        sort: (row) => row.scores?.savedV11 ?? Number.NEGATIVE_INFINITY,
        cell: (row) => scoreCell(row, row.scores?.savedV11 ?? null),
      },
      {
        key: "saved-v1",
        label: "saved v1",
        group: "scores.json",
        right: true,
        width: "w-16",
        title:
          "Board savedWork under currency v1 (raw oracle) — carried alongside v1.1 during the currency transition.",
        sort: (row) => row.scores?.savedV1 ?? Number.NEGATIVE_INFINITY,
        cell: (row) => scoreCell(row, row.scores?.savedV1 ?? null),
      },
      {
        key: "recall",
        label: "recall",
        group: "scores.json",
        right: true,
        width: "w-16",
        title:
          "Board roomRecall from scores.json (v1.1 board when present, else the v1 board the file carries).",
        sort: (row) => row.scores?.recall ?? Number.NEGATIVE_INFINITY,
        cell: (row) => scoreCell(row, row.scores?.recall ?? null),
      },
      {
        key: "edge-acc",
        label: "edgeOnInk",
        group: "scores.json",
        right: true,
        width: "w-20",
        title:
          "Board edgeOnInkAccepted from scores.json — how much of the accepted boundary stands on evidence.",
        sort: (row) => row.scores?.edgeAcc ?? Number.NEGATIVE_INFINITY,
        cell: (row) => scoreCell(row, row.scores?.edgeAcc ?? null),
      },
      {
        key: "d-saved",
        label: "Δ saved",
        group: "scores.json",
        right: true,
        width: "w-16",
        title:
          "savedWork vs the chronological predecessor, currency-matched (v1.1 against v1.1, else v1 against v1). Empty when either run lacks a comparable scores.json board.",
        sort: (row) => row.scoreDelta ?? Number.NEGATIVE_INFINITY,
        cell: (row) => (
          <span className="block px-1.5 text-right">
            <Delta value={row.scoreDelta} digits={3} />
          </span>
        ),
      },
      {
        key: "d-solved",
        label: "Δ solved",
        group: "Δ vs prev run",
        right: true,
        width: "w-16",
        title:
          "Solved zones vs this run's chronological predecessor — NOT the row below after sorting.",
        sort: (row) => row.delta?.solved ?? Number.NEGATIVE_INFINITY,
        cell: (row) => (
          <span className="block px-1.5 text-right">
            <Delta value={row.delta?.solved ?? null} />
          </span>
        ),
      },
      {
        key: "d-rooms",
        label: "Δ rooms",
        group: "Δ vs prev run",
        right: true,
        width: "w-16",
        title: "Accepted rooms vs the chronological predecessor.",
        sort: (row) => row.delta?.rooms ?? Number.NEGATIVE_INFINITY,
        cell: (row) => (
          <span className="block px-1.5 text-right">
            <Delta value={row.delta?.rooms ?? null} />
          </span>
        ),
      },
      {
        key: "d-sqft",
        label: "Δ sf",
        group: "Δ vs prev run",
        right: true,
        width: "w-16",
        title: "Accepted square footage vs the chronological predecessor.",
        sort: (row) => row.delta?.sqft ?? Number.NEGATIVE_INFINITY,
        cell: (row) => (
          <span className="block px-1.5 text-right">
            <Delta value={row.delta?.sqft ?? null} />
          </span>
        ),
      },
      {
        key: "d-held",
        label: "Δ held",
        group: "Δ vs prev run",
        right: true,
        width: "w-16",
        title: "Held square footage vs the chronological predecessor — down is the improvement.",
        sort: (row) => row.delta?.held ?? Number.NEGATIVE_INFINITY,
        cell: (row) => (
          <span className="block px-1.5 text-right">
            <Delta value={row.delta?.held ?? null} goodWhenUp={false} />
          </span>
        ),
      },
      {
        key: "rejects",
        label: "top rejections",
        title: "The run's three loudest rejection reasons with counts — the histogram's head.",
        facet: (row) => row.board.rejectionTop[0]?.[0] ?? "",
        all: "any loudest",
        cell: (row) => (
          <span className="flex items-center gap-1 px-1">
            {row.board.rejectionTop.map(([reason, count]) => (
              <Chip
                key={reason}
                tone="meta"
                title={`${count} rejections of kind ${reason} in this run.`}
              >
                {reason} {count}
              </Chip>
            ))}
          </span>
        ),
      },
    ],
    [curId, prevId, onPickBaseline],
  );

  const optionSets = new Set(runs.map((r) => r.meta?.optionsHash ?? "?")).size;

  return (
    <div className="shrink-0" style={{ borderColor: token("line-2") }}>
      <Press
        type="button"
        tone="quiet"
        onClick={onToggle}
        title={
          open
            ? "Collapse the run ledger."
            : "Expand the run ledger — rows are runs, marks drive the sheet's A/B."
        }
      >
        <PressContent geometry="baseline">
          <span className="">ledger</span>
          <span className="">
            {runs.length} runs · {optionSets} option sets · click a row = current (B), mark =
            baseline (A)
          </span>
          <span className="ml-auto">{open ? "▾ collapse" : "▴ expand"}</span>
        </PressContent>
      </Press>
      {open && (
        <div className="flex flex-col" style={{ height: 320 }}>
          {pool && (
            <div
              className="shrink-0 truncate px-3 py-1"
              style={{ borderColor: token("line-2") }}
              title="The run pool this page is reading — PE_TAKEOFF_RUNS_DIR if set, else <repo>/.artifacts/takeoff-runs."
            >
              pool {pool}
            </div>
          )}
          {rows === null ? (
            <div className="p-4">loading the run ledger…</div>
          ) : (
            <MasterTable
              rows={rows}
              columns={columns}
              rowKey={(row) => row.id}
              scopeLabel="runs in pool"
              searchPlaceholder="label / hash…"
              summary={`${rows.length} runs`}
              empty="No runs in the pool yet — run the zone-bounded detect harness once and it will auto-persist here."
              activeKey={curId}
              onRowClick={(row) => onPickCur(row.id)}
              tableState={tableState}
              onTableStateChange={setTableState}
            />
          )}
        </div>
      )}
    </div>
  );
}
