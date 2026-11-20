import { Effect } from "effect";
import { expect, test, vi } from "vite-plus/test";

// The SDK reading is a `pe-revit session list --all` spawn; count how often a script's gates ask for it.
const reads = vi.hoisted(() => ({ count: 0 }));
vi.mock("../src/native-receipts.ts", async (original) => ({
  ...(await original<typeof import("../src/native-receipts.ts")>()),
  readOriginalProcess: async (pid: number, startMs: number) => {
    reads.count++;
    return { pid, processStartUtc: new Date(startMs).toISOString(), executable: "Revit.exe" };
  },
}));
const { commandResources } = await import("../src/command-reads.ts");

const start = Date.parse("2026-11-10T08:00:00.000Z");
const process = {
  pid: 10,
  processStartUtc: new Date(start).toISOString(),
  executable: "Revit.exe",
};
const attachment = (pid: number) => ({
  sessionId: "session-1",
  sdkSessionId: "pe.app-25",
  connected: true,
  processId: pid,
  processStartUtcUnixMs: start,
  state: { openDocuments: [{ openId: "open-1" }] },
});
const resources = (pid = 10) =>
  commandResources(
    { list: Effect.succeed([attachment(pid)]) } as never,
    {} as never,
    async () => undefined,
  );
const dependency = {
  kind: "incarnation",
  probe: { target: { kind: "document", ref: { session: "session-1", openId: "open-1" } }, process },
  expected: true,
} as never;
const moments = ["admit", "authorize", "consented", "turn", "prepared", "step", "dispatch"];

test("the SDK proves the incarnation at the first gate and the last before dispatch, not at every gate", async () => {
  reads.count = 0;
  for (const moment of moments) await resources().probe(dependency, moment);
  expect(reads.count).toBe(2);
});

test("a probe that names no moment asks the SDK", async () => {
  reads.count = 0;
  await resources().probe(dependency);
  expect(reads.count).toBe(1);
});

test("between the SDK proofs a bridge attachment with another pid still refuses", async () => {
  await expect(resources(99).probe(dependency, "turn")).rejects.toThrow(
    "Original process incarnation or document lifetime is no longer available",
  );
});
