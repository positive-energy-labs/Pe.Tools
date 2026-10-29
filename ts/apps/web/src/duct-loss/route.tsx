/** The graph owns state, acquisition, layout and keys; these adapters supply pane content. */
import { type ReactNode } from "react";
import { routeAddress } from "@pe/agent-contracts";
import { FactChip } from "@pe/kit/lang/chip";
import { Input } from "@pe/kit/lang/input";
import { Switcher } from "@pe/kit/lang/switcher";
import { DuctCharts } from "#/duct/charts";
import { FACES, type FaceKey } from "#/duct/ductulator";
import { Ductulator } from "#/duct/wheel";
import { type DuctInput, type DuctResult, materials, solve } from "#/duct/math";
import { routeFromGraph, type MountBody, type MountScope, type RouteAdapters } from "#/shell/mount";
import { ductLossGraph, type DuctLossPage } from "./graph";

const fmt = (n: number, d = 2) => n.toLocaleString("en-US", { maximumFractionDigits: d });

const selectClass = "hairline h-(--control-h) w-full rounded-md px-2 t-prose";

function Field({ label, unit, children }: { label: string; unit?: string; children: ReactNode }) {
  return (
    <label className="grid grid-cols-[8rem_1fr_3rem] items-center gap-2 t-prose">
      <span className="text-ink-2">{label}</span>
      {children}
      <span className="face-mono text-ink-2">{unit}</span>
    </label>
  );
}

function Num({
  value,
  onChange,
  step = 1,
}: {
  value: number;
  onChange: (v: number) => void;
  step?: number;
}) {
  return (
    <Input
      type="number"
      face="mono"
      min={0}
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
    />
  );
}

function Out({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 hairline-b py-1.5 t-prose">
      <span className="text-ink-2">{label}</span>
      <output aria-label={label} className="face-mono">
        {value} {unit && <span className="text-ink-2">{unit}</span>}
      </output>
    </div>
  );
}

const formula = `Δp  = 12 · f · (L / Dₕ) · ρ · (V / 1097)²      in. wg

V   = cfm / A                                  fpm
Dₕ  = 4A / P   (rect: 2ab / (a + b))           in
Re  = 8.56 · Dₕ · V
f'  = 0.11 · (12ε / Dₕ + 68 / Re)^0.25
f   = f'                  if f' ≥ 0.018
    = 0.85 f' + 0.0028    otherwise
Dₑ  = 1.30 (ab)^0.625 / (a + b)^0.25           Huebscher`;

type Body = MountBody<DuctLossPage, null>;
const scope: MountScope<null> = { target: { kind: "host" }, work: null };
const release = () => {};
const pageSchema = routeAddress("duct-loss").schema;

function result({ owner }: Body) {
  return owner.readings.get("result").value as DuctResult | undefined;
}

function Wheel(body: Body) {
  const r = result(body);
  if (!r) return <output role="status">Calculating duct loss</output>;
  const { page: d, owner } = body;
  return (
    <div className="mx-auto aspect-square h-full max-w-full">
      <Ductulator
        face={FACES[d.face]}
        diameter={d.shape === "round" ? d.a : r.equivalentDiameter}
        cfm={d.cfm}
        onDiameter={(a) => owner.view.setPage({ shape: "round", a })}
        onCfm={(cfm) => owner.view.setPage({ cfm: Math.round(cfm) })}
      />
    </div>
  );
}

function Inputs(body: Body) {
  const r = result(body);
  if (!r) return <output role="status">Calculating duct loss</output>;
  const { page: d, owner } = body;
  const setPage = owner.view.setPage;
  const set = (patch: Partial<DuctInput>) => setPage(patch);
  const knownMaterial = Object.values<number>(materials).includes(d.roughness);
  const faceKey = d.face;
  return (
    <div className="flex flex-col gap-(--gutter)">
      <Switcher
        ariaLabel="wheel face"
        value={faceKey}
        onChange={(face: FaceKey) => setPage({ face })}
        options={[
          {
            value: "commercial",
            label: "commercial",
            title: "3 to 60 in, 30 to 100k cfm, up to 10 in. wg",
          },
          {
            value: "residential",
            label: "residential",
            title: "4 to 20 in, 20 to 2000 cfm, up to 1 in. wg; wider pitch, finer read",
          },
        ]}
      />
      <section className="flex flex-col gap-2">
        <h2 className="t-prose font-medium">Duct</h2>
        <Field label="shape">
          <select
            className={selectClass}
            value={d.shape}
            onChange={(e) => set({ shape: e.target.value as DuctInput["shape"] })}
          >
            <option value="round">round</option>
            <option value="rect">rectangular</option>
          </select>
        </Field>
        <Field label={d.shape === "round" ? "diameter" : "width"} unit="in">
          <Num value={d.a} onChange={(a) => set({ a })} />
        </Field>
        {d.shape === "rect" && (
          <Field label="height" unit="in">
            <Num value={d.b} onChange={(b) => set({ b })} />
          </Field>
        )}
        <Field label="airflow" unit="cfm">
          <Num value={d.cfm} onChange={(cfm) => set({ cfm })} step={10} />
        </Field>
        <Field label="length" unit="ft">
          <Num value={d.length} onChange={(length) => set({ length })} />
        </Field>
        <Field label="material">
          <select
            className={selectClass}
            value={String(d.roughness)}
            onChange={(e) => set({ roughness: Number(e.target.value) })}
          >
            {Object.entries(materials).map(([k, v]) => (
              <option key={k} value={v}>
                {k}
              </option>
            ))}
            {!knownMaterial && <option value={d.roughness}>custom</option>}
          </select>
        </Field>
        <Field label="roughness ε" unit="ft">
          <Num value={d.roughness} onChange={(roughness) => set({ roughness })} step={0.0001} />
        </Field>
        <Field label="density ρ" unit="lb/ft³">
          <Num value={d.density} onChange={(density) => set({ density })} step={0.001} />
        </Field>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="t-prose font-medium">Loss</h2>
        <div className="flex flex-wrap gap-1.5 pb-1">
          <FactChip title="Friction loss over the entered length">
            <output aria-label="friction loss">Δp {fmt(r.loss, 3)} in. wg</output>
          </FactChip>
          <FactChip title="Friction loss per 100 ft, the friction-chart number">
            <output aria-label="loss per 100 ft">{fmt(r.lossPer100, 3)} in. wg / 100 ft</output>
          </FactChip>
        </div>
        <Out label="velocity V" value={fmt(r.velocity, 0)} unit="fpm" />
        <Out label="area A" value={fmt(r.area, 3)} unit="ft²" />
        <Out label="hydraulic diameter Dₕ" value={fmt(r.hydraulicDiameter, 2)} unit="in" />
        {d.shape === "rect" && (
          <Out label="equivalent diameter Dₑ" value={fmt(r.equivalentDiameter, 2)} unit="in" />
        )}
        <Out label="Reynolds Re" value={fmt(r.reynolds, 0)} />
        <Out label="friction factor f" value={fmt(r.friction, 4)} />

        <h2 className="t-prose pt-(--gutter) font-medium">Formula</h2>
        <pre className="hairline face-mono t-prose rounded-md p-3 whitespace-pre-wrap text-ink">
          {formula}
        </pre>
      </section>
    </div>
  );
}

function Charts(body: Body) {
  const r = result(body);
  if (!r) return <output role="status">Calculating duct loss</output>;
  const { page: d, owner } = body;
  return (
    <DuctCharts
      face={FACES[d.face]}
      cfm={d.cfm}
      diameter={d.shape === "round" ? d.a : r.equivalentDiameter}
      onPick={(next) =>
        owner.view.setPage({
          ...(next.cfm != null && { cfm: Math.round(next.cfm) }),
          ...(next.diameter != null && {
            shape: "round" as const,
            a: Math.round(next.diameter * 10) / 10,
          }),
        })
      }
    />
  );
}

const adapters: RouteAdapters<DuctLossPage, null> = {
  getSnapshot: () => scope,
  subscribe: () => release,
  sources: {
    "duct-loss.solve": { kind: "derive", derive: ({ args }) => solve(pageSchema.parse(args)) },
  },
  // This calculator has no Work. These ports never contact a host or manufacture acknowledgements.
  write: async () => ({
    ok: false,
    kind: "refused",
    error: "Duct Loss has no Work",
    hint: "Edit Page fields instead",
  }),
  subscribeAcceptedDeltas: () => release,
  bodies: { wheel: Wheel, inputs: Inputs, charts: Charts },
};

export const ductLossRoute = routeFromGraph(ductLossGraph, adapters, "/duct-loss");
