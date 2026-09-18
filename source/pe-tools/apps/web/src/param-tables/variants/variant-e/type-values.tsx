import { token } from "#/lib/token";
import { type OutcomeKind } from "#/components/lang/outcome";
import { FC_UNITS, PARAM_META, type FcRow, type ParamMeta } from "#/param-tables/variants/data";

export interface TypeVals {
  ewt: number;
  lwt: number;
}

export type Model = Record<string, TypeVals>;

export interface TypeGroup {
  name: string;
  rows: FcRow[];
}

export const GROUPS: TypeGroup[] = (() => {
  const byType = new Map<string, FcRow[]>();
  for (const row of FC_UNITS) {
    const bucket = byType.get(row.typeName);
    if (bucket != null) bucket.push(row);
    else byType.set(row.typeName, [row]);
  }
  return [...byType.entries()].map(([name, rows]) => ({ name, rows }));
})();

export const initialModel = (): Model =>
  Object.fromEntries(
    GROUPS.map((g) => {
      const first = g.rows[0];
      if (first == null) throw new Error("empty type group");
      return [g.name, { ewt: first.heat.ewt, lwt: first.heat.lwt }];
    }),
  );

export type FactKey = "heatEwt" | "heatLwt" | "odtWinter";

export interface Fact {
  label: string;
  unit: string;
  value: number;
  committed: number;
  target?: string;
}

export type Facts = Record<FactKey, Fact>;

export const INITIAL_FACTS: Facts = {
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
  odtWinter: { label: "Outdoor design temp (winter DB)", unit: "°F", value: 9.4, committed: 9.4 },
};

export interface Link {
  factKey: "heatEwt" | "heatLwt";
  param: ParamMeta;
  get: (v: TypeVals) => number;
  set: (v: TypeVals, n: number) => TypeVals;
}

export const param = (name: string): ParamMeta => {
  const found = PARAM_META.find((p) => p.name === name);
  if (found == null) throw new Error(`unknown param ${name}`);
  return found;
};

export const LINKS: Link[] = [
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

export const isFormulaOwned = (link: Link, typeName: string): boolean =>
  link.param.readOnlyOn?.includes(typeName) === true;

export const HEAT_CAP_SUM = FC_UNITS.reduce((sum, r) => sum + r.heat.capTotal, 0);

export type Lens = "grid" | "fom" | "bod";

export interface Outcome {
  kind: OutcomeKind;
  label: string;
  says?: string;
}

export interface TypeWrite {
  group: TypeGroup;
  link: Link;
  from: number;
  to: number;
  refusal?: string;
}

export const muted: React.CSSProperties = { color: token("ink-mute") };

export const secondary: React.CSSProperties = { color: token("ink-2") };

export const hairline = `1px solid ${token("line")}`;
