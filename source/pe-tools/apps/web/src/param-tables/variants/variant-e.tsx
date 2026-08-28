import { token } from "#/lib/token";

/**
 * VARIANT E — "there is no new page".
 *
 * THE BET: the param-tables product is not a new surface — it is the canonical cross-cutting
 * equipment table (SURFACE-PHILOSOPHY §0: "the cross-cutting view is the product") finally
 * getting AUTHORED INPUTS. The page is the 23-fan-coil × PE_* attribute grid. The FOM exhibit
 * and the BOD list are LENSES: saved projections over the SAME substrate — switching lens
 * re-projects, it never re-states (§2 pseudo-dimension law: keyed lookups, no new state model).
 * Authored design facts (heating EWT/LWT, ODT) live in a thin authored lane pinned ON the
 * grid's frame; their fan-out IS the column — one edit stages a whole type-scope column,
 * grouped by type so the far side of the bulk write is visible (§2: "a bulk verb is disabled
 * unless you can see its far side").
 *
 * Staging is DERIVED, never stored (§1 "compute agreement; do not remember it"):
 *   authored fact {value, committed} × model type-param value →
 *     edited & model ≠ draft   → staged   (your unsaved square, whole column by type)
 *     formula-owned type       → locked   (refuses per-target, reason on the cell)
 *     model ≠ committed        → drift    (the one alarm)
 *
 * The master-table primitive is NOT imported: this is a hand-rolled <table> speaking the same
 * cell vocabulary (StateCell row scale). Folding a lens seam + a pinned authored band + type
 * group-header rows into MasterTable's API would fight the prototype (§6: sharing costs the
 * consumer its layout freedom); a promoted version of this variant would grow those seams on
 * the primitive instead.
 *
 * LANG GAPS left in place (search "// LANG GAP"):
 *   1 drift's ghost/`modelValue` is defined model-side ("the value the model currently holds");
 *     here the disagreement is authored-side, so the cells carry it in `note` instead.
 *   2 no mark exists for a LINKED cell (bound to an authored fact) or an INBOUND cell (read
 *     from the model) — the linkage is only legible from column heads and hover titles.
 *   3 no primitive for a pinned authored band on a machine-operated table.
 *   4 no primitive for a type group-header row ("these rows stage together").
 */
import { Fragment, useState } from "react";

import { AddressingBar } from "#/components/lang/addressing-bar";
import { ArtifactFrame } from "#/components/lang/artifact-frame";
import { fmtNum, StateCell, type StateCellProps } from "#/components/lang/cell";
import { FactChip } from "#/components/lang/chip";
import { HelpTip } from "#/components/lang/help";
import { OutcomeLine, type OutcomeKind } from "#/components/lang/outcome";
import { Switcher } from "#/components/lang/switcher";
import { Verb } from "#/components/lang/verb";
import {
  BOD_MAIN_HOUSE,
  FC_UNITS,
  FOM_HWCH_PLANT,
  PARAM_META,
  type FcRow,
  type ParamMeta,
} from "#/param-tables/variants/fixture";

// ---------------------------------------------------------------------------
// Substrate shape — one state model; every lens is a lookup over it.
// ---------------------------------------------------------------------------

interface TypeVals {
  ewt: number;
  lwt: number;
}
type Model = Record<string, TypeVals>;

interface TypeGroup {
  name: string;
  rows: FcRow[];
}

/** Rows grouped by family type — perf params live at TYPE scope, so the group IS the write unit. */
const GROUPS: TypeGroup[] = (() => {
  const byType = new Map<string, FcRow[]>();
  for (const row of FC_UNITS) {
    const bucket = byType.get(row.typeName);
    if (bucket != null) bucket.push(row);
    else byType.set(row.typeName, [row]);
  }
  return [...byType.entries()].map(([name, rows]) => ({ name, rows }));
})();

const initialModel = (): Model =>
  Object.fromEntries(
    GROUPS.map((g) => {
      const first = g.rows[0];
      if (first == null) throw new Error("empty type group");
      return [g.name, { ewt: first.heat.ewt, lwt: first.heat.lwt }];
    }),
  );

type FactKey = "heatEwt" | "heatLwt" | "odtWinter";

interface Fact {
  label: string;
  unit: string;
  /** The draft the user is authoring. */
  value: number;
  /** The last committed authored value — staging is value ≠ committed, derived every render. */
  committed: number;
  /** The parameter this fact fans out to; absent ⇒ no home in this model (seam). */
  target?: string;
}
type Facts = Record<FactKey, Fact>;

const INITIAL_FACTS: Facts = {
  heatEwt: {
    label: "Heating EWT",
    unit: "°F",
    value: 110,
    committed: 110,
    target: "PE_M_PerfHeat_FluidEWT",
  },
  heatLwt: {
    label: "Heating LWT",
    unit: "°F",
    value: 100,
    committed: 100,
    target: "PE_M_PerfHeat_FluidLWT",
  },
  // Real BOD fact with no PE_* target in this model — renders as the reserved seam, honestly.
  odtWinter: { label: "Outdoor design temp (winter DB)", unit: "°F", value: 9.4, committed: 9.4 },
};

interface Link {
  factKey: "heatEwt" | "heatLwt";
  param: ParamMeta;
  get: (v: TypeVals) => number;
  set: (v: TypeVals, n: number) => TypeVals;
}

const param = (name: string): ParamMeta => {
  const found = PARAM_META.find((p) => p.name === name);
  if (found == null) throw new Error(`unknown param ${name}`);
  return found;
};

const LINKS: Link[] = [
  {
    factKey: "heatEwt",
    param: param("PE_M_PerfHeat_FluidEWT"),
    get: (v) => v.ewt,
    set: (v, n) => ({ ...v, ewt: n }),
  },
  {
    factKey: "heatLwt",
    param: param("PE_M_PerfHeat_FluidLWT"),
    get: (v) => v.lwt,
    set: (v, n) => ({ ...v, lwt: n }),
  },
];

const isFormulaOwned = (link: Link, typeName: string): boolean =>
  link.param.readOnlyOn?.includes(typeName) === true;

/** Live inbound reading: Σ heating design capacity over the rows in scope. */
const HEAT_CAP_SUM = FC_UNITS.reduce((sum, r) => sum + r.heat.capTotal, 0);

type Lens = "grid" | "fom" | "bod";

interface Outcome {
  kind: OutcomeKind;
  label: string;
  says?: string;
}

// One staged type-write, derived — includes the ones that will refuse.
interface TypeWrite {
  group: TypeGroup;
  link: Link;
  from: number;
  to: number;
  refusal?: string;
}

const COLS = 10; // grid column count, for group-header colSpan

const muted: React.CSSProperties = { color: token("ink-mute") };
const secondary: React.CSSProperties = { color: token("ink-2") };
const hairline = `1px solid ${token("line")}`;

export function VariantE() {
  const [lens, setLens] = useState<Lens>("grid");
  const [facts, setFacts] = useState<Facts>(INITIAL_FACTS);
  const [model, setModel] = useState<Model>(initialModel);
  const [outcomes, setOutcomes] = useState<Outcome[]>([]);

  // ------------------------------------------------------------------ derive
  const writes: TypeWrite[] = [];
  const drifting: { group: TypeGroup; link: Link; cur: number }[] = [];
  for (const group of GROUPS) {
    const vals = model[group.name];
    if (vals == null) continue;
    for (const link of LINKS) {
      const fact = facts[link.factKey];
      const cur = link.get(vals);
      const edited = fact.value !== fact.committed;
      if (edited) {
        if (isFormulaOwned(link, group.name)) {
          writes.push({
            group,
            link,
            from: cur,
            to: fact.value,
            refusal: `${link.param.name} is formula-owned on ${group.name} — the write refuses`,
          });
        } else if (cur !== fact.value) {
          writes.push({ group, link, from: cur, to: fact.value });
        }
      } else if (cur !== fact.committed) {
        drifting.push({ group, link, cur });
      }
    }
  }
  const applicable = writes.filter((w) => w.refusal == null);
  const refusals = writes.filter((w) => w.refusal != null);
  const stagedRows = applicable.reduce((n, w) => n + w.group.rows.length, 0);
  const driftRows = drifting.reduce((n, d) => n + d.group.rows.length, 0);

  // ------------------------------------------------------------------- verbs
  const setFactValue = (key: FactKey, value: number) =>
    setFacts((f) => ({ ...f, [key]: { ...f[key], value } }));

  const apply = () => {
    const next: Model = { ...model };
    const lines: Outcome[] = [];
    for (const w of writes) {
      if (w.refusal != null) {
        lines.push({
          kind: "refused",
          label: `${w.link.param.name} · ${w.group.name}`,
          says: w.refusal,
        });
        continue;
      }
      const vals = next[w.group.name];
      if (vals == null) continue;
      next[w.group.name] = w.link.set(vals, w.to);
      lines.push({
        kind: "receipt",
        label: `${w.link.param.name} ${fmtNum(w.from, 1)} → ${fmtNum(w.to, 1)} · ${w.group.name}`,
        says: `one type write — ${w.group.rows.length} row${w.group.rows.length === 1 ? "" : "s"} moved together`,
      });
    }
    const summary: Outcome =
      refusals.length > 0
        ? {
            kind: "partial",
            label: `${applicable.length}/${writes.length} type writes applied · ${stagedRows} rows moved · ${refusals.length} refused`,
            says: "refused targets keep their formula value — the disagreement now reads as drift",
          }
        : {
            kind: "receipt",
            label: `${applicable.length} type writes applied · ${stagedRows} rows moved`,
            says: "mock apply — in-memory only in this prototype",
          };
    setModel(next);
    setFacts(
      (f) =>
        Object.fromEntries(
          Object.entries(f).map(([k, v]) => [k, { ...v, committed: v.value }]),
        ) as Facts,
    );
    setOutcomes([summary, ...lines]);
  };

  // ------------------------------------------------------- cell state (grid)
  const linkedCellProps = (group: TypeGroup, link: Link): StateCellProps => {
    const vals = model[group.name];
    const fact = facts[link.factKey];
    const cur = vals != null ? link.get(vals) : Number.NaN;
    const edited = fact.value !== fact.committed;
    if (isFormulaOwned(link, group.name)) {
      const wants = edited ? fact.value : fact.committed;
      return {
        scale: "row",
        value: fmtNum(cur, 1),
        cap: "readonly",
        capReason:
          cur !== wants
            ? `formula-owned on this type — authored ${fact.label} says ${fmtNum(wants, 1)}, the formula holds ${fmtNum(cur, 1)}; a write refuses`
            : "formula-owned on this type — writes refuse",
      };
    }
    if (edited && cur !== fact.value) {
      return {
        scale: "row",
        value: fmtNum(fact.value, 1),
        stage: "staged",
        stagedBy: "you",
        note: `staged from authored ${fact.label} — model holds ${fmtNum(cur, 1)}; commits with the type (${group.rows.length} rows)`,
      };
    }
    if (cur !== fact.committed) {
      // LANG GAP (1): drift's `modelValue` ghost is defined as "the value the model currently
      // holds" — here the model IS what is shown and the AUTHORED side disagrees, so the ghost
      // slot would lie. The authored value rides in `note` (title at row scale) instead.
      return {
        scale: "row",
        value: fmtNum(cur, 1),
        agree: "drift",
        note: `model drifted — authored ${fact.label} is ${fmtNum(fact.committed, 1)}`,
      };
    }
    return {
      scale: "row",
      value: fmtNum(cur, 1),
      note: `linked ← authored ${fact.label} (${link.param.name})`,
    };
  };

  // -------------------------------------------------- the one authored editor
  // Rendered in the authored lane AND inside the BOD lens (§4 "one editor, one implementation").
  const factCell = (key: FactKey) => {
    const fact = facts[key];
    if (fact.target == null) {
      return (
        <StateCell
          scale="row"
          value={fmtNum(fact.value, 1)}
          cap="nohome"
          capReason="no parameter target in this model — lives only as BOD prose today"
        />
      );
    }
    return (
      <StateCell
        scale="row"
        value={fmtNum(fact.value, 1)}
        stage={fact.value !== fact.committed ? "staged" : "clean"}
        stagedBy="you"
        numeric={{ digits: 1 }}
        onCommit={(text) => {
          setFactValue(key, Number(text));
        }}
        note={`authored design fact → ${fact.target} · type scope · ${GROUPS.length} types · ${FC_UNITS.length} rows`}
      />
    );
  };

  // ----------------------------------------------------------------- renders
  const linkedHead = (link: Link) => {
    const fact = facts[link.factKey];
    return (
      // LANG GAP (2): no cell/column mark exists for "linked to an authored fact" — the
      // linkage is carried by this hand-rolled column head and hover titles only.
      <th
        key={link.param.name}
        className="px-2 py-1 text-left align-top font-normal"
        title={`linked column — every value flows from the authored fact "${fact.label}"; edit it in the design-facts lane`}
      >
        <span className="block t-caption" style={secondary}>
          {fact.label} ⟵ authored
        </span>
        <span className="block font-mono t-caption" style={muted}>
          {link.param.name}
        </span>
      </th>
    );
  };

  const plainHead = (label: string, sub?: string) => (
    <th className="px-2 py-1 text-left align-top font-normal">
      <span className="block t-caption" style={secondary}>
        {label}
      </span>
      {sub != null ? (
        <span className="block font-mono t-caption" style={muted}>
          {sub}
        </span>
      ) : (
        <span className="block t-caption">&nbsp;</span>
      )}
    </th>
  );

  const gridLens = (
    <table
      className="w-full border-collapse text-xs"
      style={{ ["--pe-on" as string]: token("artifact") }}
    >
      <thead>
        <tr
          style={{
            position: "sticky",
            top: 0,
            zIndex: 2,
            background: token("artifact"),
            boxShadow: `inset 0 -1px ${token("line")}`,
          }}
        >
          {plainHead("Tag")}
          {plainHead("Serves")}
          {plainHead("Location")}
          {plainHead("Model")}
          {plainHead("Heat capacity", "Btu/h · inbound")}
          {plainHead("Heat flow", "GPM")}
          {linkedHead(LINKS[0] as Link)}
          {linkedHead(LINKS[1] as Link)}
          {plainHead("Cool total", "Btu/h")}
          {plainHead("MCA", "A")}
        </tr>
      </thead>
      <tbody>
        {GROUPS.map((group) => {
          const groupWrites = applicable.filter((w) => w.group.name === group.name);
          const groupRefusals = refusals.filter((w) => w.group.name === group.name);
          return (
            <Fragment key={group.name}>
              {/* LANG GAP (4): no primitive for a type group-header row — this hand-rolled band
                  is what makes "one type write = N rows stage together" legible. */}
              <tr style={{ background: token("recess"), ["--pe-on" as string]: token("recess") }}>
                <td colSpan={COLS} className="px-2 py-1" style={{ borderTop: hairline }}>
                  <span className="font-mono t-caption">{group.name}</span>
                  <span className="ml-2 t-caption" style={muted}>
                    {group.rows.length} row{group.rows.length === 1 ? "" : "s"} · perf params at
                    type scope
                  </span>
                  {groupWrites.length > 0 ? (
                    <span className="ml-2 t-caption" style={{ color: token("caution") }}>
                      one type write —{" "}
                      {groupWrites
                        .map((w) => w.link.param.name.replace("PE_M_PerfHeat_Fluid", ""))
                        .join(" + ")}{" "}
                      stage {group.rows.length} row{group.rows.length === 1 ? "" : "s"} together
                    </span>
                  ) : null}
                  {groupRefusals.length > 0 ? (
                    <span className="ml-2 t-caption" style={{ color: token("alarm") }}>
                      {groupRefusals
                        .map((w) => w.link.param.name.replace("PE_M_PerfHeat_Fluid", ""))
                        .join(" + ")}{" "}
                      refuses — formula-owned
                    </span>
                  ) : null}
                </td>
              </tr>
              {group.rows.map((row) => (
                <tr key={row.tag} style={{ borderTop: hairline }}>
                  <td className="px-2 py-0.5 font-mono">{row.tag}</td>
                  <td className="px-2 py-0.5">{row.serves}</td>
                  <td className="px-2 py-0.5" style={secondary}>
                    {row.location}
                  </td>
                  <td className="px-2 py-0.5 font-mono t-caption" style={secondary}>
                    {row.model}
                  </td>
                  <td
                    className="px-2 py-0.5 font-mono"
                    title="inbound — read from PE_M_PerfHeat_CapacityDesignTotal on the type"
                  >
                    {row.heat.capTotal.toLocaleString()}
                  </td>
                  <td className="px-2 py-0.5 font-mono">{fmtNum(row.heat.gpm, 1)}</td>
                  {LINKS.map((link) => (
                    <td key={link.param.name} className="px-2 py-0.5 font-mono">
                      <StateCell {...linkedCellProps(group, link)} />
                    </td>
                  ))}
                  <td className="px-2 py-0.5 font-mono">{row.cool.total.toLocaleString()}</td>
                  <td className="px-2 py-0.5 font-mono">{fmtNum(row.mca, 1)}</td>
                </tr>
              ))}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );

  // The FOM exhibit: the print-shaped 5×11 projection of the SAME substrate. Layout comes from
  // the fixture; the heating Load cell is INBOUND — recomputed from the grid's rows, not retyped.
  const fomLens = (
    <div className="p-6">
      <div className="mb-2 t-caption" style={secondary}>
        <span className="font-mono">SXL - FOM HWCH Plant</span> → sheet exhibit · a saved projection
        of the same {FC_UNITS.length}-row substrate — switching lens re-projects, nothing is retyped
      </div>
      <table className="border-collapse text-xs" style={{ border: hairline }}>
        <tbody>
          <tr>
            <td
              colSpan={3}
              className="px-3 py-1 text-center"
              style={{ border: hairline, ...secondary }}
            >
              {FOM_HWCH_PLANT.groupRow[0]}
            </td>
            <td
              colSpan={4}
              className="px-3 py-1 text-center"
              style={{ border: hairline, ...secondary }}
            >
              {FOM_HWCH_PLANT.groupRow[3]}
            </td>
            <td
              colSpan={4}
              className="px-3 py-1 text-center"
              style={{ border: hairline, ...secondary }}
            >
              {FOM_HWCH_PLANT.groupRow[7]}
            </td>
          </tr>
          <tr>
            {FOM_HWCH_PLANT.headRow.map((head, i) => (
              <td
                key={i}
                className="px-3 py-1 text-center t-caption"
                style={{ border: hairline, ...secondary }}
              >
                {head}
              </td>
            ))}
          </tr>
          <tr>
            {FOM_HWCH_PLANT.dataRow.map((cell, i) =>
              i === 9 ? (
                // LANG GAP (2): the inbound cell has no reserved mark either — hover carries it.
                <td
                  key={i}
                  className="px-3 py-1 text-center font-mono"
                  style={{ border: hairline }}
                >
                  <StateCell
                    scale="row"
                    value={HEAT_CAP_SUM.toLocaleString()}
                    agree="drift"
                    note={`inbound — Σ PE_M_PerfHeat_CapacityDesignTotal over ${FC_UNITS.length} fan-coil rows; the printed SXL exhibit held ${cell} (stale dead text)`}
                  />
                </td>
              ) : (
                <td
                  key={i}
                  className={`px-3 py-1 text-center ${i >= 3 ? "font-mono" : ""}`}
                  style={{ border: hairline }}
                  title={
                    i >= 3
                      ? "dead text in the SXL exhibit — would become an authored fact or an inbound reading"
                      : undefined
                  }
                >
                  {cell}
                </td>
              ),
            )}
          </tr>
          <tr>
            <td
              colSpan={11}
              className="px-3 py-1 text-left italic t-caption"
              style={{ border: hairline, ...muted }}
            >
              {FOM_HWCH_PLANT.footnote}
            </td>
          </tr>
        </tbody>
      </table>
      <div className="mt-2 t-caption" style={muted}>
        heating Load reads live from the grid's rows — the printed exhibit disagreed, and the
        squiggle says so
      </div>
    </div>
  );

  const bodLens = (
    <div className="p-6">
      <div className="mb-2 t-caption" style={secondary}>
        <span className="font-mono">SXL - M_BOD_MainHouse</span> (sheet M001) · label × value
        projection of the same substrate — authored facts render through the same editor as the lane
      </div>
      <table className="border-collapse text-xs">
        <tbody>
          {BOD_MAIN_HOUSE.map((entry) => (
            <tr key={entry.key} style={{ borderTop: hairline }}>
              <td className="max-w-xl px-2 py-1 pr-6">{entry.label}</td>
              <td className="px-2 py-1 font-mono">
                {entry.key === "odt-winter" ? (
                  factCell("odtWinter")
                ) : entry.numeric != null ? (
                  entry.value
                ) : (
                  <span className="font-sans" style={secondary}>
                    {entry.value}
                  </span>
                )}
              </td>
              <td className="px-2 py-1 t-caption" style={muted}>
                {entry.unit ?? ""}
                {entry.key === "odt-winter" ? " · authored design fact" : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <AddressingBar
        name="param tables"
        sentence={
          <span className="flex items-center gap-1.5 text-xs">
            <span className="font-mono">ProjectA_Clone_Aug_11</span>
            <span style={muted}>›</span>
            <span>Mechanical Equipment</span>
            <span style={muted}>›</span>
            <span>Main House fan coils</span>
          </span>
        }
        facts={
          <>
            <FactChip title="rows and family types in scope — the substrate every lens projects">
              {FC_UNITS.length} rows · {GROUPS.length} types
            </FactChip>
            {stagedRows > 0 ? (
              <FactChip
                tone="caution"
                title="unsaved — staged type writes derived from authored-fact edits; apply commits them"
              >
                {applicable.length} type writes · {stagedRows} rows staged
              </FactChip>
            ) : null}
            {driftRows > 0 ? (
              <FactChip
                tone="alarm"
                title="the model disagrees with a committed authored fact on these rows"
              >
                {driftRows} rows drift
              </FactChip>
            ) : null}
          </>
        }
        verb={
          <Verb
            tone="commit"
            label="Apply staged writes"
            onClick={apply}
            disabled={applicable.length === 0}
            reason={
              applicable.length > 0
                ? `Writes ${applicable.length} type parameter${applicable.length === 1 ? "" : "s"} (${stagedRows} rows) in ProjectA_Clone_Aug_11${refusals.length > 0 ? ` — ${refusals.length} target${refusals.length === 1 ? "" : "s"} will refuse (formula-owned)` : ""} · mock, in-memory`
                : refusals.length > 0
                  ? "every staged write refuses — the edited fact only targets formula-owned types"
                  : "nothing is staged — edit a design fact in the authored lane first"
            }
          />
        }
        seam={
          <FactChip
            dashed
            title="prototype fixture lane — pulled from ProjectA_Clone_Aug_11 on 2026-08-17; a live host session would replace this"
          >
            fixture · ProjectA_Clone_Aug_11
          </FactChip>
        }
      />

      {outcomes.length > 0 ? (
        <div className="flex flex-col gap-0.5 px-4 py-1">
          {outcomes.map((o, i) => (
            <OutcomeLine key={i} kind={o.kind} label={o.label} says={o.says} />
          ))}
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col px-4 pb-4 pt-2">
        <ArtifactFrame
          className="flex min-h-0 flex-1 flex-col"
          head={
            <span className="flex w-full items-center gap-3">
              <span className="text-xs">Main House fan coils × PE_* parameters</span>
              <HelpTip>
                One substrate, three lenses. The grid is every fan coil × every attribute; the FOM
                exhibit and the BOD list are saved projections of the same rows and the same
                authored facts — switching lens re-projects, it never copies. The authored lane
                below is the write path: edit a design fact and its whole linked column stages,
                grouped by type, because the parameters live at type scope.
              </HelpTip>
              <Switcher<Lens>
                ariaLabel="Lens"
                value={lens}
                onChange={setLens}
                options={[
                  {
                    value: "grid",
                    label: "Grid",
                    title: "Every fan coil × every attribute — the substrate itself",
                  },
                  {
                    value: "fom",
                    label: "FOM exhibit",
                    title:
                      "The print-shaped FOM HWCH Plant projection — same substrate, 5×11 sheet layout",
                  },
                  {
                    value: "bod",
                    label: "BOD",
                    title:
                      "The M001 Basis of Design projection — label × value over the same authored facts",
                  },
                ]}
              />
            </span>
          }
          foot={
            <span className="flex w-full items-center gap-3 t-caption" style={secondary}>
              <span>
                {FC_UNITS.length} rows · {GROUPS.length} type groups
              </span>
              {applicable.length > 0 ? (
                <span style={{ color: token("caution") }}>
                  {applicable.length} type writes stage {stagedRows} rows
                  {refusals.length > 0 ? ` · ${refusals.length} will refuse` : ""}
                </span>
              ) : (
                <span style={muted}>no staged writes</span>
              )}
              <span className="ml-auto font-mono" style={muted}>
                lens: {lens}
              </span>
            </span>
          }
        >
          {/* LANG GAP (3): the authored lane — a pinned band of design facts riding ON the
              machine-operated table — has no primitive; hand-rolled, hairline-separated,
              deliberately on the frame's own ground (border budget: no second enclosure). */}
          <div className="flex items-start gap-6 px-3 py-2" style={{ borderBottom: hairline }}>
            <span className="pt-0.5 t-caption" style={secondary}>
              design facts
            </span>
            {(Object.keys(facts) as FactKey[]).map((key) => {
              const fact = facts[key];
              return (
                <span key={key} className="flex items-baseline gap-1.5">
                  <span className="t-caption" style={secondary}>
                    {fact.label}
                  </span>
                  <span className="w-14 font-mono text-xs">{factCell(key)}</span>
                  <span className="t-caption" style={muted}>
                    {fact.unit}
                  </span>
                  {fact.target != null ? (
                    <span className="font-mono t-caption" style={muted}>
                      → {fact.target}
                    </span>
                  ) : null}
                </span>
              );
            })}
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            {lens === "grid" ? gridLens : lens === "fom" ? fomLens : bodLens}
          </div>
        </ArtifactFrame>
      </div>
    </div>
  );
}
