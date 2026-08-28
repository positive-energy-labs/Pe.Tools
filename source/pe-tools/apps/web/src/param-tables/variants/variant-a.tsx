import { token } from "#/lib/token";

/**
 * VARIANT A — "the table is the product; linking is a property of a cell."
 *
 * The page is a spreadsheet-grade grid editor. The user authors a freeform table
 * (col letters, row numbers, every data cell editable in place); ANY cell can be
 * plain text, a number, or LINKED — outbound ("this cell drives parameter P on
 * element-set S") or inbound ("this cell shows parameter P from element-set S").
 * Link state renders as CELL STATE (marks, squiggles, footline testimony), never
 * as extra columns — the pseudo-dimension law taken literally at cell scale.
 *
 * The write ceremony: an edit to an outbound cell stages a fan-out. The far side
 * (per-TYPE writes, tag counts, per-target refusals) is a standing strip under
 * the grid; the one blue Apply verb is enabled ONLY when that strip is showing
 * pending writes — "a bulk verb is disabled unless you can see its far side" is
 * satisfied by construction, not by discipline.
 *
 * Throwaway prototype (find-the-product round 1). No persistence, no host calls.
 */
import { useState } from "react";
import type { CSSProperties, ReactNode } from "react";

import { AddressingBar } from "#/components/lang/addressing-bar";
import { ArtifactFrame } from "#/components/lang/artifact-frame";
import { StateCell, cellFactsText, fmtNum } from "#/components/lang/cell";
import type { StateCellProps } from "#/components/lang/cell";
import { FactChip } from "#/components/lang/chip";
import { EmptyState } from "#/components/lang/empty";
import { HelpTip } from "#/components/lang/help";
import { OutcomeLine } from "#/components/lang/outcome";
import type { OutcomeKind } from "#/components/lang/outcome";
import { Verb } from "#/components/lang/verb";
import {
  BOD_MAIN_HOUSE,
  DEMO_LINK,
  FC_UNITS,
  FOM_HWCH_PLANT,
  PARAM_META,
} from "#/param-tables/variants/fixture";
import type { FcRow, ParamMeta } from "#/param-tables/variants/fixture";
import { Press } from "#/components/lang/press";

// ─── the cell model ─────────────────────────────────────────────────────────
// A link is a PROPERTY OF A CELL — one optional field, not a schema column.

type TableKey = "fom" | "bod";
type LinkDir = "out" | "in";

interface CellLink {
  dir: LinkDir;
  /** PARAM_META name. Target set is fixed in this proto: the 23 scheduled fan coils, by type. */
  param: string;
}

interface Cell {
  /** The authored text — for an outbound link, the value that drives the model. */
  text: string;
  /** Static chrome cells (headings/captions) are part of the authored table but not data. */
  kind?: "head" | "caption";
  /** Machine-measured literal — renders mono. */
  mono?: boolean;
  /** Present ⇒ numeric commit path (parse/refuse) with this display precision. */
  digits?: number;
  /** Outbound links: the last value the model was told. text ≠ authored ⇒ your unsaved edit. */
  authored?: string;
  link?: CellLink;
}

// ─── fixture-derived constants (computed once; no invented data) ────────────

const FOM_COLS = 11;
const BOD_COLS = 3;

/** The element set every link targets: the 23 scheduled fan coils, grouped by TYPE —
 * perf params live at type scope, so the type rows ARE the far side of a write. */
const TYPE_ROWS: { type: string; tags: string[] }[] = (() => {
  const seen = new Map<string, string[]>();
  for (const u of FC_UNITS) {
    const tags = seen.get(u.typeName);
    if (tags) tags.push(u.tag);
    else seen.set(u.typeName, [u.tag]);
  }
  return [...seen.entries()].map(([type, tags]) => ({ type, tags }));
})();

/** Fixture-header truth (untrusted positional correspondence made visible): MSVT18 is shared
 * by 14 tags model-wide while this schedule shows 13 — a type write hits the extra one too. */
const OFF_SCHEDULE_NOTE: Record<string, string> = {
  "Mortex MSVT18": "14 tags in the model — 13 on this schedule, 1 beyond it",
};

/** How each linkable (type-scope) parameter reads off a fixture row — the mock model's seed. */
const PARAM_VALUE: Record<string, (u: FcRow) => number> = {
  PE_M_PerfHeat_FluidEWT: (u) => u.heat.ewt,
  PE_M_PerfHeat_FluidLWT: (u) => u.heat.lwt,
  PE_M_PerfCool_FluidEWT: (u) => u.cool.ewt,
  PE_M_PerfCool_FluidLWT: (u) => u.cool.lwt,
  PE_M_PerfHeat_CapacityDesignTotal: (u) => u.heat.capTotal,
  PE_M_PerfCool_CapacityDesignTotal: (u) => u.cool.total,
};

const LINKABLE: ParamMeta[] = PARAM_META.filter((p) => PARAM_VALUE[p.name] != null);
const metaOf = (name: string): ParamMeta | undefined => PARAM_META.find((p) => p.name === name);

type Model = Record<string, Record<string, number>>;

function initModel(): Model {
  const m: Model = {};
  for (const u of FC_UNITS) {
    if (m[u.typeName] == null) {
      m[u.typeName] = Object.fromEntries(
        Object.entries(PARAM_VALUE).map(([name, read]) => [name, read(u)]),
      );
    }
  }
  return m;
}

// ─── the authored tables (in-memory; FOM open by default) ───────────────────

const pad = (cells: Cell[], cols: number): Cell[] => {
  while (cells.length < cols) cells.push({ text: "" });
  return cells;
};

function initFom(): Cell[][] {
  const F = FOM_HWCH_PLANT;
  return [
    F.groupRow.map((t): Cell => ({ text: t, kind: "head" })),
    F.headRow.map((t): Cell => ({ text: t, kind: "head" })),
    F.dataRow.map((t, i): Cell => ({ text: t, mono: i !== 2 })),
    pad([{ text: F.footnote, kind: "caption" }], FOM_COLS),
    pad([], FOM_COLS),
    // The authored extension the product exists for: loop temps as OUTBOUND linked cells.
    pad(
      [
        { text: DEMO_LINK.sourceLabel },
        { text: "EWT", kind: "head" },
        {
          text: "110",
          authored: "110",
          mono: true,
          digits: 1,
          link: { dir: "out", param: "PE_M_PerfHeat_FluidEWT" },
        },
        { text: "LWT", kind: "head" },
        {
          text: "100",
          authored: "100",
          mono: true,
          digits: 1,
          link: { dir: "out", param: "PE_M_PerfHeat_FluidLWT" },
        },
        { text: "°F — drives the scheduled fan-coil types", kind: "caption" },
      ],
      FOM_COLS,
    ),
    // An INBOUND cell: the table shows a value the model owns (Σ across the 23 tags).
    pad(
      [
        { text: "Connected FCU heating capacity" },
        { text: "Σ design total", kind: "head" },
        { text: "", mono: true, link: { dir: "in", param: "PE_M_PerfHeat_CapacityDesignTotal" } },
        { text: "Btu/h", kind: "caption" },
      ],
      FOM_COLS,
    ),
  ];
}

function initBod(): Cell[][] {
  return BOD_MAIN_HOUSE.map((e) =>
    pad(
      [
        { text: e.label },
        { text: e.value, mono: e.numeric != null },
        { text: e.unit ?? "", kind: "caption" },
      ],
      BOD_COLS,
    ),
  );
}

// ─── derived truths (computed each render — "compute agreement; do not remember it") ──

interface Pending {
  t: TableKey;
  r: number;
  c: number;
  addr: string;
  meta: ParamMeta;
  type: string;
  tags: string[];
  cur: number;
  next: number;
  /** Present ⇒ this target REFUSES, with the reason. Formula-owned params cannot be written. */
  refusal?: string;
}

const colLetter = (c: number) => String.fromCharCode(65 + c);
const addr = (r: number, c: number) => `${colLetter(c)}${r + 1}`;

function pendingWrites(grids: Record<TableKey, Cell[][]>, model: Model): Pending[] {
  const out: Pending[] = [];
  for (const t of ["fom", "bod"] as TableKey[]) {
    grids[t].forEach((row, r) =>
      row.forEach((cell, c) => {
        if (cell.link?.dir !== "out") return;
        const meta = metaOf(cell.link.param);
        const next = Number(cell.text);
        if (meta == null || Number.isNaN(next)) return;
        for (const ty of TYPE_ROWS) {
          const cur = model[ty.type]?.[meta.name];
          if (cur == null || cur === next) continue;
          out.push({
            t,
            r,
            c,
            addr: addr(r, c),
            meta,
            type: ty.type,
            tags: ty.tags,
            cur,
            next,
            ...(meta.readOnlyOn?.includes(ty.type)
              ? {
                  refusal: `formula-owned on this type — the family formula computes ${meta.name}; retype the formula in the family editor instead`,
                }
              : {}),
          });
        }
      }),
    );
  }
  return out;
}

/** Distinct model-side values that disagree with an outbound cell, as testimony text. */
function driftSummary(param: string, value: number, model: Model): string | null {
  const held = new Map<number, number>();
  for (const ty of TYPE_ROWS) {
    const v = model[ty.type]?.[param];
    if (v != null && v !== value) held.set(v, (held.get(v) ?? 0) + 1);
  }
  if (held.size === 0) return null;
  return [...held.entries()]
    .map(([v, n]) => `${fmtNum(v)} on ${n} type${n > 1 ? "s" : ""}`)
    .join(" · ");
}

// ─── the raw link mark ──────────────────────────────────────────────────────
// LANG GAP: the language has no linked-cell provenance mark. The slot table in
// lang.css assigns top-right fold = pea authored, bottom-left square = unsaved,
// text decoration = the squiggle family — linkage is a FOURTH fact about a cell
// and needs its own slot. Raw here: a bottom-right corner tab. Solid = outbound
// (this cell drives the model); hollow = inbound (this cell reads the model) —
// shape, not hue, carries the distinction (the grayscale extension: a sub-word
// mark may not separate by hue alone). Non-focusable, pointer-events none, so it
// can never steal the caret.
function LinkMark({ dir, title }: { dir: LinkDir; title: string }) {
  return (
    <svg
      viewBox="0 0 8 8"
      width={8}
      height={8}
      style={{ position: "absolute", right: 1, bottom: 1, pointerEvents: "none" }}
      aria-hidden
    >
      <title>{title}</title>
      {dir === "out" ? (
        <path d="M8 0 L8 8 L0 8 Z" fill={token("ink-2")} />
      ) : (
        <path
          d="M7.3 1.4 L7.3 7.3 L1.4 7.3 Z"
          fill="none"
          stroke={token("ink-2")}
          strokeWidth={1.2}
        />
      )}
    </svg>
  );
}

// ─── the page ───────────────────────────────────────────────────────────────

const TABLES: { key: TableKey; name: string; cols: number }[] = [
  { key: "fom", name: FOM_HWCH_PLANT.name, cols: FOM_COLS },
  { key: "bod", name: "BOD MainHouse", cols: BOD_COLS },
];

interface Receipt {
  kind: OutcomeKind;
  label: string;
  says?: string;
}

export function VariantA() {
  const [grids, setGrids] = useState<Record<TableKey, Cell[][]>>(() => ({
    fom: initFom(),
    bod: initBod(),
  }));
  const [model, setModel] = useState<Model>(initModel);
  const [active, setActive] = useState<TableKey>("fom");
  const [sel, setSel] = useState<{ t: TableKey; r: number; c: number } | null>(null);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [pickParam, setPickParam] = useState<string>(DEMO_LINK.targets[0]);

  const patchCell = (t: TableKey, r: number, c: number, patch: Partial<Cell>) =>
    setGrids((prev) => {
      const grid = prev[t].map((row) => row.slice());
      grid[r]![c] = { ...grid[r]![c]!, ...patch };
      return { ...prev, [t]: grid };
    });

  const inboundValue = (param: string): number =>
    FC_UNITS.reduce((n, u) => n + (model[u.typeName]?.[param] ?? 0), 0);

  // Recomputed every render — a user edit produces the same drift the model moving would.
  const pending = pendingWrites(grids, model);
  const writes = pending.filter((p) => p.refusal == null);
  const refusals = pending.filter((p) => p.refusal != null);
  const tagsMoved = writes.reduce((n, w) => n + w.tags.length, 0);

  const linkedCells = (["fom", "bod"] as TableKey[]).flatMap((t) =>
    grids[t].flatMap((row) => row.filter((c) => c.link != null)),
  );
  const outCount = linkedCells.filter((c) => c.link?.dir === "out").length;
  const inCount = linkedCells.length - outCount;

  // THE COMMIT — the only verb that writes beyond the page, so the only blue on it.
  const apply = () => {
    if (writes.length === 0) return;
    setModel((prev) => {
      const next: Model = Object.fromEntries(
        Object.entries(prev).map(([ty, params]) => [ty, { ...params }]),
      );
      for (const w of writes) next[w.type]![w.meta.name] = w.next;
      return next;
    });
    setGrids((prev) => {
      const next = { fom: prev.fom.map((r) => r.slice()), bod: prev.bod.map((r) => r.slice()) };
      for (const p of pending) {
        const cell = next[p.t][p.r]![p.c]!;
        next[p.t][p.r]![p.c] = { ...cell, authored: cell.text };
      }
      return next;
    });
    setReceipts((prev) => [
      {
        kind: refusals.length > 0 ? "partial" : "receipt",
        label: `${writes.length} type writes · ${tagsMoved} tags moved`,
        says:
          refusals.length > 0
            ? `${refusals.length} target${refusals.length > 1 ? "s" : ""} refused — still holding the old value`
            : "the performance schedule columns move with them",
      },
      ...refusals.map(
        (f): Receipt => ({
          kind: "refused",
          label: `${f.type} · ${f.meta.name}`,
          says: f.refusal,
        }),
      ),
      ...prev,
    ]);
  };

  // Build the canon cell-grammar props for a data cell — ONE derivation feeds the
  // grid render, the title testimony, and the readout band, so they cannot disagree.
  const cellProps = (t: TableKey, r: number, c: number, cell: Cell): StateCellProps => {
    if (cell.link?.dir === "in") {
      const meta = metaOf(cell.link.param);
      return {
        value: Math.round(inboundValue(cell.link.param)).toLocaleString("en-US"),
        scale: "row",
        fresh: "fresh",
        cap: "readonly",
        capReason: `inbound link — the model owns this value (Σ ${cell.link.param} across ${FC_UNITS.length} scheduled tags${meta?.unit != null ? `, ${meta.unit}` : ""})`,
        className: "face-mono",
      };
    }
    if (cell.link?.dir === "out") {
      const v = Number(cell.text);
      const drift = Number.isNaN(v) ? null : driftSummary(cell.link.param, v, model);
      const staged = cell.authored != null && cell.text !== cell.authored;
      return {
        value: cell.text,
        scale: "row",
        fresh: "fresh",
        agree: drift != null ? "drift" : "agree",
        ...(drift != null ? { modelValue: drift } : {}),
        stage: staged ? "staged" : "clean",
        stagedBy: "you",
        note: `outbound link — drives ${cell.link.param} on ${TYPE_ROWS.length} fan-coil types (${FC_UNITS.length} scheduled tags)`,
        onCommit: (text: string) => patchCell(t, r, c, { text }),
        numeric: { digits: cell.digits ?? 1 },
        className: "face-mono",
      };
    }
    return {
      value: cell.text,
      scale: "row",
      onCommit: (text: string) => patchCell(t, r, c, { text }),
      ...(cell.mono ? { className: "face-mono" } : {}),
    };
  };

  const grid = grids[active];
  const cols = TABLES.find((x) => x.key === active)!.cols;
  const selected = sel != null && sel.t === active ? grids[sel.t][sel.r]?.[sel.c] : undefined;

  // ── addressing sentence: clickable nouns only — the doc, then the two authored tables ──
  const sentence = (
    <span className="flex min-w-0 items-center gap-2">
      <span
        className="face-mono t-label"
        style={{ color: token("ink") }}
        title="the host document these links read and write (fixture lane)"
      >
        ProjectA_Clone_Aug_11
      </span>
      <span className="t-label" style={{ color: token("ink-mute") }}>
        ·
      </span>
      {TABLES.map((tb) => (
        <Press
          key={tb.key}
          type="button"
          className="face-mono t-label"
          onClick={() => {
            setActive(tb.key);
            setSel(null);
          }}
          title={`open the authored table "${tb.name}"`}
          style={{
            padding: "0 2px",
            cursor: "pointer",
            border: "none",
            borderBottom: `0.5px solid ${token("ink")}`,
            borderRadius: 0,
            // selection is a FILL, never a hue
            backgroundColor: active === tb.key ? token("select") : "transparent",
            color: token("ink"),
            whiteSpace: "nowrap",
          }}
        >
          {tb.name}
        </Press>
      ))}
    </span>
  );

  const applyReason =
    pending.length === 0
      ? "nothing staged — edit a linked cell and its fan-out appears below the grid"
      : writes.length === 0
        ? "every remaining target refuses — formula-owned parameters cannot be written from here"
        : `writes ${writes.length} type parameters · ${tagsMoved} scheduled tags move · ${refusals.length} refuse`;

  // ── render ──
  return (
    <div
      className="flex h-screen flex-col"
      style={{ backgroundColor: token("page"), color: token("ink") }}
    >
      <AddressingBar
        name="param tables"
        sentence={sentence}
        facts={
          <>
            <FactChip title="the element set every link targets — the scheduled fan coils, grouped by type because perf params live at type scope">
              {FC_UNITS.length} tags · {TYPE_ROWS.length} types
            </FactChip>
            <FactChip title="linked cells across both authored tables — outbound drive the model, inbound read it">
              {linkedCells.length} linked · {outCount} out · {inCount} in
            </FactChip>
            {pending.length > 0 ? (
              <FactChip
                tone="caution"
                title="type-level writes the model has not received — the staged fan-out strip below the grid is their far side"
              >
                {pending.length} staged
              </FactChip>
            ) : null}
          </>
        }
        verb={
          <Verb
            tone="commit"
            label={writes.length > 0 ? `Apply ${writes.length} writes` : "Apply"}
            onClick={apply}
            disabled={writes.length === 0}
            reason={applyReason}
          />
        }
        seam={
          <FactChip
            dashed
            title="prototype fixture pulled live 2026-08-17 — a connected host session replaces this lane"
          >
            fixture · ProjectA_Clone_Aug_11
          </FactChip>
        }
      />

      <div className="flex min-h-0 flex-1">
        {/* ── the sheet ── */}
        <div className="min-w-0 flex-1 space-y-3 overflow-auto p-3">
          <ArtifactFrame
            head={
              <div className="flex items-center gap-2">
                <span className="t-label t-upper" style={{ color: token("ink-2") }}>
                  {TABLES.find((x) => x.key === active)!.name}
                </span>
                <HelpTip>
                  An authored table. Every cell is yours to type; a cell becomes LINKED through the
                  inspector — outbound cells drive a parameter on the fan-coil types, inbound cells
                  read one. Link state is drawn on the cell itself (corner tab, squiggle for model
                  disagreement, bold + square for your unsaved edit) — never as extra columns.
                </HelpTip>
                <FactChip title="authored grid dimensions">
                  {grid.length} × {cols}
                </FactChip>
              </div>
            }
            foot={
              <span className="t-caption face-mono truncate" style={{ color: token("ink-2") }}>
                {sel != null && sel.t === active && selected != null
                  ? `${addr(sel.r, sel.c)} · ${
                      selected.kind != null
                        ? selected.kind
                        : (cellFactsText(cellProps(sel.t, sel.r, sel.c, selected)) ?? "plain cell")
                    }`
                  : "click a cell — its testimony reads out here"}
              </span>
            }
          >
            <table style={{ borderCollapse: "collapse", tableLayout: "fixed", width: "100%" }}>
              <colgroup>
                <col style={{ width: 30 }} />
                <col style={{ width: active === "fom" ? 210 : 340 }} />
                {Array.from({ length: cols - 1 }, (_, i) => (
                  <col key={i} style={{ minWidth: 84 }} />
                ))}
              </colgroup>
              <thead>
                <tr>
                  <th style={{ borderBottom: `0.5px solid ${token("line")}` }} />
                  {Array.from({ length: cols }, (_, c) => (
                    <th
                      key={`header-${c}`}
                      className="t-caption face-mono"
                      style={{
                        color: token("ink-mute"),
                        fontWeight: "var(--weight-regular)",
                        textAlign: "center",
                        borderBottom: `0.5px solid ${token("line")}`,
                        borderLeft: `0.5px solid ${token("line")}`,
                        padding: "2px 0",
                      }}
                    >
                      {colLetter(c)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {grid.map((row, r) => {
                  // A caption-only row (the SXL footnote) spans the sheet.
                  const captionOnly =
                    row[0]?.kind === "caption" && row.every((c, i) => i === 0 || c.text === "");
                  return (
                    <tr key={r}>
                      <td
                        className="t-caption face-mono"
                        style={{
                          color: token("ink-mute"),
                          textAlign: "center",
                          borderRight: `0.5px solid ${token("line")}`,
                          borderBottom: `0.5px solid ${token("line")}`,
                        }}
                      >
                        {r + 1}
                      </td>
                      {(captionOnly ? [row[0]!] : row).map((cell, c) => {
                        const isSel = sel?.t === active && sel.r === r && sel.c === c;
                        const tdStyle: CSSProperties = {
                          padding: 0,
                          height: 28,
                          borderLeft: `0.5px solid ${token("line")}`,
                          borderBottom: `0.5px solid ${token("line")}`,
                          verticalAlign: "middle",
                          overflow: "hidden",
                          ...(isSel
                            ? // selection is a FILL; re-declare --pe-on so cell washes land right
                              ({
                                backgroundColor: token("select"),
                                "--pe-on": token("select"),
                              } as CSSProperties)
                            : {}),
                        };
                        let body: ReactNode;
                        if (cell.kind === "head") {
                          body = (
                            <span
                              className="t-label block truncate px-1.5"
                              style={{ color: token("ink-2") }}
                            >
                              {cell.text}
                            </span>
                          );
                        } else if (cell.kind === "caption") {
                          body = (
                            <span
                              className="t-caption block truncate px-1.5"
                              style={{ color: token("ink-mute") }}
                            >
                              {cell.text}
                            </span>
                          );
                        } else {
                          body = (
                            <span style={{ position: "relative", display: "block" }}>
                              <StateCell {...cellProps(active, r, c, cell)} />
                              {cell.link != null ? (
                                <LinkMark
                                  dir={cell.link.dir}
                                  title={
                                    cell.link.dir === "out"
                                      ? `outbound — drives ${cell.link.param}`
                                      : `inbound — reads ${cell.link.param}`
                                  }
                                />
                              ) : null}
                            </span>
                          );
                        }
                        return (
                          <td
                            key={c}
                            colSpan={captionOnly ? cols : undefined}
                            style={tdStyle}
                            onClick={() => setSel({ t: active, r, c })}
                          >
                            {body}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </ArtifactFrame>

          {/* ── the staged fan-out: the FAR SIDE of Apply, always visible while anything
                 is pending. The commit verb above is enabled only when this strip has
                 writable rows — the §2 gate holds structurally. ── */}
          {pending.length > 0 ? (
            <ArtifactFrame
              head={
                <div className="flex items-center gap-2">
                  <span className="t-label t-upper" style={{ color: token("ink-2") }}>
                    staged fan-out
                  </span>
                  <HelpTip>
                    The far side of Apply. Writes land on TYPES, not tags — one row per type, and
                    every tag of that type moves with it. A formula-owned target refuses here, per
                    target, before anything is committed.
                  </HelpTip>
                  <FactChip title="type-level writes ready to commit, and the scheduled tags they move">
                    {writes.length} writes · {tagsMoved} tags
                  </FactChip>
                  {refusals.length > 0 ? (
                    <FactChip
                      tone="alarm"
                      title="targets that refuse the write — the reason is on each row"
                    >
                      {refusals.length} refuse
                    </FactChip>
                  ) : null}
                </div>
              }
            >
              {/* LANG GAP: no fan-out / staged-writes preview primitive exists. The cell
                  grammar says a value's state; nothing canon says "this one edit becomes
                  these N typed writes over there". Raw rows here. */}
              <div className="px-2 py-1">
                {[...new Map(pending.map((p) => [`${p.addr}·${p.meta.name}`, p])).values()].map(
                  (g) => (
                    <div key={`${g.addr}-${g.meta.name}`} className="py-1">
                      <div className="t-caption flex items-baseline gap-1.5">
                        <span className="face-mono" style={{ color: token("ink") }}>
                          {g.addr}
                        </span>
                        <span style={{ color: token("ink-mute") }}>→</span>
                        <span className="face-mono" style={{ color: token("ink") }}>
                          {g.meta.name}
                        </span>
                        <span style={{ color: token("ink-mute") }}>
                          {g.meta.label}
                          {g.meta.unit != null ? ` · ${g.meta.unit}` : ""} · type scope
                        </span>
                      </div>
                      {pending
                        .filter((p) => p.addr === g.addr && p.meta.name === g.meta.name)
                        .map((p) => (
                          <div
                            key={p.type}
                            className="t-label flex items-baseline gap-2 py-0.5 pl-4"
                          >
                            <span
                              className="face-mono truncate"
                              style={{ color: token("ink"), minWidth: 180 }}
                            >
                              {p.type}
                            </span>
                            <span className="face-mono" style={{ color: token("ink-2") }}>
                              ×{p.tags.length} tag{p.tags.length > 1 ? "s" : ""}
                            </span>
                            {p.refusal != null ? (
                              <span className="t-caption" style={{ color: token("alarm") }}>
                                refuses — {p.refusal}
                              </span>
                            ) : (
                              <span className="face-mono" style={{ color: token("ink") }}>
                                {fmtNum(p.cur)} → {fmtNum(p.next)}
                              </span>
                            )}
                            {OFF_SCHEDULE_NOTE[p.type] != null ? (
                              <span className="t-caption" style={{ color: token("ink-mute") }}>
                                {OFF_SCHEDULE_NOTE[p.type]}
                              </span>
                            ) : null}
                          </div>
                        ))}
                    </div>
                  ),
                )}
              </div>
            </ArtifactFrame>
          ) : null}

          {/* receipts are plain content — never framed */}
          {receipts.length > 0 ? (
            <div className="space-y-0.5">
              {receipts.slice(0, 6).map((r, i) => (
                <OutcomeLine key={i} kind={r.kind} label={r.label} says={r.says} />
              ))}
            </div>
          ) : null}
        </div>

        {/* ── the cell inspector: a fixed side pane, so opening/closing link state never
               moves the grid ("affordances do not move content"). ── */}
        <div
          className="w-[300px] shrink-0 space-y-3 overflow-auto p-3"
          style={{ borderLeft: `0.5px solid ${token("line")}` }}
        >
          <div className="flex items-center gap-2">
            <span className="t-label t-upper" style={{ color: token("ink-2") }}>
              cell
            </span>
            {sel != null && sel.t === active ? (
              <span className="face-mono t-label" style={{ color: token("ink") }}>
                {addr(sel.r, sel.c)}
              </span>
            ) : null}
            <HelpTip>
              Everything a cell IS, and where a link is made or removed. An outbound link makes this
              cell the author of a parameter across the fan-coil types; an inbound link makes it a
              live reading. The write itself always goes through Apply, up top.
            </HelpTip>
          </div>

          {sel == null || sel.t !== active || selected == null ? (
            <EmptyState story="scope" exit="click any cell in the grid">
              no cell selected
            </EmptyState>
          ) : selected.kind != null ? (
            <div className="t-label" style={{ color: token("ink-2") }}>
              a {selected.kind === "head" ? "heading" : "caption"} cell — authored chrome, not data.
              It cannot carry a link.
            </div>
          ) : (
            <>
              <div className="space-y-1">
                <div className="t-caption t-upper" style={{ color: token("ink-mute") }}>
                  value
                </div>
                <div className="face-mono t-value truncate" style={{ color: token("ink") }}>
                  {selected.link?.dir === "in"
                    ? Math.round(inboundValue(selected.link.param)).toLocaleString("en-US")
                    : selected.text === ""
                      ? "—"
                      : selected.text}
                </div>
                <div className="flex flex-wrap gap-1">
                  <FactChip title="what kind of cell this is — plain cells are just yours; linked cells carry provenance">
                    {selected.link == null
                      ? Number.isNaN(Number(selected.text)) || selected.text === ""
                        ? "text"
                        : "number"
                      : selected.link.dir === "out"
                        ? "linked · outbound"
                        : "linked · inbound"}
                  </FactChip>
                </div>
              </div>

              {selected.link != null ? (
                (() => {
                  const meta = metaOf(selected.link.param);
                  return (
                    <div className="space-y-1.5">
                      <div className="t-caption t-upper" style={{ color: token("ink-mute") }}>
                        link
                      </div>
                      <div className="t-label" style={{ color: token("ink") }}>
                        {selected.link.dir === "out" ? "this cell drives" : "this cell reads (Σ)"}
                      </div>
                      <div className="face-mono t-label break-all" style={{ color: token("ink") }}>
                        {selected.link.param}
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {meta != null ? (
                          <FactChip title="human label and unit of the target parameter">
                            {meta.label}
                            {meta.unit != null ? ` · ${meta.unit}` : ""}
                          </FactChip>
                        ) : null}
                        <FactChip title="perf params live at TYPE scope — one write per type, every tag of the type moves">
                          type scope
                        </FactChip>
                        <FactChip title="the element set this link spans — the scheduled fan coils, grouped by type">
                          {FC_UNITS.length} tags · {TYPE_ROWS.length} types
                        </FactChip>
                        {meta?.readOnlyOn != null && meta.readOnlyOn.length > 0 ? (
                          <FactChip
                            tone="alarm"
                            title={`formula-owned on: ${meta.readOnlyOn.join(", ")} — those targets refuse writes, per target`}
                          >
                            read-only on {meta.readOnlyOn.length} type
                            {meta.readOnlyOn.length > 1 ? "s" : ""}
                          </FactChip>
                        ) : null}
                      </div>
                      {selected.link.dir === "out" &&
                      pending.some((p) => p.t === sel.t && p.r === sel.r && p.c === sel.c) ? (
                        <div className="t-caption" style={{ color: token("ink-2") }}>
                          this cell has staged writes — their far side is the fan-out strip under
                          the grid
                        </div>
                      ) : null}
                      <Verb
                        label="Unlink"
                        onClick={() => {
                          const frozen =
                            selected.link?.dir === "in"
                              ? Math.round(inboundValue(selected.link.param)).toLocaleString(
                                  "en-US",
                                )
                              : selected.text;
                          patchCell(sel.t, sel.r, sel.c, {
                            link: undefined,
                            authored: undefined,
                            text: frozen,
                          });
                        }}
                        reason="removes the link — the value stays behind as plain text; nothing is written to the model"
                      />
                    </div>
                  );
                })()
              ) : (
                <div className="space-y-1.5">
                  <div className="t-caption t-upper" style={{ color: token("ink-mute") }}>
                    make a link
                  </div>
                  {/* LANG GAP: no parameter-picker primitive at cell scale — doc-picker is
                      document-scoped and the sentence popover is fleet-bound. Raw select. */}
                  <select
                    className="face-mono t-label w-full"
                    value={pickParam}
                    onChange={(e) => setPickParam(e.target.value)}
                    title="the target parameter — type-scope perf params only in this proto"
                    style={{
                      backgroundColor: token("artifact"),
                      color: token("ink"),
                      border: `0.5px solid ${token("line-2")}`,
                      borderRadius: 2,
                      padding: "3px 4px",
                    }}
                  >
                    {LINKABLE.map((p) => (
                      <option key={p.name} value={p.name}>
                        {p.name} — {p.label}
                      </option>
                    ))}
                  </select>
                  <div className="flex gap-1.5">
                    <Verb
                      label="Link → drive"
                      onClick={() =>
                        patchCell(sel.t, sel.r, sel.c, {
                          link: { dir: "out", param: pickParam },
                          authored: selected.text,
                          mono: true,
                          digits: 1,
                        })
                      }
                      reason="outbound — this cell's value will drive the parameter across the fan-coil types; the write itself still goes through Apply"
                    />
                    <Verb
                      label="Link ← read"
                      onClick={() =>
                        patchCell(sel.t, sel.r, sel.c, {
                          link: { dir: "in", param: pickParam },
                          mono: true,
                        })
                      }
                      reason="inbound — this cell becomes a live Σ reading of the parameter across the 23 scheduled tags; it stops being editable"
                    />
                  </div>
                  <div className="t-caption" style={{ color: token("ink-mute") }}>
                    target set is fixed in this proto: the {FC_UNITS.length} scheduled fan coils, by
                    type
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
