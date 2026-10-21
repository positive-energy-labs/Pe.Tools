// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { ductsRouteState } from "@pe/agent-contracts";
import type { Priced } from "@pe/ducts-domain/pricing";
import type { DuctSnapshot } from "@pe/ducts-domain/types";

import type { LossesWork } from "../../work";
import { InputsPane } from "./inputs-pane";

afterEach(cleanup);

const node = (id: number, kind: string, extra: object = {}) => ({
  id,
  kind,
  groupId: "g1",
  facts: [],
  connectors: [],
  ...extra,
});
const snapshot = {
  groups: [{ id: "g1", rootIds: [1] }],
  nodes: [
    node(1, "equipment", { facts: [{ key: "mark", text: "FC-17" }] }),
    node(30, "terminal"),
  ],
  segments: [],
} as unknown as DuctSnapshot;
const priced = {
  flows: new Map([[30, { cfm: null, source: null }]]),
  equipmentFlows: new Map([[1, { cfm: null, source: null }]]),
  roles: new Map(),
  staged: { terminalDrops: {}, esp: {}, roles: {} },
  next: { paths: {}, byGroup: {}, design: { graph: { parts: [] } } },
} as unknown as Priced;

test("every unit and grille of the system has a named row carrying its cells, and typing stages", async () => {
  const write = vi.fn(async (_patches: unknown) => null);
  const work = {
    doc: ductsRouteState.schema.parse({}),
    revision: 1,
    write,
  } as unknown as LossesWork;
  const names: Record<number, string> = { 1: "FC-17", 30: "Price LBP15A Supply 16 X 8" };
  const { container, getByText } = render(
    <InputsPane
      snapshot={snapshot}
      priced={priced}
      work={work}
      scope={{ groups: ["g1"], terminals: new Set([30]), units: new Set([1]) }}
      nameOf={(id) => names[id]!}
      selected={null}
      select={() => undefined}
      light={() => undefined}
    />,
  );
  expect(getByText("FC-17")).toBeTruthy();
  expect(getByText("Price LBP15A Supply 16 X 8")).toBeTruthy();
  for (const cell of ["equipmentFlows:1", "roles:1", "esp:1", "flows:30", "terminalDrops:30"])
    expect(container.querySelector(`[data-e-cell="${cell}"]`)).not.toBeNull();
  const input = container.querySelector('[data-e-cell="flows:30"] input') as HTMLInputElement;
  fireEvent.change(input, { target: { value: "400" } });
  fireEvent.blur(input);
  await vi.waitFor(() => expect(write).toHaveBeenCalled());
  expect(JSON.stringify(write.mock.calls[0]![0])).toContain('"cfm":400');
});
