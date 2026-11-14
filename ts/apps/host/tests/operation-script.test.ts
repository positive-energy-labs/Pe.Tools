import { mkdtemp } from "../../../tests/isolated-home/storage.ts";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vite-plus/test";
import { freezeScript } from "../src/operation-script.ts";
import { fixtureNative } from "./fixture-native.ts";
import { Effect } from "effect";
import { gatewayExecutor } from "../src/gateway-actions.ts";
import type { CommandContext } from "../src/command-executor.ts";
import type { ActionExecution } from "../src/action-journal.ts";
import type { RevitBridge } from "../src/bridge.ts";
import type { PictureCaptures } from "../src/captures-route.ts";
import type { Caller } from "@pe/agent-contracts";

it("C3 refuses a Pod script before execution on any missing or mismatched probe, and permits a matching model", async () => {
  const entries = [{ elementId: 1, elementUniqueId: "one" }, { elementId: 2, elementUniqueId: "wrong" }];
  const calls: { key: string; input: unknown; session: unknown; openId: unknown }[] = [];
  const bridge = { invoke: (key: string, input: unknown, session?: string, openId?: string | null) => {
    calls.push({ key, input, session, openId });
    return Effect.succeed({ value: key === "revit.detail.elements" ? { documentTitle: "Other", entries } : { status: "Succeeded" } });
  } } as unknown as RevitBridge["Service"];
  const sourceBundle = { files: [{ path: "pod.json", bytesBase64: Buffer.from(JSON.stringify({ for: {
    title: "Chadds", probes: [{ elementId: 1, uniqueId: "one" }, { elementId: 2, uniqueId: "two" }],
  } })).toString("base64") }] };
  const executor = gatewayExecutor("scripting.execute", bridge, () => Effect.void, {} as PictureCaptures);
  const run = (bundle = sourceBundle) => {
    const execution = { prepared: { kind: "native-leaf", script: { sourceBundle: bundle } },
      step: (_kind, _key, _input, execute) => execute("run"),
    } as ActionExecution;
    const ctx = { caller: { kind: "human", via: "local" }, admission: { id: "run",
      target: { kind: "document", ref: { session: "s", openId: "d" } }, input: { sourcePath: "src/Run.cs" },
    } } as unknown as CommandContext;
    return Effect.runPromiseExit(executor.run(ctx, execution) as Effect.Effect<unknown, unknown>);
  };
  const mismatch = await run();
  expect(mismatch._tag).toBe("Failure");
  expect(JSON.stringify(mismatch)).toContain("this Pod is for Chadds; the bound document is Other");
  expect(calls).toEqual([{ key: "revit.detail.elements", input: { query: { kind: "ElementReferences", elementIds: [1, 2] } }, session: "s", openId: "d" }]);
  calls.length = 0;
  entries[1].elementUniqueId = "two";
  expect((await run())._tag).toBe("Success");
  expect(calls.map((call) => call.key)).toEqual(["revit.detail.elements", "scripting.execute"]);
  calls.length = 0;
  entries.pop();
  expect((await run())._tag).toBe("Failure");
  expect(calls.map((call) => call.key)).toEqual(["revit.detail.elements"]);
  calls.length = 0;
  expect((await run({ files: [] }))._tag).toBe("Success");
  expect(calls.map((call) => call.key)).toEqual(["scripting.execute"]);
});

it("stamps the trusted script caller over supplied caller bytes", async () => {
  const callers: Caller[] = [
    { kind: "human", via: "local" }, { kind: "anonymous" },
    { kind: "pea", thread: "t", context: "c" }, { kind: "page", page: "page:@p/p" },
    { kind: "external-mcp", device: "d", context: "c", label: "Device" },
    { kind: "service", service: "s" },
  ];
  const executor = gatewayExecutor("scripting.execute", {} as RevitBridge["Service"],
    (_key, input) => Effect.succeed(input), {} as PictureCaptures);
  for (const caller of callers) {
    for (const supplied of [undefined, "Person", "Agent"]) {
      let sent: unknown;
      const execution = {
        prepared: { kind: "host-leaf" },
        step: (_kind, _key, input, execute) => {
          sent = input;
          return execute("script-caller");
        },
      } as ActionExecution;
      const ctx = { caller, admission: { id: "script-caller", target: { kind: "host" },
        input: { scriptContent: "WriteLine(1);", ...(supplied ? { caller: supplied } : {}) },
      } } as unknown as CommandContext;
      await Effect.runPromise(executor.run(ctx, execution) as Effect.Effect<unknown, unknown>);
      expect(sent).toMatchObject({ caller: caller.kind === "human" ? "Person" : "Agent" });
    }
  }
});

// These Nov 2-6 payload recordings predate Touched. Keep their provenance intact and supply
// explicit scenario evidence, rather than claiming the retained status proves no model changes.
it.each([
  ["Succeeded", { kind: "none" }, "succeeded"],
  ["RuntimeFailed", { kind: "rolledBack" }, "failed"],
  ["CompilationFailed", { kind: "none" }, "failed"],
  ["RuntimeFailed", undefined, "incomplete"],
  ["CompilationFailed", undefined, "incomplete"],
] as const)(
  "HTTP script admission classifies retained %s with touched=%j as %s", async (status, touched, state) => {
    const dir = await mkdtemp(join(tmpdir(), "pe-script-recorded-"));
    const native = await fixtureNative(dir, `retained-script-${status}`, "retained-host-ops-catalog"); const socket = await native.connect();
    if (touched) native.reportTouched("scripting.execute", touched);
    try {
      const response = await native.actions()({ id: "script", key: "scripting.execute", target: { kind: "document", ref: socket.target }, input: { scriptContent: "WriteLine(1);" } });
      expect(response.status, await response.clone().text()).toBeLessThan(400);
      const result = await native.journal.wait("script");
      expect(result.state).toBe(state);
      expect(result.steps.at(-1)).toMatchObject({ transport: "bridge", bridgeReply: touched ? "touched" : "missing-touched" });
      if (touched) expect(result.steps.at(-1)).toHaveProperty("touched", touched);
      else expect(result.steps.at(-1)).not.toHaveProperty("touched");
      expect(native.calls.filter(call => call.key === "scripting.execute")).toMatchObject([{ key: "scripting.execute", input: { scriptContent: "WriteLine(1);" } }]);
      expect(native.calls.every(call => call.action === "scripting.execute")).toBe(true);
      if (state !== "succeeded") expect(result.steps.at(-1)).toMatchObject({ state: "failed", evidence: { result: { status } } });
    } finally { await native.close(); await rm(dir, { recursive: true, force: true }); }
  },
);
// UNPROVEN[no recording]: Cancelled and unrecognized script statuses. Former replies were hand-written.

it("freezes a supplied snapshot without reading disk and rejects ambiguous or authority bytes", async () => {
  const files = [{ path: "src/Run.cs", bytesBase64: Buffer.from("original").toString("base64") }];
  const frozen = await freezeScript({ sourcePath: "src/Run.cs", sourceBundle: { files } });
  files[0]!.bytesBase64 = "";
  expect(Buffer.from(frozen!.sourceBundle.files[0]!.bytesBase64, "base64").toString()).toBe(
    "original",
  );
  for (const paths of [
    ["src/A.cs", "src/a.cs"],
    ["src/A.cs", "Src/B.cs"],
    ["src", "src/A.cs"],
    ["pages/tour/.state/binding.json"],
    ["src/../A.cs"],
  ]) {
    await expect(
      freezeScript({
        sourcePath: "src/A.cs",
        sourceBundle: { files: paths.map((path) => ({ path, bytesBase64: "" })) },
      }),
    ).rejects.toThrow();
  }
});
