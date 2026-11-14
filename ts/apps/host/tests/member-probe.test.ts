/**
 * D22: a script run consumes every `.cs`/`.csx` member of its Pod (contract C1), and the journal's
 * gate re-reads every consumed fact at every async boundary. A member read is one discovery of every
 * Pod in the home, so a 34-script Pod in a 35-Pod home cost 34 discoveries (about 115 s) per gate
 * and never reached Revit inside Pea's wait. These tests hold the rule that fixes it: one gate pass
 * reads a Pod once, however many of its members the action consumed.
 */
import { mkdtemp } from "../../../tests/isolated-home/storage.ts";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { z } from "zod";
import type { Consumed } from "@pe/agent-contracts";
import { commandResources } from "../src/command-reads.ts";
import { gatewayExecutor } from "../src/gateway-actions.ts";
import { bindPackageScanLogger } from "../src/packages.ts";
import { approvedPea } from "./callers.ts";
import { detachedBridge, pictureCaptures, testJournal } from "./effect-test.ts";

// One Pod id whose discovery never lands inside the reader's wait; every other read is the real one.
vi.mock("../src/packages.ts", async (original) => {
  const real = await original<typeof import("../src/packages.ts")>();
  const { PackageDiscoveryExceeded } = await import("../src/pod-capture.ts");
  return {
    ...real,
    readPackage: (id: string, options: Parameters<typeof real.readPackage>[1]) =>
      id === "never-lands"
        ? Promise.reject(new PackageDiscoveryExceeded(options?.podsRoots ?? []))
        : real.readPackage(id, options),
  };
});

type Member = Extract<Consumed, { kind: "member" }>;
const sha = (text: string) => createHash("sha256").update(text).digest("hex");

let root: string;
let scans = 0;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "pe-member-probe-"));
  scans = 0;
  bindPackageScanLogger((message) => {
    if (message.startsWith("Pod folder scan start")) scans++;
  });
});
afterEach(async () => {
  bindPackageScanLogger(() => {});
  await rm(root, { recursive: true, force: true });
});

/** A Pod of `count` scripts, and the member facts a script run of it consumes. */
async function pod(id: string, count: number): Promise<Member[]> {
  await mkdir(join(root, id, "checks"), { recursive: true });
  const files = [
    ["pod.json", JSON.stringify({ schemaVersion: 2, id, name: id, version: "0.1.0", entrypoints: [] })],
    ...Array.from({ length: count }, (_, index) => [`checks/c${index}.csx`, `Result(${index});`]),
  ] as const;
  for (const [path, text] of files) await writeFile(join(root, id, path), text);
  return files.map(([path, text]) => ({ kind: "member", probe: { pod: id, path }, expected: sha(text) }));
}
const resources = () =>
  commandResources(detachedBridge(), { podsRoot: root } as never, async () => undefined);

/** The whole action through the real journal and the real probes; returns the discoveries it cost. */
async function discoveriesOf(id: string, consumes: Member[], prepare = async () => {}) {
  const journal = testJournal();
  const executor = gatewayExecutor("scripting.execute", detachedBridge(),
    () => Effect.succeed({ status: "Succeeded" }), pictureCaptures(root));
  journal.bindCommands({ ...resources(), resolve: () => ({
    ...executor,
    definition: async () => ({ says: "Run script", needs: "nothing", effect: "command", dirties: [], input: z.record(z.string(), z.unknown()) }),
    bind: async () => ({ effects: [], consumes, prepare: async () => (await prepare(), { kind: "host-leaf" }) }),
  }) });
  scans = 0;
  await journal.invoke(
    { id, key: "scripting.execute", target: { kind: "host" }, input: { scriptContent: "Result(1);" } },
    { caller: approvedPea(id), basis: null },
  );
  return { action: await journal.wait(id), scans };
}

test("a script run's gates cost the same Pod discoveries whether it consumed two members or thirty-four", async () => {
  const two = await discoveriesOf("two", await pod("small", 1));
  const many = await discoveriesOf("many", await pod("pdrop", 33));
  expect(two.action.state, JSON.stringify(two.action)).toBe("succeeded");
  expect(many.action.state, JSON.stringify(many.action)).toBe("succeeded");
  expect(two.scans).toBeGreaterThan(0);
  expect(many.scans).toBe(two.scans);
});

test("a member edited between two gates still refuses the run as stale: no read outlives its pass", async () => {
  const members = await pod("pdrop", 3);
  const { action } = await discoveriesOf("edited", members, () =>
    writeFile(join(root, "pdrop", "checks/c2.csx"), "Result(99);"),
  );
  expect(action).toMatchObject({
    state: "failed",
    refusal: { kind: "stale", consumed: [{ probe: { pod: "pdrop", path: "checks/c2.csx" } }] },
  });
});

test("one gate pass reads a Pod once; new passes and unscoped probes validate disk changes", async () => {
  const members = await pod("pdrop", 5);
  const probe = resources().probe;
  const pass = {};
  for (const member of members) expect(await probe(member, "admit", pass)).toBe(member.expected);
  expect(scans).toBe(1);
  // Freshness is per pass: an edit between two gates is seen by the second.
  await writeFile(join(root, "pdrop", "checks/c0.csx"), "Result(99);");
  expect(await probe(members[1]!, "turn", {})).toBe(sha("Result(99);"));
  expect(scans).toBe(2);
  await probe(members[1]!);
  expect(scans).toBe(2); // An unchanged probe checks metadata, not the Pod's bytes again.
  await writeFile(join(root, "pdrop", "checks/c1.csx"), "Result(100);");
  expect(await probe(members[2]!)).toBe(sha("Result(100);"));
  expect(scans).toBe(3);
});

test("a member that left the Pod probes null; a discovery that ran out of time is not a changed input", async () => {
  const [, member] = await pod("pdrop", 1);
  const probe = resources().probe;
  expect(await probe({ ...member!, probe: { pod: "pdrop", path: "checks/gone.csx" } }, "admit", {})).toBeNull();
  expect(await probe({ ...member!, probe: { pod: "absent", path: "pod.json" } }, "admit", {})).toBeNull();
  // Discovery's 5 s wait ran out (pod-capture.ts): the Pod was not read, so nothing is known to have changed.
  await expect(
    probe({ ...member!, probe: { pod: "never-lands", path: "pod.json" } }, "dispatch", {}),
  ).rejects.toMatchObject({ statusCode: 503, message: expect.stringContaining("Pod discovery exceeded") });
});
