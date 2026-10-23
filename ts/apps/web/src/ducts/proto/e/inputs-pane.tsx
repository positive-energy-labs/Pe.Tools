/**
 * The Inputs section of the sidebar: one named row per unit (flow, role, ESP) and per grille (flow,
 * drop) of the open system, always drawn, never behind an expanded run. These are the Work cells a
 * person types into; a Set row's "enter a flow" lands on one of them. Which parameter a flow is
 * read from is a route setting, not an input: the airflow slots live in the chrome Settings popover.
 */
import type { Priced } from "@pe/ducts-domain/pricing";
import type { SystemScope } from "@pe/ducts-domain/system-scope";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import { useEffect, useState } from "react";
import { emptyListState, useList } from "@pe/kit/lang/collection";
import { ListView } from "@pe/kit/lang/list-view";
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
  address?: {
    query: string;
    sort: "" | "name";
    onChange: (query: string, sort: "" | "name") => void;
  };
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

export function InputsPane(props: InputsPaneProps) {
  const observation = useNativeObservation();
  const { snapshot, priced, work, scope, nameOf, selected, select, light } = props;
  const { units, terminals } = inputRowsOf(snapshot, scope);
  const ctx: InputsCtx | null = priced ? { snapshot, priced, work, groups: scope.groups } : null;
  const items = [
    ...units.map((id) => ({ id, kind: "unit" as const })),
    ...terminals.map((id) => ({ id, kind: "grille" as const })),
  ];
  const [state, setState] = useState(emptyListState<"name">);
  const list = useList({
    items,
    keyOf: (item) => `${item.kind}:${item.id}`,
    search: (item) => ({ text: [nameOf(item.id), item.kind], ids: [item.id] }),
    fields: {
      kind: { kind: "text" as const, read: (item) => item.kind, values: ["unit", "grille"] },
    },
    sorts: { name: (item) => nameOf(item.id) },
    select: "single",
    state: {
      ...state,
      query: props.address?.query ?? state.query,
      sort: props.address?.sort ?? state.sort,
      selected: items
        .filter((item) => item.id === selected)
        .map((item) => `${item.kind}:${item.id}`),
    },
    onState: (next) => {
      setState(next);
      if (props.address && (next.query !== props.address.query || next.sort !== props.address.sort))
        props.address.onChange(next.query, next.sort);
    },
    onPick: (item) => select(item.id),
  });
  useEffect(() => {
    const row = list.rows.find((row) => row.item.id === selected);
    if (row) list.reveal(row.key);
    // Reveal through the core only when its filtered rows include the route's selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, list.state.query, list.state.sort]);
  if (!units.length && !terminals.length)
    return <p className="t-small text-ink-2 p-2">no unit or grille in this system</p>;
  if (!ctx)
    return (
      <p className="t-small text-ink-2 p-2" data-e-inputs-wait>
        flow, ESP and role cells open once the loss tables are read
      </p>
    );
  return (
    <div aria-label="inputs" data-e-inputs>
      <ListView
        list={list}
        aria-label="inputs"
        estimate={40}
        bar={items.length >= 20 || !!list.state.query || !!list.state.sort}
        empty={{
          message: "no unit or grille in this system",
          exit: "Choose a system with a unit or grille",
        }}
        row={({ id, kind }) => {
          const target = observedElements(observation, [id]);
          return {
            lines: 2,
            label: nameOf(id),
            title: nameOf(id),
            aside: kind,
            sub: (
              <span
                onClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => event.stopPropagation()}
              >
                {kind === "unit" ? (
                  <>
                    <EquipmentCells ctx={ctx} id={id} />
                    {props.fanVerbs?.(id) ?? null}
                  </>
                ) : (
                  <TerminalCells ctx={ctx} id={id} />
                )}
              </span>
            ),
            onMouseEnter: () => light([id]),
            onMouseLeave: () => light(null),
            revitIds: target.ids,
            revitRefs: target.refs,
          };
        }}
      />
    </div>
  );
}
