import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vite-plus/test";
import { freezeScript } from "../src/operation-script.ts";
import { fixtureNative } from "./fixture-native.ts";

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
