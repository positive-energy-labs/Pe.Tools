import { Effect } from "effect";
import { expect, test, vi } from "vite-plus/test";
import type { WorkPath } from "@pe/agent-contracts";
import { fansExecutors } from "@pe/fans-host/actions";
import { ductActionExecutors } from "../action-runtime.ts";

/*
 * Ruling D9 (2026-11-18; field map invariant 8): an apply stays in its route. Whatever the native owner
 * answers, an apply retires only the cells its own route owns, under that route. Red at 272c0120: a /fans
 * apply retired the /duct-systems `rules` and `assumptions` cells under "duct-systems".
 */
const role = "UniqueId:6d52156a-3876-4d76-b641-341454252f26-00000005";
const answer = { previewOnly: false, writes: [
  { kind: "verdict", key: "open-end:101:1", outcome: "written" },
  { kind: "fitting", id: 7, outcome: "written" },
  { kind: "role", id: 5, outcome: "written" },
] };
const input = { terminals: [], components: [], equipment: [], terminalFlows: [], equipmentFlows: [], fittings: [{ id: 7, ruleKey: "elbow" }] };

async function apply(executor: { run: (ctx: never, execution: never) => Effect.Effect<unknown, unknown> }, route: string) {
  const key = { binding: "open", route, target: null, open: { session: "A", openId: "doc" } };
  const retireWork = vi.fn((_key: unknown, _route: string, paths: readonly WorkPath[]) => Effect.succeed({ retired: [...paths], revision: 2 }));
  const ctx = { admission: { target: { kind: "document", ref: { session: "A", openId: "doc" } }, input: { work: { key, revision: 1 } } } };
  const execution = { prepared: { process: {}, input, dependencies: null, subjects: { [role]: "5" }, cells: [["roles", role]] },
    step: () => Effect.succeed(answer), retireWork };
  await Effect.runPromise(executor.run(ctx as never, execution as never) as Effect.Effect<unknown>);
  return { key, calls: retireWork.mock.calls };
}

test("a /fans apply retires its own role and leaves the /duct-systems verdict and rule staged", async () => {
  const { key, calls } = await apply(fansExecutors({} as never)["sheet.apply"] as never, "fans");
  expect(calls).toEqual([[key, "fans", [["roles", role]]]]);
});

test("a /duct-systems apply still retires its own verdict, under its own route", async () => {
  const executors = ductActionExecutors({
    snapshot: async () => { throw Error("unused"); }, derive: async () => { throw Error("unused"); },
    entry: { key: "ducts.heal", native: "ducts.heal.preview", refusePlan: null,
      retires: () => [["assumptions", "open-end:101:1"], ["roles", role]] },
    bindings: [["ducts.apply-heal", "heal", "apply"]],
  }, {} as never);
  const { key, calls } = await apply(executors["ducts.apply-heal"] as never, "duct-systems");
  expect(calls).toEqual([[key, "duct-systems", [["assumptions", "open-end:101:1"]]]]);
});
