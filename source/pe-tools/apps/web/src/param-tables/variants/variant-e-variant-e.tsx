import { token } from "#/lib/token";
import { useState } from "react";
import { AddressingBar } from "#/components/lang/addressing-bar";
import { ArtifactFrame } from "#/components/lang/artifact-frame";
import { fmtNum, StateCell, type StateCellProps } from "#/components/lang/cell";
import { FactChip } from "#/components/lang/chip";
import { HelpTip } from "#/components/lang/help";
import { OutcomeLine } from "#/components/lang/outcome";
import { Switcher } from "#/components/lang/switcher";
import { Verb } from "#/components/lang/verb";
import { FC_UNITS } from "#/param-tables/variants/fixture";
import type {
  FactKey,
  Facts,
  Lens,
  Link,
  Model,
  Outcome,
  TypeGroup,
  TypeWrite,
} from "./variant-e-type-vals";
import {
  GROUPS,
  INITIAL_FACTS,
  LINKS,
  hairline,
  initialModel,
  isFormulaOwned,
  muted,
  secondary,
} from "./variant-e-type-vals";
import { VariantGridLens } from "./variant-e-grid-lens";
import { VariantFomLens } from "./variant-e-fom-lens";
import { VariantBodLens } from "./variant-e-bod-lens";

export function VariantE() {
  const [lens, setLens] = useState<Lens>("grid");
  const [facts, setFacts] = useState<Facts>(INITIAL_FACTS);
  const [model, setModel] = useState<Model>(initialModel);
  const [outcomes, setOutcomes] = useState<Outcome[]>([]);

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
            kind: "error",
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
        <span className="block face-mono t-caption" style={muted}>
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
        <span className="block face-mono t-caption" style={muted}>
          {sub}
        </span>
      ) : (
        <span className="block t-caption">&nbsp;</span>
      )}
    </th>
  );

  const gridLens = (
    <VariantGridLens
      applicable={applicable}
      refusals={refusals}
      linkedCellProps={linkedCellProps}
      linkedHead={linkedHead}
      plainHead={plainHead}
    />
  );

  const fomLens = <VariantFomLens />;

  const bodLens = <VariantBodLens factCell={factCell} />;

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <AddressingBar
        name="param tables"
        sentence={
          <span>
            <span className="face-mono">ProjectA_Clone_Aug_11</span>
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
          head={
            <span className="flex w-full items-center gap-3">
              <span className="t-value">Main House fan coils × PE_* parameters</span>
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
              <span className="ml-auto face-mono" style={muted}>
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
                  <span className="w-14 face-mono t-value">{factCell(key)}</span>
                  <span className="t-caption" style={muted}>
                    {fact.unit}
                  </span>
                  {fact.target != null ? (
                    <span className="face-mono t-caption" style={muted}>
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
