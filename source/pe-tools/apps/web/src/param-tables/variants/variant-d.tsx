import { token } from "#/lib/token";

/**
 * VARIANT D — "the named design fact is the product; tables and parameters both subscribe."
 *
 * The structural bet: a table cell is NOT the source of truth. A registry of named design
 * facts is ("Heating loop EWT = 110 °F"). The page is a dataflow surface — facts as the
 * SPINE, two subscriber wings:
 *   left  · authored TABLES (the loop-temps exhibit, FOM HWCH Plant, BOD MainHouse) whose
 *           cells reference facts and are NOT editable in place — the fact is;
 *   right · model PARAMETERS (PE_* at TYPE scope on the fan-coil types) — the far side of
 *           every write, tags visible, refusals per-type.
 * Linking cell→param is N×M spaghetti; fact→subscribers is a star.
 *
 * Provenance has direction: most facts are authored (→ flows out); one is model-sourced
 * (← "Installed FC heating capacity" summed live from PE_M_PerfHeat_CapacityDesignTotal),
 * and it refuses editing — its truth lives in the model.
 *
 * Demo path: edit Heating loop EWT/LWT in the registry → staged fan-out (bold = unsaved)
 * in BOTH wings → DVWHSA…RV2 refuses the EWT write (formula-owned, per PARAM_META) →
 * one blue Commit (the only write beyond the page) applies mock → receipt in the head;
 * the refused type is then in honest drift against the fact (the one alarm).
 *
 * LANG GAPS left in place (search "// LANG GAP"): subscription glyph, old→new staged
 * transition token, cross-pane subscriber highlight, provenance-direction glyph.
 */
import { useState } from "react";

import { AddressingBar } from "#/components/lang/addressing-bar";
import { ArtifactFrame } from "#/components/lang/artifact-frame";
import { fmtNum, StateCell } from "#/components/lang/cell";
import { FactChip } from "#/components/lang/chip";
import { HelpTip } from "#/components/lang/help";
import { OutcomeLine, type OutcomeKind } from "#/components/lang/outcome";
import { Provenance, Section } from "#/components/lang/section";
import { Verb } from "#/components/lang/verb";
import {
  BOD_MAIN_HOUSE,
  FC_UNITS,
  FOM_HWCH_PLANT,
  PARAM_META,
  type FcRow,
} from "#/param-tables/variants/fixture";

// ---------------------------------------------------------------------------
// Static shape derived from the fixture (no invented data)
// ---------------------------------------------------------------------------

interface TypeGroup {
  typeName: string;
  tags: string[];
  count: number;
  rep: FcRow;
}

const TYPE_GROUPS: TypeGroup[] = (() => {
  const by = new Map<string, TypeGroup>();
  for (const u of FC_UNITS) {
    const g = by.get(u.typeName);
    if (g) {
      g.tags.push(u.tag);
      g.count += 1;
    } else {
      by.set(u.typeName, { typeName: u.typeName, tags: [u.tag], count: 1, rep: u });
    }
  }
  return [...by.values()];
})();

const TAG_TOTAL = FC_UNITS.length;

const LOOP_PARAMS = [
  "PE_M_PerfHeat_FluidEWT",
  "PE_M_PerfHeat_FluidLWT",
  "PE_M_PerfCool_FluidEWT",
  "PE_M_PerfCool_FluidLWT",
] as const;
type LoopParam = (typeof LOOP_PARAMS)[number];
const CAP_PARAM = "PE_M_PerfHeat_CapacityDesignTotal";

const paramLabel = (name: string): string => PARAM_META.find((p) => p.name === name)?.label ?? name;
const isReadOnly = (param: string, typeName: string): boolean =>
  PARAM_META.find((p) => p.name === param)?.readOnlyOn?.includes(typeName) ?? false;

/** Which fact drives which loop param — the star's outbound edges. */
const FACT_FOR_PARAM: Record<LoopParam, string> = {
  PE_M_PerfHeat_FluidEWT: "heat-ewt",
  PE_M_PerfHeat_FluidLWT: "heat-lwt",
  PE_M_PerfCool_FluidEWT: "cool-ewt",
  PE_M_PerfCool_FluidLWT: "cool-lwt",
};

interface FactDef {
  key: string;
  label: string;
  unit?: string;
  /** Present ⇒ numeric commit path (parse-refuse-normalize) in the registry editor. */
  numeric?: { digits?: number };
  /** Provenance direction: authored here (flows out) vs sourced from the model (flows in). */
  origin: "authored" | "model";
  /** Inbound facts name the param they are summed from. */
  sourceParam?: string;
  /** Outbound edge to the model world — one param, every type that carries it. */
  target?: LoopParam;
  /** How many authored-table cells subscribe (the left wing's fan-out count). */
  tableCells: number;
  seed: string;
}

/**
 * The registry seed. Loop temps are the values retyped across the fixture's type perf
 * blocks today (110/100 heating, 45/55 cooling); source temps come from the FOM grid
 * ("50°F"/"30°F"); everything else is the 18 BOD entries verbatim.
 */
const FACTS: FactDef[] = [
  {
    key: "heat-ewt",
    label: "Heating loop EWT",
    unit: "°F",
    numeric: { digits: 1 },
    origin: "authored",
    target: "PE_M_PerfHeat_FluidEWT",
    tableCells: 1,
    seed: "110",
  },
  {
    key: "heat-lwt",
    label: "Heating loop LWT",
    unit: "°F",
    numeric: { digits: 1 },
    origin: "authored",
    target: "PE_M_PerfHeat_FluidLWT",
    tableCells: 1,
    seed: "100",
  },
  {
    key: "cool-ewt",
    label: "Cooling loop EWT",
    unit: "°F",
    numeric: { digits: 1 },
    origin: "authored",
    target: "PE_M_PerfCool_FluidEWT",
    tableCells: 1,
    seed: "45",
  },
  {
    key: "cool-lwt",
    label: "Cooling loop LWT",
    unit: "°F",
    numeric: { digits: 1 },
    origin: "authored",
    target: "PE_M_PerfCool_FluidLWT",
    tableCells: 1,
    seed: "55",
  },
  {
    key: "src-cool",
    label: "Cooling source temp (WWHP)",
    unit: "°F",
    numeric: { digits: 0 },
    origin: "authored",
    tableCells: 1,
    seed: "50",
  },
  {
    key: "src-heat",
    label: "Heating source temp (WWHP)",
    unit: "°F",
    numeric: { digits: 0 },
    origin: "authored",
    tableCells: 1,
    seed: "30",
  },
  {
    key: "cap-installed",
    label: "Installed FC heating capacity (Σ schedule)",
    unit: "Btu/h",
    origin: "model",
    sourceParam: CAP_PARAM,
    tableCells: 0,
    seed: "", // derived live from the model world every render — never stored
  },
  ...BOD_MAIN_HOUSE.map(
    (e): FactDef => ({
      key: `bod-${e.key}`,
      label: e.label,
      unit: e.unit,
      // Comma-formatted fixture values stay strings; pure numbers get the numeric path.
      numeric: e.numeric != null && !e.value.includes(",") ? { digits: 1 } : undefined,
      origin: "authored",
      tableCells: 1,
      seed: e.value,
    }),
  ),
];
const FACT_BY_KEY = new Map(FACTS.map((f) => [f.key, f]));

interface StagedWrite {
  typeName: string;
  param: string;
  from: number;
  to: number;
  tags: number;
  refusal?: string;
}

interface Receipt {
  kind: OutcomeKind;
  label: string;
  says: string;
}

const MUTE = { color: token("ink-mute") } as const;
const INK2 = { color: token("ink-2") } as const;

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

export function VariantD() {
  /** Committed fact values — the registry's accepted truth (page state). */
  const [factValues, setFactValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(FACTS.map((f) => [f.key, f.seed])),
  );
  /** Unsaved fact edits: factKey → new text. Everything downstream derives from this. */
  const [staged, setStaged] = useState<Record<string, string>>({});
  /** The mock model: per TYPE, per param, the value the model currently holds. */
  const [model, setModel] = useState<Record<string, Record<string, number>>>(() =>
    Object.fromEntries(
      TYPE_GROUPS.map((t) => [
        t.typeName,
        {
          PE_M_PerfHeat_FluidEWT: t.rep.heat.ewt,
          PE_M_PerfHeat_FluidLWT: t.rep.heat.lwt,
          PE_M_PerfCool_FluidEWT: t.rep.cool.ewt,
          PE_M_PerfCool_FluidLWT: t.rep.cool.lwt,
          [CAP_PARAM]: t.rep.heat.capTotal,
        },
      ]),
    ),
  );
  const [selected, setSelected] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);

  // ---- derived, recomputed every render (compute agreement; do not remember it) ----

  const capInstalled = TYPE_GROUPS.reduce(
    (sum, t) => sum + (model[t.typeName]?.[CAP_PARAM] ?? 0) * t.count,
    0,
  );

  const factDisplay = (k: string): string =>
    k === "cap-installed" ? capInstalled.toLocaleString("en-US") : (factValues[k] ?? "");

  const writesFor = (f: FactDef, to: number): StagedWrite[] => {
    const target = f.target;
    if (target == null) return [];
    return TYPE_GROUPS.map((t) => ({
      typeName: t.typeName,
      param: target,
      from: model[t.typeName]?.[target] ?? 0,
      to,
      tags: t.count,
      refusal: isReadOnly(target, t.typeName)
        ? "formula-owned on this type — the family formula computes it; write refuses"
        : undefined,
    }));
  };

  const stagedKeys = Object.keys(staged);
  const stagedWrites: StagedWrite[] = stagedKeys.flatMap((k) => {
    const f = FACT_BY_KEY.get(k);
    const text = staged[k];
    return f?.target != null && text != null ? writesFor(f, Number(text)) : [];
  });
  const landing = stagedWrites.filter((w) => w.refusal == null && w.from !== w.to);
  const refusing = stagedWrites.filter((w) => w.refusal != null);
  const tableOnlyStaged = stagedKeys.filter((k) => FACT_BY_KEY.get(k)?.target == null).length;

  // ---- verbs ----

  const stageFactEdit = (f: FactDef, text: string): void => {
    setStaged((s) => {
      const next = { ...s };
      if (text === factValues[f.key]) delete next[f.key];
      else next[f.key] = text;
      return next;
    });
  };

  const commitStaged = (): void => {
    const next = Object.fromEntries(Object.entries(model).map(([t, params]) => [t, { ...params }]));
    for (const w of landing) {
      const params = next[w.typeName];
      if (params != null) params[w.param] = w.to;
    }
    const tagsMoved = landing.reduce((s, w) => s + w.tags, 0);
    setModel(next);
    setFactValues((v) => ({ ...v, ...staged }));
    setStaged({});
    setReceipt({
      kind: refusing.length > 0 ? "partial" : "receipt",
      label: `${landing.length} type-writes landed · ${tagsMoved} tags moved${
        refusing.length > 0 ? ` · ${refusing.length} refused` : ""
      }${tableOnlyStaged > 0 ? ` · ${tableOnlyStaged} table-only facts settled` : ""}`,
      says:
        refusing.length > 0
          ? `refused: ${refusing.map((w) => `${w.param} on ${w.typeName}`).join(", ")} — formula-owned; the fact now disagrees with those types`
          : "mock apply — no host was called",
    });
  };

  const toggleSelect = (k: string): void => setSelected((s) => (s === k ? null : k));

  // -------------------------------------------------------------------------
  // Left wing — a table cell that SUBSCRIBES to a fact. Read-only on purpose:
  // the thesis made tangible. Clicking it locates the fact in the registry.
  // -------------------------------------------------------------------------
  const factRef = (k: string): React.ReactNode => {
    const f = FACT_BY_KEY.get(k);
    if (f == null) return null;
    const st = staged[k];
    const hot = selected === k;
    return (
      <button
        type="button"
        onClick={() => toggleSelect(k)}
        className="inline-flex items-baseline gap-1 rounded-none px-1 text-left font-mono text-xs"
        // LANG GAP: cross-pane subscriber highlight — the selection fill is being applied
        // to every subscriber of the selected fact, not just the pressed control. The
        // language has "selection is a fill" but no ruling on selection PROPAGATION.
        style={hot ? { background: token("select") } : undefined}
        title={`subscribes to fact "${f.label}" — the cell is a projection; edit the fact in the registry`}
      >
        {/* LANG GAP: fact-subscription glyph — no canon mark says "this value flows in
            from a named fact". Using a raw ⌁ in mute ink until one is ruled. */}
        <span style={MUTE}>⌁</span>
        {st != null ? (
          <>
            {/* LANG GAP: old→new staged transition token. StateCell's ghost is reserved
                for model drift; a staged fan-out needs "was → will be" and has no canon
                form. Bold stays reserved for unsaved (the new value). */}
            <s style={MUTE}>{factValues[k]}</s>
            <b>{st}</b>
          </>
        ) : (
          <span>{factDisplay(k)}</span>
        )}
        {f.unit != null ? <span style={MUTE}>{f.unit}</span> : null}
      </button>
    );
  };

  const deadCell = (v: string): React.ReactNode => (
    <span style={MUTE} title="dead text — an SXL header cell today; not linked to any fact">
      {v}
    </span>
  );

  // -------------------------------------------------------------------------
  // Right wing — one param row on one type: the far side of a fact's star.
  // -------------------------------------------------------------------------
  const paramRow = (t: TypeGroup, p: LoopParam): React.ReactNode => {
    const factKey = FACT_FOR_PARAM[p];
    const f = FACT_BY_KEY.get(factKey);
    if (f == null) return null;
    const cur = model[t.typeName]?.[p] ?? 0;
    const stagedText = staged[factKey];
    const to = stagedText != null ? Number(stagedText) : null;
    const ro = isReadOnly(p, t.typeName);
    const committedFact = Number(factValues[factKey]);
    const hot = selected === factKey;

    let valueNode: React.ReactNode;
    if (to != null && ro) {
      valueNode = (
        <span className="inline-flex items-baseline gap-2">
          <span className="font-mono">{fmtNum(cur)}</span>
          <span
            className="t-caption"
            style={{ color: token("alarm") }}
            title={`write of ${fmtNum(to)} refused: ${p} is formula-owned on ${t.typeName} — the family formula computes this value; reconcile in the family, not here`}
          >
            refuses — formula-owned
          </span>
        </span>
      );
    } else if (to != null && to !== cur) {
      valueNode = (
        <span
          className="font-mono"
          title={`staged by fact "${f.label}" — Commit writes ${fmtNum(to)} to ${p} on this type (${t.count} tag${t.count === 1 ? "" : "s"})`}
        >
          {/* LANG GAP: old→new staged transition token (same gap as the table wing). */}
          <s style={MUTE}>{fmtNum(cur)}</s> → <b>{fmtNum(to)}</b>
        </span>
      );
    } else if (to != null) {
      valueNode = (
        <span className="font-mono" title="already holds the staged value — Commit is a no-op here">
          {fmtNum(cur)}
        </span>
      );
    } else if (cur !== committedFact && !Number.isNaN(committedFact)) {
      valueNode = (
        <StateCell
          scale="row"
          value={fmtNum(cur)}
          agree="drift"
          note={`fact "${f.label}" says ${fmtNum(committedFact)} — this type holds ${fmtNum(cur)}${ro ? " · formula-owned, so a write would refuse; reconcile in the family" : ""}`}
          className="font-mono"
        />
      );
    } else {
      valueNode = <span className="font-mono">{fmtNum(cur)}</span>;
    }

    return (
      <div
        key={p}
        className="flex cursor-pointer items-baseline justify-between gap-2 px-1 py-px text-xs"
        style={hot ? { background: token("select") } : undefined}
        onClick={() => toggleSelect(factKey)}
        title={p}
      >
        <span style={INK2}>{paramLabel(p)}</span>
        <span className="inline-flex items-baseline gap-1">
          {valueNode}
          <span style={MUTE}>°F</span>
        </span>
      </div>
    );
  };

  // -------------------------------------------------------------------------
  // Spine — one fact row in the registry.
  // -------------------------------------------------------------------------
  const factRow = (f: FactDef): React.ReactNode => {
    const st = staged[f.key];
    const hot = selected === f.key;
    const inbound = f.origin === "model";
    const fanout =
      st != null && f.target != null
        ? (() => {
            const ws = writesFor(f, Number(st));
            const ok = ws.filter((w) => w.refusal == null);
            const no = ws.filter((w) => w.refusal != null);
            return { ok, no, tags: ok.reduce((s, w) => s + w.tags, 0) };
          })()
        : null;
    return (
      <div
        key={f.key}
        className="border-b px-2 py-1"
        style={{
          borderColor: token("line"),
          ...(hot ? { background: token("select") } : null),
        }}
        onClick={() => toggleSelect(f.key)}
      >
        <div className="grid grid-cols-[14px_minmax(0,1fr)_auto_auto] items-baseline gap-2">
          {/* LANG GAP: provenance-direction glyph — no canon mark distinguishes an
              authored fact (flows out to subscribers) from a model-sourced one (flows
              in). Raw arrows in mute ink until ruled. */}
          <span
            className="font-mono text-xs"
            style={MUTE}
            title={
              inbound
                ? `← model-sourced: summed live from ${f.sourceParam ?? ""} at type scope`
                : "→ authored here: subscribers downstream take this value"
            }
          >
            {inbound ? "←" : "→"}
          </span>
          <span className="truncate text-xs" title={f.label}>
            {f.label}
          </span>
          <span className="inline-flex items-baseline gap-1 font-mono text-xs">
            <StateCell
              scale="row"
              value={st ?? factDisplay(f.key)}
              stage={st != null ? "staged" : "clean"}
              cap={inbound ? "readonly" : "editable"}
              capReason={
                inbound
                  ? `model-sourced — flows in from ${f.sourceParam ?? ""} across ${TYPE_GROUPS.length} types; edit the model, not the fact`
                  : undefined
              }
              onCommit={inbound ? undefined : (text) => stageFactEdit(f, text)}
              numeric={f.numeric}
              className="min-w-16"
            />
            {f.unit != null ? <span style={MUTE}>{f.unit}</span> : null}
          </span>
          <span
            className="font-mono t-caption"
            style={MUTE}
            title={`fan-out: ${f.tableCells} table cell${f.tableCells === 1 ? "" : "s"} subscribe${f.tableCells === 1 ? "s" : ""}${f.target != null ? `; ${f.target} on ${TYPE_GROUPS.length} types / ${TAG_TOTAL} tags` : "; no model parameter linked"}${inbound ? `; sourced from ${f.sourceParam ?? ""}` : ""}`}
          >
            {f.tableCells > 0 ? `${f.tableCells}c` : "–"}
            {f.target != null ? ` · ${TYPE_GROUPS.length}t/${TAG_TOTAL}` : ""}
          </span>
        </div>
        {fanout != null ? (
          <div className="pl-6 font-mono t-caption" style={{ color: token("caution") }}>
            stages {fanout.ok.length} types · {fanout.tags} tags
            {fanout.no.length > 0
              ? ` — ${fanout.no.length} refuses (formula-owned: ${fanout.no.map((w) => w.typeName).join(", ")})`
              : ""}
          </div>
        ) : null}
        {st != null && f.target == null ? (
          <div className="pl-6 font-mono t-caption" style={MUTE}>
            table subscribers only — settles on Commit, nothing leaves the page
          </div>
        ) : null}
      </div>
    );
  };

  // -------------------------------------------------------------------------

  const commitDisabled = stagedKeys.length === 0;
  const commitReason = commitDisabled
    ? "nothing staged — edit a fact in the registry first"
    : `writes ${landing.length} staged type-params to the model (mock) and settles ${stagedKeys.length} fact${stagedKeys.length === 1 ? "" : "s"}${
        refusing.length > 0
          ? ` — ${refusing.length} target${refusing.length === 1 ? "" : "s"} will refuse (formula-owned)`
          : ""
      }`;

  return (
    <div
      className="flex h-screen flex-col overflow-hidden"
      style={{ background: token("page"), color: token("ink") }}
    >
      <AddressingBar
        name="param-tables · d"
        sentence={
          <span className="text-sm">
            ProjectA_Clone_Aug_11 · Main House · <span className="font-medium">design facts</span>
          </span>
        }
        facts={
          <>
            <FactChip title="named design facts in the registry — the page's source of truth">
              {FACTS.length} facts
            </FactChip>
            <FactChip title="fan-coil types carrying the linked PE_* params, and the schedule tags they fan out to">
              {TYPE_GROUPS.length} types · {TAG_TOTAL} tags
            </FactChip>
            {stagedKeys.length > 0 ? (
              <FactChip
                tone="caution"
                title="unsaved fact edits — every downstream subscriber shows its staged value; Commit settles them"
              >
                {stagedKeys.length} staged
              </FactChip>
            ) : null}
          </>
        }
        verb={
          <Verb
            tone="commit"
            label="Commit"
            disabled={commitDisabled}
            reason={commitReason}
            onClick={commitStaged}
          />
        }
        advisory={
          receipt != null ? (
            <OutcomeLine kind={receipt.kind} label={receipt.label} says={receipt.says} />
          ) : null
        }
        seam={
          <FactChip
            dashed
            title="fixture lane — real data read from ProjectA_Clone_Aug_11 on 2026-08-17; no host is connected, every apply is a mock"
          >
            fixture · ProjectA_Clone_Aug_11
          </FactChip>
        }
      />

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,5fr)_minmax(340px,3fr)_minmax(0,5fr)]">
        {/* ── LEFT WING · authored tables (subscriber world 1) ─────────────── */}
        <div
          className="min-h-0 overflow-y-auto border-r px-3 py-2"
          style={{ borderColor: token("line") }}
        >
          <Section
            label="Tables — subscribers"
            help={
              <HelpTip>
                Authored tables are projections of the fact registry. A ⌁ cell renders the fact it
                subscribes to and cannot be edited in place — click it to locate its fact in the
                spine. Muted cells are today&apos;s SXL dead text, not yet linked.
              </HelpTip>
            }
          >
            <div className="flex flex-col gap-3">
              <ArtifactFrame
                head={
                  <div className="flex items-center gap-2 text-xs">
                    <span className="font-medium">Hydronic Loop Temperatures</span>
                    <FactChip
                      dashed
                      title="stand-in: authored on this page and not yet placed — would land on M001 as a live exhibit, replacing the SXL header-cell workaround"
                    >
                      authored · unplaced
                    </FactChip>
                  </div>
                }
              >
                <table className="w-full text-xs">
                  <thead>
                    <tr style={INK2}>
                      <th className="px-2 py-1 text-left font-normal" />
                      <th className="px-2 py-1 text-left font-normal">Heating</th>
                      <th className="px-2 py-1 text-left font-normal">Cooling</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-t" style={{ borderColor: token("line") }}>
                      <td className="px-2 py-1" style={INK2}>
                        EWT
                      </td>
                      <td className="px-2 py-1">{factRef("heat-ewt")}</td>
                      <td className="px-2 py-1">{factRef("cool-ewt")}</td>
                    </tr>
                    <tr className="border-t" style={{ borderColor: token("line") }}>
                      <td className="px-2 py-1" style={INK2}>
                        LWT
                      </td>
                      <td className="px-2 py-1">{factRef("heat-lwt")}</td>
                      <td className="px-2 py-1">{factRef("cool-lwt")}</td>
                    </tr>
                  </tbody>
                </table>
              </ArtifactFrame>

              <ArtifactFrame
                head={
                  <div className="flex items-center gap-2 text-xs">
                    <span className="font-medium">{FOM_HWCH_PLANT.name}</span>
                    <span style={MUTE}>SXL header cells today — two cells fact-linked</span>
                  </div>
                }
              >
                <div className="overflow-x-auto">
                  <table className="w-full t-caption">
                    <thead>
                      <tr style={MUTE}>
                        {FOM_HWCH_PLANT.groupRow.map((g, i) => (
                          <th key={i} className="px-1 py-0.5 text-left font-normal">
                            {g}
                          </th>
                        ))}
                      </tr>
                      <tr style={INK2}>
                        {FOM_HWCH_PLANT.headRow.map((h, i) => (
                          <th key={i} className="px-1 py-0.5 text-left font-normal">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-t" style={{ borderColor: token("line") }}>
                        {FOM_HWCH_PLANT.dataRow.map((v, i) => (
                          <td key={i} className="px-1 py-1">
                            {i === 3
                              ? factRef("src-cool")
                              : i === 7
                                ? factRef("src-heat")
                                : deadCell(v)}
                          </td>
                        ))}
                      </tr>
                    </tbody>
                  </table>
                  <div className="px-1 py-1 t-caption" style={MUTE}>
                    {FOM_HWCH_PLANT.footnote}
                  </div>
                </div>
              </ArtifactFrame>

              <ArtifactFrame
                head={
                  <div className="flex items-center gap-2 text-xs">
                    <span className="font-medium">BOD MainHouse</span>
                    <span style={MUTE}>M001 · every row subscribes to its fact</span>
                  </div>
                }
              >
                <table className="w-full text-xs">
                  <tbody>
                    {BOD_MAIN_HOUSE.map((e) => (
                      <tr key={e.key} className="border-t" style={{ borderColor: token("line") }}>
                        <td className="max-w-64 px-2 py-1 align-baseline" style={INK2}>
                          {e.label}
                        </td>
                        <td className="px-2 py-1 align-baseline">{factRef(`bod-${e.key}`)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ArtifactFrame>
            </div>
          </Section>
        </div>

        {/* ── SPINE · the fact registry (the product) ──────────────────────── */}
        <div
          className="min-h-0 overflow-y-auto border-r px-3 py-2"
          style={{ borderColor: token("line") }}
        >
          <Section
            label="Design facts"
            help={
              <HelpTip>
                The registry is the source of truth. Edit a fact here and every subscriber — table
                cells left, typed parameters right — shows its staged value until the one Commit
                writes beyond the page. → flows out to subscribers; ← flows in from the model and
                refuses editing here.
              </HelpTip>
            }
            aside={
              <span className="font-mono t-caption" style={MUTE}>
                {stagedKeys.length > 0
                  ? `${landing.length} writes staged · ${refusing.length} will refuse`
                  : "nothing staged"}
              </span>
            }
          >
            <ArtifactFrame
              foot={
                <span className="font-mono t-caption" style={MUTE}>
                  {FACTS.length} facts · {FACTS.filter((f) => f.target != null).length} drive params
                  · 1 model-sourced
                </span>
              }
            >
              <div>{FACTS.map((f) => factRow(f))}</div>
            </ArtifactFrame>
          </Section>
        </div>

        {/* ── RIGHT WING · model parameters (subscriber world 2, the far side) ─ */}
        <div className="min-h-0 overflow-y-auto px-3 py-2">
          <Section
            label="Model parameters — subscribers"
            help={
              <HelpTip>
                The far side of every write. PE_* perf params live at TYPE scope: one staged write
                on a type moves every tag below it. A formula-owned param refuses per type with its
                reason; a squiggle means the type already disagrees with the fact — the one alarm.
              </HelpTip>
            }
            aside={
              <span className="font-mono t-caption" style={MUTE}>
                {TYPE_GROUPS.length} types · {TAG_TOTAL} tags
              </span>
            }
          >
            <ArtifactFrame
              head={
                <span className="text-xs font-medium">
                  Hydronic Fan Coil Unit Performance Schedule — by type
                </span>
              }
            >
              <div>
                {TYPE_GROUPS.map((t) => {
                  const stagedHere = stagedWrites.some(
                    (w) => w.typeName === t.typeName && w.refusal == null && w.from !== w.to,
                  );
                  return (
                    <div
                      key={t.typeName}
                      className="border-b px-2 py-1.5"
                      style={{ borderColor: token("line") }}
                    >
                      <div className="flex items-baseline gap-2">
                        <span className="font-mono text-xs">{t.typeName}</span>
                        <FactChip title="instances of this type in the Main House schedule — one type write moves all of them">
                          {t.count} tag{t.count === 1 ? "" : "s"}
                        </FactChip>
                      </div>
                      <div className="mt-1">
                        {LOOP_PARAMS.map((p) => paramRow(t, p))}
                        <div
                          className="flex items-baseline justify-between gap-2 px-1 py-px text-xs"
                          title={`${CAP_PARAM} — source of the model-sourced fact; provenance flows model → registry here`}
                        >
                          <span style={INK2}>{paramLabel(CAP_PARAM)}</span>
                          <span className="inline-flex items-baseline gap-1">
                            <span className="font-mono">
                              {(model[t.typeName]?.[CAP_PARAM] ?? 0).toLocaleString("en-US")}
                            </span>
                            <span style={MUTE}>Btu/h</span>
                            <span className="t-caption" style={MUTE}>
                              → feeds fact
                            </span>
                          </span>
                        </div>
                      </div>
                      <div
                        className="mt-1 font-mono t-caption"
                        style={stagedHere ? { fontWeight: 600 } : MUTE}
                        title={
                          stagedHere
                            ? "these tags see the staged value the moment Commit lands"
                            : "tags carried by this type"
                        }
                      >
                        {t.tags.join(" · ")}
                      </div>
                    </div>
                  );
                })}
              </div>
            </ArtifactFrame>
            <Provenance>
              read live 2026-08-17 from ProjectA_Clone_Aug_11 · perf params at type scope · 23 of 36
              FC instances appear in the Main House schedule (fixture note)
            </Provenance>
          </Section>
        </div>
      </div>
    </div>
  );
}
