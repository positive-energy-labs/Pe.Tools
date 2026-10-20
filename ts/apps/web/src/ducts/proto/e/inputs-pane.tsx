/**
 * The Inputs section of the sidebar: one named row per unit (flow, role, ESP) and per grille (flow,
 * drop) of the open system, always drawn, never behind an expanded run. These are the Work cells a
 * person types into; a Set row's "enter a flow" lands on one of them.
 */
import type { Priced } from "@pe/ducts-domain/pricing";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import { Row } from "@pe/kit/lang/row";

import { EquipmentCells, TerminalCells, type InputsCtx } from "./input-cells";
import type { LossesWork } from "../../work";

export interface InputsPaneProps {
  snapshot: DuctSnapshot;
  priced: Priced | null;
  work: LossesWork;
  group: string;
  nameOf: (id: number) => string;
  selected: number | null;
  select: (id: number | null) => void;
  light: (ids: readonly number[] | null) => void;
}

/** The unit ids and terminal ids of one system, in snapshot order. */
export function inputRowsOf(snapshot: DuctSnapshot, group: string) {
  const roots = new Set(snapshot.groups.find((g) => g.id === group)?.rootIds ?? []);
  const units = snapshot.nodes.filter(
    (n) => n.kind === "equipment" && (n.groupId === group || roots.has(n.id)),
  );
  const terminals = snapshot.nodes.filter((n) => n.kind === "terminal" && n.groupId === group);
  return { units: units.map((n) => n.id), terminals: terminals.map((n) => n.id) };
}

export function InputsPane(props: InputsPaneProps) {
  const { snapshot, priced, work, group, nameOf, selected, select, light } = props;
  const { units, terminals } = inputRowsOf(snapshot, group);
  const ctx: InputsCtx | null = priced ? { snapshot, priced, work } : null;
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
      data-key={`${kind}:${id}`}
    />
  );
  return (
    <div role="list" aria-label="inputs" data-e-inputs>
      {units.map((id) => row(id, <EquipmentCells ctx={ctx} id={id} />, "unit"))}
      {terminals.map((id) => row(id, <TerminalCells ctx={ctx} id={id} />, "grille"))}
    </div>
  );
}
