import { expect, test } from "vite-plus/test";
import { bindWork } from "@pe/agent-contracts";
import { familyCellKey } from "../../../packages/agent-contracts/src/families.ts";
import { confirmedRetirement, familyExecutors } from "../src/family-actions.ts";
import { Effect } from "effect";
import { NodeServices } from "@effect/platform-node";
import { FetchHttpClient } from "effect/http";
import { effectTest, detachedBridge, captureStore } from "./effect-test.ts";
import type { ActionExecution } from "@pe/host-internal/action-execution";
import type { CommandContext } from "@pe/host-internal/command-executor";
import { RequestIdentity, admittedRequestIdentity } from "@pe/host-internal/request-identity";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp } from "../../../tests/isolated-home/storage.ts";

// SMELL-FF-RETIRE-01: consumed Work retires only where a successful native receipt confirms it.
const target = { session: "s", openId: "o" };
effectTest("PUR-FFX-RETIRE-DEPTH-01: cancelled apply preserves consumed Work at the apply surface", () =>
  Effect.gen(function* () {
    const answer = { receipts: [], diagnostics: [{ code: "Cancelled" }] };
    let calls = 0;
    const bridge = detachedBridge({
      invoke: (key) => {
        expect(key).toBe("family.apply");
        calls++;
        return Effect.succeed({ value: answer, target: { session: "s", document: "o" } });
      },
    });
    const directory = yield* Effect.tryPromise(() => mkdtemp(join(tmpdir(), "family-retirement-")));
    const executor = familyExecutors(captureStore(directory), bridge)["family.apply"];
    const retired: unknown[] = [];
    const execution: ActionExecution = {
      prepared: {
        kind: "native",
        process: { pid: 1, processStartUtc: "2026-11-16T17:00:00Z", executable: "Revit.exe" },
        input: { plan: "reviewed-plan" },
        retire: family,
      },
      step: (_kind, _key, _input, execute, options) =>
        execute("native-attempt").pipe(Effect.tap((result) => Effect.sync(() => options?.check?.(result)))),
      retireWork: (_key, _route, paths) => {
        retired.push(...paths);
        return Effect.succeed({ retired: [...paths], revision: 1 });
      },
      effect: () => Effect.die("Unexpected effect"),
      publishWork: () => Effect.die("Unexpected publication"),
      recorded: () => undefined,
    };
    const caller = { kind: "human" as const, via: "local" as const };
    const ctx: CommandContext = {
      admission: { id: "cancelled-apply", key: "family.apply", input: {}, target: { kind: "document", ref: target } },
      caller, basis: null, consumed: [],
      get work(): never { throw Error("Unexpected Work read"); },
      selectWork: async () => { throw Error("Unexpected selection"); },
      read: { receipts: () => [] },
      clock: { now: () => "2026-11-16T17:00:00Z" },
      ids: { mint: () => "unused" },
    };
    const result = yield* executor.run(ctx, execution).pipe(
      Effect.provide(NodeServices.layer),
      Effect.provide(FetchHttpClient.layer),
      Effect.provideService(RequestIdentity, admittedRequestIdentity(caller, {})),
    );
    expect(calls).toBe(1);
    expect(result).toMatchObject({ native: answer });
    expect(retired).toEqual([]);
  }),
);
const cell = (familyName: string) => familyCellKey({ familyName, typeName: "T", parameter: "P" });
const receipt = (familyName: string, success: boolean, converged = success) => ({
  familyName,
  success,
  converged,
});
const family = {
  key: bindWork("family", null, undefined, target),
  route: "family" as const,
  cells: ["a", "b"],
};
const families = {
  key: bindWork("families", null, undefined, target),
  route: "families" as const,
  cells: [cell("Fan"), cell("Pump")],
  patch: true as const,
};

test("a cancelled family apply with no successful receipt retires nothing", () => {
  expect(confirmedRetirement(family, undefined, [])).toEqual([]);
  expect(confirmedRetirement(family, undefined, [receipt("Fan", false)])).toEqual([]);
});

test("a successful family apply retires its consumed cells", () => {
  expect(confirmedRetirement(family, undefined, [receipt("Fan", true)])).toEqual([
    ["cells", "a"],
    ["cells", "b"],
  ]);
});

test("a project apply retires only cells of families whose receipt succeeded", () => {
  expect(
    confirmedRetirement(families, ["Fan", "Pump"], [receipt("Fan", true), receipt("Pump", false)]),
  ).toEqual([["cells", cell("Fan")]]);
});

test("a patch retires only when every targeted family converged, and never on zero successes", () => {
  const both = [receipt("Fan", true), receipt("Pump", true)];
  expect(confirmedRetirement(families, ["Fan", "Pump"], both)).toContainEqual(["patch"]);
  expect(
    confirmedRetirement(families, ["Fan", "Pump"], [receipt("Fan", true), receipt("Pump", true, false)]),
  ).not.toContainEqual(["patch"]);
  expect(confirmedRetirement(families, [], [receipt("Fan", false)])).toEqual([]);
});
