// @vitest-environment jsdom
/** Mission 9: the Chat head counts Pea's launch proposal on the instances Work like any route's. */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { address, readingKey } from "@pe/agent-contracts";

import { peReadings } from "#/readings";
import { useHeadWorks } from "./head-works";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

test("the instances Work's launch proposal is a head Work, counted and opened like the others", () => {
  const accept = new Map<string, Parameters<typeof peReadings.subscribe>[1]>();
  vi.spyOn(peReadings, "subscribe").mockImplementation((request, next) => {
    if (request.kind === "work" && (request as { route?: string }).route === "instances")
      accept.set(readingKey(request), next);
    return () => {};
  });
  const open = vi.fn();
  const { result } = renderHook(() => useHeadWorks(null, "", { open, planIn: vi.fn() }));
  act(() => {
    for (const [key, next] of accept)
      next({
        kind: "snapshot",
        key,
        value: {
          revision: 2,
          doc: { launch: { proposal: { value: { kind: "start", year: "2025", name: "dev" } } } },
        },
      } as never);
  });
  const instances = result.current.find((work) => work.route === "Instances");
  expect(instances).toBeDefined();
  expect(Object.keys(instances!.cells)).toEqual(["launch"]);
  expect(instances!.cells.launch!.proposal).toBeTruthy();
  expect(instances!.wire.segment).toBeNull();
  instances!.open();
  expect(open).toHaveBeenCalledWith("instances", undefined);
});

test("F-H6-5: a families scope proposal shows in the head as its own Families group", () => {
  const next = new Map<string, Parameters<typeof peReadings.subscribe>[1]>();
  vi.spyOn(peReadings, "subscribe").mockImplementation((request, emit) => {
    if (request.kind === "work" && (request as { route?: string }).route === "families")
      next.set(readingKey(request), emit);
    return () => {};
  });
  const open = vi.fn();
  const { result } = renderHook(() =>
    useHeadWorks(address("C:/Models/MEP.rvt"), "MEP", { open, planIn: vi.fn() }),
  );
  const filter = { categoryNames: [], familyNames: ["LBP15A"], placementScope: "AllLoaded" };
  const scope = { proposal: { value: filter } };
  const patch = {
    proposal: {
      value: {
        path: "proposed/duct-patch.json",
        content: JSON.stringify({
          $schema: "https://host/schemas/settings/FamilyFoundry/patches.json",
          select: { names: ["LBP15A"] },
          patch: { parameters: {} },
        }),
      },
    },
  };
  act(() => {
    for (const [key, emit] of next)
      emit({
        kind: "snapshot",
        key,
        value: { revision: 1, doc: { scope, patch, cells: {}, excluded: {} } },
      } as never);
  });
  const families = result.current.filter((work) => work.route === "Families");
  const scoped = families.find((work) => "scope" in work.cells);
  expect(scoped).toBeDefined();
  expect(scoped!.cells.scope!.proposal).toBeTruthy();
  // The scope sits at the Work's root: its accept writes ["scope", "staged"].
  expect(scoped!.wire.segment).toBeNull();
  expect(scoped!.groupOf("scope")).toEqual(["scope"]);
  expect(scoped!.show?.(filter)).toContain("LBP15A");
  const native = families.find((work) => "patch" in work.cells);
  expect(native?.wire.segment).toBeNull();
  expect(native?.cells.patch?.proposal?.value).toEqual(patch.proposal.value);
  expect(native?.groupOf("patch")).toEqual(["native FF patch"]);
});
