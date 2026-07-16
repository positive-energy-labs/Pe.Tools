import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";

import { ThemeToggle } from "#/components/ThemeToggle";

export const Route = createFileRoute("/poc/family-lens")({ component: Page });

/* ------------------------------------------------------------------------------------------------
 * POC: the family-matrix replacement, docs/target style — one state model, four exhibits.
 *   The problem: 800 parameters across a category, ~100 matter, and "the view you want"
 *   is itself state nobody stores. So the LENS is the state model:
 *     Snapshot (read-only)  families × types × params, as read from the host
 *     Lens                  ordered pinned params + muted set — curation as first-class state
 *     Drafts                cell trichotomy proposal → staged → push (schedule-grid shape)
 *   Every exhibit reads AND writes the same lens + drafts; hover a param anywhere and it
 *   lights everywhere. Self-contained; mock category stands in for the host matrix call.
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
  { name: "Air Flow", kind: "shared", gen: (f, t) => `${(hash(f + t) % 14 + 2) * 25} CFM` },
  { name: "Max Flow", kind: "shared", gen: (f, t) => `${(hash(f + t) % 14 + 6) * 50} CFM` },
  { name: "Min Flow", kind: "shared", gen: (f, t) => `${(hash(f + t) % 6 + 1) * 25} CFM` },
  { name: "Neck Size", kind: "shared", gen: (f, t) => `${(hash(t) % 5 + 3) * 2}"ø` },
  { name: "Face Width", kind: "family", gen: (f, t) => `${(hash(f + t) % 4 + 1) * 6}in` },
  { name: "Face Height", kind: "family", gen: (f, t) => `${(hash(t + f) % 3 + 1) * 6}in` },
  { name: "Static Pressure", kind: "shared", gen: (f, t) => `0.${hash(f + t) % 8 + 1}0 in-wg` },
  { name: "NC Rating", kind: "shared", gen: (f, t) => `NC-${(hash(t + "nc") % 5 + 3) * 5}` },
  { name: "Mounting", kind: "family", gen: (f) => (hash(f) % 2 ? "Lay-in" : "Surface") },
  { name: "Frame Type", kind: "family", gen: (f) => ["Type A", "Type B", "Beveled"][hash(f) % 3] },
  { name: "Finish", kind: "shared", gen: (f) => (hash(f + "fin") % 3 ? "White" : "Mill") },
  { name: "Material", kind: "shared", gen: () => "Steel" },
  { name: "Manufacturer", kind: "shared", gen: (f) => ["Price", "Titus", "Krueger"][hash(f) % 3] },
  { name: "Model", kind: "shared", gen: (f) => `${["SPD", "TMS", "PAS"][hash(f) % 3]}-${hash(f) % 90 + 10}` },
  { name: "Damper", kind: "family", gen: (f) => (hash(f + "d") % 2 ? "Opposed Blade" : "None") },
  { name: "Border Width", kind: "family", gen: (f) => `${hash(f + "b") % 2 + 1}in` },
  { name: "Duct Width", kind: "family", gen: (f, t) => `${(hash(t + "dw") % 4 + 2) * 4}in` },
  { name: "Duct Height", kind: "family", gen: (f, t) => `${(hash(t + "dh") % 3 + 2) * 4}in` },
  { name: "Weight", kind: "shared", gen: (f, t) => `${hash(f + t + "w") % 20 + 4} lb` },
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
  "Price_ProductLine", "Price_SortOrder", "Ti_Legacy Code", "Ti_Do Not Use", "kr_OldFlow",
  "zzz_Temp Calc", "Cost 2019", "Keynote_OLD", "Lead Time (wks)", "Rep Contact",
  "Submittal Ref", "CAD Block Name", "Spec Section", "Warranty Note", "Color Code Int",
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
      const constant = `${hash(pname) % 900 + 100}`;
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
  const map = new Map<string, { kind: ParamKind; fams: number; vals: Set<string>; cells: number }>();
  for (const fam of snapshot) {
    for (const [param, perType] of Object.entries(fam.values)) {
      const entry = map.get(param) ?? { kind: fam.kinds[param], fams: 0, vals: new Set(), cells: 0 };
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
  pushed: Record<CellKey, string>; // "Revit" after push — overlays the snapshot
  hoverParam: string | null;
  setPinned: (next: string[]) => void;
  setMuted: (next: Set<string>) => void;
  setDrafts: (fn: (d: Drafts) => Drafts) => void;
  setHoverParam: (p: string | null) => void;
  push: () => void;
  valueOf: (row: RowRef, param: string) => string | null;
}

function useLens(): LensState {
  const snapshot = useMemo(buildSnapshot, []);
  const stats = useMemo(() => computeStats(snapshot), [snapshot]);
  const rows = useMemo(() => rowsOf(snapshot), [snapshot]);
  const [pinned, setPinned] = useState<string[]>(() =>
    stats.filter((s) => s.kind !== "vendor").slice(0, 10).map((s) => s.name),
  );
  const [muted, setMuted] = useState<Set<string>>(new Set());
  const [drafts, setDraftsRaw] = useState<Drafts>({});
  const [pushed, setPushed] = useState<Record<CellKey, string>>({});
  const [hoverParam, setHoverParam] = useState<string | null>(null);

  const valueOf = (row: RowRef, param: string): string | null => {
    const key = cellKey(row, param);
    if (pushed[key] != null) return pushed[key];
    const fam = snapshot.find((f) => f.id === row.familyId);
    return fam?.values[param]?.[row.typeName] ?? null;
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
    snapshot, stats, rows, pinned, muted, drafts, pushed, hoverParam,
    setPinned, setMuted,
    setDrafts: (fn) => setDraftsRaw(fn),
    setHoverParam, push, valueOf,
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

function PluginCard({
  mvp,
  action,
  hint,
  children,
}: {
  mvp: string;
  action: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-[2px] border border-[var(--line)] bg-[var(--paper)] px-3 py-2.5 text-xs shadow-sm">
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-semibold text-[var(--clay-ink)]">Family Lens · {mvp}</span>
        <span className="tele-label text-[var(--lichen)]">{action}</span>
      </div>
      <div className="mt-2">{children}</div>
      <div className="mt-2 border-t border-[var(--line-soft)] pt-1.5 text-[10px] text-[var(--slate)]">
        {hint}
      </div>
    </div>
  );
}

function SectionIntro({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <p className="tele-label text-[11px] tracking-[0.22em] text-[var(--clay-ink)]">{title}</p>
      <p className="mt-1 max-w-3xl text-[13px] leading-relaxed text-[var(--slate)]">{children}</p>
    </div>
  );
}

// ════════════════════════════════════ EXHIBIT 1 — SIGNAL TRIAGE ═════════════════════════════════
function SignalTriage({ lens }: { lens: LensState }) {
  const [query, setQuery] = useState("");
  const { stats, pinned, muted } = lens;
  const totalFamilies = lens.snapshot.length;

  const visible = stats.filter(
    (s) =>
      !pinned.includes(s.name) &&
      !muted.has(s.name) &&
      (query === "" || s.name.toLowerCase().includes(query.toLowerCase())),
  );
  const pin = (name: string) => lens.setPinned([...pinned, name]);
  const unpin = (name: string) => lens.setPinned(pinned.filter((p) => p !== name));
  const mute = (name: string) => lens.setMuted(new Set([...muted, name]));
  const autoLens = () =>
    lens.setPinned(stats.filter((s) => s.kind !== "vendor" && s.distinct > 1).slice(0, 15).map((s) => s.name));
  const muteConstants = () =>
    lens.setMuted(new Set([...muted, ...stats.filter((s) => s.distinct <= 1).map((s) => s.name)]));

  return (
    <div className="grid gap-3 lg:grid-cols-[1fr_270px]">
      {/* ranked ladder */}
      <div>
        <div className="mb-1.5 flex flex-wrap items-center gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${stats.length} parameters…`}
            className="w-52 rounded-[2px] border border-[var(--line-2)] bg-transparent px-1.5 py-0.5 text-[11px] outline-none focus:border-[var(--pe-blue)]"
          />
          <button
            type="button"
            onClick={autoLens}
            className="rounded-[2px] border border-[var(--line)] px-1.5 py-0.5 text-[10px] hover:border-[var(--pe-blue)]"
          >
            auto-lens · top 15 by signal
          </button>
          <button
            type="button"
            onClick={muteConstants}
            className="rounded-[2px] border border-[var(--line)] px-1.5 py-0.5 text-[10px] hover:border-[var(--kiln)]"
          >
            mute all constants
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
        <div className="max-h-72 overflow-y-auto rounded-[2px] border border-[var(--line)]">
          {visible.map((s) => (
            <div
              key={s.name}
              onMouseEnter={() => lens.setHoverParam(s.name)}
              onMouseLeave={() => lens.setHoverParam(null)}
              className={`flex items-center gap-2 border-b border-[var(--line-soft)] px-2 py-1 ${
                lens.hoverParam === s.name ? "bg-[var(--pe-blue)]/5" : ""
              }`}
            >
              <KindDot kind={s.kind} />
              <span className="w-44 truncate text-[11px]" title={s.name}>
                {s.name}
              </span>
              {/* coverage bar */}
              <span className="flex h-2 w-16 shrink-0 rounded-[1px] bg-[var(--line-soft)]" title={`in ${s.familiesWith}/${totalFamilies} families`}>
                <span
                  className="h-2 rounded-[1px] bg-[var(--lichen)]/60"
                  style={{ width: `${s.coverage * 100}%` }}
                />
              </span>
              <span className="w-14 shrink-0 font-mono text-[9px] text-[var(--slate)]" title="distinct values / cells">
                {s.distinct}v/{s.cells}c
              </span>
              <span
                className={`w-8 shrink-0 text-right font-mono text-[10px] tabular-nums ${
                  s.score > 60 ? "text-[var(--clay-ink)]" : "text-[var(--slate)]/60"
                }`}
                title="signal = variance across types × coverage across families"
              >
                {s.score}
              </span>
              <button
                type="button"
                onClick={() => pin(s.name)}
                className="rounded-[2px] px-1 text-[10px] text-[var(--pe-blue)] hover:bg-[var(--pe-blue)]/10"
              >
                pin ▸
              </button>
              <button
                type="button"
                onClick={() => mute(s.name)}
                className="rounded-[2px] px-1 text-[10px] text-[var(--slate)]/60 hover:text-[var(--kiln)]"
                title="Mute — drop from triage; nothing is deleted"
              >
                mute
              </button>
            </div>
          ))}
          {visible.length === 0 && (
            <p className="px-2 py-3 text-[11px] text-[var(--slate)]">
              nothing left to triage — everything is pinned, muted, or filtered
            </p>
          )}
        </div>
      </div>

      {/* the lens itself */}
      <div>
        <p className="tele-label mb-1 text-[9px] text-[var(--lichen)]">
          the lens · ordered, stored, shareable
        </p>
        <div className="space-y-1 rounded-[2px] border border-[var(--pe-blue)]/40 bg-[var(--pe-blue)]/[0.03] p-2">
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
                <span className="w-4 font-mono text-[9px] text-[var(--slate)]">{i + 1}</span>
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
          {pinned.length} pinned of {stats.length} discovered · {muted.size} muted. The lens is what
          Pea saves, what a teammate opens, and what the grid below renders — column order included.
        </p>
      </div>
    </div>
  );
}

// ════════════════════════════════════ EXHIBIT 2 — RETICLE GRID ══════════════════════════════════
interface Reticle {
  rowKey: string;
  param: string;
  x: number;
  y: number;
}

function ReticleGrid({ lens }: { lens: LensState }) {
  const { rows, pinned, drafts } = lens;
  const [reticle, setReticle] = useState<Reticle | null>(null);
  const [editing, setEditing] = useState<{ key: CellKey; draft: string } | null>(null);
  const [sort, setSort] = useState<{ param: string; dir: 1 | -1 } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const sortedRows = useMemo(() => {
    if (!sort) return rows;
    return [...rows].sort((a, b) => {
      const va = lens.valueOf(a, sort.param) ?? "";
      const vb = lens.valueOf(b, sort.param) ?? "";
      const na = Number.parseFloat(va);
      const nb = Number.parseFloat(vb);
      const cmp =
        !Number.isNaN(na) && !Number.isNaN(nb) ? na - nb : va.localeCompare(vb);
      return cmp * sort.dir;
    });
  }, [rows, sort, lens]);

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

  return (
    <div>
      <div
        ref={containerRef}
        className="relative max-h-[420px] overflow-auto rounded-[2px] border border-[var(--line)]"
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
                      setSort(isSort && sort.dir === 1 ? { param, dir: -1 } : isSort ? null : { param, dir: 1 })
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
                        <span className="ml-0.5 text-[var(--pe-blue)]">{sort.dir === 1 ? "↑" : "↓"}</span>
                      )}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row) => {
              const rowHot = reticle?.rowKey === row.key;
              return (
                <tr
                  key={row.key}
                  className={`${!sort && row.firstInFamily ? "border-t border-[var(--line-2)]" : ""}`}
                >
                  <td
                    className={`sticky left-0 z-10 max-w-[190px] truncate border-b border-r border-[var(--line-soft)] bg-[var(--paper)] px-2 py-0.5 ${
                      rowHot ? "!bg-[var(--pe-blue)]/10" : ""
                    }`}
                    title={`${row.familyName} · ${row.typeName}`}
                  >
                    {(sort || row.firstInFamily) && (
                      <span className="font-medium text-[var(--clay-ink)]">
                        {row.familyName.replace(/^PE /, "")}{" "}
                      </span>
                    )}
                    <span className="font-mono text-[10px] text-[var(--slate)]">{row.typeName}</span>
                  </td>
                  {pinned.map((param) => {
                    const key = cellKey(row, param);
                    const value = lens.valueOf(row, param);
                    const draft = drafts[key];
                    const colHot = reticle?.param === param;
                    const isEditing = editing?.key === key;
                    return (
                      <td
                        key={param}
                        onMouseMove={(e) =>
                          setReticle({ rowKey: row.key, param, x: e.clientX, y: e.clientY })
                        }
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
                          <span className="font-semibold text-[var(--pe-blue)]" title={`proposal · was ${draft.from}`}>
                            {draft.proposal}
                          </span>
                        ) : (
                          <span className={value == null ? "text-[var(--slate)]/40" : ""}>
                            {value ?? "·"}
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
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
                    <span className={draft.staged ? "text-[var(--lichen)]" : "text-[var(--pe-blue)]"}>
                      {" "}· {draft.staged ? "staged" : "proposal"} (was {draft.from})
                    </span>
                  )}
                </p>
              </>
            );
          })()}
        </div>
      )}

      <p className="mt-1 text-[10px] text-[var(--slate)]">
        crosshair tint = the reticle's row and column · click any cell to edit — an edit is a{" "}
        <span className="font-semibold text-[var(--pe-blue)]">proposal</span>, never a write · click a
        column header to sort (sorting dissolves family grouping, deliberately)
      </p>
    </div>
  );
}

// ═══════════════════════════════════ EXHIBIT 3 — VALUE STRIPS ═══════════════════════════════════
function ValueStrips({ lens }: { lens: LensState }) {
  const { rows, pinned } = lens;
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <div className="space-y-1">
      {pinned.map((param) => {
        const groups = new Map<string, RowRef[]>();
        let missing = 0;
        for (const row of rows) {
          const v = lens.valueOf(row, param);
          if (v == null) {
            missing++;
            continue;
          }
          groups.set(v, [...(groups.get(v) ?? []), row]);
        }
        const sorted = Array.from(groups.entries()).sort((a, b) => b[1].length - a[1].length);
        const isOpen = expanded === param;
        return (
          <div
            key={param}
            onMouseEnter={() => lens.setHoverParam(param)}
            onMouseLeave={() => lens.setHoverParam(null)}
            className={`rounded-[2px] border px-2 py-1 ${
              lens.hoverParam === param ? "border-[var(--pe-blue)]/50 bg-[var(--pe-blue)]/[0.03]" : "border-[var(--line)]"
            }`}
          >
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setExpanded(isOpen ? null : param)}
                className="w-40 shrink-0 truncate text-left text-[11px] font-medium hover:text-[var(--pe-blue)]"
                title={param}
              >
                {param}
              </button>
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
                {sorted.map(([value, members]) => {
                  const outlier = members.length === 1 && sorted.length > 1;
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
                {missing > 0 && (
                  <span className="font-mono text-[9px] text-[var(--slate)]/60">∅×{missing}</span>
                )}
              </div>
              <span className="shrink-0 font-mono text-[9px] text-[var(--slate)]">
                {sorted.length} value{sorted.length === 1 ? "" : "s"}
              </span>
            </div>
            {isOpen && (
              <div className="mt-1 space-y-0.5 border-t border-[var(--line-soft)] pt-1">
                {sorted.map(([value, members]) => (
                  <p key={value} className="text-[10px] text-[var(--slate)]">
                    <span className="font-mono text-[var(--clay-ink)]">{value}</span> —{" "}
                    {members.map((m) => `${m.familyName.replace(/^PE /, "")} ${m.typeName}`).join(", ")}
                  </p>
                ))}
              </div>
            )}
          </div>
        );
      })}
      {pinned.length === 0 && (
        <p className="rounded-[2px] border border-dashed border-[var(--line)] py-4 text-center text-[11px] text-[var(--slate)]">
          the strips render the lens — pin parameters in the triage above
        </p>
      )}
    </div>
  );
}

// ═══════════════════════════════ EXHIBIT 4 — CHAT PLUGIN CARD ═══════════════════════════════════
function ChatCard({ lens }: { lens: LensState }) {
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

  return (
    <div className="mx-auto max-w-xl">
      {/* the compact inline card, schedule-grid shape */}
      <div className="rounded-[2px] border border-[var(--line)] bg-[var(--paper)] px-3 py-2 text-xs shadow-sm">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="font-medium text-[var(--clay-ink)]">
            Air Terminals
            <span className="tele-label ml-1.5 font-normal text-[var(--lichen)]">
              {lens.rows.length} types · lens {lens.pinned.length}/{lens.stats.length}
            </span>
          </span>
          <span>
            <b className={open.length ? "text-[var(--pe-blue)]" : ""}>{open.length}</b>{" "}
            <span className="text-[var(--slate)]">open proposals</span>
          </span>
          <span>
            <b className={staged.length ? "text-[var(--lichen)]" : ""}>{staged.length}</b>{" "}
            <span className="text-[var(--slate)]">staged</span>
          </span>
          <span className="ml-auto font-medium text-[var(--pe-blue)]">Open workspace</span>
        </div>

        {/* the review dock — every draft as current → proposed, human-actor writes only */}
        {(open.length > 0 || staged.length > 0) && (
          <div className="mt-2 space-y-1 border-t border-[var(--line-soft)] pt-2">
            {Object.entries(lens.drafts).map(([key, draft]) => (
              <div key={key} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-[10px]" title={draft.rowLabel}>
                  <span className="font-medium">{draft.param}</span>{" "}
                  <span className="text-[var(--slate)]">· {draft.rowLabel}</span>
                </span>
                <span className="font-mono text-[10px] tabular-nums">
                  <span className="text-[var(--slate)] line-through opacity-70">{draft.from || "—"}</span>
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
            {staged.length > 0 && (
              <button
                type="button"
                onClick={lens.push}
                className="mt-1 w-full rounded-[2px] border border-[var(--pe-blue)] bg-[var(--pe-blue)]/10 py-1 text-[11px] font-semibold text-[var(--pe-blue)] hover:bg-[var(--pe-blue)]/20"
              >
                Push {staged.length} to Revit
              </button>
            )}
          </div>
        )}
        {open.length === 0 && staged.length === 0 && (
          <p className="mt-1.5 text-[10px] text-[var(--slate)]">
            no drafts — edit a cell in the reticle grid and it lands here for review
          </p>
        )}
      </div>
      <p className="mt-1.5 text-center text-[10px] text-[var(--slate)]">
        Pea can propose; only you can push. Same trichotomy, same dock, as the schedule-grid plugin.
      </p>
    </div>
  );
}

// ═══════════════════════════════════════════ PAGE ═══════════════════════════════════════════════
function Page() {
  const lens = useLens();
  const open = Object.values(lens.drafts).filter((d) => d.proposal != null && d.staged == null).length;
  const staged = Object.values(lens.drafts).filter((d) => d.staged != null).length;
  const pushedCount = Object.keys(lens.pushed).length;

  return (
    <main className="min-h-screen bg-[var(--paper)] text-[var(--foreground)]">
      <div className="mx-auto max-w-[1160px] px-5 py-6">
        <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="tele-label text-[10px] tracking-[0.3em] text-[var(--clay-ink)]">
              POC / FAMILY LENS — THE FAMILY-MATRIX REPLACEMENT
            </p>
            <h1 className="mt-1 text-xl font-semibold tracking-tight">
              The lens is the state, the grid is a projection
            </h1>
            <p className="mt-2 max-w-3xl text-[13px] leading-relaxed text-[var(--slate)]">
              A category matrix has hundreds of parameters and a hundred that matter — and today
              the view you curate to see them evaporates on reload. So this model stores three
              things: a read-only <b>snapshot</b>, a <b>lens</b> (ordered pinned params + muted
              set), and cell <b>drafts</b> (proposal → staged → push). Every exhibit below reads
              and writes the same lens and drafts; hover a parameter anywhere and it lights
              everywhere. The mock category stands in for the host matrix call — the shape is the
              contract, not the data.
            </p>
          </div>
          <ThemeToggle />
        </header>

        {/* shared readout — the one resolution every exhibit derives from */}
        <div className="sticky top-0 z-30 mb-5 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-[2px] border border-[var(--line)] bg-[var(--paper)]/95 px-3 py-2 text-[11px] backdrop-blur">
          <span className="tele-label text-[9px] text-[var(--slate)]">lens</span>
          <span className="font-mono tabular-nums">
            {lens.pinned.length}<span className="text-[var(--slate)]">/{lens.stats.length} params</span>
          </span>
          <span className="font-mono tabular-nums">
            {lens.rows.length}<span className="text-[var(--slate)]"> rows</span>
          </span>
          <span className="font-mono tabular-nums text-[var(--pe-blue)]">
            {open}<span className="text-[var(--slate)]"> proposals</span>
          </span>
          <span className="font-mono tabular-nums text-[var(--lichen)]">
            {staged}<span className="text-[var(--slate)]"> staged</span>
          </span>
          {pushedCount > 0 && (
            <span className="font-mono tabular-nums text-[var(--clay-ink)]">
              {pushedCount}<span className="text-[var(--slate)]"> pushed</span>
            </span>
          )}
          <span className="ml-auto text-[10px] text-[var(--slate)]">
            {lens.hoverParam ? (
              <>
                hover · <span className="font-mono text-[var(--pe-blue)]">{lens.hoverParam}</span>
              </>
            ) : (
              "hover a parameter in any exhibit"
            )}
          </span>
        </div>

        <section className="mb-8">
          <SectionIntro title="EXHIBIT 1 — SIGNAL TRIAGE">
            Picking 100 of 800 is a ranking problem, not a scrolling problem. Every discovered
            parameter gets a <b>signal score</b> — variance across types × coverage across
            families — so vendor leftovers that are constant everywhere sink to the bottom on
            their own. Pin what matters into the lens (ordered — the order is the column order),
            mute what never will. <i>auto-lens</i> is the one-click starting point; the lens is
            what Pea can save, propose changes to, and hand to a teammate.
          </SectionIntro>
          <PluginCard
            mvp="triage"
            action="Curate"
            hint="Muting hides from triage only — nothing is deleted, and the ladder re-ranks live as the snapshot changes."
          >
            <SignalTriage lens={lens} />
          </PluginCard>
        </section>

        <section className="mb-8">
          <SectionIntro title="EXHIBIT 2 — RETICLE GRID">
            The dense matrix, but only the lens wide — and with a <b>reticle</b>: the hovered
            cell's row and column tint as a crosshair, and a HUD rides the cursor naming the
            family · type and parameter under it, so your eyes never jump to the headers. Click a
            cell to edit; an edit is a <b>proposal</b>, drawn blue, and goes to the review dock —
            it never writes. Column-header click sorts rows by that parameter across all families.
          </SectionIntro>
          <PluginCard
            mvp="reticle"
            action="Compare + draft"
            hint="Grey hatched cells = parameter not on that family — absence is information, not an empty string."
          >
            <ReticleGrid lens={lens} />
          </PluginCard>
        </section>

        <section className="mb-8">
          <SectionIntro title="EXHIBIT 3 — VALUE STRIPS">
            Comparing 100 parameters isn't 100 columns — it's one row per parameter showing the{" "}
            <b>distribution</b> of its values across every type in the category. Consensus reads
            as one big chip; drift reads as many; a kiln chip is a lone outlier worth a look.
            Click a parameter name to see exactly which types hold each value. This is the
            "is this category consistent?" view the spreadsheet can never be.
          </SectionIntro>
          <PluginCard
            mvp="strips"
            action="Audit"
            hint="Strips render the same lens in the same order — reorder in the triage and this view follows."
          >
            <ValueStrips lens={lens} />
          </PluginCard>
        </section>

        <section className="mb-8">
          <SectionIntro title="EXHIBIT 4 — THE CHAT CARD">
            How this docks into chat, exactly like the schedule-grid plugin: a compact card naming
            the category and lens, counts for open proposals and staged cells, and the review dock
            listing every draft as a current → proposed diff. Approve stages; push writes staged
            cells to Revit and clears them. Edits you make in the reticle grid above land here
            live.
          </SectionIntro>
          <ChatCard lens={lens} />
        </section>

        <section className="mb-10">
          <SectionIntro title="THE LEDGER">
            What this POC claims and what it leaves open:
          </SectionIntro>
          <div className="space-y-1.5 text-[11px] leading-relaxed">
            <p>
              <span className="tele-label mr-2 text-[9px] text-[var(--lichen)]">CLAIM</span>
              The lens (pinned + order + muted) is route state, not component state — persisted,
              agent-readable, agent-proposable through the same route-state dispatcher as
              schedule-grid cells.
            </p>
            <p>
              <span className="tele-label mr-2 text-[9px] text-[var(--lichen)]">CLAIM</span>
              Signal scoring makes 800→100 a default, not a chore: variance × coverage is
              computable from the snapshot alone, no Revit semantics in the browser.
            </p>
            <p>
              <span className="tele-label mr-2 text-[9px] text-[var(--lichen)]">CLAIM</span>
              The reticle removes the eyes-jump tax of dense grids for free — it's pure hover
              state, no layout cost.
            </p>
            <p>
              <span className="tele-label mr-2 text-[9px] text-[var(--kiln)]">OPEN</span>
              Named lenses ("Mech QA", "Submittal check") saved per category — one more record in
              route state; not built here.
            </p>
            <p>
              <span className="tele-label mr-2 text-[9px] text-[var(--kiln)]">OPEN</span>
              Which cells are writable is host truth (formula-driven, read-only, type vs
              instance) — the real plugin must render locked cells from the snapshot's scope
              flags, as family-model does.
            </p>
            <p>
              <span className="tele-label mr-2 text-[9px] text-[var(--kiln)]">OPEN</span>
              Push here mutates a mock overlay; the real write is a host operation batched per
              family document, with the same freshness guard as schedule-grid push.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
