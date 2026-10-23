import { type ListSearch } from "@pe/agent-contracts";
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
import { useCallback, useEffect, useMemo, useState } from "react";
import { emptyListState, useList } from "@pe/kit/lang/collection";
import { ListView, type ListRowParts } from "@pe/kit/lang/list-view";
import { observedElements, useNativeObservation } from "#/revit/observation";

import { EquipmentCells, TerminalCells, type InputsCtx } from "./input-cells";
import { fanFacts } from "./fan-sections";
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
    scope?: string;
    search: ListSearch;
    sort: "" | "name";
    onChange: (search: ListSearch, sort: "" | "name") => void;
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
  const { units, terminals } = useMemo(() => inputRowsOf(snapshot, scope), [snapshot, scope]);
  const ctx = useMemo<InputsCtx | null>(
    () => (priced ? { snapshot, priced, work, groups: scope.groups } : null),
    [snapshot, priced, work, scope.groups],
  );
  // A unit that is a fan reads as one, with its own section's TEL and ESP beside its cells.
  const fans = useMemo(
    () => new Map(fanFacts(priced, scope.groups, nameOf).map((f) => [f.unit, f])),
    [priced, scope.groups, nameOf],
  );
  const items = useMemo(
    () => [
      ...units.map((id) => ({ id, kind: "unit" as const })),
      ...terminals.map((id) => ({ id, kind: "grille" as const })),
    ],
    [units, terminals],
  );
  const search = useCallback(
    (item: (typeof items)[number]) => ({ text: [nameOf(item.id), item.kind], ids: [item.id] }),
    [nameOf],
  );
  const [state, setState] = useState(emptyListState<"name">);
  const list = useList({
    scope: props.address?.scope,
    items,
    keyOf: (item) => `${item.kind}:${item.id}`,
    search,
    fields: {
      kind: { kind: "text" as const, read: (item) => item.kind, values: ["unit", "grille"] },
    },
    sorts: { name: (item) => nameOf(item.id) },
    select: "single",
    state: {
      ...state,
      search: props.address?.search ?? state.search,
      sort: props.address?.sort ?? state.sort,
      selected: items
        .filter((item) => item.id === selected)
        .map((item) => `${item.kind}:${item.id}`),
    },
    onState: (next) => {
      setState(next);
      if (
        props.address &&
        (next.search !== props.address.search || next.sort !== props.address.sort)
      )
        props.address.onChange(next.search, next.sort);
    },
    onPick: (item) => select(item.id),
  });
  useEffect(() => {
    const row = list.rows.find((row) => row.item.id === selected);
    if (row) list.reveal(row.key);
    // Reveal through the core only when its filtered rows include the route's selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, list.state.search, list.state.sort]);
  const row = useCallback(
    ({ id, kind }: (typeof items)[number]): ListRowParts => {
      if (!ctx) return { label: nameOf(id) };
      const target = observedElements(observation, [id]);
      const fan = kind === "unit" ? fans.get(id) : undefined;
      return {
        lines: 2,
        wrap: true,
        label: nameOf(id),
        title: fan ? `${nameOf(id)} · ${fan.role}: ${fan.says}` : nameOf(id),
        aside: fan?.role ?? kind,
        sub: (
          <span
            className="flex min-w-0 flex-col gap-0.5"
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
          >
            {kind === "unit" ? (
              <>
                <EquipmentCells ctx={ctx} id={id} />
                {fan ? (
                  <span className="face-mono t-small text-ink-2" data-e-fan-facts={id}>
                    {fan.says}
                  </span>
                ) : null}
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
    },
    [ctx, observation, fans, nameOf, props.fanVerbs, light],
  );
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
        bar={items.length >= 20 || list.filtering || !!list.state.sort}
        empty={{
          message: "no unit or grille in this system",
          exit: "Choose a system with a unit or grille",
        }}
        row={row}
      />
    </div>
  );
}
