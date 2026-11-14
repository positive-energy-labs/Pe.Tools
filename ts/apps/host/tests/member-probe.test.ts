/**
 * D22: the journal's gate re-reads every consumed fact at every async boundary. A member read was one
 * discovery of every Pod in the home, so a 34-script Pod in a 35-Pod home cost 34 discoveries (about
 * 115 s) per gate and never reached Revit inside Pea's wait. These tests hold the rules that fix it:
 * one gate pass reads a Pod once, it reads only that Pod's folder once discovery has indexed it, and a
 * run consumes only the files it compiles.
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
import { bindPackageScanLogger, listPackages } from "../src/packages.ts";
import { scriptRunInputs } from "../src/operation-script.ts";
import { discoverPackages, stopPackageDiscovery } from "../src/pod-capture.ts";
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

// The race tests' release event: discovery was asked. The real call decides whether the asker joins the
// scan in flight or replaces it before it returns, so a listener told after it lands the older scan
// only once that is settled, at any machine speed.
const discoveryAsked = vi.hoisted(() => ({ listener: undefined as (() => void) | undefined }));
vi.mock("../src/pod-capture.ts", async (original) => {
  const real = await original<typeof import("../src/pod-capture.ts")>();
  return {
    ...real,
    discoverPackages: (...args: Parameters<typeof real.discoverPackages>) => {
      const answer = real.discoverPackages(...args);
      discoveryAsked.listener?.();
      return answer;
    },
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
  discoveryAsked.listener = undefined;
  stopPackageDiscovery();
  bindPackageScanLogger(() => {});
  await rm(root, { recursive: true, force: true });
});

/** A Pod of `count` scripts, and the member facts a script run of it consumes. */
async function pod(id: string, count: number): Promise<Member[]> {
  for (const folder of ["checks", "src"]) await mkdir(join(root, id, folder), { recursive: true });
  const files = [
    ["pod.json", JSON.stringify({ schemaVersion: 2, id, name: id, version: "0.1.0", entrypoints: [] })],
    ["src/Shared.cs", "static class Shared { }"],
    ...Array.from({ length: count }, (_, index) => [`checks/c${index}.csx`, `Result(${index});`]),
  ] as const;
  for (const [path, text] of files) await writeFile(join(root, id, path), text);
  return files.map(([path, text]) => ({ kind: "member", probe: { pod: id, path }, expected: sha(text) }));
}
/** A gate pass that starts now. */
const now = () => ({ startedAt: Date.now() });
const resources = () =>
  commandResources(detachedBridge(), { podsRoot: root } as never, async () => undefined);

type Probe = ReturnType<typeof resources>["probe"];

/**
 * An older discovery of this home, in flight from now. It lands with what the disk held when it began,
 * as a slow scan that started before an edit does, and only once discovery has been asked again after
 * `arm()`: by then the asker has joined it or replaced it.
 */
async function olderScan() {
  const before = await listPackages({ podsRoots: root });
  let arm = () => {};
  const askedAgain = new Promise<void>((resolve) => {
    arm = () => void (discoveryAsked.listener = resolve);
  });
  void discoverPackages(root, () => askedAgain.then(() => before), "background");
  return arm;
}
/** The Pod in `pdrop`'s folder takes another id, so the index no longer finds `pdrop` there; then a millisecond passes. */
async function renamePod() {
  await writeFile(join(root, "pdrop", "pod.json"), JSON.stringify({ schemaVersion: 2, id: "renamed", name: "renamed", version: "0.1.0", entrypoints: [] }));
  await new Promise((resolve) => setTimeout(resolve, 5));
}

/** The whole action through the real journal and the real probes; returns the discoveries it cost. */
async function discoveriesOf(
  id: string,
  consumes: Member[],
  prepare = async () => {},
  /** The test's seat at the journal's own probe calls: a production gate has no hook between its passes. */
  around = (probe: Probe): Probe => probe,
) {
  const journal = testJournal();
  const executor = gatewayExecutor("scripting.execute", detachedBridge(),
    () => Effect.succeed({ status: "Succeeded" }), pictureCaptures(root));
  const real = resources();
  journal.bindCommands({ ...real, probe: around(real.probe), resolve: () => ({
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
  // Discovery has indexed the Pod by now: the next run's gates read its folder and discover nothing.
  const again = await discoveriesOf("again", await pod("pdrop", 33));
  expect(again.action.state, JSON.stringify(again.action)).toBe("succeeded");
  expect(again.scans).toBe(0);
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

test("an indexed Pod's pass reads only its own folder, once; the next pass and a probe outside any pass read it again", async () => {
  const members = await pod("pdrop", 5);
  const c0 = members.find((member) => member.probe.path === "checks/c0.csx")!;
  await listPackages({ podsRoots: root });
  scans = 0;
  const probe = resources().probe;
  const pass = { startedAt: Date.now() };
  for (const member of members) expect(await probe(member, "admit", pass)).toBe(member.expected);
  // One reading per pass: the Pod was read at the pass's first probe, so a later edit is the next pass's.
  await writeFile(join(root, "pdrop", "checks/c0.csx"), "Result(99);");
  expect(await probe(c0, "admit", pass)).toBe(c0.expected);
  expect(await probe(c0, "turn", now())).toBe(sha("Result(99);"));
  await writeFile(join(root, "pdrop", "checks/c0.csx"), "Result(100);");
  expect(await probe(c0)).toBe(sha("Result(100);"));
  await writeFile(join(root, "pdrop", "checks/c0.csx"), "Result(101);");
  expect(await probe(c0)).toBe(sha("Result(101);"));
  expect(scans).toBe(0);
});

test("the index is a shortcut, never the answer: a Pod it does not hold, or holds wrongly, is asked of discovery", async () => {
  const [first] = await pod("early", 1);
  await listPackages({ podsRoots: root });
  const probe = resources().probe;
  // Arrived after the last discovery.
  const late = await pod("late", 1);
  scans = 0;
  expect(await probe(late[0]!, "admit", now())).toBe(late[0]!.expected);
  expect(scans).toBe(1);
  // Indexed, then its folder left the home.
  await rm(join(root, "early"), { recursive: true });
  expect(await probe(first!, "admit", now())).toBeNull();
});

// The instrument the three race tests stand on. If discovery ever awaits before it decides, the release
// event above no longer means "joined or replaced", and this goes red first.
test("discovery decides join-or-replace before the call returns", async () => {
  let reads = 0;
  const read = () => (reads++, new Promise<never>(() => {}));
  void discoverPackages(root, read, "background");
  void discoverPackages(root, read, "background");
  expect(reads).toBe(1); // joined: no second read
  void discoverPackages(root, read, "background", Date.now() + 60_000);
  expect(reads).toBe(2); // replaced: the scan in flight is older than the floor
});

// Mutant: drop `notBefore` from the fallback in `readMemberPod` and the pass answers the old bytes.
test("a pass that misses the index reads a discovery begun after it started, never an older one in flight", async () => {
  const [manifest] = await pod("pdrop", 2);
  const arm = await olderScan();
  await renamePod();
  arm();
  expect(await resources().probe(manifest!, "dispatch", now())).toBeNull();
});

// F-W25c-1. Mutant: `startedAt: 0` in `gate()` and the run succeeds on the bytes the older scan read.
test("the last gate before a step runs refuses an index miss while an older discovery is in flight", async () => {
  const members = await pod("pdrop", 2);
  const moments: (string | undefined)[] = [];
  let arm: (() => void) | undefined;
  const { action } = await discoveriesOf("raced", members, undefined, (probe) => async (dependency, moment, pass) => {
    if (moments.at(-1) !== moment) moments.push(moment);
    // The last gate's pass has started: the older scan lands once this pass has asked discovery.
    if (moment === "step" && arm) arm = void arm();
    const answer = await probe(dependency, moment, pass);
    // The gate before it has read every member: an older scan starts, then the edit misses the index.
    if (moment === "prepared" && dependency.kind === "member" && dependency.probe.path === members.at(-1)!.probe.path) {
      arm = await olderScan();
      await renamePod();
    }
    return answer;
  });
  // The fixture's host-leaf step has no bridge dispatch, so `step` is its last gate, straight after `prepared`.
  expect(moments.slice(-2)).toEqual(["prepared", "step"]);
  expect(action).toMatchObject({
    state: "failed",
    refusal: { kind: "stale", consumed: [{ probe: { pod: "pdrop", path: "pod.json" } }] },
  });
});

// Mutant: drop `notBefore` from the catalog probe and the pass answers the older scan's hashes.
test("the catalog probe reads a discovery begun after its pass started", async () => {
  await pod("pdrop", 1);
  const arm = await olderScan();
  await writeFile(join(root, "pdrop", "checks/c0.csx"), "Result(99);");
  await new Promise((resolve) => setTimeout(resolve, 5));
  arm();
  expect(await resources().probe({ kind: "catalog", probe: {}, expected: [] }, "step", now())).toEqual([{
    id: "pdrop",
    members: expect.arrayContaining([{ path: "checks/c0.csx", sha256: sha("Result(99);") }]),
  }]);
});

test("a run consumes its entrypoint and every .cs beside it, not another entrypoint's .csx", async () => {
  const run = async (id: string, edited: string) => {
    const admitted = (await pod("pdrop", 3)).map((member) => ({ path: member.probe.path, member }));
    // Native matches the entrypoint with either slash and without case.
    const consumes = scriptRunInputs(admitted, "checks\\C0.csx").map(({ member }) => member);
    return (await discoveriesOf(id, consumes, () => writeFile(join(root, "pdrop", edited), "// edited"))).action;
  };
  expect((await run("sibling", "checks/c1.csx")).state).toBe("succeeded");
  for (const [id, path] of [["helper", "src/Shared.cs"], ["entry", "checks/c0.csx"], ["manifest", "pod.json"]] as const)
    expect(await run(id, path), path).toMatchObject({
      state: "failed",
      refusal: { kind: "stale", consumed: [{ probe: { pod: "pdrop", path } }] },
    });
});

test("a member that left the Pod probes null; a discovery that ran out of time is not a changed input", async () => {
  const [, member] = await pod("pdrop", 1);
  const probe = resources().probe;
  expect(await probe({ ...member!, probe: { pod: "pdrop", path: "checks/gone.csx" } }, "admit", now())).toBeNull();
  expect(await probe({ ...member!, probe: { pod: "absent", path: "pod.json" } }, "admit", now())).toBeNull();
  // Discovery's 5 s wait ran out (pod-capture.ts): the Pod was not read, so nothing is known to have changed.
  await expect(
    probe({ ...member!, probe: { pod: "never-lands", path: "pod.json" } }, "dispatch", now()),
  ).rejects.toMatchObject({ statusCode: 503, message: expect.stringContaining("Pod discovery exceeded") });
});
