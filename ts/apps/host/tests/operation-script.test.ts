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

it.each([["Succeeded", "succeeded"], ["RuntimeFailed", "failed"], ["CompilationFailed", "failed"]] as const)(
  "real HTTP script admission classifies retained %s as %s", async (status, state) => {
    const dir = await mkdtemp(join(tmpdir(), "pe-script-recorded-"));
    const native = await fixtureNative(dir, `retained-script-${status}`, "retained-host-ops-catalog"); const socket = await native.connect();
    try {
      const response = await native.actions()({ id: "script", key: "scripting.execute", target: { kind: "document", ref: socket.target }, input: { scriptContent: "WriteLine(1);" } });
      expect(response.status, await response.clone().text()).toBeLessThan(400);
      const result = await native.journal.wait("script");
      expect(result, JSON.stringify(result)).toMatchObject({ state });
      expect(native.calls.filter(call => call.key === "scripting.execute")).toMatchObject([{ key: "scripting.execute", input: { scriptContent: "WriteLine(1);" } }]);
      expect(native.calls.every(call => call.action === "scripting.execute")).toBe(true);
      if (state === "failed") expect(result.steps.at(-1)).toMatchObject({ state: "failed", evidence: { result: { status } } });
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
