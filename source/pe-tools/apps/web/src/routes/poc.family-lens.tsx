import { createFileRoute } from "@tanstack/react-router";
import { Fragment, useMemo, useRef, useState } from "react";

import { ThemeToggle } from "#/components/ThemeToggle";

export const Route = createFileRoute("/poc/family-lens")({ component: Page });

/* ------------------------------------------------------------------------------------------------
 * POC: the family-matrix replacement — actual plugin shape, one workspace.
 *   Toolbar        category · lens button (popover: triage ladder ⇄ lens, side by side,
 *                  distribution strips inline as triage evidence) · draft counts
 *   Reticle grid   the centerpiece — crosshair + cursor HUD, collapsible family groups,
 *                  per-row hide, column sort, cell edits as proposals
 *   Review dock    proposal → staged → push, schedule-grid trichotomy
 *   State model unchanged from the exhibit POC: Snapshot (read-only) + Lens (ordered pinned
 *   params, muted set) + Drafts. Mock category stands in for the host matrix call.
 * ---------------------------------------------------------------------------------------------- */

// ── snapshot types ───────────────────────────────────────────────────────────────────────────────
type ParamKind = "shared" | "family" | "vendor";
interface FamilySnap {
  id: string;
  name: string;
  types: string[];
  /** param → per-type values (missing param = family doesn't have it) */
  values: Record<string, Record<string, string>>;
  kinds: Record<string, ParamKind>;
}
interface RowRef {
  key: string;
  familyId: string;
  familyName: string;
  typeName: string;
  firstInFamily: boolean;
}

// ── mock category: deterministic, hash-seeded so the POC is stable ───────────────────────────────
const hash = (s: string) => {
  let x = 7;
  for (const ch of s) x = (x * 31 + ch.charCodeAt(0)) | 0;
  return Math.abs(x);
};

const CORE_PARAMS: Array<{
  name: string;
  kind: ParamKind;
  /** value for (family, type) — variance lives here */
  gen: (family: string, type: string) => string;
}> = [
  { name: "Air Flow", kind: "shared", gen: (f, t) => `${((hash(f + t) % 14) + 2) * 25} CFM` },
  { name: "Max Flow", kind: "shared", gen: (f, t) => `${((hash(f + t) % 14) + 6) * 50} CFM` },
  { name: "Min Flow", kind: "shared", gen: (f, t) => `${((hash(f + t) % 6) + 1) * 25} CFM` },
  { name: "Neck Size", kind: "shared", gen: (f, t) => `${((hash(t) % 5) + 3) * 2}"ø` },
  { name: "Face Width", kind: "family", gen: (f, t) => `${((hash(f + t) % 4) + 1) * 6}in` },
  { name: "Face Height", kind: "family", gen: (f, t) => `${((hash(t + f) % 3) + 1) * 6}in` },
  { name: "Static Pressure", kind: "shared", gen: (f, t) => `0.${(hash(f + t) % 8) + 1}0 in-wg` },
  { name: "NC Rating", kind: "shared", gen: (f, t) => `NC-${((hash(t + "nc") % 5) + 3) * 5}` },
  { name: "Mounting", kind: "family", gen: (f) => (hash(f) % 2 ? "Lay-in" : "Surface") },
  { name: "Frame Type", kind: "family", gen: (f) => ["Type A", "Type B", "Beveled"][hash(f) % 3] },
  { name: "Finish", kind: "shared", gen: (f) => (hash(f + "fin") % 3 ? "White" : "Mill") },
  { name: "Material", kind: "shared", gen: () => "Steel" },
  { name: "Manufacturer", kind: "shared", gen: (f) => ["Price", "Titus", "Krueger"][hash(f) % 3] },
  {
    name: "Model",
    kind: "shared",
    gen: (f) => `${["SPD", "TMS", "PAS"][hash(f) % 3]}-${(hash(f) % 90) + 10}`,
  },
  { name: "Damper", kind: "family", gen: (f) => (hash(f + "d") % 2 ? "Opposed Blade" : "None") },
  { name: "Border Width", kind: "family", gen: (f) => `${(hash(f + "b") % 2) + 1}in` },
  { name: "Duct Width", kind: "family", gen: (f, t) => `${((hash(t + "dw") % 4) + 2) * 4}in` },
  { name: "Duct Height", kind: "family", gen: (f, t) => `${((hash(t + "dh") % 3) + 2) * 4}in` },
  { name: "Weight", kind: "shared", gen: (f, t) => `${(hash(f + t + "w") % 20) + 4} lb` },
  { name: "Voltage", kind: "shared", gen: (f) => (hash(f + "v") % 2 ? "120 V" : "—") },
];

const FAMILY_NAMES = [
  "PE Supply Diffuser Square",
  "PE Supply Diffuser Round",
  "PE Return Grille",
  "PE Linear Slot 4ft",
  "PE Linear Slot 2ft",
  "PE Exhaust Register",
  "PE Transfer Grille",
  "PE Displacement Unit",
];

/** Junk that makes real category matrices unreadable: vendor leftovers, low coverage, constant. */
const VENDOR_STEMS = [
  "Price_ProductLine",
  "Price_SortOrder",
  "Ti_Legacy Code",
  "Ti_Do Not Use",
  "kr_OldFlow",
  "zzz_Temp Calc",
  "Cost 2019",
  "Keynote_OLD",
  "Lead Time (wks)",
  "Rep Contact",
  "Submittal Ref",
  "CAD Block Name",
  "Spec Section",
  "Warranty Note",
  "Color Code Int",
];

function buildSnapshot(): FamilySnap[] {
  return FAMILY_NAMES.map((name) => {
    const typeCount = (hash(name) % 4) + 2;
    const types = Array.from({ length: typeCount }, (_, i) => {
      const neck = (i + 3) * 2;
      return `${neck}" Neck`;
    });
    const values: Record<string, Record<string, string>> = {};
    const kinds: Record<string, ParamKind> = {};
    for (const p of CORE_PARAMS) {
      if (hash(name + p.name) % 10 < 2 && p.name !== "Air Flow") continue; // coverage gaps
      kinds[p.name] = p.kind;
      values[p.name] = Object.fromEntries(types.map((t) => [t, p.gen(name, t)]));
    }
    // 6–10 vendor params per family, mostly unique to it, constant across types
    const vendorCount = (hash(name + "vc") % 5) + 6;
    for (let i = 0; i < vendorCount; i++) {
      const stem = VENDOR_STEMS[(hash(name) + i * 3) % VENDOR_STEMS.length];
      const pname = hash(name + stem) % 3 === 0 ? stem : `${stem} ${(hash(name + stem) % 4) + 1}`;
      kinds[pname] = "vendor";
      const constant = `${(hash(pname) % 900) + 100}`;
      values[pname] = Object.fromEntries(types.map((t) => [t, constant]));
    }
    return { id: name.toLowerCase().replace(/\s+/g, "-"), name, types, values, kinds };
  });
}

// ── derived: rows + per-param signal ─────────────────────────────────────────────────────────────
interface ParamStat {
  name: string;
  kind: ParamKind;
  coverage: number; // families having it / total families
  familiesWith: number;
  distinct: number; // distinct values across all cells
  cells: number;
  score: number;
}

function computeStats(snapshot: FamilySnap[]): ParamStat[] {
  const map = new Map<
    string,
    { kind: ParamKind; fams: number; vals: Set<string>; cells: number }
  >();
  for (const fam of snapshot) {
    for (const [param, perType] of Object.entries(fam.values)) {
      const entry = map.get(param) ?? {
        kind: fam.kinds[param],
        fams: 0,
        vals: new Set(),
        cells: 0,
      };
      entry.fams++;
      for (const v of Object.values(perType)) {
        entry.vals.add(v);
        entry.cells++;
      }
      map.set(param, entry);
    }
  }
  const total = snapshot.length;
  return Array.from(map.entries())
    .map(([name, e]) => {
      const coverage = e.fams / total;
      const variance = e.cells > 1 ? (e.vals.size - 1) / (e.cells - 1) : 0;
      // signal = does it differentiate rows × can you compare it across families
      const score = Math.round((variance * 2 + coverage) * 50);
      return {
        name,
        kind: e.kind,
        coverage,
        familiesWith: e.fams,
        distinct: e.vals.size,
        cells: e.cells,
        score,
      };
    })
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}

const rowsOf = (snapshot: FamilySnap[]): RowRef[] =>
  snapshot.flatMap((fam) =>
    fam.types.map((typeName, i) => ({
      key: `${fam.id}::${typeName}`,
      familyId: fam.id,
      familyName: fam.name,
      typeName,
      firstInFamily: i === 0,
    })),
  );

// ── drafts: the schedule-grid trichotomy, cell-keyed ─────────────────────────────────────────────
type CellKey = string; // `${familyId}::${type}::${param}`
const cellKey = (row: RowRef, param: string): CellKey => `${row.key}::${param}`;
interface Draft {
  proposal?: string;
  staged?: string;
  from: string;
  rowLabel: string;
  param: string;
}
type Drafts = Record<CellKey, Draft>;

// ── page-level shared state plumbing ─────────────────────────────────────────────────────────────
interface LensState {
  snapshot: FamilySnap[];
  stats: ParamStat[];
  rows: RowRef[];
  pinned: string[];
  muted: Set<string>;
  drafts: Drafts;
  pushed: Record<CellKey, string>;
  hoverParam: string | null;
  collapsed: Set<string>; // family ids folded to a summary row
  hiddenRows: Set<string>; // individual row keys tucked away
  setPinned: (next: string[]) => void;
  setMuted: (next: Set<string>) => void;
  setDrafts: (fn: (d: Drafts) => Drafts) => void;
  setHoverParam: (p: string | null) => void;
  setCollapsed: (next: Set<string>) => void;
  setHiddenRows: (next: Set<string>) => void;
  push: () => void;
  valueOf: (row: RowRef, param: string) => string | null;
  /** value distribution across all rows, largest bucket first */
  dist: (param: string) => Array<[string, RowRef[]]>;
}

function useLens(): LensState {
  const snapshot = useMemo(buildSnapshot, []);
  const stats = useMemo(() => computeStats(snapshot), [snapshot]);
  const rows = useMemo(() => rowsOf(snapshot), [snapshot]);
  const [pinned, setPinned] = useState<string[]>(() =>
    stats
      .filter((s) => s.kind !== "vendor")
      .slice(0, 10)
      .map((s) => s.name),
  );
  const [muted, setMuted] = useState<Set<string>>(new Set());
  const [drafts, setDraftsRaw] = useState<Drafts>({});
  const [pushed, setPushed] = useState<Record<CellKey, string>>({});
  const [hoverParam, setHoverParam] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [hiddenRows, setHiddenRows] = useState<Set<string>>(new Set());

  const valueOf = (row: RowRef, param: string): string | null => {
    const key = cellKey(row, param);
    if (pushed[key] != null) return pushed[key];
    const fam = snapshot.find((f) => f.id === row.familyId);
    return fam?.values[param]?.[row.typeName] ?? null;
  };

  const dist = (param: string): Array<[string, RowRef[]]> => {
    const groups = new Map<string, RowRef[]>();
    for (const row of rows) {
      const v = valueOf(row, param);
      if (v == null) continue;
      groups.set(v, [...(groups.get(v) ?? []), row]);
    }
    return Array.from(groups.entries()).sort((a, b) => b[1].length - a[1].length);
  };

  const push = () => {
    setPushed((prev) => {
      const next = { ...prev };
      for (const [key, draft] of Object.entries(drafts))
        if (draft.staged != null) next[key] = draft.staged;
      return next;
    });
    setDraftsRaw((prev) =>
      Object.fromEntries(Object.entries(prev).filter(([, d]) => d.staged == null)),
    );
  };

  return {
    snapshot,
    stats,
    rows,
    pinned,
    muted,
    drafts,
    pushed,
    hoverParam,
    collapsed,
    hiddenRows,
    setPinned,
    setMuted,
    setDrafts: (fn) => setDraftsRaw(fn),
    setHoverParam,
    setCollapsed,
    setHiddenRows,
    push,
    valueOf,
    dist,
  };
}

// ── tiny shared UI ───────────────────────────────────────────────────────────────────────────────
const KIND_COLOR: Record<ParamKind, string> = {
  shared: "var(--lichen)",
  family: "var(--pe-blue)",
  vendor: "var(--slate)",
};

function KindDot({ kind }: { kind: ParamKind }) {
  return (
    <span
      className="inline-block size-1.5 shrink-0 rounded-full"
      style={{ background: KIND_COLOR[kind] }}
      title={`${kind} parameter`}
    />
  );
}

/** Compact value distribution: top buckets as chips, outliers kiln, missing count last. */
function DistStrip({ lens, param, max = 4 }: { lens: LensState; param: string; max?: number }) {
  const buckets = lens.dist(param);
  const missing = lens.rows.length - buckets.reduce((n, [, m]) => n + m.length, 0);
  const shown = buckets.slice(0, max);
  const rest = buckets.length - shown.length;
  return (
    <span className="inline-flex min-w-0 flex-wrap items-center gap-1">
      {shown.map(([value, members]) => {
        const outlier = members.length === 1 && buckets.length > 1;
        return (
          <span
            key={value}
            className={`rounded-[2px] border px-1 py-px font-mono text-[9px] tabular-nums ${
              outlier
                ? "border-[var(--kiln)]/50 text-[var(--kiln)]"
                : "border-[var(--line)] text-[var(--clay-ink)]"
            }`}
            title={members.map((m) => `${m.familyName} · ${m.typeName}`).join("\n")}
          >
            {value}
            {members.length > 1 && (
              <span className="ml-0.5 text-[var(--slate)]">×{members.length}</span>
            )}
          </span>
        );
      })}
      {rest > 0 && (
        <span className="font-mono text-[9px] text-[var(--slate)]" title={`${rest} more values`}>
          +{rest}
        </span>
      )}
      {missing > 0 && (
        <span
          className="font-mono text-[9px] text-[var(--slate)]/60"
          title="rows without this parameter"
        >
          ∅×{missing}
        </span>
      )}
    </span>
  );
}

// ═══════════════════════════════ LENS POPOVER — triage ⇄ lens ═══════════════════════════════════
function LensPopover({ lens }: { lens: LensState }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const { stats, pinned, muted } = lens;
  const totalFamilies = lens.snapshot.length;

  const ladder = stats.filter(
    (s) =>
      !pinned.includes(s.name) &&
      !muted.has(s.name) &&
      (query === "" || s.name.toLowerCase().includes(query.toLowerCase())),
  );
  const autoLens = () =>
    lens.setPinned(
      stats
        .filter((s) => s.kind !== "vendor" && s.distinct > 1)
        .slice(0, 15)
        .map((s) => s.name),
    );
  const muteConstants = () =>
    lens.setMuted(new Set([...muted, ...stats.filter((s) => s.distinct <= 1).map((s) => s.name)]));

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-1.5 rounded-[2px] border px-2 py-0.5 text-[11px] ${
          open
            ? "border-[var(--pe-blue)] text-[var(--pe-blue)]"
            : "border-[var(--line)] hover:border-[var(--line-2)]"
        }`}
        title="Curate the lens — which parameters the grid shows, in what order"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
          <path d="M1 2h8L6 5.5V9L4 8V5.5L1 2z" fill="currentColor" />
        </svg>
        lens{" "}
        <span className="font-mono tabular-nums">
          {pinned.length}/{stats.length}
        </span>
        {muted.size > 0 && (
          <span className="font-mono text-[9px] text-[var(--slate)]">·{muted.size}m</span>
        )}
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
            onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
            role="presentation"
          />
          <div className="absolute left-0 top-full z-50 mt-1 w-[820px] max-w-[92vw] rounded-[2px] border border-[var(--line-2)] bg-[var(--paper)] p-3 shadow-lg">
            <div className="grid gap-3 md:grid-cols-[1fr_250px]">
              {/* triage ladder — distribution strips are the evidence */}
              <div className="min-w-0">
                <div className="mb-1.5 flex flex-wrap items-center gap-2">
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={`Search ${stats.length} parameters…`}
                    className="w-48 rounded-[2px] border border-[var(--line-2)] bg-transparent px-1.5 py-0.5 text-[11px] outline-none focus:border-[var(--pe-blue)]"
                  />
                  <button
                    type="button"
                    onClick={autoLens}
                    className="rounded-[2px] border border-[var(--line)] px-1.5 py-0.5 text-[10px] hover:border-[var(--pe-blue)]"
                  >
                    auto-lens · top 15
                  </button>
                  <button
                    type="button"
                    onClick={muteConstants}
                    className="rounded-[2px] border border-[var(--line)] px-1.5 py-0.5 text-[10px] hover:border-[var(--kiln)]"
                  >
                    mute constants
                  </button>
                  {muted.size > 0 && (
                    <button
                      type="button"
                      onClick={() => lens.setMuted(new Set())}
                      className="text-[10px] text-[var(--slate)] hover:text-[var(--fail)]"
                    >
                      unmute {muted.size}
                    </button>
                  )}
                </div>
                <div className="max-h-[340px] overflow-y-auto rounded-[2px] border border-[var(--line)]">
                  {ladder.map((s) => (
                    <div
                      key={s.name}
                      onMouseEnter={() => lens.setHoverParam(s.name)}
                      onMouseLeave={() => lens.setHoverParam(null)}
                      className={`flex items-center gap-2 border-b border-[var(--line-soft)] px-2 py-1 ${
                        lens.hoverParam === s.name ? "bg-[var(--pe-blue)]/5" : ""
                      }`}
                    >
                      <KindDot kind={s.kind} />
                      <span
                        className="w-36 shrink-0 truncate text-[11px]"
                        title={`${s.name} — in ${s.familiesWith}/${totalFamilies} families`}
                      >
                        {s.name}
                      </span>
                      <span className="min-w-0 flex-1 overflow-hidden">
                        <DistStrip lens={lens} param={s.name} max={3} />
                      </span>
                      <span
                        className={`w-7 shrink-0 text-right font-mono text-[10px] tabular-nums ${
                          s.score > 60 ? "text-[var(--clay-ink)]" : "text-[var(--slate)]/60"
                        }`}
                        title="signal = variance across types × coverage across families"
                      >
                        {s.score}
                      </span>
                      <button
                        type="button"
                        onClick={() => lens.setPinned([...pinned, s.name])}
                        className="shrink-0 rounded-[2px] px-1 text-[10px] text-[var(--pe-blue)] hover:bg-[var(--pe-blue)]/10"
                      >
                        pin ▸
                      </button>
                      <button
                        type="button"
                        onClick={() => lens.setMuted(new Set([...muted, s.name]))}
                        className="shrink-0 rounded-[2px] px-1 text-[10px] text-[var(--slate)]/60 hover:text-[var(--kiln)]"
                        title="Mute — drop from triage; nothing is deleted"
                      >
                        mute
                      </button>
                    </div>
                  ))}
                  {ladder.length === 0 && (
                    <p className="px-2 py-3 text-[11px] text-[var(--slate)]">
                      nothing left to triage — everything is pinned, muted, or filtered
                    </p>
                  )}
                </div>
                <p className="mt-1 text-[10px] text-[var(--slate)]">
                  strips show each parameter's value distribution across all {lens.rows.length} rows
                  — consensus is one big chip, drift is many, kiln is a lone outlier
                </p>
              </div>

              {/* the lens — ordered, the grid's column order */}
              <div>
                <p className="tele-label mb-1 text-[9px] text-[var(--lichen)]">
                  the lens · order = column order
                </p>
                <div className="max-h-[340px] space-y-1 overflow-y-auto rounded-[2px] border border-[var(--pe-blue)]/40 bg-[var(--pe-blue)]/[0.03] p-2">
                  {pinned.map((name, i) => {
                    const stat = stats.find((s) => s.name === name);
                    return (
                      <div
                        key={name}
                        onMouseEnter={() => lens.setHoverParam(name)}
                        onMouseLeave={() => lens.setHoverParam(null)}
                        className={`flex items-center gap-1.5 rounded-[2px] border px-1.5 py-0.5 text-[11px] ${
                          lens.hoverParam === name
                            ? "border-[var(--pe-blue)] bg-[var(--pe-blue)]/10"
                            : "border-[var(--line)] bg-[var(--paper)]"
                        }`}
                      >
                        <span className="w-4 font-mono text-[9px] text-[var(--slate)]">
                          {i + 1}
                        </span>
                        {stat && <KindDot kind={stat.kind} />}
                        <span className="min-w-0 flex-1 truncate">{name}</span>
                        <button
                          type="button"
                          disabled={i === 0}
                          onClick={() => {
                            const next = [...pinned];
                            [next[i - 1], next[i]] = [next[i], next[i - 1]];
                            lens.setPinned(next);
                          }}
                          className="text-[var(--slate)] hover:text-[var(--clay-ink)] disabled:opacity-20"
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          onClick={() => lens.setPinned(pinned.filter((p) => p !== name))}
                          className="text-[var(--slate)] hover:text-[var(--fail)]"
                        >
                          ×
                        </button>
                      </div>
                    );
                  })}
                  {pinned.length === 0 && (
                    <p className="py-2 text-center text-[10px] text-[var(--slate)]">
                      empty lens — pin parameters from the ladder
                    </p>
                  )}
                </div>
                <p className="mt-1.5 text-[10px] leading-relaxed text-[var(--slate)]">
                  the lens is stored route state — Pea can save it, propose to it, and a teammate
                  reopens exactly this view
                </p>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════ RETICLE GRID — the centerpiece ═════════════════════════════════
interface Reticle {
  rowKey: string;
  param: string;
  x: number;
  y: number;
}

function ReticleGrid({ lens }: { lens: LensState }) {
  const { snapshot, rows, pinned, drafts, collapsed, hiddenRows } = lens;
  const [reticle, setReticle] = useState<Reticle | null>(null);
  const [editing, setEditing] = useState<{ key: CellKey; draft: string } | null>(null);
  const [sort, setSort] = useState<{ param: string; dir: 1 | -1 } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const sortedRows = useMemo(() => {
    const visible = rows.filter((r) => !hiddenRows.has(r.key));
    if (!sort) return visible;
    return [...visible].sort((a, b) => {
      const va = lens.valueOf(a, sort.param) ?? "";
      const vb = lens.valueOf(b, sort.param) ?? "";
      const na = Number.parseFloat(va);
      const nb = Number.parseFloat(vb);
      const cmp = !Number.isNaN(na) && !Number.isNaN(nb) ? na - nb : va.localeCompare(vb);
      return cmp * sort.dir;
    });
  }, [rows, sort, hiddenRows, lens]);

  const commit = (row: RowRef, param: string, next: string) => {
    const key = cellKey(row, param);
    const from = lens.valueOf(row, param) ?? "";
    lens.setDrafts((prev) => {
      if (next === from) {
        const rest = { ...prev };
        delete rest[key];
        return rest;
      }
      return {
        ...prev,
        [key]: {
          ...prev[key],
          proposal: next,
          staged: undefined,
          from,
          rowLabel: `${row.familyName} · ${row.typeName}`,
          param,
        },
      };
    });
  };

  const toggleFamily = (familyId: string) => {
    const next = new Set(collapsed);
    if (next.has(familyId)) next.delete(familyId);
    else next.add(familyId);
    lens.setCollapsed(next);
  };
  const hideRow = (rowKey: string) => lens.setHiddenRows(new Set([...hiddenRows, rowKey]));
  const restoreFamilyRows = (familyId: string) =>
    lens.setHiddenRows(new Set([...hiddenRows].filter((k) => !k.startsWith(`${familyId}::`))));

  const renderCell = (row: RowRef, param: string) => {
    const key = cellKey(row, param);
    const value = lens.valueOf(row, param);
    const draft = drafts[key];
    const rowHot = reticle?.rowKey === row.key;
    const colHot = reticle?.param === param;
    const isEditing = editing?.key === key;
    return (
      <td
        key={param}
        onMouseMove={(e) => setReticle({ rowKey: row.key, param, x: e.clientX, y: e.clientY })}
        onClick={() =>
          value != null &&
          !isEditing &&
          setEditing({ key, draft: draft?.proposal ?? draft?.staged ?? value })
        }
        className={`cursor-text border-b border-r border-[var(--line-soft)] px-1.5 py-0.5 font-mono text-[10px] tabular-nums ${
          rowHot || colHot ? "bg-[var(--pe-blue)]/[0.07]" : ""
        } ${rowHot && colHot ? "!bg-[var(--pe-blue)]/20" : ""} ${
          value == null ? "bg-[var(--line-soft)]/40" : ""
        }`}
        title={value == null ? "parameter not on this family" : undefined}
      >
        {isEditing ? (
          <input
            autoFocus
            value={editing.draft}
            size={Math.max(4, editing.draft.length)}
            onChange={(e) => setEditing({ key, draft: e.target.value })}
            onBlur={() => {
              commit(row, param, editing.draft.trim());
              setEditing(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") setEditing(null);
            }}
            className="w-full rounded-[1px] border border-[var(--pe-blue)] bg-[var(--paper)] px-0.5 outline-none"
          />
        ) : draft?.staged != null ? (
          <span className="font-semibold text-[var(--lichen)]" title={`staged · was ${draft.from}`}>
            {draft.staged}
          </span>
        ) : draft?.proposal != null ? (
          <span
            className="font-semibold text-[var(--pe-blue)]"
            title={`proposal · was ${draft.from}`}
          >
            {draft.proposal}
          </span>
        ) : (
          <span className={value == null ? "text-[var(--slate)]/40" : ""}>{value ?? "·"}</span>
        )}
      </td>
    );
  };

  /** Collapsed family: one summary cell per column — consensus value, or the spread. */
  const renderSummaryCell = (fam: FamilySnap, famRows: RowRef[], param: string) => {
    const values = famRows.map((r) => lens.valueOf(r, param)).filter((v): v is string => v != null);
    const distinct = Array.from(new Set(values));
    const colHot = reticle?.param === param;
    return (
      <td
        key={param}
        className={`border-b border-r border-[var(--line-soft)] px-1.5 py-0.5 font-mono text-[10px] tabular-nums ${
          colHot ? "bg-[var(--pe-blue)]/[0.07]" : ""
        }`}
        title={
          distinct.length > 1
            ? famRows.map((r) => `${r.typeName}: ${lens.valueOf(r, param) ?? "—"}`).join("\n")
            : undefined
        }
      >
        {distinct.length === 0 ? (
          <span className="text-[var(--slate)]/40">·</span>
        ) : distinct.length === 1 ? (
          <span className="text-[var(--slate)]">{distinct[0]}</span>
        ) : (
          <span className="text-[var(--kiln)]">≠{distinct.length}</span>
        )}
      </td>
    );
  };

  return (
    <div>
      <div
        ref={containerRef}
        className="relative max-h-[58vh] overflow-auto rounded-[2px] border border-[var(--line)]"
        onMouseLeave={() => setReticle(null)}
      >
        <table className="w-full border-collapse text-[11px]">
          <thead className="sticky top-0 z-10 bg-[var(--paper)]">
            <tr>
              <th className="sticky left-0 z-20 border-b border-r border-[var(--line-2)] bg-[var(--paper)] px-2 py-1 text-left">
                <span className="tele-label text-[9px] text-[var(--slate)]">family / type</span>
              </th>
              {pinned.map((param) => {
                const isSort = sort?.param === param;
                const hot = lens.hoverParam === param || reticle?.param === param;
                return (
                  <th
                    key={param}
                    onClick={() =>
                      setSort(
                        isSort && sort.dir === 1
                          ? { param, dir: -1 }
                          : isSort
                            ? null
                            : { param, dir: 1 },
                      )
                    }
                    onMouseEnter={() => lens.setHoverParam(param)}
                    onMouseLeave={() => lens.setHoverParam(null)}
                    className={`min-w-[76px] cursor-pointer border-b border-r border-[var(--line-soft)] px-1.5 py-1 text-left align-bottom ${
                      hot ? "bg-[var(--pe-blue)]/10" : ""
                    }`}
                    title={`${param} — click to sort${isSort ? (sort.dir === 1 ? " (asc)" : " (desc)") : ""}`}
                  >
                    <span className="block max-w-[110px] truncate text-[10px] font-semibold text-[var(--clay-ink)]">
                      {param}
                      {isSort && (
                        <span className="ml-0.5 text-[var(--pe-blue)]">
                          {sort.dir === 1 ? "↑" : "↓"}
                        </span>
                      )}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sort
              ? // sorted: flat rows across families, grouping dissolved
                sortedRows.map((row) => (
                  <tr key={row.key} className="group">
                    <td
                      className={`sticky left-0 z-10 max-w-[190px] truncate border-b border-r border-[var(--line-soft)] bg-[var(--paper)] px-2 py-0.5 ${
                        reticle?.rowKey === row.key ? "!bg-[var(--pe-blue)]/10" : ""
                      }`}
                      title={`${row.familyName} · ${row.typeName}`}
                    >
                      <span className="font-medium text-[var(--clay-ink)]">
                        {row.familyName.replace(/^PE /, "")}{" "}
                      </span>
                      <span className="font-mono text-[10px] text-[var(--slate)]">
                        {row.typeName}
                      </span>
                    </td>
                    {pinned.map((param) => renderCell(row, param))}
                  </tr>
                ))
              : // grouped: family header rows with collapse, type rows with per-row hide
                snapshot.map((fam) => {
                  const famRows = rows.filter((r) => r.familyId === fam.id);
                  const visibleRows = famRows.filter((r) => !hiddenRows.has(r.key));
                  const hiddenCount = famRows.length - visibleRows.length;
                  const isCollapsed = collapsed.has(fam.id);
                  return (
                    <Fragment key={fam.id}>
                      <tr className="bg-[var(--paper-2)]/60">
                        <td className="sticky left-0 z-10 border-b border-r border-[var(--line-soft)] bg-[var(--paper-2)] px-1 py-0.5">
                          <button
                            type="button"
                            onClick={() => toggleFamily(fam.id)}
                            className="flex w-full items-center gap-1 text-left"
                            title={isCollapsed ? "Expand types" : "Collapse to summary row"}
                          >
                            <span className="w-3 text-center font-mono text-[9px] text-[var(--slate)]">
                              {isCollapsed ? "▸" : "▾"}
                            </span>
                            <span className="min-w-0 truncate font-medium text-[var(--clay-ink)]">
                              {fam.name.replace(/^PE /, "")}
                            </span>
                            <span className="ml-auto shrink-0 font-mono text-[9px] text-[var(--slate)]">
                              {fam.types.length}t
                            </span>
                            {hiddenCount > 0 && (
                              <span
                                onClick={(e) => {
                                  e.stopPropagation();
                                  restoreFamilyRows(fam.id);
                                }}
                                className="shrink-0 cursor-pointer font-mono text-[9px] text-[var(--kiln)] hover:underline"
                                title={`${hiddenCount} hidden row${hiddenCount === 1 ? "" : "s"} — click to restore`}
                                role="button"
                              >
                                +{hiddenCount}
                              </span>
                            )}
                          </button>
                        </td>
                        {isCollapsed
                          ? pinned.map((param) => renderSummaryCell(fam, famRows, param))
                          : pinned.map((param) => (
                              <td
                                key={param}
                                className={`border-b border-r border-[var(--line-soft)] ${
                                  reticle?.param === param ? "bg-[var(--pe-blue)]/[0.07]" : ""
                                }`}
                              />
                            ))}
                      </tr>
                      {!isCollapsed &&
                        visibleRows.map((row) => (
                          <tr key={row.key} className="group">
                            <td
                              className={`sticky left-0 z-10 border-b border-r border-[var(--line-soft)] bg-[var(--paper)] py-0.5 pl-5 pr-1 ${
                                reticle?.rowKey === row.key ? "!bg-[var(--pe-blue)]/10" : ""
                              }`}
                              title={`${row.familyName} · ${row.typeName}`}
                            >
                              <span className="flex items-center gap-1">
                                <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-[var(--slate)]">
                                  {row.typeName}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => hideRow(row.key)}
                                  className="shrink-0 rounded-[2px] px-1 font-mono text-[9px] text-[var(--slate)] opacity-0 transition-opacity hover:text-[var(--kiln)] group-hover:opacity-100"
                                  title="Hide this row (restore from the family header)"
                                >
                                  –
                                </button>
                              </span>
                            </td>
                            {pinned.map((param) => renderCell(row, param))}
                          </tr>
                        ))}
                    </Fragment>
                  );
                })}
          </tbody>
        </table>
      </div>

      {/* the reticle HUD — row × column names ride the cursor so eyes never leave the cell */}
      {reticle && !editing && (
        <div
          className="pointer-events-none fixed z-50 rounded-[2px] border border-[var(--line-2)] bg-[var(--paper)] px-2 py-1 shadow-md"
          style={{ left: reticle.x + 14, top: reticle.y + 18 }}
        >
          {(() => {
            const row = rows.find((r) => r.key === reticle.rowKey);
            if (!row) return null;
            const value = lens.valueOf(row, reticle.param);
            const draft = drafts[cellKey(row, reticle.param)];
            return (
              <>
                <p className="text-[10px] font-medium text-[var(--clay-ink)]">
                  {row.familyName} <span className="text-[var(--slate)]">· {row.typeName}</span>
                </p>
                <p className="font-mono text-[10px]">
                  <span className="text-[var(--lichen)]">{reticle.param}</span>{" "}
                  <span className="text-[var(--slate)]">=</span>{" "}
                  {draft?.proposal ?? draft?.staged ?? value ?? "not on this family"}
                  {draft && (
                    <span
                      className={draft.staged ? "text-[var(--lichen)]" : "text-[var(--pe-blue)]"}
                    >
                      {" "}
                      · {draft.staged ? "staged" : "proposal"} (was {draft.from})
                    </span>
                  )}
                </p>
              </>
            );
          })()}
        </div>
      )}

      <p className="mt-1 text-[10px] text-[var(--slate)]">
        crosshair + HUD = the reticle · click a cell to edit — an edit is a{" "}
        <span className="font-semibold text-[var(--pe-blue)]">proposal</span>, never a write · ▾
        collapses a family to its consensus row (<span className="text-[var(--kiln)]">≠n</span> =
        types disagree) · row hover reveals <span className="font-mono">–</span> to tuck a single
        row · column header sorts (sorting dissolves grouping, deliberately)
      </p>
    </div>
  );
}

// ═══════════════════════════════ REVIEW DOCK — trichotomy ═══════════════════════════════════════
function ReviewDock({ lens }: { lens: LensState }) {
  const open = Object.values(lens.drafts).filter((d) => d.proposal != null && d.staged == null);
  const staged = Object.values(lens.drafts).filter((d) => d.staged != null);
  const approve = (key: string) =>
    lens.setDrafts((prev) => ({
      ...prev,
      [key]: { ...prev[key], staged: prev[key].proposal, proposal: undefined },
    }));
  const deny = (key: string) =>
    lens.setDrafts((prev) => {
      const rest = { ...prev };
      delete rest[key];
      return rest;
    });

  if (open.length === 0 && staged.length === 0)
    return (
      <p className="rounded-[2px] border border-dashed border-[var(--line)] px-3 py-2 text-[10px] text-[var(--slate)]">
        no drafts — edit a cell above and it lands here for review. Pea can propose; only you can
        push.
      </p>
    );

  return (
    <div className="rounded-[2px] border border-[var(--line)] bg-[var(--paper)] px-3 py-2">
      <div className="space-y-1">
        {Object.entries(lens.drafts).map(([key, draft]) => (
          <div key={key} className="flex items-center gap-2 text-xs">
            <span className="min-w-0 flex-1 truncate text-[10px]" title={draft.rowLabel}>
              <span className="font-medium">{draft.param}</span>{" "}
              <span className="text-[var(--slate)]">· {draft.rowLabel}</span>
            </span>
            <span className="font-mono text-[10px] tabular-nums">
              <span className="text-[var(--slate)] line-through opacity-70">
                {draft.from || "—"}
              </span>
              <span className="mx-1 text-[var(--lichen)]">→</span>
              <span className="text-[var(--clay-ink)]">{draft.staged ?? draft.proposal}</span>
            </span>
            {draft.staged == null ? (
              <>
                <button
                  type="button"
                  onClick={() => approve(key)}
                  className="rounded-[2px] border border-[var(--lichen)]/50 px-1.5 py-px text-[10px] text-[var(--lichen)] hover:bg-[var(--lichen)]/10"
                >
                  approve
                </button>
                <button
                  type="button"
                  onClick={() => deny(key)}
                  className="rounded-[2px] border border-[var(--line)] px-1.5 py-px text-[10px] text-[var(--slate)] hover:text-[var(--fail)]"
                >
                  deny
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => deny(key)}
                className="rounded-[2px] border border-[var(--line)] px-1.5 py-px text-[10px] text-[var(--slate)]"
              >
                undo
              </button>
            )}
          </div>
        ))}
      </div>
      {staged.length > 0 && (
        <button
          type="button"
          onClick={lens.push}
          className="mt-2 w-full rounded-[2px] border border-[var(--pe-blue)] bg-[var(--pe-blue)]/10 py-1 text-[11px] font-semibold text-[var(--pe-blue)] hover:bg-[var(--pe-blue)]/20"
        >
          Push {staged.length} to Revit
        </button>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════ PAGE ═══════════════════════════════════════════════
function Page() {
  const lens = useLens();
  const open = Object.values(lens.drafts).filter(
    (d) => d.proposal != null && d.staged == null,
  ).length;
  const staged = Object.values(lens.drafts).filter((d) => d.staged != null).length;
  const pushedCount = Object.keys(lens.pushed).length;
  const visibleRows = lens.rows.length - lens.hiddenRows.size;

  return (
    <main className="min-h-screen bg-[var(--paper)] text-[var(--foreground)]">
      <div className="mx-auto max-w-[1160px] px-5 py-6">
        <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="tele-label text-[10px] tracking-[0.3em] text-[var(--clay-ink)]">
              POC / FAMILY LENS — PLUGIN SHAPE
            </p>
            <h1 className="mt-1 text-xl font-semibold tracking-tight">Reticle grid workspace</h1>
            <p className="mt-1 max-w-3xl text-[12px] leading-relaxed text-[var(--slate)]">
              The plugin as it would ship: the grid is the surface, curation lives behind the lens
              button, drafts review in the dock. Same state model — snapshot + lens + drafts.
            </p>
          </div>
          <ThemeToggle />
        </header>

        {/* toolbar — the plugin's control row */}
        <div className="sticky top-0 z-30 mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[2px] border border-[var(--line)] bg-[var(--paper)]/95 px-3 py-1.5 text-[11px] backdrop-blur">
          <span className="font-medium text-[var(--clay-ink)]">
            Air Terminals
            <span className="tele-label ml-1.5 font-normal text-[var(--lichen)]">
              {lens.snapshot.length} families · {visibleRows}/{lens.rows.length} rows
            </span>
          </span>
          <LensPopover lens={lens} />
          <span className="ml-auto flex items-center gap-3 font-mono tabular-nums">
            <span className={open ? "text-[var(--pe-blue)]" : "text-[var(--slate)]/60"}>
              {open} <span className="font-sans text-[var(--slate)]">proposals</span>
            </span>
            <span className={staged ? "text-[var(--lichen)]" : "text-[var(--slate)]/60"}>
              {staged} <span className="font-sans text-[var(--slate)]">staged</span>
            </span>
            {pushedCount > 0 && (
              <span className="text-[var(--clay-ink)]">
                {pushedCount} <span className="font-sans text-[var(--slate)]">pushed</span>
              </span>
            )}
          </span>
        </div>

        <ReticleGrid lens={lens} />

        <div className="mt-3">
          <ReviewDock lens={lens} />
        </div>

        <p className="mt-4 text-[10px] leading-relaxed text-[var(--slate)]">
          <span className="tele-label mr-2 text-[9px] text-[var(--kiln)]">OPEN</span>
          named lenses per category · host scope flags for locked cells · real push as a batched
          host operation with freshness guard · collapse/hidden state persisting with the lens in
          route state
        </p>
      </div>
    </main>
  );
}
