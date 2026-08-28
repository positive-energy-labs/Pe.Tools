import { token } from "#/lib/token";

/**
 * VARIANT B — the LINK is the product; the table is just a source substrate.
 *
 * The page is a BINDING LEDGER: one row per linkage, source (table cell address) →
 * target (parameter × element selector), fan-out, and a VISIBLE state machine —
 * fresh · drift · stale · staged · staged-stale — rendered as a station strip with
 * the verbs living between stations. /parameter-links' audit finding #2 was that its
 * freshness gate was invisible; here the gate IS a station: evaluating snapshots the
 * source value, and if the source moves after evaluation the binding goes
 * "staged-stale" and the commit verb refuses, visibly, until re-evaluated.
 *
 * Evaluation is first-class and side-effect free: per-TARGET verdicts (write /
 * refuse / no-op) computed against the evaluation snapshot, with the far side
 * (types × tags) always visible before the one commit verb fires. Direction is a
 * property of a binding: one INBOUND binding reads the model (Σ heating capacity
 * over 23 tags) into a table cell that is machine-fed and refuses hand edits.
 *
 * Honest wrinkles kept from the fixture: FC-1's type (DVWHSA…RV2) holds heating
 * LWT 90 while the authored design says 100 — so the LWT binding opens in DRIFT
 * before anyone touches anything; and PE_M_PerfHeat_FluidEWT is formula-owned on
 * that same type, so the EWT fan-out refuses there, per target, with the reason.
 *
 * Throwaway prototype — no persistence, no host calls, useState only.
 */
import { useState } from "react";

import { AddressingBar } from "#/components/lang/addressing-bar";
import { ArtifactFrame } from "#/components/lang/artifact-frame";
import { fmtNum, StateCell } from "#/components/lang/cell";
import { FactChip } from "#/components/lang/chip";
import { HelpTip } from "#/components/lang/help";
import { OutcomeLine, type OutcomeKind } from "#/components/lang/outcome";
import { Verb } from "#/components/lang/verb";
import { cn } from "#/lib/utils";
import {
  BOD_MAIN_HOUSE,
  DEMO_LINK,
  FC_UNITS,
  FOM_HWCH_PLANT,
  PARAM_META,
  type FcRow,
} from "#/param-tables/variants/fixture";
import { Press } from "#/components/lang/press";

// ---------------------------------------------------------------------------
// Domain: the far side (types × tags) and the binding definitions
// ---------------------------------------------------------------------------

interface TypeGroup {
  typeName: string;
  tags: FcRow[];
}

const TYPE_GROUPS: TypeGroup[] = (() => {
  const byType = new Map<string, FcRow[]>();
  for (const fc of FC_UNITS) {
    const arr = byType.get(fc.typeName) ?? [];
    arr.push(fc);
    byType.set(fc.typeName, arr);
  }
  return [...byType.entries()].map(([typeName, tags]) => ({ typeName, tags }));
})();

/**
 * Model-wide tag counts where the fixture header states them: the schedule shows
 * 23 of 36 FC-* instances, and Mortex MSVT18 serves 14 tags in the model (13 of
 * which are scheduled here). A type-scope write hits ALL of them — the far side
 * must say so even for tags this page cannot list.
 */
const MODEL_TAG_COUNT: Record<string, number> = { "Mortex MSVT18": 14 };

const META = new Map(PARAM_META.map((m) => [m.name, m]));

/** The four perf slots a type carries in this demo. */
interface TypePerf {
  heatEwt: number;
  heatLwt: number;
  coolEwt: number;
  coolLwt: number;
}
type PerfKey = keyof TypePerf;

function initialTypeVals(): Record<string, TypePerf> {
  return Object.fromEntries(
    TYPE_GROUPS.map((g) => {
      const first = g.tags[0] as FcRow;
      return [
        g.typeName,
        {
          heatEwt: first.heat.ewt,
          heatLwt: first.heat.lwt,
          coolEwt: first.cool.ewt,
          coolLwt: first.cool.lwt,
        },
      ];
    }),
  );
}

/** An OUTBOUND binding: authored table cell → type-scope parameter across the fleet. */
interface OutDef {
  id: string;
  /** Source cell address in the authored table — the machine literal the ledger keys on. */
  addr: string;
  label: string;
  key: PerfKey;
  paramName: string;
}

const OUT_DEFS: OutDef[] = [
  {
    id: "hewt",
    addr: "FOM!F6",
    label: `${DEMO_LINK.sourceLabel} — EWT`,
    key: "heatEwt",
    paramName: "PE_M_PerfHeat_FluidEWT",
  },
  {
    id: "hlwt",
    addr: "FOM!G6",
    label: `${DEMO_LINK.sourceLabel} — LWT`,
    key: "heatLwt",
    paramName: "PE_M_PerfHeat_FluidLWT",
  },
  {
    id: "cewt",
    addr: "FOM!F7",
    label: "Cooling loop supply/return (design) — EWT",
    key: "coolEwt",
    paramName: "PE_M_PerfCool_FluidEWT",
  },
  {
    id: "clwt",
    addr: "FOM!G7",
    label: "Cooling loop supply/return (design) — LWT",
    key: "coolLwt",
    paramName: "PE_M_PerfCool_FluidLWT",
  },
];

/** The one INBOUND binding: the model feeds a table cell. Direction is a binding property. */
const IN_DEF = {
  id: "incap",
  addr: "FOM!F8",
  label: "FC installed heating capacity (Σ fleet)",
  paramName: "PE_M_PerfHeat_CapacityDesignTotal",
  reducer: "sum" as const,
};

/** Authored design values — the fixture's uniform loop temps (FC_UNITS heat/cool). */
const AUTHORED_INITIAL: TypePerf = { heatEwt: 110, heatLwt: 100, coolEwt: 45, coolLwt: 55 };

// ---------------------------------------------------------------------------
// Derived reads — status and verdicts are COMPUTED, never remembered (§1)
// ---------------------------------------------------------------------------

type BindingStatus = "fresh" | "drift" | "stale" | "staged" | "staged-stale";

/** Lifecycle order, for the station strip and the ledger sort. */
const STATUS_ORDER: BindingStatus[] = ["drift", "stale", "staged-stale", "staged", "fresh"];

interface TargetVerdict {
  typeName: string;
  tags: FcRow[];
  current: number;
  proposed: number;
  /** Formula-owned on this type — refuses any write, whatever the value. */
  readOnly: boolean;
  verdict: "write" | "refuse" | "noop";
  reason?: string;
}

function verdictsFor(
  def: OutDef,
  proposed: number,
  typeVals: Record<string, TypePerf>,
): TargetVerdict[] {
  return TYPE_GROUPS.map((g) => {
    const current = typeVals[g.typeName]?.[def.key] ?? Number.NaN;
    const readOnly = META.get(def.paramName)?.readOnlyOn?.includes(g.typeName) === true;
    const verdict: TargetVerdict["verdict"] =
      current === proposed ? "noop" : readOnly ? "refuse" : "write";
    return {
      typeName: g.typeName,
      tags: g.tags,
      current,
      proposed,
      readOnly,
      verdict,
      reason:
        verdict === "refuse"
          ? `formula-owned — ${def.paramName} is read-only on ${g.typeName}`
          : undefined,
    };
  });
}

function statusFor(
  def: OutDef,
  authored: TypePerf,
  applied: TypePerf,
  evals: Record<string, number>,
  typeVals: Record<string, TypePerf>,
): BindingStatus {
  const snap = evals[def.id];
  if (snap != null) return snap === authored[def.key] ? "staged" : "staged-stale";
  if (authored[def.key] !== applied[def.key]) return "stale";
  const drift = TYPE_GROUPS.some((g) => typeVals[g.typeName]?.[def.key] !== authored[def.key]);
  return drift ? "drift" : "fresh";
}

/** The disagreeing far-side values, for drift titles: "90 on DVWHSA…". */
function driftSummary(def: OutDef, authored: TypePerf, typeVals: Record<string, TypePerf>): string {
  return TYPE_GROUPS.filter((g) => typeVals[g.typeName]?.[def.key] !== authored[def.key])
    .map((g) => `${fmtNum(typeVals[g.typeName]?.[def.key] ?? Number.NaN)} on ${g.typeName}`)
    .join(", ");
}

const CAP_TOTAL = FC_UNITS.reduce((sum, fc) => sum + fc.heat.capTotal, 0);

// LANG GAP: the binding-status axis (fresh/drift/stale/staged/staged-stale) has no canon
// component — cell.tsx's squiggle family is close but keyed to cell values, not linkages.
// Borrowing the meaning tokens raw: drift wears the one alarm, stale/staged wear caution.
const STATUS_INK: Record<BindingStatus, string> = {
  fresh: token("ink-mute"),
  drift: token("alarm"),
  stale: token("caution"),
  staged: token("caution"),
  "staged-stale": token("caution"),
};

const STATUS_TITLE: Record<BindingStatus, string> = {
  fresh: "the model holds exactly what the table says",
  drift: "the model disagrees with the authored value — no pending edit of yours",
  stale: "you edited the source cell; verdicts have not been computed",
  staged: "verdicts are computed and waiting on the one commit verb",
  "staged-stale": "the source moved AFTER verdicts were computed — re-evaluate before apply",
};

interface Outcome {
  kind: OutcomeKind;
  label: string;
  says?: string;
}

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

export function VariantB() {
  const [authored, setAuthored] = useState<TypePerf>(AUTHORED_INITIAL);
  /** The authored value at last apply — what "stale" is measured against. */
  const [applied, setApplied] = useState<TypePerf>(AUTHORED_INITIAL);
  /** The (mock) model: perf values per type. Mutated only by the commit verb. */
  const [typeVals, setTypeVals] = useState<Record<string, TypePerf>>(initialTypeVals);
  /** bindingId → the source value SNAPSHOTTED at evaluation. Presence = staged. */
  const [evals, setEvals] = useState<Record<string, number>>({});
  const [selected, setSelected] = useState<string | null>("hlwt");
  const [outcomes, setOutcomes] = useState<Outcome[]>([]);
  /** Lightly-editable BOD values — authored-only, no bindings yet. */
  const [bodVals, setBodVals] = useState<Record<string, string>>({});

  const rows = OUT_DEFS.map((def) => ({
    def,
    status: statusFor(def, authored, applied, evals, typeVals),
  })).sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status));

  const count = (s: BindingStatus) => rows.filter((r) => r.status === s).length;
  const nDrift = count("drift");
  const nStale = count("stale");
  const nStaged = count("staged");
  const nStagedStale = count("staged-stale");
  const nFresh = count("fresh") + 1; // + the inbound binding, live by construction

  const evaluable = rows.filter((r) => r.status !== "fresh" && r.status !== "staged");
  const stagedRows = rows.filter((r) => r.status === "staged");
  const stagedWrites = stagedRows.flatMap((r) =>
    verdictsFor(r.def, evals[r.def.id] ?? authored[r.def.key], typeVals).filter(
      (v) => v.verdict === "write",
    ),
  );
  const stagedTagCount = stagedWrites.reduce((n, v) => n + v.tags.length, 0);

  const onEvaluate = () => {
    if (evaluable.length === 0) return;
    const next = { ...evals };
    for (const r of evaluable) next[r.def.id] = authored[r.def.key];
    setEvals(next);
    let w = 0;
    let refuse = 0;
    let noop = 0;
    for (const r of evaluable) {
      for (const v of verdictsFor(r.def, authored[r.def.key], typeVals)) {
        if (v.verdict === "write") w += 1;
        else if (v.verdict === "refuse") refuse += 1;
        else noop += 1;
      }
    }
    setOutcomes((o) => [
      {
        kind: "advisory",
        label: `evaluated ${evaluable.length} bindings · ${w} writes · ${refuse} refuse · ${noop} no-op`,
        says: "side-effect free — nothing has left the page",
      },
      ...o.slice(0, 5),
    ]);
    if (evaluable.length === 1) setSelected(evaluable[0]?.def.id ?? null);
  };

  const onApply = () => {
    if (stagedRows.length === 0 || nStagedStale > 0) return;
    const next = Object.fromEntries(
      Object.entries(typeVals).map(([k, v]) => [k, { ...v }]),
    ) as Record<string, TypePerf>;
    let writes = 0;
    let tagsHit = 0;
    const refusals: string[] = [];
    for (const r of stagedRows) {
      const proposed = evals[r.def.id] as number;
      for (const v of verdictsFor(r.def, proposed, typeVals)) {
        if (v.verdict === "write") {
          const t = next[v.typeName];
          if (t != null) t[r.def.key] = proposed;
          writes += 1;
          tagsHit += v.tags.length;
        } else if (v.verdict === "refuse") {
          refusals.push(`${r.def.paramName} on ${v.typeName}`);
        }
      }
    }
    setTypeVals(next);
    setApplied((a) => {
      const out = { ...a };
      for (const r of stagedRows) out[r.def.key] = authored[r.def.key];
      return out;
    });
    setEvals((e) => {
      const out = { ...e };
      for (const r of stagedRows) delete out[r.def.id];
      return out;
    });
    setOutcomes((o) => [
      {
        kind: "receipt",
        label: `wrote ${writes} type values · ${tagsHit} tags · ${stagedRows.length} bindings`,
        says: "mock apply — a real commit calls revit.apply.parameter-links",
      },
      ...(refusals.length > 0
        ? [
            {
              kind: "refused" as const,
              label: `${refusals.length} target refused — ${refusals.join(", ")}`,
              says: "formula-owned on that type; the value stands as the family computes it",
            },
          ]
        : []),
      ...o.slice(0, 4),
    ]);
  };

  const applyDisabledReason =
    stagedRows.length === 0 && nStagedStale === 0
      ? "nothing staged — edit a bound source cell, then evaluate"
      : nStagedStale > 0
        ? `evaluation is stale for ${nStagedStale} binding${nStagedStale > 1 ? "s" : ""} — the source moved after verdicts were computed; re-evaluate`
        : `write ${stagedWrites.length} type values (${stagedTagCount} tags) to the model — mock, in-memory`;

  const commitCell = (key: PerfKey) => (text: string) => {
    setAuthored((a) => ({ ...a, [key]: Number(text) }));
  };

  /** Cell props for a bound source cell, derived from its binding's status. */
  const boundCell = (def: OutDef) => {
    const status = statusFor(def, authored, applied, evals, typeVals);
    return (
      <StateCell
        scale="row"
        value={fmtNum(authored[def.key])}
        numeric={{ digits: 1 }}
        onCommit={commitCell(def.key)}
        stage={authored[def.key] !== applied[def.key] ? "staged" : "clean"}
        agree={status === "drift" ? "drift" : "agree"}
        modelValue={status === "drift" ? driftSummary(def, authored, typeVals) : undefined}
        className="w-16 text-right"
      />
    );
  };

  return (
    <div
      className="flex h-screen flex-col overflow-hidden text-sm"
      style={{ backgroundColor: token("page"), color: token("ink") }}
    >
      <AddressingBar
        name="param tables · b"
        sentence={
          <span className="flex items-baseline gap-1.5">
            <span className="font-mono t-value">ProjectA_Clone_Aug_11</span>
            <span style={{ color: token("ink-mute") }}>›</span>
            <span>M001 design tables</span>
            <span style={{ color: token("ink-mute") }}>›</span>
            <span className="font-medium">binding ledger</span>
          </span>
        }
        facts={
          <>
            <FactChip title="one row per linkage between an authored cell and a model parameter">
              {OUT_DEFS.length + 1} bindings
            </FactChip>
            {nDrift > 0 ? (
              <FactChip tone="alarm" title="the model disagrees with the authored value">
                {nDrift} drift
              </FactChip>
            ) : null}
            {nStale + nStagedStale > 0 ? (
              <FactChip
                tone="caution"
                title="a source cell moved; verdicts are missing or outdated"
              >
                {nStale + nStagedStale} stale
              </FactChip>
            ) : null}
            {nStaged > 0 ? (
              <FactChip tone="caution" title="verdicts computed, waiting on Apply">
                {stagedWrites.length} writes staged
              </FactChip>
            ) : null}
          </>
        }
        verb={
          <Verb
            tone="commit"
            label="Apply staged"
            onClick={onApply}
            disabled={stagedRows.length === 0 || nStagedStale > 0}
            reason={applyDisabledReason}
          />
        }
        seam={
          <FactChip
            dashed
            title="in-memory fixture pulled from ProjectA_Clone_Aug_11 on 2026-08-17 — a live lane would replace this"
          >
            fixture · 2026-08-17
          </FactChip>
        }
      />

      <div className="flex min-h-0 flex-1">
        {/* ------------------------------------------------------------------ */}
        {/* LEFT — the source substrate. Deliberately subordinate.             */}
        {/* ------------------------------------------------------------------ */}
        <div className="flex w-[430px] shrink-0 flex-col gap-3 overflow-y-auto p-3">
          <div className="flex items-center gap-1.5">
            <span
              className="t-caption font-medium uppercase tracking-widest"
              style={{ color: token("ink-mute") }}
            >
              source substrate
            </span>
            <HelpTip>
              The tables are where values are authored; the ledger owns what they mean. A marked
              cell feeds (or is fed by) a binding — click its marker to find the binding. Unmarked
              values are authored-only and never leave the page.
            </HelpTip>
          </div>

          <ArtifactFrame
            head={
              <div className="flex items-baseline gap-2">
                <span className="t-value font-medium">FOM HWCH Plant</span>
                <span className="t-caption" style={{ color: token("ink-mute") }}>
                  sheet exhibit — today a dead SXL header grid
                </span>
              </div>
            }
          >
            <div className="overflow-x-auto p-2">
              <table className="t-caption" style={{ borderCollapse: "collapse" }}>
                <tbody>
                  <tr style={{ color: token("ink-mute") }}>
                    {FOM_HWCH_PLANT.groupRow.map((c, i) => (
                      <td key={i} className="px-1.5 py-0.5 font-medium uppercase tracking-wide">
                        {c}
                      </td>
                    ))}
                  </tr>
                  <tr style={{ color: token("ink-2") }}>
                    {FOM_HWCH_PLANT.headRow.map((c, i) => (
                      <td key={i} className="whitespace-nowrap px-1.5 py-0.5">
                        {c}
                      </td>
                    ))}
                  </tr>
                  <tr className="font-mono">
                    {FOM_HWCH_PLANT.dataRow.map((c, i) => (
                      <td key={i} className="whitespace-nowrap px-1.5 py-0.5">
                        {c}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
              <div className="mt-1 px-1.5 italic t-caption" style={{ color: token("ink-mute") }}>
                {FOM_HWCH_PLANT.footnote}
              </div>
            </div>

            {/* Plant design temps — the bound cells. Gutter markers locate; the
                decision (evaluate/apply) is made where the evidence is: the ledger. */}
            <div className="border-t px-2 py-1.5" style={{ borderColor: token("line") }}>
              <div
                className="mb-1 t-caption font-medium uppercase tracking-widest"
                style={{ color: token("ink-mute") }}
              >
                plant design temps · bound
              </div>
              {OUT_DEFS.map((def) => {
                const isSel = selected === def.id;
                return (
                  <div
                    key={def.id}
                    className="flex items-center gap-2 rounded-sm px-1 py-0.5"
                    style={
                      isSel
                        ? ({
                            backgroundColor: token("select"),
                            "--pe-on": token("select"),
                          } as React.CSSProperties)
                        : undefined
                    }
                  >
                    {/* LANG GAP: gutter binding marker — §4's gutter-marker law has no
                        canon component; a raw ⇄ button carries locate + count here. */}
                    <Press
                      type="button"
                      className="w-9 shrink-0 text-left font-mono t-caption"
                      style={{ color: token("nav") }}
                      title={`bound — 1 binding sources this cell (${def.addr}); click to find it in the ledger`}
                      onClick={() => setSelected(isSel ? null : def.id)}
                    >
                      ⇄ {def.addr.split("!")[1]}
                    </Press>
                    <span className="min-w-0 flex-1 truncate t-value">{def.label}</span>
                    {boundCell(def)}
                    <span className="w-5 t-caption" style={{ color: token("ink-mute") }}>
                      °F
                    </span>
                  </div>
                );
              })}
              {/* The inbound cell — machine-fed, refuses hand edits. */}
              <div
                className="flex items-center gap-2 rounded-sm px-1 py-0.5"
                style={
                  selected === IN_DEF.id
                    ? ({
                        backgroundColor: token("select"),
                        "--pe-on": token("select"),
                      } as React.CSSProperties)
                    : undefined
                }
              >
                <Press
                  type="button"
                  className="w-9 shrink-0 text-left font-mono t-caption"
                  style={{ color: token("nav") }}
                  title={`bound (inbound) — the model feeds this cell (${IN_DEF.addr}); click to find the binding`}
                  onClick={() => setSelected(selected === IN_DEF.id ? null : IN_DEF.id)}
                >
                  ⇄ {IN_DEF.addr.split("!")[1]}
                </Press>
                <span className="min-w-0 flex-1 truncate t-value">{IN_DEF.label}</span>
                <StateCell
                  scale="row"
                  value={CAP_TOTAL.toLocaleString("en-US")}
                  cap="readonly"
                  capReason="machine-fed — an inbound binding reads Σ PE_M_PerfHeat_CapacityDesignTotal over 23 tags; edit the model, not the cell"
                  className="w-16 text-right"
                />
                <span className="w-5 t-caption" style={{ color: token("ink-mute") }}>
                  Btu/h
                </span>
              </div>
            </div>
          </ArtifactFrame>

          <ArtifactFrame
            head={
              <div className="flex items-baseline gap-2">
                <span className="t-value font-medium">BOD MainHouse</span>
                <span className="t-caption" style={{ color: token("ink-mute") }}>
                  M001 · authored-only — no bindings yet
                </span>
              </div>
            }
          >
            <div className="max-h-64 overflow-y-auto px-2 py-1">
              {BOD_MAIN_HOUSE.map((e) => {
                const current = bodVals[e.key] ?? (e.numeric != null ? fmtNum(e.numeric) : e.value);
                const edited =
                  bodVals[e.key] != null &&
                  bodVals[e.key] !== (e.numeric != null ? fmtNum(e.numeric) : e.value);
                return (
                  <div key={e.key} className="flex items-baseline gap-2 py-px">
                    <span className="w-9 shrink-0" />
                    <span
                      className="min-w-0 flex-1 truncate t-caption"
                      style={{ color: token("ink-2") }}
                      title={e.label}
                    >
                      {e.label}
                    </span>
                    <StateCell
                      scale="row"
                      value={current}
                      numeric={e.numeric != null ? {} : undefined}
                      onCommit={(t) => setBodVals((s) => ({ ...s, [e.key]: t }))}
                      stage={edited ? "staged" : "clean"}
                      note="no binding — authored value only; never leaves the page"
                      className="w-24 shrink-0 text-right"
                    />
                    <span className="w-9 shrink-0 t-caption" style={{ color: token("ink-mute") }}>
                      {e.unit ?? ""}
                    </span>
                  </div>
                );
              })}
            </div>
          </ArtifactFrame>
        </div>

        {/* ------------------------------------------------------------------ */}
        {/* RIGHT — THE LEDGER. The dominant surface; the page's product.      */}
        {/* ------------------------------------------------------------------ */}
        <div className="flex min-w-0 flex-1 flex-col gap-2 overflow-y-auto p-3 pl-0">
          <ArtifactFrame
            head={
              <div className="flex items-center gap-2">
                <span className="t-value font-medium">Binding ledger</span>
                <HelpTip>
                  One row per linkage. Direction is a property of the binding: → writes the model
                  from the table, ← feeds the table from the model. A binding moves through the
                  stations above the table; the verbs live between stations, and Apply refuses while
                  any evaluation is stale — the gate is visible, not implied.
                </HelpTip>
                <span className="flex-1" />
                <span className="font-mono t-caption" style={{ color: token("ink-mute") }}>
                  {TYPE_GROUPS.length} types · {FC_UNITS.length} tags in scope
                </span>
              </div>
            }
            foot={
              <div className="flex flex-col gap-0.5">
                {outcomes.length === 0 ? (
                  <span className="t-caption italic" style={{ color: token("ink-mute") }}>
                    no verbs have run — edit a bound cell, evaluate, apply
                  </span>
                ) : (
                  outcomes.map((o, i) => (
                    <OutcomeLine key={i} kind={o.kind} label={o.label} says={o.says} />
                  ))
                )}
              </div>
            }
          >
            {/* LANG GAP: the state-machine station strip — no canon component renders a
                lifecycle with live counts and the verbs between stations. Built raw; this
                is the surface that makes the (previously invisible) freshness gate legible. */}
            <div
              className="flex flex-wrap items-center gap-1.5 border-b px-3 py-2 t-caption"
              style={{ borderColor: token("line") }}
            >
              <Station word="fresh" n={nFresh} ink={token("ink-mute")} title={STATUS_TITLE.fresh} />
              <Arrow label="source edit" />
              <Station word="stale" n={nStale} ink={token("caution")} title={STATUS_TITLE.stale} />
              <span style={{ color: token("ink-mute") }}>·</span>
              <Station word="drift" n={nDrift} ink={token("alarm")} title={STATUS_TITLE.drift} />
              <Arrow />
              <Verb
                label="Evaluate"
                onClick={onEvaluate}
                disabled={evaluable.length === 0}
                reason={
                  evaluable.length === 0
                    ? "nothing stale or drifting — edit a bound source cell first"
                    : `compute per-target verdicts for ${evaluable.length} binding${evaluable.length > 1 ? "s" : ""} — side-effect free`
                }
              />
              <Arrow />
              <Station
                word="staged"
                n={nStaged}
                ink={token("caution")}
                title={STATUS_TITLE.staged}
              />
              {nStagedStale > 0 ? (
                <Station
                  word="staged·stale"
                  n={nStagedStale}
                  ink={token("alarm")}
                  title={STATUS_TITLE["staged-stale"]}
                />
              ) : null}
              <Arrow label="Apply — the head verb" />
              <span style={{ color: token("ink-mute") }}>fresh</span>
            </div>

            <table className="w-full t-value" style={{ borderCollapse: "collapse" }}>
              <thead>
                <tr
                  className="text-left t-caption uppercase tracking-wider"
                  style={{ color: token("ink-mute") }}
                >
                  <th className="px-3 py-1.5 font-medium">dir</th>
                  <th className="px-2 py-1.5 font-medium">source</th>
                  <th className="px-2 py-1.5 font-medium">target parameter</th>
                  <th className="px-2 py-1.5 font-medium">far side</th>
                  <th className="px-2 py-1.5 font-medium">status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ def, status }) => {
                  const isSel = selected === def.id;
                  const open = isSel || status === "staged" || status === "staged-stale";
                  const snap = evals[def.id];
                  const verdicts = verdictsFor(def, snap ?? authored[def.key], typeVals);
                  const staged = snap != null;
                  const meta = META.get(def.paramName);
                  return (
                    <FragmentRow key={def.id}>
                      <tr
                        className="cursor-pointer border-t"
                        style={{
                          borderColor: token("line"),
                          ...(isSel
                            ? ({
                                backgroundColor: token("select"),
                                "--pe-on": token("select"),
                              } as React.CSSProperties)
                            : null),
                        }}
                        onClick={() => setSelected(isSel ? null : def.id)}
                        title={STATUS_TITLE[status]}
                      >
                        <td
                          className="px-3 py-1.5 font-mono"
                          title="outbound — the table writes the model"
                        >
                          →
                        </td>
                        <td className="px-2 py-1.5">
                          <span className="font-mono">{def.addr}</span>{" "}
                          <span style={{ color: token("ink-mute") }}>{def.label}</span>
                        </td>
                        <td className="px-2 py-1.5">
                          <span className="font-mono">{def.paramName}</span>{" "}
                          <span style={{ color: token("ink-mute") }}>
                            {meta?.label} · {meta?.scope} scope
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-2 py-1.5 font-mono">
                          {TYPE_GROUPS.length} types · {FC_UNITS.length} tags
                        </td>
                        <td className="whitespace-nowrap px-2 py-1.5">
                          {/* LANG GAP: status word — see STATUS_INK above. */}
                          <span
                            className={cn(status === "staged" && "font-semibold")}
                            style={{ color: STATUS_INK[status] }}
                          >
                            {status === "staged"
                              ? `staged · ${verdicts.filter((v) => v.verdict === "write").length} write · ${verdicts.filter((v) => v.verdict === "refuse").length} refuse`
                              : status === "staged-stale"
                                ? "staged — evaluation stale"
                                : status}
                          </span>
                        </td>
                      </tr>
                      {open ? (
                        <tr>
                          <td colSpan={5} className="px-3 pb-2 pt-0">
                            <FarSide
                              verdicts={verdicts}
                              staged={staged}
                              stagedStale={status === "staged-stale"}
                              unit={meta?.unit ?? ""}
                            />
                          </td>
                        </tr>
                      ) : null}
                    </FragmentRow>
                  );
                })}

                {/* The inbound binding — the model feeds the table. */}
                <FragmentRow>
                  <tr
                    className="cursor-pointer border-t"
                    style={{
                      borderColor: token("line"),
                      ...(selected === IN_DEF.id
                        ? ({
                            backgroundColor: token("select"),
                            "--pe-on": token("select"),
                          } as React.CSSProperties)
                        : null),
                    }}
                    onClick={() => setSelected(selected === IN_DEF.id ? null : IN_DEF.id)}
                    title="inbound — the model feeds the table cell; recomputed every render, fresh by construction"
                  >
                    <td
                      className="px-3 py-1.5 font-mono"
                      title="inbound — the model feeds the table"
                    >
                      ←
                    </td>
                    <td className="px-2 py-1.5">
                      <span className="font-mono">{IN_DEF.addr}</span>{" "}
                      <span style={{ color: token("ink-mute") }}>{IN_DEF.label}</span>
                    </td>
                    <td className="px-2 py-1.5">
                      <span className="font-mono">{IN_DEF.paramName}</span>{" "}
                      <span style={{ color: token("ink-mute") }}>reduce: Σ {IN_DEF.reducer}</span>
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5 font-mono">
                      {FC_UNITS.length} tags · Σ
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5">
                      <span style={{ color: STATUS_INK.fresh }}>fresh · live</span>
                    </td>
                  </tr>
                  {selected === IN_DEF.id ? (
                    <tr>
                      <td colSpan={5} className="px-3 pb-2 pt-0">
                        <InboundFarSide />
                      </td>
                    </tr>
                  ) : null}
                </FragmentRow>
              </tbody>
            </table>
          </ArtifactFrame>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

/** Keyed fragment for a row pair (row + its far-side lane). */
function FragmentRow({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

function Station({ word, n, ink, title }: { word: string; n: number; ink: string; title: string }) {
  return (
    <span
      className="flex items-baseline gap-1 border px-1.5 py-0.5"
      style={{
        borderColor: token("line"),
        color: n > 0 ? ink : token("ink-mute"),
        opacity: n > 0 ? 1 : 0.6,
      }}
      title={title}
    >
      <span className="font-mono">{n}</span>
      <span>{word}</span>
    </span>
  );
}

function Arrow({ label }: { label?: string }) {
  return (
    <span className="flex items-baseline gap-1 t-caption" style={{ color: token("ink-mute") }}>
      {label != null ? <span className="italic">{label}</span> : null}
      <span>→</span>
    </span>
  );
}

/**
 * The far side of an outbound binding: one row per TYPE (the write's real grain),
 * with the tags it fans out to, the model's current value, the proposed value when
 * staged, and the per-target verdict.
 *
 * LANG GAP: no canon primitive for a per-target verdict lane (write/refuse/no-op
 * with reasons); the verdict words borrow meaning tokens directly.
 */
function FarSide({
  verdicts,
  staged,
  stagedStale,
  unit,
}: {
  verdicts: TargetVerdict[];
  staged: boolean;
  stagedStale: boolean;
  unit: string;
}) {
  return (
    <div className="ml-5 border-l pl-3" style={{ borderColor: token("line-2") }}>
      {stagedStale ? (
        <div className="py-1 t-caption" style={{ color: token("alarm") }}>
          these verdicts were computed against a source value that has since moved — they will not
          be applied; re-evaluate
        </div>
      ) : null}
      <table className="t-caption" style={{ borderCollapse: "collapse" }}>
        <thead>
          <tr
            className="text-left t-caption uppercase tracking-wider"
            style={{ color: token("ink-mute") }}
          >
            <th className="py-0.5 pr-4 font-medium">type</th>
            <th className="py-0.5 pr-4 font-medium">tags hit</th>
            <th className="py-0.5 pr-4 font-medium">model holds</th>
            <th className="py-0.5 pr-4 font-medium">{staged ? "proposed" : ""}</th>
            <th className="py-0.5 font-medium">{staged ? "verdict" : "writability"}</th>
          </tr>
        </thead>
        <tbody>
          {verdicts.map((v) => {
            const modelTags = MODEL_TAG_COUNT[v.typeName];
            return (
              <tr key={v.typeName}>
                <td className="py-0.5 pr-4 font-mono">{v.typeName}</td>
                <td
                  className="whitespace-nowrap py-0.5 pr-4 font-mono"
                  title={v.tags.map((t) => t.tag).join(", ")}
                >
                  {v.tags.length}
                  {modelTags != null && modelTags > v.tags.length ? (
                    <span
                      style={{ color: token("caution") }}
                      title={`the model holds ${modelTags} tags of this type; ${v.tags.length} are in this schedule (23 of 36 FC-* scheduled) — a type write hits them all`}
                    >
                      {" "}
                      +{modelTags - v.tags.length} unscheduled = {modelTags} in model
                    </span>
                  ) : null}
                </td>
                <td className="py-0.5 pr-4 font-mono">
                  {fmtNum(v.current)} {unit}
                </td>
                <td className="py-0.5 pr-4 font-mono">
                  {staged && v.verdict !== "noop"
                    ? `→ ${fmtNum(v.proposed)} ${unit}`
                    : staged
                      ? "—"
                      : ""}
                </td>
                <td className="py-0.5">
                  {staged ? (
                    v.verdict === "write" ? (
                      <span className="font-semibold" style={{ color: token("caution") }}>
                        write
                      </span>
                    ) : v.verdict === "refuse" ? (
                      <span style={{ color: token("alarm") }} title={v.reason}>
                        refuse — {v.reason}
                      </span>
                    ) : (
                      <span style={{ color: token("ink-mute") }}>no-op — already equal</span>
                    )
                  ) : v.readOnly ? (
                    <span style={{ color: token("ink-mute") }}>formula-owned (read-only)</span>
                  ) : (
                    <span style={{ color: token("ink-mute") }}>writable</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** The far side of the inbound binding: per-type contributions to the Σ. */
function InboundFarSide() {
  return (
    <div className="ml-5 border-l pl-3" style={{ borderColor: token("line-2") }}>
      <table className="t-caption" style={{ borderCollapse: "collapse" }}>
        <thead>
          <tr
            className="text-left t-caption uppercase tracking-wider"
            style={{ color: token("ink-mute") }}
          >
            <th className="py-0.5 pr-4 font-medium">type</th>
            <th className="py-0.5 pr-4 font-medium">tags read</th>
            <th className="py-0.5 font-medium">Σ contribution</th>
          </tr>
        </thead>
        <tbody>
          {TYPE_GROUPS.map((g) => (
            <tr key={g.typeName}>
              <td className="py-0.5 pr-4 font-mono">{g.typeName}</td>
              <td className="py-0.5 pr-4 font-mono" title={g.tags.map((t) => t.tag).join(", ")}>
                {g.tags.length}
              </td>
              <td className="py-0.5 font-mono">
                {g.tags.reduce((n, t) => n + t.heat.capTotal, 0).toLocaleString("en-US")} Btu/h
              </td>
            </tr>
          ))}
          <tr className="border-t" style={{ borderColor: token("line") }}>
            <td className="py-0.5 pr-4" style={{ color: token("ink-mute") }}>
              total → {IN_DEF.addr}
            </td>
            <td className="py-0.5 pr-4 font-mono">{FC_UNITS.length}</td>
            <td className="py-0.5 font-mono">{CAP_TOTAL.toLocaleString("en-US")} Btu/h</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
