// LEDGER variant — find-the-product round 1. Thesis: this page is a TABLE OF RUNS. History is
// the primary object; images are secondary evidence you open on demand. Rows are runs (newest
// first), columns are board facts derived from report.json plus DELTA columns against each
// run's chronological predecessor (diff columns are legitimate; value duplication is not —
// docs/design/SURFACE-PHILOSOPHY.md §2). Selecting a run opens its zone strip; marking two
// runs A/B opens a compare pane that renders ONLY the zones that materially changed.
import { useEffect, useMemo, useRef, useState } from "react";

import { MasterTable } from "#/components/master-table/master-table";
import { fmtNum, type Column, type MasterTableState } from "#/components/master-table/model";
import { Chip } from "#/components/ui/chip";
import { cn } from "#/lib/utils";

import {
  boardSummary,
  fetchRunIndex,
  loadRaster,
  loadRunReport,
  loadZoneGeometry,
  paintRaster,
  ringPath,
  zoneViewport,
  type RunReport,
  type ZoneGeometry,
  type ZoneRecord,
} from "./world";

// ---------------------------------------------------------------------------------------------
// Row model — built once when the reports land. Deltas are computed against the CHRONOLOGICAL
// predecessor (the run below it in time), never against "whatever row happens to sit below
// after sorting" — re-sorting the table must not rewrite history.
// ---------------------------------------------------------------------------------------------

type Board = ReturnType<typeof boardSummary>;

type RunRow = {
  id: string;
  label: string | null;
  hash: string;
  when: string; // ISO
  report: RunReport;
  board: Board;
  /** Null on the oldest run in the pool — there is nothing to diff against. */
  delta: { solved: number; rooms: number; sqft: number; held: number } | null;
  prevLabel: string | null;
};

// gap: world.boardSummary stops at report.json facts — scores.json (savedWork et al.) is not
// part of the run package yet (CLEANROOM fixture silences), so the ledger cannot carry scorer
// columns or rank runs by saved work. Persist-time gap; not recomputing the python scorer here.

// gap: world.fetchRunIndex discards the `pool` path the middleware reports alongside `runs`,
// so the masthead cannot say WHICH .artifacts directory it is reading. Omitted rather than
// re-fetching index.json a second time here.

async function buildRows(): Promise<RunRow[]> {
  const index = await fetchRunIndex(); // newest first by construction
  const reports = await Promise.all(index.map((entry) => loadRunReport(entry.id)));
  return index.map((entry, i) => {
    const report = reports[i]!;
    const board = boardSummary(report);
    const prev = i + 1 < index.length ? reports[i + 1]! : null;
    const prevBoard = prev ? boardSummary(prev) : null;
    return {
      id: entry.id,
      label: entry.meta?.label ?? null,
      hash: entry.meta?.optionsHash ?? report.optionsHash,
      when: entry.meta?.generatedUtc ?? report.GeneratedUtc,
      report,
      board,
      delta: prevBoard
        ? {
            solved: board.solved - prevBoard.solved,
            rooms: board.acceptedRooms - prevBoard.acceptedRooms,
            sqft: board.acceptedSqft - prevBoard.acceptedSqft,
            held: board.heldSqft - prevBoard.heldSqft,
          }
        : null,
      prevLabel: index[i + 1]?.meta?.label ?? (prev ? index[i + 1]!.id : null),
    };
  });
}

const runName = (row: Pick<RunRow, "label" | "hash">) => row.label ?? `run ${row.hash.slice(0, 6)}`;

const whenShort = (iso: string) => {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

// ---------------------------------------------------------------------------------------------
// Delta cell — signed, toned by whether the move is an improvement. Held sqft improves DOWN.
// ---------------------------------------------------------------------------------------------

function DeltaCell({
  value,
  digits = 0,
  goodWhenUp = true,
}: {
  value: number | null;
  digits?: number;
  goodWhenUp?: boolean;
}) {
  if (value === null) {
    return (
      <span
        className="tele block px-1.5 text-right text-[var(--r-ink-mute)]"
        title="Oldest run in the pool — nothing earlier to diff against."
      >
        —
      </span>
    );
  }
  const eps = digits === 0 ? 0.5 : 0.05;
  if (Math.abs(value) < eps) {
    return (
      <span className="tele block px-1.5 text-right text-[var(--r-ink-mute)]" title="No change vs the previous run.">
        ·
      </span>
    );
  }
  const good = goodWhenUp ? value > 0 : value < 0;
  return (
    <span
      className={cn(
        "tele block px-1.5 text-right tabular-nums",
        good ? "text-[var(--st-done)]" : "text-[var(--st-warn)]",
      )}
    >
      {value > 0 ? "+" : ""}
      {fmtNum(value, digits)}
    </span>
  );
}

// ---------------------------------------------------------------------------------------------
// Zone thumbnail — the run's OWN evidence, kept small (secondary to the table). Canvas underlay
// per the contact-sheet law: received ink solid, invented closures (seals + gap-close) screened.
// The canvas keeps its own resting palette (COLOR-ROLES: visual canvases are outside the role
// vocabulary); the SVG overlay speaks state roles since it states facts (accepted / residue).
// ---------------------------------------------------------------------------------------------

const INK_RGBA: [number, number, number, number] = [51, 65, 85, 235]; // received — solid
const CLOSE_RGBA: [number, number, number, number] = [166, 94, 46, 235]; // invented — screened

// gap: world.parseZoneTsv surfaces no accepted/held status on ROOM lines (the TSV carries
// none), so the overlay draws every TSV room in the accepted tone — held rooms are visible
// only as counts in the table, never as geometry. If held rooms should read differently the
// status has to join the TSV at persist time.

function ZoneThumb({ runId, zone, box = 104 }: { runId: string; zone: ZoneRecord; box?: number }) {
  const vp = useMemo(() => {
    const spanX = zone.MaxX - zone.MinX + 8;
    const spanY = zone.MaxY - zone.MinY + 8;
    return zoneViewport(zone, box / Math.max(spanX, spanY));
  }, [zone, box]);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [geom, setGeom] = useState<ZoneGeometry | null>(null);
  const [dead, setDead] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadZoneGeometry(runId, zone.Tsv)
      .then((g) => !cancelled && setGeom(g))
      .catch(() => !cancelled && setDead(true));
    void (async () => {
      const ctx = canvasRef.current?.getContext("2d");
      if (!ctx) return;
      try {
        paintRaster(ctx, await loadRaster(runId, zone.Ink), vp, INK_RGBA);
        for (const rel of [zone.Seals, zone.Close]) {
          if (rel) paintRaster(ctx, await loadRaster(runId, rel), vp, CLOSE_RGBA, true);
        }
      } catch {
        if (!cancelled) setDead(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [runId, zone, vp]);

  if (dead) {
    return (
      <div
        style={{ width: vp.widthPx, height: vp.heightPx }}
        className="tele flex items-center justify-center border border-[var(--r-line)] text-[10px] text-[var(--r-ink-mute)]"
        title="This zone's raster or TSV failed to load — the run package is missing evidence for it."
      >
        no raster
      </div>
    );
  }
  return (
    <div
      className="relative shrink-0 border border-[var(--r-line)]"
      style={{ width: vp.widthPx, height: vp.heightPx }}
    >
      <canvas ref={canvasRef} width={vp.widthPx} height={vp.heightPx} className="absolute inset-0" />
      <svg width={vp.widthPx} height={vp.heightPx} className="absolute inset-0">
        {zone.ZoneLoops.length > 0 && (
          <path
            d={ringPath(vp, zone.ZoneLoops as [number, number][][])}
            fill="none"
            stroke="var(--st-meta)"
            strokeOpacity={0.45}
          />
        )}
        {geom &&
          [...geom.polys.entries()].map(([id, rings]) => (
            <path
              key={id}
              d={ringPath(vp, rings.map((ring) => ring.points))}
              fillRule="evenodd"
              fill="var(--st-done)"
              fillOpacity={0.13}
              stroke="var(--st-done)"
              strokeOpacity={0.7}
            />
          ))}
        {geom?.residues.map((residue) => (
          <path
            key={residue.id}
            d={ringPath(vp, residue.loops)}
            fill="var(--st-warn)"
            fillOpacity={0.12}
            stroke="var(--st-warn)"
            strokeOpacity={0.5}
            strokeDasharray="2 2"
          />
        ))}
      </svg>
    </div>
  );
}

const zoneShort = (zone: ZoneRecord) => zone.Zone.split("#")[1] ?? zone.Zone;

// ---------------------------------------------------------------------------------------------
// Selected-run pane — the run's zones as a compact strip. Solved zones get thumbnails (largest
// accepted area first); held zones stay DATA — a reason histogram, no 7 empty pictures.
// ---------------------------------------------------------------------------------------------

function RunZonesPane({ row }: { row: RunRow }) {
  const solved = useMemo(
    () =>
      row.report.Zones.filter((zone) => zone.triage.verdict === "solve").sort(
        (a, b) => b.AcceptedSqft - a.AcceptedSqft,
      ),
    [row],
  );
  const heldReasons = useMemo(() => {
    const counts = new Map<string, number>();
    for (const zone of row.report.Zones) {
      if (zone.triage.verdict === "hold") {
        counts.set(zone.triage.reason, (counts.get(zone.triage.reason) ?? 0) + 1);
      }
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [row]);

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--r-line)] px-3 py-1">
        <span className="tele-label text-[var(--r-ink)]">{runName(row)}</span>
        <Chip tone="done" title="Zones the triage verdict marked solve, out of all zones in the run.">
          {row.board.solved}/{row.board.zones} solved
        </Chip>
        <Chip tone="meta" title="Accepted rooms and square footage across every solved zone.">
          {row.board.acceptedRooms} rooms · {fmtNum(row.board.acceptedSqft, 0)} sf
        </Chip>
        {heldReasons.map(([reason, count]) => (
          <Chip key={reason} tone="warn" title={`Zones held with triage reason "${reason}" — no thumbnail; a held zone is a fact, not a picture.`}>
            {count} held: {reason}
          </Chip>
        ))}
      </div>
      <div className="flex min-h-0 flex-1 items-start gap-2 overflow-x-auto px-3 py-2">
        {solved.map((zone) => (
          <figure key={zone.Zone} className="shrink-0" title={zone.Zone}>
            <ZoneThumb runId={row.id} zone={zone} />
            <figcaption className="tele mt-0.5 max-w-[104px] truncate text-[10px] text-[var(--r-ink-2)]">
              #{zoneShort(zone)} · {zone.AcceptedRooms}r · {fmtNum(zone.AcceptedSqft, 0)}sf
            </figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// A/B compare — the ruled default is side-by-side thumbnails, but only for zones that CHANGED
// (accepted rooms moved, accepted sqft moved > 0.5, verdict flipped, or the zone exists on one
// side only). Identical zones are a count, not 40 identical picture pairs.
// ---------------------------------------------------------------------------------------------

type ZoneDiff = {
  key: string;
  a: ZoneRecord | null;
  b: ZoneRecord | null;
  rooms: number;
  sqft: number;
};

function zoneDiffs(a: RunRow, b: RunRow): { changed: ZoneDiff[]; same: number } {
  const byZone = (report: RunReport) => new Map(report.Zones.map((zone) => [zone.Zone, zone]));
  const zonesA = byZone(a.report);
  const zonesB = byZone(b.report);
  const keys = [...new Set([...zonesA.keys(), ...zonesB.keys()])].sort();
  const changed: ZoneDiff[] = [];
  let same = 0;
  for (const key of keys) {
    const za = zonesA.get(key) ?? null;
    const zb = zonesB.get(key) ?? null;
    const rooms = (zb?.AcceptedRooms ?? 0) - (za?.AcceptedRooms ?? 0);
    const sqft = (zb?.AcceptedSqft ?? 0) - (za?.AcceptedSqft ?? 0);
    const flipped = za?.triage.verdict !== zb?.triage.verdict;
    if (rooms !== 0 || Math.abs(sqft) > 0.5 || flipped || !za || !zb) {
      changed.push({ key, a: za, b: zb, rooms, sqft });
    } else {
      same += 1;
    }
  }
  changed.sort((x, y) => Math.abs(y.sqft) - Math.abs(x.sqft) || Math.abs(y.rooms) - Math.abs(x.rooms));
  return { changed, same };
}

function SideStat({ zone }: { zone: ZoneRecord | null }) {
  if (!zone) {
    return <span className="tele text-[var(--r-ink-mute)]">absent</span>;
  }
  return (
    <span className="tele tabular-nums text-[var(--r-ink-2)]">
      {zone.AcceptedRooms}r · {fmtNum(zone.AcceptedSqft, 0)}sf
      {zone.triage.verdict === "hold" && (
        <span className="text-[var(--st-warn)]"> · held: {zone.triage.reason}</span>
      )}
    </span>
  );
}

function ComparePane({ a, b, onClear }: { a: RunRow; b: RunRow; onClear: () => void }) {
  const { changed, same } = useMemo(() => zoneDiffs(a, b), [a, b]);
  const board = {
    solved: b.board.solved - a.board.solved,
    rooms: b.board.acceptedRooms - a.board.acceptedRooms,
    sqft: b.board.acceptedSqft - a.board.acceptedSqft,
    held: b.board.heldSqft - a.board.heldSqft,
  };
  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--r-line)] px-3 py-1">
        <span className="tele-label text-[var(--r-ink)]">
          A {runName(a)} → B {runName(b)}
        </span>
        <span className="tele flex items-center gap-1 text-[11px] text-[var(--r-ink-2)]">
          Δ solved <DeltaCell value={board.solved} /> rooms <DeltaCell value={board.rooms} /> sf{" "}
          <DeltaCell value={board.sqft} /> held sf <DeltaCell value={board.held} goodWhenUp={false} />
        </span>
        <Chip
          tone="meta"
          title="Zones whose accepted rooms/sqft or verdict are identical in both runs. They are not rendered — an unchanged zone is a count, not a picture pair."
        >
          {same} zones unchanged
        </Chip>
        <button
          type="button"
          onClick={onClear}
          title="Drop both A/B marks and close the compare pane."
          className="tele ml-auto rounded-[var(--radius)] px-1 text-[var(--r-ink-2)] hover:[background-image:linear-gradient(var(--r-veil),var(--r-veil))]"
        >
          clear a/b
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {changed.length === 0 && (
          <p className="tele p-6 text-center text-[11px] text-[var(--r-ink-2)]">
            No zone materially changed between these two runs — the board deltas above are the
            whole story.
          </p>
        )}
        {changed.map((diff) => (
          <div
            key={diff.key}
            className="flex items-center gap-3 border-b border-[var(--r-line)] px-3 py-2"
          >
            <div className="flex shrink-0 items-start gap-1">
              {diff.a ? (
                <ZoneThumb runId={a.id} zone={diff.a} box={120} />
              ) : (
                <AbsentThumb side="A" />
              )}
              {diff.b ? (
                <ZoneThumb runId={b.id} zone={diff.b} box={120} />
              ) : (
                <AbsentThumb side="B" />
              )}
            </div>
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="tele-label text-[var(--r-ink)]" title={diff.key}>
                {diff.key}
              </span>
              <span className="tele flex items-center gap-1 text-[11px]">
                <SideStat zone={diff.a} />
                <span className="text-[var(--r-ink-mute)]">→</span>
                <SideStat zone={diff.b} />
              </span>
              <span className="tele flex items-center gap-1 text-[11px] text-[var(--r-ink-2)]">
                Δ rooms <DeltaCell value={diff.rooms} /> Δ sf <DeltaCell value={diff.sqft} />
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function AbsentThumb({ side }: { side: string }) {
  return (
    <div
      className="tele flex h-[120px] w-[120px] shrink-0 items-center justify-center border border-dashed border-[var(--r-line-2)] text-[10px] text-[var(--r-ink-mute)]"
      title="This zone does not exist in this run — the zoning pass cut the level differently."
    >
      not in {side}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// The page.
// ---------------------------------------------------------------------------------------------

export default function Ledger() {
  const [rows, setRows] = useState<RunRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [picks, setPicks] = useState<string[]>([]);
  // Controlled table state so "newest first" is a VISIBLE header sort, not silent row order.
  const [tableState, setTableState] = useState<MasterTableState>({
    filters: {},
    sorts: [{ key: "run", dir: "desc" }],
    query: "",
  });

  useEffect(() => {
    buildRows().then(setRows, (cause: unknown) => setError(String(cause)));
  }, []);

  const togglePick = (id: string) =>
    setPicks((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id].slice(-2)));

  // A/B is chronology, not click order: A is the older of the two marks.
  const pickOrder = useMemo(() => [...picks].sort(), [picks]);
  const letterOf = (id: string) => {
    const index = pickOrder.indexOf(id);
    return index === -1 ? null : index === 0 ? "A" : "B";
  };

  const columns = useMemo<Column<RunRow>[]>(
    () => [
      {
        key: "run",
        label: "run",
        lock: true,
        width: "w-52",
        title: "The run's label (or options-hash name when unlabeled) and when the harness persisted it. Sorted descending = newest first.",
        sort: (row) => row.id, // ids are timestamp-prefixed — id order IS chronology
        search: (row) => `${row.label ?? ""} ${row.hash} ${row.id}`,
        cell: (row) => (
          <span className="tele flex min-w-0 items-baseline gap-1.5 px-1.5">
            <span className={cn("truncate", row.label ? "text-[var(--r-ink)]" : "text-[var(--r-ink-2)]")}>
              {runName(row)}
            </span>
            <span className="shrink-0 text-[10px] text-[var(--r-ink-mute)]">{whenShort(row.when)}</span>
          </span>
        ),
      },
      {
        key: "options",
        label: "options",
        width: "w-20",
        title: "Solver options generation — runs sharing a hash ran identical options; a hash change means the knobs moved.",
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
        key: "ab",
        label: "a/b",
        width: "w-12",
        title: "Mark two runs to compare. A is always the chronologically older mark; the pane below shows only zones that changed.",
        cell: (row) => {
          const letter = letterOf(row.id);
          return (
            <button
              type="button"
              onClick={() => togglePick(row.id)}
              title={
                letter
                  ? `Marked as ${letter} — click to unmark.`
                  : "Mark this run for A/B compare (two marks open the compare pane; a third replaces the newer mark)."
              }
              className={cn(
                "tele h-7 w-full px-1.5 text-left",
                letter ? "text-[var(--r-ink)]" : "text-[var(--r-ink-mute)] hover:text-[var(--r-ink-2)]",
              )}
            >
              {letter ?? "pick"}
            </button>
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
          <span className="tele block px-1.5 text-right tabular-nums">
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
        sort: (row) => row.board.acceptedRooms,
        cell: (row) => (
          <span className="tele block px-1.5 text-right tabular-nums">{row.board.acceptedRooms}</span>
        ),
      },
      {
        key: "sqft",
        label: "accepted sf",
        group: "board",
        right: true,
        width: "w-20",
        title: "Accepted square footage across every solved zone.",
        sort: (row) => row.board.acceptedSqft,
        cell: (row) => (
          <span className="tele block px-1.5 text-right tabular-nums">
            {fmtNum(row.board.acceptedSqft, 0)}
          </span>
        ),
      },
      {
        key: "held",
        label: "held sf",
        group: "board",
        right: true,
        width: "w-16",
        title: "Square footage sitting in held rooms — area the solver found but did not trust.",
        sort: (row) => row.board.heldSqft,
        cell: (row) => (
          <span className="tele block px-1.5 text-right tabular-nums text-[var(--r-ink-2)]">
            {fmtNum(row.board.heldSqft, 0)}
          </span>
        ),
      },
      // gap(master-table): there is no canon "value + delta" column pair — each Δ below is a
      // hand-built ValueColumn repeating the same shape (value, goodWhen, prev-missing dash).
      // A diff-column primitive would delete these four near-identical defs and keep the
      // improvement/regression toning in one place.
      {
        key: "d-solved",
        label: "Δ solved",
        group: "Δ vs prev run",
        right: true,
        width: "w-16",
        title: "Solved zones vs this run's chronological predecessor — NOT the row below after sorting.",
        sort: (row) => row.delta?.solved ?? Number.NEGATIVE_INFINITY,
        cell: (row) => <DeltaCell value={row.delta?.solved ?? null} />,
      },
      {
        key: "d-rooms",
        label: "Δ rooms",
        group: "Δ vs prev run",
        right: true,
        width: "w-16",
        title: "Accepted rooms vs the chronological predecessor.",
        sort: (row) => row.delta?.rooms ?? Number.NEGATIVE_INFINITY,
        cell: (row) => <DeltaCell value={row.delta?.rooms ?? null} />,
      },
      {
        key: "d-sqft",
        label: "Δ sf",
        group: "Δ vs prev run",
        right: true,
        width: "w-16",
        title: "Accepted square footage vs the chronological predecessor.",
        sort: (row) => row.delta?.sqft ?? Number.NEGATIVE_INFINITY,
        cell: (row) => <DeltaCell value={row.delta?.sqft ?? null} />,
      },
      {
        key: "d-held",
        label: "Δ held",
        group: "Δ vs prev run",
        right: true,
        width: "w-16",
        title: "Held square footage vs the chronological predecessor — down is the improvement here.",
        sort: (row) => row.delta?.held ?? Number.NEGATIVE_INFINITY,
        cell: (row) => <DeltaCell value={row.delta?.held ?? null} goodWhenUp={false} />,
      },
      {
        key: "rejects",
        label: "top rejections",
        title: "The run's three loudest rejection reasons with counts — the histogram's head, not its tail.",
        facet: (row) => row.board.rejectionTop[0]?.[0] ?? "",
        all: "any loudest",
        cell: (row) => (
          <span className="flex items-center gap-1 px-1">
            {row.board.rejectionTop.map(([reason, count]) => (
              <Chip key={reason} tone="meta" title={`${count} rejections of kind ${reason} in this run.`}>
                {reason} {count}
              </Chip>
            ))}
          </span>
        ),
      },
    ],
    [pickOrder],
  );

  if (error) {
    return (
      <div className="tele p-8 text-sm text-[var(--st-warn)]">
        run pool failed to load: {error} — is the pe:takeoff-runs-pool middleware serving
        /api/runs-data?
      </div>
    );
  }
  if (!rows) {
    return <div className="tele p-8 text-sm text-[var(--r-ink-2)]">loading the run ledger…</div>;
  }

  const selected = rows.find((row) => row.id === selectedId) ?? null;
  const pair =
    pickOrder.length === 2
      ? ([rows.find((r) => r.id === pickOrder[0]), rows.find((r) => r.id === pickOrder[1])] as const)
      : null;
  const comparing = pair && pair[0] && pair[1] ? { a: pair[0], b: pair[1] } : null;
  const paneOpen = comparing !== null || selected !== null;
  const optionSets = new Set(rows.map((row) => row.hash)).size;

  return (
    <div className="flex h-dvh min-h-0 flex-col bg-background text-foreground">
      <div className="flex shrink-0 items-baseline gap-2 border-b border-[var(--r-line)] px-3 py-1.5">
        <span className="tele-label text-[var(--r-ink)]">run ledger</span>
        <span className="tele text-[11px] text-[var(--r-ink-2)]">
          history is the object — every persisted takeoff run, newest first. Click a row for its
          zones; mark two for A/B.
        </span>
      </div>

      <div className={cn("min-h-0", paneOpen ? "flex-[3]" : "flex-1", "flex flex-col")}>
        <MasterTable
          rows={rows}
          columns={columns}
          rowKey={(row) => row.id}
          scopeLabel="runs in pool"
          searchPlaceholder="label / hash…"
          summary={`${rows.length} runs · ${optionSets} option sets`}
          chips={picks.map((id) => {
            const row = rows.find((r) => r.id === id);
            return {
              label: `${letterOf(id) ?? "?"}: ${row ? runName(row) : id}`,
              onClear: () => togglePick(id),
            };
          })}
          empty="No runs in the pool yet — run the zone-bounded detect harness once and it will auto-persist here."
          activeKey={selectedId}
          onRowClick={(row) => setSelectedId((prev) => (prev === row.id ? null : row.id))}
          tableState={tableState}
          onTableStateChange={setTableState}
        />
      </div>

      {paneOpen && (
        <div className="flex min-h-0 flex-[2] flex-col border-t-2 border-[var(--r-line-2)]">
          {comparing ? (
            <ComparePane a={comparing.a} b={comparing.b} onClear={() => setPicks([])} />
          ) : (
            selected && <RunZonesPane row={selected} />
          )}
        </div>
      )}
    </div>
  );
}
