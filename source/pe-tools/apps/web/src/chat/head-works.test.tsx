// @vitest-environment jsdom
/** Mission 9: the Chat head counts Pea's launch proposal on the instances Work like any route's. */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { readingKey } from "@pe/agent-contracts";

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
