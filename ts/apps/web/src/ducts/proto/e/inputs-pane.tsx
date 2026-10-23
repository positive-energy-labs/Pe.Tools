/**
 * The Inputs section of the sidebar: one named row per unit (flow, role, ESP) and per grille (flow,
 * drop) of the open system, always drawn, never behind an expanded run. These are the Work cells a
 * person types into; a Set row's "enter a flow" lands on one of them. Which parameter a flow is
 * read from is a route setting, not an input: the airflow slots live in the chrome Settings popover.
 */
import type { Priced } from "@pe/ducts-domain/pricing";
import type { SystemScope } from "@pe/ducts-domain/system-scope";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import { useScopeGestures, type ScopeGesture } from "@pe/kit/keys";
import { Row } from "@pe/kit/lang/row";
import { observedElements, useNativeObservation } from "#/revit/observation";

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
function inputRowsOf(snapshot: DuctSnapshot, scope: InputsScope) {
  const units = snapshot.nodes.filter((n) => n.kind === "equipment" && scope.units.has(n.id));
  const terminals = snapshot.nodes.filter(
    (n) => n.kind === "terminal" && scope.terminals.has(n.id),
  );
  return { units: units.map((n) => n.id), terminals: terminals.map((n) => n.id) };
}

/** The cells' own keys (`StateCell`'s input handler) and the row's pointer, declared for help. */
const INPUT_KEYS: readonly ScopeGesture[] = [
  { keys: ["Enter"], label: "commit, next row" },
  { keys: ["Tab"], label: "commit, next cell" },
  { keys: ["↑", "↓"], label: "commit, row up or down" },
  { keys: ["Esc"], label: "drop the typed value" },
  { pointer: "click", label: "select in the picture" },
  { pointer: "hover", label: "light it in the picture" },
];

export function InputsPane(props: InputsPaneProps) {
  useScopeGestures(INPUT_KEYS);
  const observation = useNativeObservation();
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
  const row = (id: number, cells: React.ReactNode, kind: "unit" | "grille") => {
    const target = observedElements(observation, [id]);
    return (
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
        revitIds={target.ids}
        revitRefs={target.refs}
        data-key={`${kind}:${id}`}
      />
    );
  };
  return (
    <div role="list" aria-label="inputs" data-e-inputs>
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
      {terminals.map((id) => row(id, <TerminalCells ctx={ctx} id={id} />, "grille"))}
    </div>
  );
}
