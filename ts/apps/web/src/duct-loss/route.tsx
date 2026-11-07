/** The graph owns state, acquisition, layout and keys; these adapters supply pane content. */
import { type ReactNode } from "react";
import type { DuctLossContext } from "./route";
import { FactChip } from "@pe/kit/lang/chip";
import { Input } from "@pe/kit/lang/input";
import { StateCell } from "@pe/kit/lang/cell";
import { Switcher } from "@pe/kit/lang/switcher";
import { DuctCharts } from "#/duct-loss/duct/charts";
import { FACES, type FaceKey } from "#/duct-loss/duct/ductulator";
import { Ductulator } from "#/duct-loss/duct/wheel";
import { type DuctInput, type DuctResult, materials } from "@pe/ducts-domain/duct-loss-math";

const fmt = (n: number, d = 2) => n.toLocaleString("en-US", { maximumFractionDigits: d });


function Field({ label, unit, children }: { label: string; unit?: string; children: ReactNode }) {
  return (
    <label className="grid grid-cols-[8rem_1fr_3rem] items-center gap-2">
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
    <div className="flex items-baseline justify-between gap-4 hairline-b py-1.5">
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

type Body = DuctLossContext;
const pageOf = (ctx: Body) => ctx.page.read();
const setPage = (ctx: Body, patch: Partial<ReturnType<typeof pageOf>>) => {
  const { face, ...query } = patch;
  if (face !== undefined) ctx.page.pose({ face });
  if (Object.keys(query).length) ctx.page.query(query);
};
const result = (ctx: Body): DuctResult | undefined =>
  ctx.value.current ? (ctx.value.value.result ?? undefined) : undefined;
const status = (ctx: Body) =>
  ctx.value.current ? (ctx.value.value.error ?? "Calculating duct loss") : ctx.value.reason;

function Wheel(body: Body) {
  const r = result(body);
  if (!r) return <output role="status">{status(body)}</output>;
  const d = pageOf(body);
  if (d.cfm === 0)
    return (
      <output>
        Zero airflow: zero loss and velocity. Enter positive airflow to use the logarithmic wheel.
      </output>
    );
  return (
    <div className="mx-auto aspect-square h-full max-w-full">
      <Ductulator
        face={FACES[d.face]}
        diameter={d.shape === "round" ? d.a : r.equivalentDiameter}
        cfm={d.cfm}
        onDiameter={(a) => setPage(body, { shape: "round", a })}
        onCfm={(cfm) => setPage(body, { cfm: Math.round(cfm) })}
      />
    </div>
  );
}

function Inputs(body: Body) {
  const r = result(body);
  const d = pageOf(body);
  const set = (patch: Partial<DuctInput>) => setPage(body, patch);

  const knownMaterial = Object.values<number>(materials).includes(d.roughness);
  const faceKey = d.face;
  return (
    <div className="t-prose flex flex-col gap-(--gutter)">
      <Switcher
        ariaLabel="wheel face"
        value={faceKey}
        onChange={(face: FaceKey) => setPage(body, { face })}
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
        <h2 className="font-medium">Duct</h2>
        <Field label="shape">
          <Switcher ariaLabel="Duct shape" value={d.shape} onChange={shape=>set({shape})} options={[{value:"round",label:"Round"},{value:"rect",label:"Rectangular"}]}/>
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
          <StateCell value={Object.entries(materials).find(([,value])=>value===d.roughness)?.[0]??"custom"} choice={{current:Object.entries(materials).find(([,value])=>value===d.roughness)?.[0]??"custom",options:[...Object.keys(materials).map(label=>({key:label,label})),...(!knownMaterial?[{key:"custom",label:"custom"}]:[])],pick:key=>set({roughness:materials[key as keyof typeof materials]??d.roughness})}}/>
        </Field>
        <Field label="roughness ε" unit="ft">
          <Num value={d.roughness} onChange={(roughness) => set({ roughness })} step={0.0001} />
        </Field>
        <Field label="density ρ" unit="lb/ft³">
          <Num value={d.density} onChange={(density) => set({ density })} step={0.001} />
        </Field>
      </section>

      {r ? (
        <section className="flex flex-col gap-2">
          <h2 className="font-medium">Loss</h2>
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

          <h2 className="pt-(--gutter) font-medium">Formula</h2>
          <pre className="hairline face-mono rounded-md p-3 whitespace-pre-wrap text-ink">
            {formula}
          </pre>
        </section>
      ) : (
        <output role="alert">{status(body)}</output>
      )}
    </div>
  );
}

function Charts(body: Body) {
  const r = result(body);
  if (!r) return <output role="status">{status(body)}</output>;
  const d = pageOf(body);
  if (d.cfm === 0)
    return <output>Zero airflow: zero loss. Enter positive airflow for logarithmic charts.</output>;
  return (
    <DuctCharts
      face={FACES[d.face]}
      cfm={d.cfm}
      diameter={d.shape === "round" ? d.a : r.equivalentDiameter}
      onPick={(next) =>
        setPage(body, {
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

export const WheelBody = ({ ctx }: { ctx: Body }) => <Wheel {...ctx} />;
export const InputsBody = ({ ctx }: { ctx: Body }) => <Inputs {...ctx} />;
export const ChartsBody = ({ ctx }: { ctx: Body }) => <Charts {...ctx} />;
