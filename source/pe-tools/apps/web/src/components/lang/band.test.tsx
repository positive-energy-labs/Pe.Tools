// @vitest-environment jsdom
import { availableTransitions, type TrichotomyCellLike } from "@pe/agent-contracts";
import { cleanup } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";

import {
  discardStaged,
  fanOutWord,
  reviewTransitions,
  runFanOut,
  type CellWire,
} from "#/components/lang/band";

afterEach(cleanup);

const wire = (lock: string | null = null): CellWire => ({
  segment: "cells",
  write: vi.fn(async () => null),
  revision: 7,
  lockOf: () => lock,
});
const verbs = (cell: TrichotomyCellLike, lock: string | null = null) =>
  reviewTransitions(wire(lock), "a", cell).map((t) => t.kind);

const CASES: [string, TrichotomyCellLike, string | null][] = [
  ["open", { proposal: { value: "10in" }, staged: null }, null],
  ["contested", { proposal: { value: "5in" }, staged: { value: "6in" } }, null],
  ["agreed", { proposal: { value: { w: 10, h: 8 } }, staged: { value: { h: 8, w: 10 } } }, null],
  ["staged", { proposal: null, staged: { value: "6in" } }, null],
  ["locked stray", { proposal: { value: "40A" }, staged: null }, "formula-driven"],
  ["clean", { proposal: null, staged: null }, null],
];

test("the cell's kinds are the contract's availableTransitions, minus stage", () => {
  for (const [, cell, lock] of CASES)
    expect(verbs(cell, lock)).toEqual(
      availableTransitions(cell, "human", { lock }).filter((k) => k !== "stage"),
    );
  expect(CASES.map(([name, cell, lock]) => [name, verbs(cell, lock)])).toEqual([
    ["open", ["accept", "deny"]],
    ["contested", ["accept", "deny", "unstage"]],
    ["agreed", ["unstage"]],
    ["staged", ["unstage"]],
    ["locked stray", ["deny"]],
    ["clean", []],
  ]);
});

test("bound kinds carry the rendered revision; unstage does not", async () => {
  const w = wire();
  const [accept, , unstage] = reviewTransitions(w, "a", CASES[1]![1]);
  await accept!.run();
  await unstage!.run();
  expect(w.write).toHaveBeenNthCalledWith(
    1,
    [{ path: ["cells", "a", "staged"], value: { value: "5in" } }],
    7,
  );
  expect(w.write).toHaveBeenNthCalledWith(2, [{ path: ["cells", "a", "staged"], value: null }]);
});

test("a bound verb with nothing rendered refuses and writes nothing; unstage still writes", async () => {
  const w = { ...wire(), revision: null };
  const [accept, deny, unstage] = reviewTransitions(w, "a", CASES[1]![1]);
  expect(await accept!.run()).toMatchObject({ code: "not-ready" });
  expect(await deny!.run()).toMatchObject({ code: "not-ready" });
  const out = await runFanOut(w, { x: CASES[0]![1] }, ["x"], "accept");
  expect(out.refusal).toMatchObject({ code: "not-ready" });
  expect(w.write).not.toHaveBeenCalled();
  await unstage!.run();
  expect(w.write).toHaveBeenCalledOnce();
});

test("an aggregate accept is one bound write that skips the contested key and says so", async () => {
  const w = wire();
  const cells = { x: CASES[0]![1], y: CASES[0]![1], z: CASES[1]![1] };
  const outcome = await runFanOut(w, cells, ["x", "y", "z"], "accept");
  expect(w.write).toHaveBeenCalledOnce();
  expect(vi.mocked(w.write).mock.calls[0]![1]).toBe(7);
  expect(outcome.covered).toEqual(["x", "y"]);
  expect(fanOutWord(outcome)).toBe("accepted 2 · skipped 1 (contested: 1)");
});

test("a refused aggregate reports the one refusal over every covered key", async () => {
  const w = { ...wire(), write: vi.fn(async () => ({ code: "stale-revision", message: "moved" })) };
  const outcome = await runFanOut(w, { x: CASES[0]![1] }, ["x"], "deny");
  expect(outcome.covered).toEqual(["x"]);
  expect(fanOutWord(outcome)).toBe("moved");
});

test("discard unstages every staged address in one write", async () => {
  const w = wire();
  const outcome = await discardStaged(w, Object.fromEntries(CASES.map(([n, c]) => [n, c])));
  expect(outcome.covered).toEqual(["contested", "agreed", "staged"]);
  expect(w.write).toHaveBeenCalledOnce();
});
