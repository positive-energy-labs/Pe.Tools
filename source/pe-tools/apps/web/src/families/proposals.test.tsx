// @vitest-environment jsdom
import { expect, test, vi } from "vite-plus/test";

const client = vi.hoisted(() => ({
  runSemanticAction: vi.fn(async (..._args: unknown[]) => ({
    state: "succeeded",
    result: {} as Record<string, unknown>,
  })),
}));
vi.mock("../../../../packages/mcps/src/shared/takeoff-action-client", () => client);
const written = vi.hoisted(() => [] as { path: string; content: string }[]);
vi.mock("#/route/pods", async (original) => {
  const actual = (await original()) as { podHost: object };
  return {
    ...actual,
    podHost: {
      ...actual.podHost,
      write: vi.fn(async (ref: { pod: string; path: string }, content: string) => {
        written.push({ path: ref.path, content });
        return { ...ref, sha256: "a".repeat(64) };
      }),
    },
  };
});

import { familyCellKey, type FamilyCellAddress, type FamilyCellState } from "@pe/agent-contracts";
import { render, screen } from "@testing-library/react";
import { ProposalCell } from "./matrix-columns";
import { manifest } from "./manifest";

const fcu = {
  familyId: 3101,
  familyName: "Fan Coil Unit - Ducted",
  typeName: "FCU-1",
  parameter: "PE_G___Model",
  value: "FXMQ20",
} as const;
const hp = {
  familyId: 3102,
  familyName: "Heat Pump - Split",
  typeName: "HP-1",
  parameter: "PE_G___Manufacturer",
  value: "Mitsubishi",
} as const;
const scope = {
  categoryNames: ["Mechanical Equipment"],
  familyNames: [],
  placementScope: "AllLoaded",
};
const cells = (
  rows: readonly { address: FamilyCellAddress; cell: FamilyCellState }[],
): Record<string, FamilyCellState> =>
  Object.fromEntries(rows.map(({ address, cell }) => [familyCellKey(address), cell]));
const proposal = (row: typeof fcu | typeof hp): FamilyCellState => ({
  proposal: { value: { familyName: row.familyName, value: row.value } },
  staged: null,
});
const staged = (row: typeof fcu | typeof hp): FamilyCellState => ({
  proposal: { value: { familyName: row.familyName, value: row.value } },
  staged: { value: { familyName: row.familyName, value: row.value } },
});
const ctx = (workCells: Record<string, FamilyCellState>) => ({
  target: { kind: "document", ref: { session: "s", openId: "o" } },
  work: {
    key: { route: "families", target: null },
    doc: { scope, excludedIds: [], cells: workCells },
    revision: 2,
  },
  readings: { pods: { state: "ready", observation: [] } },
  page: {
    stage: "audit",
    pod: "demo-pod",
    path: "",
    selection: [],
    confirming: false,
    sheet: null,
    draft: { placement: "AllLoaded", categories: [], families: [] },
  },
  write: vi.fn(async () => null),
  setPage: vi.fn(),
});
const planned = (familyId: number) => ({
  state: "succeeded",
  result: {
    plan: [
      {
        familyId,
        familyName: `f${familyId}`,
        planHash: `h${familyId}`,
        changes: [{ section: "types", key: "T", kind: "set" }],
        runEffects: [],
        refusals: [],
        warnings: [],
      },
    ],
  },
});

test("a proposal renders its author and both values", () => {
  render(<ProposalCell current="FXMQ12" reason="" cell={proposal(fcu)} onCommit={() => {}} />);
  const input = screen.getByDisplayValue("FXMQ20");
  const cell = input.closest("[data-proposal]")!;
  expect(cell.getAttribute("data-proposal")).toBe("pea");
  expect(cell.innerHTML).toContain("Pea proposed FXMQ12 → FXMQ20");
});

test("a counter-proposal renders beside the staged human value", () => {
  render(
    <ProposalCell
      current="FXMQ12"
      reason=""
      cell={{
        proposal: { value: { familyName: fcu.familyName, value: "FXMQ24" } },
        staged: { value: { familyName: fcu.familyName, value: "FXMQ20" } },
      }}
      onCommit={() => {}}
    />,
  );
  const rendered = screen.getAllByDisplayValue("FXMQ20").at(-1)?.closest("[data-proposal]");
  expect(rendered?.innerHTML).toContain("Pea's value is a counter-proposal");
  expect(rendered?.querySelector("[title]")?.getAttribute("title")).toContain(
    "pea proposes FXMQ24",
  );
  expect(rendered?.innerHTML).not.toContain("[object Object]");
});

test("plan takes the staged cell only; the open proposal never reaches the wire", async () => {
  written.length = 0;
  client.runSemanticAction.mockClear();
  client.runSemanticAction.mockResolvedValueOnce(planned(3101) as never);
  const c = ctx(
    cells([
      { address: fcu, cell: staged(fcu) },
      { address: hp, cell: proposal(hp) },
    ]),
  );
  expect(manifest.actions!.plan.count!(c as never)).toBe(1);
  await manifest.actions!.plan.run(c as never, undefined as never);
  expect(written.map((w) => w.path)).toEqual([
    expect.stringMatching(/^settings\/families\/staged-Fan-Coil-Unit-+Ducted-.*\.json$/),
  ]);
  expect(client.runSemanticAction).toHaveBeenCalledTimes(1);
  expect(client.runSemanticAction.mock.calls[0]![1]).toMatchObject({ familyIds: [3101] });
  const sheet = (c.setPage.mock.calls.at(-1)![0] as { sheet: { entries: { detail: string }[] } })
    .sheet;
  // The sheet names the member the family applies from.
  expect(sheet.entries[0]!.detail).toContain(`from ${written[0]!.path}`);
});

test("a denied proposal is gone from Work, so plan has nothing of it", async () => {
  written.length = 0;
  client.runSemanticAction.mockClear();
  // Deny removes the cell from both lists; with only an open proposal left, nothing is staged.
  const c = ctx(cells([{ address: hp, cell: proposal(hp) }]));
  expect(manifest.actions!.plan.count!(c as never)).toBeNull();
});

test("each staged family gets its own member, selecting exactly that family and planning its id", async () => {
  written.length = 0;
  client.runSemanticAction.mockClear();
  client.runSemanticAction
    .mockResolvedValueOnce(planned(3101) as never)
    .mockResolvedValueOnce(planned(3102) as never);
  await manifest.actions!.plan.run(
    ctx(
      cells([
        { address: fcu, cell: staged(fcu) },
        { address: hp, cell: staged(hp) },
      ]),
    ) as never,
    undefined as never,
  );
  expect(written.map((w) => JSON.parse(w.content).select)).toEqual([
    { names: ["Fan Coil Unit - Ducted"] },
    { names: ["Heat Pump - Split"] },
  ]);
  expect(
    client.runSemanticAction.mock.calls.map(
      (call) => (call[1] as { familyIds: number[] }).familyIds,
    ),
  ).toEqual([[3101], [3102]]);
});
