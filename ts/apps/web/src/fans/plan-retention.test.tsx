// @vitest-environment jsdom
import { useEffect, useReducer } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import realMuas from "../../../../packages/ducts-domain/src/sheet/fixtures/muas-local-20261102.json";
import { createWitness } from "./cutover.test-support";
import { AdmittedWrite } from "../shell/admitted-chrome";
import type { ReadingDelivery } from "../shell/readings";
const native = vi.hoisted(() => ({ submit: vi.fn(), retained: [] as unknown[] }));
vi.mock("../shell/admitted-retention", async (actual) => {
  const module = await actual<typeof import("../shell/admitted-retention")>();
  return {
    ...module,
    createAdmittedRetention: <T,>(limits: { entries: number; bytes: number }) => {
      const retention = module.createAdmittedRetention<T>(limits);
      return { ...retention, set(id: string, value: T) {
        native.retained.push(value);
        return retention.set(id, value);
      } };
    },
  };
});
vi.mock("../../../../packages/mcps/src/shared/takeoff-action-client", async (actual) => ({
  ...(await actual<object>()),
  submitAction: native.submit,
}));

const closes: (() => void)[] = [];
afterEach(() => {
  cleanup();
  closes
    .splice(0)
    .reverse()
    .forEach((close) => close());
});

test.each([false, true])("P1: rendered Fans plan keeps bounded dependencies (oversized reading: %s)", async (large) => {
  native.retained.length = 0;
  const capture = structuredClone(realMuas);
  if (large) capture.document.title = "large-model-evidence".repeat(65536);
  const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
  if (large) expect(bytes(capture)).toBeGreaterThan(1024 * 1024);
  let plan!: (result: unknown) => void;
  let snapshot!: ReadingDelivery;
  native.submit.mockImplementation(
    () =>
      new Promise((resolve) => {
        plan = resolve;
      }),
  );
  const f = await createWitness(closes, new Map(), {
    "ducts.sheet-snapshot": {
      kind: "use",
      open(_ctx, deliver) {
        snapshot = deliver;
        deliver({ kind: "complete", value: capture, revision: 1 });
      },
    },
  });
  await vi.waitFor(() => expect(f.fans.work()).not.toBeNull());
  const key = f.fans.workBasis()!.token.scope.identity.work!;
  await f.ws.apply(
    key,
    "fans",
    "pea",
    [
      {
        path: ["writeIntent"],
        value: { edit: { value: { walk: { unitId: 14577391, portIndex: 2 } } } },
      },
      {
        path: ["equipmentFlows", "14577391", "edit"],
        value: { value: { cfm: 925, source: "test" } },
      },
    ],
    f.fans.work()!.revision,
  );
  await vi.waitFor(() => expect(f.fans.work()!.value.writeIntent).toBeTruthy());
  f.fans.refresh("value");
  for (const id of ["value", "owner:ducts"])
    await vi.waitFor(() => {
      const snapshot = f.fans.readingStatus(id).snapshot;
      if (snapshot.status === "failed") throw Error(`${id}: ${snapshot.reason}`);
      expect(snapshot).toMatchObject({ current: true });
    });
  function Write() {
    const [, changed] = useReducer((n) => n + 1, 0);
    useEffect(() => f.fans.subscribe(changed), []);
    return <AdmittedWrite mount={f.fans} data={f.admitted.presenter.data} id="losses" />;
  }
  render(<Write />);
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "plan Write to Revit" })),
  );
  const preparing = native.retained.find((value) => (value as { reading?: string }).reading) as {
    invocation: { dependencies: Record<string, string> };
  };
  const constituents = Object.fromEntries(Object.entries(preparing.invocation.dependencies).map(
    ([id, hash]) => [id, { hashBytes: bytes(hash), bodyBytes: bytes(f.fans.readingStatus(id).snapshot.value) }],
  ));
  console.info("P1 token census", JSON.stringify({ large, bodyBytes: bytes(capture), preparingBytes: bytes(preparing), invocationBytes: bytes(preparing.invocation), constituents }));
  expect(document.body.textContent).not.toContain("retention limit exceeded");
  for (const hash of Object.values(preparing.invocation.dependencies)) expect(bytes(hash)).toBeLessThan(128);
  expect(plan).toBeTypeOf("function");
  const input = f.inputs.get("fans:ducts.plan-losses") as { work: unknown; readWorks: unknown };
  expect(input.readWorks).toHaveProperty("fans");
  // H1: a plan the host refuses after invoke returned shows its reason, arms nothing, and retries clean.
  const refusedText = "Fans Work belongs to another document";
  await act(async () => plan({ id: "plan-refused", state: "refused", error: refusedText }));
  expect(document.querySelector("[data-write-outcome=refused]")?.textContent).toBe(refusedText);
  expect(screen.queryByRole("button", { name: "Write to Revit" })).toBeNull();
  const trigger = screen.getByRole("button", { name: "plan Write to Revit" });
  await act(async () => fireEvent.click(trigger));
  await act(async () => fireEvent.click(trigger));
  expect(f.fans.reviewRefusal("losses")).toBeNull();
  expect(document.body.textContent).not.toContain(refusedText);
  await act(async () =>
    plan({
      id: "plan-retention",
      state: "succeeded",
      result: {
        previewOnly: true,
        takenAt: "2026-11-05T00:00:00Z",
        derivedRequest: { equipmentFlows: [{ id: 14577391, cfm: 925, source: "test" }] },
        seal: {
          requestHash: "sealed",
          work: { handle: input.work },
          documentMark: {
            session: "fixture",
            openId: "fans",
            observedSince: null,
            changedAt: null,
          },
          incarnation: {},
          dependencies: "exact",
        },
        response: {
          writes: [
            {
              id: 14577391,
              kind: "equipment-flow",
              outcome: "planned",
              before: "880 cfm",
              after: "925 cfm",
            },
          ],
          counts: { planned: 1, written: 0, refused: 0, unchanged: 0 },
        },
      },
    }),
  );
  expect(f.fans.review("losses")).toMatchObject({
    stale: false,
    cells: [{ before: "880 cfm", author: "pea" }],
  });
  expect(f.fans.review("losses")!.rows[0]).toContain("MUAS-1");
  // New naming evidence must revoke the old before/after review rather than silently re-present it.
  const moved = structuredClone(capture);
  moved.document.title = "changed model evidence";
  act(() => {
    f.fans.refresh("value");
    snapshot({ kind: "complete", value: moved, revision: 2 });
  });
  expect(f.fans.review("losses")).toMatchObject({ stale: true, rows: [], cells: [] });
  expect(() => f.fans.confirm("losses")).toThrow(/stale/i);
});
