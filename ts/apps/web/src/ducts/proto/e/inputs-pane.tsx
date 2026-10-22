/**
 * The Inputs section of the sidebar: one named row per unit (flow, role, ESP) and per grille (flow,
 * drop) of the open system, always drawn, never behind an expanded run. These are the Work cells a
 * person types into; a Set row's "enter a flow" lands on one of them. Above the grilles, the
 * airflow read slot: which parameter every grille's flow is read from, reassignable here at any
 * time (each candidate with its coverage in this system), the same choice as the inbox's Set row.
 * Above the units, the same step for a unit's design flow (the FanFlow slot): a unit's flow
 * proposes its role, so the picker sits where the role is read.
 */
import type { Priced } from "@pe/ducts-domain/pricing";
import type { SystemScope } from "@pe/ducts-domain/system-scope";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import { Button } from "@pe/kit/lang/button";
import { Row } from "@pe/kit/lang/row";

import { airflowOptions, airflowPatches, slotWord, type AirflowOf } from "../../airflow";

import { EquipmentCells, TerminalCells, type InputsCtx } from "./input-cells";
import type { ReactNode } from "react";
import type { LossesWork } from "../../work";

export interface InputsPaneProps {
  snapshot: DuctSnapshot;
  priced: Priced | null;
  work: LossesWork;
  /** The open system: its grilles, and the units on its runs, across every group it is in. */
  scope: InputsScope;
  nameOf: (id: number) => string;
  selected: number | null;
  select: (id: number | null) => void;
  light: (ids: readonly number[] | null) => void;
  /** A unit's make-the-fan verbs and last outcome, or null when none is owed (`fansOwedBase`). */
  fanVerbs?: (id: number) => ReactNode;
}

type InputsScope = Pick<SystemScope, "groups" | "terminals" | "units">;

/** The unit ids and terminal ids of one system, in snapshot order. */
export function inputRowsOf(snapshot: DuctSnapshot, scope: InputsScope) {
  const units = snapshot.nodes.filter((n) => n.kind === "equipment" && scope.units.has(n.id));
  const terminals = snapshot.nodes.filter(
    (n) => n.kind === "terminal" && scope.terminals.has(n.id),
  );
  return { units: units.map((n) => n.id), terminals: terminals.map((n) => n.id) };
}

export function InputsPane(props: InputsPaneProps) {
  const { snapshot, priced, work, scope, nameOf, selected, select, light } = props;
  const { units, terminals } = inputRowsOf(snapshot, scope);
  const ctx: InputsCtx | null = priced ? { snapshot, priced, work, groups: scope.groups } : null;
  if (!units.length && !terminals.length)
    return <p className="t-small text-ink-2 p-2">no unit or grille in this system</p>;
  if (!ctx)
    return (
      <p className="t-small text-ink-2 p-2" data-e-inputs-wait>
        flow, ESP and role cells open once the loss tables are read
      </p>
    );
  const row = (id: number, cells: React.ReactNode, kind: "unit" | "grille") => (
    <Row
      key={`${kind}:${id}`}
      role="listitem"
      lines={2}
      label={nameOf(id)}
      title={nameOf(id)}
      aside={kind}
      sub={cells}
      selected={selected === id}
      onClick={() => select(id)}
      onMouseEnter={() => light([id])}
      revitIds={[id]}
      data-key={`${kind}:${id}`}
    />
  );
  return (
    <div role="list" aria-label="inputs" data-e-inputs>
      {units.length ? (
        <AirflowSlot snapshot={snapshot} work={work} scope={scope} of="unit" />
      ) : null}
      {units.map((id) =>
        row(
          id,
          <>
            <EquipmentCells ctx={ctx} id={id} />
            {props.fanVerbs?.(id) ?? null}
          </>,
          "unit",
        ),
      )}
      {terminals.length ? (
        <AirflowSlot snapshot={snapshot} work={work} scope={scope} of="terminal" />
      ) : null}
      {terminals.map((id) => row(id, <TerminalCells ctx={ctx} id={id} />, "grille"))}
    </div>
  );
}

/** The airflow read slot: the parameter grilles (or units) read their flow from, and every candidate's coverage. */
function AirflowSlot({
  snapshot,
  work,
  scope,
  of,
}: {
  snapshot: DuctSnapshot;
  work: LossesWork;
  scope: InputsScope;
  of: AirflowOf;
}) {
  const { current, options } = airflowOptions(snapshot, scope, of);
  const at = options.find((o) => o.slot === current);
  const noun = of === "unit" ? "units" : "grilles";
  return (
    <div
      role="listitem"
      className="border-line border-b px-2 py-1"
      data-e-airflow={of === "unit" ? undefined : current}
      data-e-unit-airflow={of === "unit" ? current : undefined}
    >
      <p className="t-small">
        {of === "unit" ? "Unit airflow from " : "Airflow from "}
        <span className="face-mono">{slotWord(current)}</span>
        <span className="text-ink-2">
          {" "}
          · {at?.have ?? 0} of {at?.of ?? 0} {noun} read
        </span>
      </p>
      <div className="flex flex-wrap gap-1 pt-1">
        {options.map((o) => (
          <Button
            key={o.slot}
            kind="framed"
            label={`${o.label} · ${o.have}/${o.of}`}
            reason={`Read every ${of === "unit" ? "unit" : "grille"}'s airflow from ${o.label}: ${o.have} of ${o.of} ${noun} in this system hold a value`}
            pressed={o.slot === current}
            onClick={() => void work.write(airflowPatches(work.doc, o.slot, of) as never)}
          >
            {o.label} · {o.have}/{o.of}
          </Button>
        ))}
      </div>
    </div>
  );
}
