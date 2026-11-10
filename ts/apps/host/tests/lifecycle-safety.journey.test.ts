import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, test } from "vite-plus/test";
import { fixtureNative } from "./fixture-native.ts";
import { replay } from "./sdk-replay.ts";

async function lifecycle(changeSourceAfterCopy = false) {
  // These production lifecycle actions have no editable Work: their boundary is the admitted
  // acquisition and real file copy. Root's R6 ruling homes cleanup here, without a synthetic command.
  const dir = await mkdtemp(join(tmpdir(), "pe-unknown-acquisition-"));
  const native = await fixtureNative(join(dir, "native"));
  const source = join(dir, "never-opened.input");
  await writeFile(source, "Host copy input; no Revit opens this file.", "utf8");
  const calls: string[][] = [];
  const post = native.actions({ peaWork: join(dir, "acquisitions"), sdk: async args => {
    calls.push([...args]);
    if (changeSourceAfterCopy && args[0] === "session" && args[1] === "start") await writeFile(source, "Source changed after destination copy", "utf8");
    if (args[0] === "doc" && args[1] === "open") throw Error("Transport lost the SDK open outcome");
    // Existing retained SDK envelopes, unchanged. No SDK/Revit state is simulated.
    return replay(`${args[0]}-${args[1]}`);
  } });
  return { dir, native, source, calls, post,
    async open() {
      const response = await post({ id: "unknown-open", key: "instances.open", target: { kind: "host" }, input: { source, into: { start: { year: "2025", owner: "pea", addins: "on" } } } });
      expect(response.status, await response.clone().text()).toBeLessThan(400);
      return native.journal.wait("unknown-open");
    },
    async close() { await native.close(); await rm(dir, { recursive: true, force: true }); },
  };
}

test("R6 real acquisition cleanup cannot reconcile an unknown SDK open outcome", async () => {
  const f = await lifecycle();
  const { native, source, calls, post } = f;
  try {
    const original = await f.open();
    expect(original, JSON.stringify(original)).toMatchObject({ state: "unknown", steps: expect.arrayContaining([expect.objectContaining({ key: "instances.open", state: "unknown" })]) });
    const before = calls.length;
    const cleanup = await post({ id: "cleanup", key: "instances.cleanup", target: { kind: "host" }, input: { acquisition: original.id, unsaved: "discard" } });
    expect(cleanup.status, await cleanup.clone().text()).toBeLessThan(400);
    expect(await native.journal.wait("cleanup")).toMatchObject({ state: "failed", notDispatched: true, refusal: { code: expect.stringMatching(/^(acquisition\.unproven|reconciliation\.unresolved)$/) } });
    expect(await native.journal.wait(original.id)).toEqual(original);
    expect(calls.slice(before).every(args => args[1] === "list")).toBe(true);
    expect(await readFile(source, "utf8")).toBe("Host copy input; no Revit opens this file.");
  } finally { await f.close(); }
});

test("E6/E10 a copied destination never refreshes a changed source after durable preparation", async () => {
  const f = await lifecycle(true);
  try {
    const original = await f.open();
    expect(original, JSON.stringify(original)).toMatchObject({ state: "incomplete", prepared: { state: "ready" } });
    expect(original.steps.some(step => step.kind === "file" && step.state === "succeeded")).toBe(true);
    expect(f.calls.some(args => args[0] === "session" && args[1] === "start")).toBe(true);
    expect(f.calls.filter(args => args[0] === "doc" && args[1] === "open")).toEqual([]);
    const before = f.calls.length;
    const resumed = await f.post.request(new Request("http://host/actions/resume", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: original.id }),
    }));
    expect(resumed.status).toBe(409);
    expect(await resumed.json()).toMatchObject({ error: "Consumed input changed" });
    expect(await f.native.journal.wait(original.id)).toEqual(original);
    expect(f.calls.length).toBe(before);
    expect(await readFile(f.source, "utf8")).toBe("Source changed after destination copy");
  } finally { await f.close(); }
});
