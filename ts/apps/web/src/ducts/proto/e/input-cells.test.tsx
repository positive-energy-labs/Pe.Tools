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
