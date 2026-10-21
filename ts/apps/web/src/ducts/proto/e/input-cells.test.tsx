// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { ductsRouteState } from "@pe/agent-contracts";
import type { Priced } from "@pe/ducts-domain/pricing";
import type { DuctSnapshot } from "@pe/ducts-domain/types";

import type { LossesWork } from "../../work";
import { EquipmentCells, TerminalCells, type InputsCtx } from "./input-cells";

afterEach(cleanup);

const snapshot = { groups: [], nodes: [], segments: [] } as unknown as DuctSnapshot;
const priced = {
  flows: new Map([[30, { cfm: 120, source: "revit" }]]),
  equipmentFlows: new Map([[1, { cfm: null, source: null }]]),
  roles: new Map(),
  staged: { terminalDrops: {}, esp: {}, roles: {} },
  next: { paths: {}, byGroup: {}, design: { graph: { parts: [] } } },
} as unknown as Priced;

function ctx(doc = ductsRouteState.schema.parse({})) {
  const write = vi.fn(async (_patches: unknown) => null);
  const work = { doc, revision: 3, write } as unknown as LossesWork;
  return { write, inputs: { snapshot, priced, work } satisfies InputsCtx };
}

test("a terminal row's flow cell shows the resolved value and its source rung", () => {
  const { inputs } = ctx();
  const { container } = render(<TerminalCells ctx={inputs} id={30} />);
  const cell = container.querySelector('[data-e-cell="flows:30"]')!;
  expect((cell.querySelector("input") as HTMLInputElement).value).toBe("120");
  expect(cell.querySelector("[data-e-source]")!.textContent).toBe("cfm · Revit");
  expect(container.querySelector('[data-e-cell="terminalDrops:30"]')).not.toBeNull();
});

test("typing a flow stages it as an override in the flows segment", async () => {
  const { inputs, write } = ctx();
  const { container } = render(<TerminalCells ctx={inputs} id={30} />);
  const input = container.querySelector('[data-e-cell="flows:30"] input') as HTMLInputElement;
  fireEvent.change(input, { target: { value: "150" } });
  fireEvent.blur(input);
  await vi.waitFor(() => expect(write).toHaveBeenCalled());
  const patches = write.mock.calls[0]![0] as { path: string[]; value?: unknown }[];
  expect(patches.some((p) => p.path[0] === "flows" && p.path[1] === "30")).toBe(true);
  expect(JSON.stringify(patches)).toContain('"cfm":150');
});

test("Pea's proposal shows as the proposed value and names itself", () => {
  const doc = ductsRouteState.schema.parse({
    equipmentFlows: { "1": { proposal: { value: { cfm: 800 } } } },
  });
  const { inputs } = ctx(doc);
  const { container } = render(<EquipmentCells ctx={inputs} id={1} />);
  const cell = container.querySelector('[data-e-cell="equipmentFlows:1"]')!;
  expect((cell.querySelector("input") as HTMLInputElement).value).toBe("800");
  expect(cell.querySelector("[data-e-source]")!.textContent).toContain("Pea proposes");
  expect(container.querySelector('[data-e-cell="roles:1"]')).not.toBeNull();
  expect(container.querySelector('[data-e-cell="esp:1"]')).not.toBeNull();
  expect(screen.queryByText("override")).toBeNull();
});

test("a unit's flow is the one the open system's groups price it at, never another system's sum", () => {
  const scoped = {
    ...priced,
    equipmentFlows: new Map([[1, { cfm: 768, source: "derived", grilles: 2 }]]),
    fanFlows: new Map<string, Map<number, object>>([
      ["g1", new Map([[1, { cfm: null, source: null }]])],
      ["g2", new Map([[1, { cfm: 300, source: "derived", grilles: 1 }]])],
    ]),
  } as unknown as Priced;
  const work = { doc: ductsRouteState.schema.parse({}), revision: 3, write: vi.fn() } as unknown as LossesWork;
  const value = (groups: string[] | null) => {
    const { container, unmount } = render(
      <EquipmentCells ctx={{ snapshot, priced: scoped, work, groups }} id={1} />,
    );
    const cell = container.querySelector('[data-e-cell="equipmentFlows:1"]')!;
    const out = [
      (cell.querySelector("input") as HTMLInputElement).value,
      cell.querySelector("[data-e-source]")?.textContent ?? "",
    ];
    unmount();
    return out;
  };
  expect(value(["g1"])[0]).toBe("");
  expect(value(["g2"])).toEqual(["300", expect.stringContaining("sum of 1 grille")]);
  expect(value(null)).toEqual(["768", expect.stringContaining("sum of 2 grilles")]);
});
