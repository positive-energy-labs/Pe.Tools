import { useId, useState } from "react";
import { Tooltip } from "#/components/lang/tooltip";
import { Press } from "#/components/lang/press";
import { PRESSURE_ISSUE_KINDS } from "./issues";
import { groupPressure, type Pressure, type PressurePoint } from "./pressure";
import type { DuctSnapshot } from "./readiness";

function Depends({ pressure, ids }: { pressure: Pressure; ids: readonly string[] }) {
  return (
    <div className="flex flex-col gap-1" data-depends-on="">
      <p>Depends on</p>
      {!ids.length ? <p>Captured geometry and solver results; no additional assumptions.</p> : null}
      {ids.map((id) => {
        const used = pressure.assumptionsUsed.find((a) => a.id === id);
        return (
          <p key={id}>
            <span className="face-mono">
              {id}: {used?.value ?? "unknown"}
            </span>
            {" · "}
            {used?.source ?? "missing source"}
            {" · "}
            {used?.reason ?? "dependency missing from receipt"}
          </p>
        );
      })}
    </div>
  );
}

export function PressureNumber({
  value,
  unit = "in-wg",
  pressure,
  ids,
  label,
  digits = 3,
}: {
  value: number | null | undefined;
  unit?: string;
  pressure: Pressure;
  ids: readonly string[];
  label: string;
  digits?: number;
}) {
  const [open, setOpen] = useState(false);
  const triggerId = useId();
  return (
    <span className="face-mono">
      <Tooltip.Root open={open} onOpenChange={setOpen} triggerId={triggerId}>
        <Tooltip.Trigger
          id={triggerId}
          closeOnClick={false}
          size="compact"
          aria-label={`${label}: ${value == null ? "unknown" : value.toFixed(digits)} ${unit}; depends on`}
          onClick={() => setOpen(true)}
        >
          {value == null ? "unknown" : value.toFixed(digits)} {unit}
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Positioner side="bottom" align="start">
            <Tooltip.Popup role="tooltip">
              <Depends pressure={pressure} ids={ids} />
            </Tooltip.Popup>
          </Tooltip.Positioner>
        </Tooltip.Portal>
      </Tooltip.Root>
    </span>
  );
}

export function PressureIssues({
  pressure,
  group,
  element,
  select,
}: {
  pressure: Pressure;
  group: string;
  element?: number;
  select?: (id: number) => void;
}) {
  const issues = pressure.issues.filter(
    (i) =>
      (i.groupId === group || i.groupId === "") && (element == null || i.elementId === element),
  );
  return (
    <div data-pressure-issues="" className="flex flex-col gap-1">
      <p>Pressure issues · {issues.length}</p>
      <ul>
        {issues.map((issue, i) => {
          const info = PRESSURE_ISSUE_KINDS[issue.code];
          return (
            <li key={`${issue.code}:${issue.elementId}:${i}`}>
              <span data-tone={info?.color.tone ?? "caution"}>{info?.label ?? issue.code}</span>
              {" · "}
              {issue.elementId != null && select ? (
                <Press size="caption" onClick={() => select(issue.elementId!)}>
                  {issue.elementId}
                </Press>
              ) : (
                issue.elementId
              )}{" "}
              {issue.reason}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function PressureFacts({ point, pressure }: { point?: PressurePoint; pressure: Pressure }) {
  if (!point) return <p className="text-ink-mute">No pressure result reaches this element.</p>;
  return (
    <div className="flex flex-col gap-1" data-pressure-facts="">
      <p>
        Solver pressure ·{" "}
        {point.complete ? "complete local calculation" : "partial known-demand calculation"}
      </p>
      <p>
        Local drop{" "}
        <PressureNumber
          label="local drop"
          value={point.drop}
          pressure={pressure}
          ids={point.assumptionsUsed}
        />
      </p>
      <p>
        Cumulative loss{" "}
        <PressureNumber
          label="cumulative loss"
          value={point.atPoint}
          pressure={pressure}
          ids={point.pointAssumptions}
        />
      </p>
      <p className="text-ink-2">
        Cumulative duct and fitting loss at the farthest reached outlet; excludes rated component
        drops.
      </p>
      {point.segments.map((s) => (
        <p key={`${s.startFt}:${s.endFt}`}>
          Interval {s.startFt.toFixed(2)}–{s.endFt.toFixed(2)} ft · {s.flowCfm.toFixed(0)} cfm ·{" "}
          <PressureNumber
            label="interval drop"
            value={s.friction.pressureDropInWg}
            pressure={pressure}
            ids={s.assumptionsUsed}
          />
        </p>
      ))}
      {point.fittings.map((f) => (
        <p key={f.outletConnector}>
          Outlet {f.outletConnector} · {f.path} · {f.coefficientRow} · C={f.coefficient.toFixed(3)}{" "}
          ·{" "}
          <PressureNumber
            label="fitting drop"
            value={f.pressureDropInWg}
            pressure={pressure}
            ids={f.assumptionsUsed}
          />
        </p>
      ))}
      <Depends
        pressure={pressure}
        ids={[...new Set([...point.assumptionsUsed, ...point.pointAssumptions])]}
      />
    </div>
  );
}

export function PressureBudget({ snapshot, group }: { snapshot: DuctSnapshot; group: string }) {
  const pressure = snapshot.pressure;
  const budget = groupPressure(snapshot, group);
  if (!pressure || !budget)
    return (
      <p className="text-ink-2">Manual D budget unavailable: no pressure receipt for this group.</p>
    );
  const number = (label: string, value: number | null | undefined, unit = "in-wg") => (
    <PressureNumber
      label={label}
      value={value}
      unit={unit}
      pressure={pressure}
      ids={budget.assumptionsUsed}
    />
  );
  return (
    <div className="flex flex-col gap-1" data-pressure-budget="">
      <p>Manual D budget · {budget.isWalkable ? "walkable" : "partial network"}</p>
      {(snapshot.groups.find((g) => g.id === group)?.rootIds ?? []).map((id) => {
        const key = budget.assumptionsUsed.includes(`fan:${id}`) ? `fan:${id}` : "fan:default";
        const assumption = pressure.assumptionsUsed.find((a) => a.id === key);
        const captured = snapshot.nodes
          .find((n) => n.id === id)
          ?.facts.find((f) => f.key === "externalStatic")?.value;
        const value = assumption
          ? assumption.value === "unknown"
            ? null
            : Number(assumption.value)
          : captured;
        return (
          <p key={id}>
            Fan {id} static{" "}
            <PressureNumber
              label={`fan ${id} static`}
              value={value}
              pressure={pressure}
              ids={assumption ? [key] : []}
            />{" "}
            · {assumption?.source ?? (captured == null ? "no solver fan rating" : "revit-reported")}
          </p>
        );
      })}
      <p>
        Available static (ASP) = fan static − external component drops ={" "}
        {number("available static", budget.availableStaticInWg)}
      </p>
      <p>
        Total effective length (TEL) = longest supply + return runs, or exhaust run ={" "}
        {number("total effective length", budget.totalEffectiveLengthFt, "ft")}
      </p>
      <p>
        Friction rate = ASP × 100 / TEL ={" "}
        {number("friction rate", budget.frictionRateInWgPer100Ft, "in-wg/100 ft")}
      </p>
      <p>Margin = fan static − highest circuit loss = {number("margin", budget.marginInWg)}</p>
      {budget.marginInWg == null ? (
        <p data-tone="caution">
          Budget unresolved:{" "}
          {[
            ...new Set(
              pressure.issues
                .filter(
                  (i) => i.groupId === group && PRESSURE_ISSUE_KINDS[i.code]?.blocks !== "none",
                )
                .map((i) => PRESSURE_ISSUE_KINDS[i.code]?.label ?? i.code),
            ),
          ].join(" · ") || "missing circuit inputs"}
          .
        </p>
      ) : null}
      <p>
        This group's longest effective run:{" "}
        {number("group effective length", budget.pathEffectiveLengthFt, "ft")}. Fitting equivalent
        lengths use C × Dh / f.
      </p>
      {budget.criticalPath ? (
        <p>
          Critical terminal {budget.criticalPath.terminalId} ·{" "}
          {budget.criticalPathIncludesComponents
            ? "total loss"
            : "duct + fitting loss only; components unknown"}{" "}
          <PressureNumber
            label="critical loss"
            pressure={pressure}
            ids={budget.criticalPath.assumptionsUsed}
            value={
              budget.criticalPathIncludesComponents
                ? budget.criticalPath.totalLossInWg
                : budget.criticalPath.ductLossInWg
            }
          />
        </p>
      ) : (
        <p>No solver critical path is available.</p>
      )}
    </div>
  );
}
