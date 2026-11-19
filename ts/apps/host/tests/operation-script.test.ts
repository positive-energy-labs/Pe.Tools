import { mkdtemp } from "../../../tests/isolated-home/storage.ts";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, onTestFinished, vi } from "vite-plus/test";
import { freezeScript, requireScriptSuccess, runPodScript } from "../src/operation-script.ts";
import { fixtureNative } from "./fixture-native.ts";
import { Cause, Effect } from "effect";
import { z } from "zod";
import { NodeServices } from "@effect/platform-node";
import { FetchHttpClient } from "effect/http";
import { detachedBridge, pictureCaptures, testJournal } from "./effect-test.ts";
import { approvedPea } from "./callers.ts";
import { productPodsRoots, isPackageMember } from "../src/packages.ts";
import { contentRootsReady } from "../src/content-roots.ts";
import { podsDiskSignature } from "../src/pod-disk-signature.ts";
import { discoverPackages, stopPackageDiscovery } from "../src/pod-capture.ts";
import { RequestIdentity, admittedRequestIdentity } from "@pe/host-internal/request-identity";
import { gatewayExecutor } from "../src/gateway-actions.ts";
import type { CommandContext } from "@pe/host-internal/command-executor";
import type { ActionExecution } from "@pe/host-internal/action-execution";
import type { RevitBridge } from "@pe/host-internal/bridge";
import type { PictureCaptures } from "../src/captures-route.ts";
import type { Caller } from "@pe/agent-contracts";
import { invocationOutcome } from "@pe/agent-contracts";

it("D38 journals a ReadOnly wrong-model refusal before script dispatch", async () => {
  const root = await mkdtemp(join(tmpdir(), "pe-refused-model-"));
  const journal = testJournal();
  onTestFinished(async () => { await journal.close(); await rm(root, { recursive: true, force: true }); });
  const calls: string[] = [];
  const bridge = detachedBridge({ invoke: (key) => Effect.sync(() => {
    calls.push(key);
    if (key !== "revit.detail.elements") throw Error("Script must never dispatch");
    return { value: { documentTitle: "Brodie", entries: [] }, target: { session: "s", document: null } };
  }) });
  const executor = gatewayExecutor("scripting.execute", bridge, () => Effect.void, pictureCaptures(root));
  journal.bindCommands({ probe: async () => null, resolve: () => ({
    ...executor,
    definition: { says: "Read Pod", needs: "document", effect: "command", dirties: [], input: z.record(z.string(), z.unknown()) },
    prepared: z.unknown(),
    bind: async () => ({ effects: [], prepare: async () => ({ kind: "native-leaf" }) }),
  }) });
  const sourceBundle = { files: [{ path: "pod.json", bytesBase64: Buffer.from(JSON.stringify({ for: {
    title: "Chadds", probes: [{ elementId: 42, uniqueId: "chadds-42" }],
  } })).toString("base64") }] };
  await journal.invoke({ id: "wrong-model", key: "scripting.execute", target: { kind: "document", ref: { session: "s", openId: "d" } },
    input: { scriptContent: "Result(1);", permissionMode: "ReadOnly", sourceBundle },
  }, { caller: approvedPea("wrong-model"), basis: null });
  const receipt = await journal.wait("wrong-model");
  expect(receipt).toMatchObject({
    state: "failed", status: 409, notDispatched: true,
    refusal: { kind: "domain", code: "wrong-model", message: "this Pod is for Chadds; the bound document is Brodie" },
    steps: [{ key: "scripting.execute", state: "failed", notDispatched: true }],
  });
  expect(invocationOutcome(receipt)).toMatchObject({ state: "refused", reason: "this Pod is for Chadds; the bound document is Brodie" });
  expect(calls).toEqual(["revit.detail.elements"]);
});

it("refuses a script with no exact lifetime before native dispatch", async () => {
  const invoke = () : never => { throw Error("dispatched without a lifetime"); };
  const result = await Effect.runPromiseExit(runPodScript(detachedBridge({ invoke }), { session: "s" }, { scriptContent: "Result(doc.Title);" }, "target-proof"));
  expect(result._tag).toBe("Failure");
  expect(JSON.stringify(result)).toContain("one exact open document target");
});

it("C3 refuses a Pod script before execution on any missing or mismatched probe, and permits a matching model", async () => {
  const root = await mkdtemp(join(tmpdir(), "pe-pod-model-"));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  const entries = [{ elementId: 1, elementUniqueId: "one" }, { elementId: 2, elementUniqueId: "wrong" }];
  const calls: { key: string; input: unknown; session: unknown; openId: unknown }[] = [];
  const bridge = detachedBridge({ invoke: (key, input, session, openId) => {
    calls.push({ key, input, session, openId });
    return Effect.succeed({ value: key === "revit.detail.elements" ? { documentTitle: "Other", entries } : { status: "Succeeded" }, target: { session: session ?? "s", document: null } });
  } });
  const sourceBundle = { files: [{ path: "pod.json", bytesBase64: Buffer.from(JSON.stringify({ for: {
    title: "Chadds", probes: [{ elementId: 1, uniqueId: "one" }, { elementId: 2, uniqueId: "two" }],
  } })).toString("base64") }] };
  const executor = gatewayExecutor("scripting.execute", bridge, () => Effect.void, pictureCaptures(root));
  const unused = (): never => { throw Error("unexpected access outside the Pod script fixture"); };
  const run = (bundle = sourceBundle) => {
    const execution: ActionExecution = { prepared: { kind: "native-leaf", script: { sourceBundle: bundle } },
      step: (_kind, _key, _input, execute) => execute("run"),
      effect: unused, publishWork: unused, retireWork: unused, recorded: unused,
    };
    const ctx: CommandContext = { caller: { kind: "human", via: "local" }, admission: { id: "run", key: "scripting.execute",
      target: { kind: "document", ref: { session: "s", openId: "d" } }, input: { sourcePath: "src/Run.cs" },
    }, basis: null, consumed: [], get work() { return unused(); }, selectWork: unused,
      read: { receipts: () => [] }, clock: { now: unused }, ids: { mint: unused },
    };
    return Effect.runPromiseExit(executor.run(ctx, execution).pipe(
      Effect.provide(NodeServices.layer), Effect.provide(FetchHttpClient.layer),
      Effect.provideService(RequestIdentity, admittedRequestIdentity(ctx.caller, {})),
    ));
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

// D22b. Mutant: drop the PackageDiscoveryExceeded branch in freezeScript and both doors answer 409.
it("answers the typed 503 at both script doors when Pod discovery outlasts its wait", async () => {
  const home = await mkdtemp(join(tmpdir(), "pe-script-pending-"));
  vi.stubEnv("PE_TOOLS_PRODUCT_HOME", home);
  await contentRootsReady();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  onTestFinished(async () => {
    stopPackageDiscovery();
    vi.useRealTimers();
    vi.unstubAllEnvs();
    await rm(home, { recursive: true, force: true });
  });
  // The real single-flight discovery with a scan in flight that never lands: every reader joins it.
  const roots = productPodsRoots();
  const entered = Promise.withResolvers<void>();
  void discoverPackages(roots, () => { entered.resolve(); return new Promise(() => {}); }, "background",
    signal => podsDiskSignature(roots, isPackageMember, signal));
  await entered.promise;
  const input = { sourcePath: "checks/engine.csx", workspaceKey: "pdrop" };
  const pending = { status: 503, refusal: { kind: "domain", code: "pod.discovery.exceeded" } };

  // Real I/O runs between the fake seconds, so each reader reaches its wait before the clock passes it.
  const outlast = async <T>(work: Promise<T>) => {
    let done = false;
    void work.then(() => (done = true), () => (done = true));
    for (let second = 0; second < 60 && !done; second++) {
      await new Promise((resolve) => setImmediate(resolve));
      await vi.advanceTimersByTimeAsync(1_000);
    }
    return work;
  };

  const exit = await outlast(Effect.runPromiseExit(runPodScript(detachedBridge(), { session: "s", openId: "o" }, input, "pending")));
  expect(exit._tag === "Failure" && Cause.squash(exit.cause)).toMatchObject(pending);

  const journal = testJournal();
  const executor = gatewayExecutor("scripting.execute", detachedBridge(), () => Effect.succeed(null), pictureCaptures(home));
  journal.bindCommands({ probe: async () => null, resolve: () => ({
    ...executor,
    definition: async () => ({ says: "Run script", needs: "nothing", effect: "command", dirties: [], input: z.record(z.string(), z.unknown()) }),
    bind: async () => (await freezeScript(input), { effects: [], prepare: async () => ({ kind: "host-leaf" }) }),
  }) });
  const admitted = outlast(journal.invoke(
    { id: "pending", key: "scripting.execute", target: { kind: "host" }, input },
    { caller: approvedPea("pending"), basis: null },
  ));
  expect(await admitted).toMatchObject({
    state: "failed",
    notDispatched: true,
    ...pending,
    error: expect.stringContaining("Pod discovery exceeded 5000 ms"),
  });
});

it("a failed script's error names the first Error diagnostic's first line, never its stack", () => {
  const failed = (value: unknown) => {
    try { requireScriptSuccess(value); } catch (error) { return (error as Error).message; }
    return "did not throw";
  };
  expect(failed({ status: "RuntimeFailed", diagnostics: [
    { stage: "normalize", severity: "Info", message: "Inline snippet mode" },
    { stage: "runtime", severity: "Error", message: "System.NullReferenceException: Object reference not set to an instance of an object.\r\n   at Script.Execute() in C:\Users\someone\Script.cs:line 4" },
    { stage: "fence", severity: "Error", message: "second" },
  ] })).toBe("Script execution RuntimeFailed: System.NullReferenceException: Object reference not set to an instance of an object.");
  expect(failed({ status: "Cancelled", diagnostics: [] })).toBe("Script execution Cancelled");
  expect(failed({ status: "RuntimeFailed" })).toBe("Script execution RuntimeFailed");
  expect(failed({ status: "Succeeded", diagnostics: [{ severity: "Error", message: "x" }] })).toBe("did not throw");
});
