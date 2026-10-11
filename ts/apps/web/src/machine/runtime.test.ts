import { expect, test } from "vite-plus/test";
import type { Machine, Reading } from "@pe/agent-contracts";
import { MACHINE_SEEDS } from "#/open/seeds";
import { chipText, machineOf, runtimeIdentity } from "./model";

const original = machineOf(MACHINE_SEEDS["no-revit"])!;
const matched: Machine = {
  ...original,
  host: { ...original.host!, runtimeMatch: "verified" },
};
const ready = (observation: Machine): Reading<Machine> => ({ state: "ready", observation });

test("matched ownership is displayed only for a current real reading", () => {
  expect(chipText(ready(matched))).toBe("Installed · 0.7.0 · Revit matched");
  expect(runtimeIdentity(ready(matched)).detail).toContain("not payload freshness");
  const stale = { ...MACHINE_SEEDS.disconnected, previous: matched } as Reading<Machine>;
  expect(chipText(stale)).toBe("Installed · 0.7.0 · stale");
  expect(chipText(ready(matched), true)).toBe("Fixture · 0.7.0");
  expect(chipText({ state: "absent" })).toBe("Runtime unknown");
});

test("checkout name never substitutes for owner evidence", () => {
  const host = {
    ...matched.host!,
    payload: "checkout" as const,
    sourceRoot: "C:\\work\\checkout-A",
  };
  expect(chipText(ready({ ...matched, host }))).toBe("Dev checkout-A · 0.7.0 · Revit matched");
  expect(chipText(ready({ ...matched, host: { ...host, runtimeMatch: undefined } }))).toContain(
    "identity unverified",
  );
  expect(chipText(ready({ ...matched, host: { ...host, sourceRoot: null } }))).toContain(
    "identity unverified",
  );
});

test("refusal and no connection have distinct honest states", () => {
  const state = (runtimeMatch: "refused" | "disconnected") =>
    ready({
      ...matched,
      host: { ...matched.host!, runtimeMatch, runtimeRefusal: "Wrong checkout" },
    });
  expect(chipText(state("refused"))).toContain("runtime refused");
  expect(runtimeIdentity(state("refused")).detail).toContain("Wrong checkout");
  expect(chipText(state("disconnected"))).toContain("no Revit link");
});
