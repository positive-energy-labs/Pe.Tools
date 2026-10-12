/**
 * /duct-loss — the SMACNA Ductulator, cloned (`duct/wheel.tsx`), beside the formula it embodies
 * and four log-log lenses on the same law (`duct/charts.tsx`). Wheel, panel and charts share one
 * state: drag any of them and the rest follow. A face toggle reprints the wheel for residential
 * spans. Math in `duct/math.ts` and `duct/ductulator.ts`, each pinned by its test.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";

import { FactChip } from "#/components/lang/chip";
import { Input } from "#/components/lang/input";
import { Surface } from "#/components/lang/surface";
import { Switcher } from "#/components/lang/switcher";
import { DuctCharts } from "#/duct/charts";
import { FACES, type FaceKey } from "#/duct/ductulator";
import { Ductulator } from "#/duct/wheel";
import { type DuctInput, materials, solve } from "#/duct/math";
import { RouteShell, emptyManifest } from "#/route";

const manifest = emptyManifest("duct-loss", "Duct Loss");

export const Route = createFileRoute("/duct-loss")({
  component: () => (
    <RouteShell manifest={manifest}>
      <DuctLossRoute />
    </RouteShell>
  ),
});

const fmt = (n: number, d = 2) => n.toLocaleString(undefined, { maximumFractionDigits: d });

const selectClass =
  "h-(--control-h) w-full rounded-md border border-line bg-line/20 px-2 t-prose outline-none focus-visible:border-line-2";

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
    <div className="flex items-baseline justify-between gap-4 border-b border-line py-1.5 t-prose">
      <span className="text-ink-2">{label}</span>
      <span className="face-mono">
        {value} {unit && <span className="text-ink-2">{unit}</span>}
      </span>
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

function DuctLossRoute() {
  const [d, setD] = useState<DuctInput>({
    shape: "round",
    a: 12,
    b: 8,
    cfm: 1000,
    length: 100,
    roughness: materials["galvanized steel"],
    density: 0.075,
  });
  const set = (p: Partial<DuctInput>) => setD((x) => ({ ...x, ...p }));
  const r = solve(d);
  const knownMaterial = Object.values<number>(materials).includes(d.roughness);
  const wheelDiameter = d.shape === "round" ? d.a : r.equivalentDiameter;
  const [faceKey, setFaceKey] = useState<FaceKey>("commercial");
  const face = FACES[faceKey];
  const pick = (next: { cfm?: number; diameter?: number }) =>
    set({
      ...(next.cfm != null && { cfm: Math.round(next.cfm) }),
      ...(next.diameter != null && { shape: "round" as const, a: Math.round(next.diameter * 10) / 10 }),
    });

  return (
    <Surface>
      <div className="flex flex-wrap justify-center gap-(--gutter)">
        <div className="aspect-square h-[min(85vh,52rem)] max-w-full">
          <Ductulator
            face={face}
            diameter={wheelDiameter}
            cfm={d.cfm}
            onDiameter={(a) => set({ shape: "round", a })}
            onCfm={(cfm) => set({ cfm: Math.round(cfm) })}
          />
        </div>
        <div className="flex w-80 flex-col gap-(--gutter)">
        <Switcher
          ariaLabel="wheel face"
          value={faceKey}
          onChange={setFaceKey}
          options={[
            { value: "commercial", label: "commercial", title: "3 to 60 in, 30 to 100k cfm, up to 10 in. wg" },
            { value: "residential", label: "residential", title: "4 to 20 in, 20 to 2000 cfm, up to 1 in. wg; wider pitch, finer read" },
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
              Δp {fmt(r.loss, 3)} in. wg
            </FactChip>
            <FactChip title="Friction loss per 100 ft, the friction-chart number">
              {fmt(r.lossPer100, 3)} in. wg / 100 ft
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
          <pre className="face-mono t-prose rounded-md border border-line bg-line/20 p-3 whitespace-pre-wrap text-ink">
            {formula}
          </pre>
          <p className="t-prose text-ink-2">
            ASHRAE Fundamentals, Duct Design: Darcy friction with the Altshul-Tsal factor. L in ft,
            D in inches, ε in ft, ρ in lb/ft³. The wheel reads the friction-chart power law
            0.109136·Q^1.9/D^5.02 for galvanized duct and standard air, as the SMACNA Ductulator
            does; it runs up to a tenth above the Altshul-Tsal figure.
          </p>
        </section>
        </div>
      </div>
      <div className="pt-(--gutter)">
        <DuctCharts face={face} cfm={d.cfm} diameter={wheelDiameter} onPick={pick} />
      </div>
    </Surface>
  );
}
