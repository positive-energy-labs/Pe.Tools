// @vitest-environment jsdom
// Its own file: the app atom registry is per module, and a sibling test's open-B Work would linger.
import { afterEach, expect, test, vi } from "vite-plus/test";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { RegistryContext } from "@effect/atom-react";

import { appAtomRegistry } from "#/route";
import { cellsApplied, setup, stubEventSource } from "../../../../host/tests/schedule-test-fixture";
import { detailResponse, target } from "../../../../host/tests/schedule-fixture";
import { LiveScheduleGridWorkspace } from "./live";
import { ScheduleGridWorkspace, type ScheduleGridState } from "./workspace";

vi.mock("#/lib/token", () => ({ token: () => "currentColor", dash: () => "none" }));
afterEach(cleanup);

test("ask A: a push refused on moved evidence draws the cell stale with what Revit holds now, no separate read; accept then push lands it", async () => {
  const f = await setup(); // 1::2 staged "150 VA" under the open-B reading of 100 VA
  stubEventSource(f);
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {}, removeItem: () => {} });
  let state: ScheduleGridState | undefined;
  render(
    <RegistryContext.Provider value={appAtomRegistry}>
      <LiveScheduleGridWorkspace
        workspaceId={f.scope.work}
        target={JSON.stringify({ kind: "open", ref: f.b })}
        render={(next) => {
          state = next;
          return <ScheduleGridWorkspace state={next} />;
        }}
      />
    </RegistryContext.Provider>,
  );
  await screen.findByText("P-1");
  // The push admits the Work revision the page holds: wait until it holds setup's last write.
  const settled = (await f.view()).doc;
  await vi.waitFor(() => expect(state?.slice).toEqual(settled));
  await vi.waitFor(() => expect(state?.blockedBecause).toBeNull());
  // Revit moves Load to 120 VA after the review; the domain refuses the cell on its evidence.
  const moved = detailResponse();
  const row = moved.entries[0].rows[0];
  row.values = ["P-1", "120 VA"];
  row.bindings[0] = {
    ...row.bindings[0],
    rawValue: "120",
    displayValue: "120 VA",
    targets: [target(7, "120"), target(8, "120")],
  };
  f.setDetail(moved);
  const refused = cellsApplied([[1, 2, false, "Expected target evidence is stale"]]);
  Object.assign(refused.results[0]!, { code: "target-evidence-stale" });
  f.setResponse(refused);
  await act(async () => {
    // The refusal names the cell; its own readback already rebound the Work.
    expect(await state!.execute("push")).toMatchObject({
      message: "1 refused · Load · row 1",
    });
  });
  // The push's readback rebound the Work: A is on the key, C is the basis, B is still staged.
  await vi.waitFor(async () =>
    expect((await f.view()).doc.basis).toMatchObject({ stale: [{ key: "1::2", was: "100 VA" }] }),
  );
  expect((await f.view()).doc.cells["1::2"].staged).toEqual({ value: "150 VA" });
  expect((await screen.findAllByTitle(/Revit now 120 VA/)).length).toBeGreaterThan(0);
  const pending = await screen.findByRole("list", { name: "pending cells" });
  fireEvent.click(await within(pending).findByRole("button", { name: "accept" }));
  await vi.waitFor(async () =>
    expect((await f.view()).doc.basis).toEqual({ captureId: expect.any(String) }),
  );
  f.setResponse(cellsApplied([[1, 2, true]]));
  await vi.waitFor(() => expect(state?.blockedBecause).toBeNull());
  await act(async () => {
    expect(await state!.execute("push")).toBeNull();
  });
  const pushed = f.sent.filter((s) => s.key === "schedule.cells.apply");
  expect(pushed).toHaveLength(2);
  expect(pushed[1]!.input.edits[0]).toMatchObject({
    value: "150 VA",
    expectedBinding: { rawValue: "120" },
  });
}, 30_000);
