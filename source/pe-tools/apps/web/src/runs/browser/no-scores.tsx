import { type ReactNode } from "react";
import { FactChip as Chip } from "#/components/lang/chip";
import {
  boardSummary,
  comparableRuns,
  difference,
  modalZoneCount,
  partiality,
  type RunIndexEntry,
  type RunScores,
  scoreBoards,
} from "../world";
import type { RunsSource } from "../source";
import type { RunRow } from "./plan-dock";
import { Delta } from "./unknown";
import { rowScores } from "./plan-dock";

export function savedWorkDelta(cur: RunScores | null, prev: RunScores | null): number | null {
  if (!cur || !prev) return null;
  const c = scoreBoards(cur);
  const p = scoreBoards(prev);
  if (c.v11?.savedWork != null && p.v11?.savedWork != null)
    return c.v11.savedWork - p.v11.savedWork;
  if (c.v11 || p.v11) return null;
  if (c.v1?.savedWork != null && p.v1?.savedWork != null) return c.v1.savedWork - p.v1.savedWork;
  return null;
}

export async function buildLedgerRows(
  index: RunIndexEntry[],
  source: Pick<RunsSource, "loadRunReport" | "loadRunScores">,
): Promise<RunRow[]> {
  const [reports, scoresAll] = await Promise.all([
    Promise.all(index.map((entry) => source.loadRunReport(entry.id))),
    Promise.all(index.map((entry) => source.loadRunScores(entry.id))),
  ]);
  const modal = modalZoneCount(reports);
  return index.map((entry, i) => {
    const report = reports[i]!;
    const board = boardSummary(report);
    const previousIndex = reports.findIndex(
      (candidate, j) => j > i && comparableRuns(report, candidate),
    );
    const prev = previousIndex >= 0 ? boardSummary(reports[previousIndex]!) : null;
    return {
      id: entry.id,
      label: entry.meta?.label ?? null,
      hash: entry.meta?.optionsHash ?? report.optionsHash,
      when: entry.meta?.generatedUtc ?? report.GeneratedUtc,
      board,
      scores: rowScores(scoresAll[i]!),
      scoreDelta: savedWorkDelta(
        scoresAll[i]!,
        previousIndex >= 0 ? scoresAll[previousIndex]! : null,
      ),
      delta: prev
        ? {
            solved: board.solved - prev.solved,
            rooms: difference(board.acceptedRooms, prev.acceptedRooms),
            sqft: difference(board.acceptedSqft, prev.acceptedSqft),
            held: difference(board.heldSqft, prev.heldSqft),
          }
        : null,
      partiality: partiality(report, modal),
    };
  });
}

export const NO_SCORES_TITLE =
  "No scores.json in this run package. Measurements are unavailable; nothing is recomputed in their place.";

export function scoreCell(row: RunRow, value: number | null): ReactNode {
  if (row.scores === null) {
    return (
      <span className="block px-1.5 text-right" title={NO_SCORES_TITLE}>
        no scores
      </span>
    );
  }
  return <span className="block px-1.5 text-right">{value === null ? "—" : value.toFixed(3)}</span>;
}

export const runName = (row: Pick<RunRow, "label" | "hash">) =>
  row.label ?? `run ${row.hash.slice(0, 6)}`;

/** The scorer's board line for the current run (B) — read from the package's scores.json, with a
 * currency-matched savedWork delta vs the A baseline. An absent file is said out loud; nothing
 * here is ever computed as a stand-in (SHIMS.md #1 close). */
export function HeaderScores(props: {
  runId?: string | null;
  cur: RunScores | null | undefined;
  prev: RunScores | null | undefined;
}) {
  const { cur, prev } = props;
  if (cur === undefined) return null; // still loading — silence beats a flashed fake absent state
  if (cur === null) {
    return (
      <Chip tone="caution" title={NO_SCORES_TITLE}>
        no scores.json
      </Chip>
    );
  }
  if (cur.metricSchemaVersion) {
    return (
      <a href={`/api/runs-data/${props.runId}/scores.json`} target="_blank" rel="noreferrer">
        six-axis measurements (JSON) — legacy scores unavailable
      </a>
    );
  }
  const { v11, v1 } = scoreBoards(cur);
  const primary = v11 ?? v1;
  const delta = savedWorkDelta(cur, prev ?? null);
  const f = (value: number | null | undefined) => (value == null ? "—" : value.toFixed(3));
  return (
    <span
      className=""
      title="scores.json — the python scorer's board (score-looks-good.py, the single measure authority), persisted into the run package at harness time."
    >
      saved {f(primary?.savedWork)} {v11 ? "v1.1" : "v1"}
      {v11 && v1 ? ` · ${f(v1.savedWork)} v1` : ""}
      {delta !== null ? (
        <>
          {" · Δ vs A "}
          <Delta value={delta} digits={3} />
        </>
      ) : null}
      {` · recall ${f(primary?.roomRecall)} · edgeOnInk ${f(primary?.edgeOnInkAccepted)}`}
    </span>
  );
}
