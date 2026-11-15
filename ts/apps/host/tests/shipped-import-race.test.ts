import { afterEach, expect, test, vi } from "vite-plus/test";
import { mkdtemp, stateMachine } from "../../../tests/isolated-home/storage.ts";
import * as fs from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { bindPackageLifecycle, createPackageLifecycle, decisionsKind } from "../src/package-lifecycle.ts";
import { exportPod } from "../src/pod-transfer.ts";
import { importShippedPods, ledgerKind } from "../src/installed-pods.ts";
import { listPackages } from "../src/packages.ts";
import { readPackageWork, stopPackageDiscovery } from "../src/pod-capture.ts";
import { notices } from "@pe/host-contracts/kinds";

vi.mock("node:fs/promises", async original => ({ ...(await original<typeof fs>()) }));

afterEach(() => { bindPackageLifecycle(undefined); vi.restoreAllMocks(); vi.unstubAllEnvs(); stopPackageDiscovery(); });

test.each([0, 1, 2])("shipped archives activate despite destination capture expiry, run %i", async run => {
  const root = await mkdtemp(join(tmpdir(), "pe-shipped-race-"));
  const shipped = join(root, "shipped");
  const ids = ["document-profiler", "hydronic", "snowdon-circuits", "snowdon-ducts"];
  try {
    for (const pod of ids) await exportPod({ pod, archivePath: join(shipped, `${pod}.zip`) },
      { podsRoot: join(import.meta.dirname, "../../../../examples/pods") });
    const home = join(root, `home-${run}`), pods = join(home, "Pods");
    await fs.mkdir(pods, { recursive: true });
    vi.stubEnv("PE_TOOLS_PRODUCT_HOME", home);
    const machine = stateMachine(root);
    const lifecycle = createPackageLifecycle({ machine, packages: options => listPackages({ ...options, podsRoots: pods, wait: "background" }) });
    bindPackageLifecycle(lifecycle);
    const expired = Promise.withResolvers<void>();
    const open = fs.open;
    // Hold the redundant destination capture until its real per-Pod budget expires. Staging IO is real.
    const reads = vi.spyOn(fs, "open").mockImplementation(async (...args) => {
      if (String(args[0]) === join(pods, "snowdon-circuits", "pod.json")) {
        await expired.promise;
        throw Object.assign(Error("late capture"), { code: "EBUSY" });
      }
      return open(...args);
    });
    try {
      const report = await importShippedPods({ shippedRoot: shipped, podsRoot: pods, machine, ledger: ledgerKind.in(machine, `ledger-${run}.json`) });
      expect(report.outcomes, `run ${run}`).toEqual(ids.map(id => expect.objectContaining({ id, outcome: "imported" })));
      const enabled = JSON.parse(await fs.readFile(decisionsKind.in(machine).path, "utf8"));
      for (const id of ids) {
        expect(lifecycle.active(id), `run ${run} ${id}`).toBe(true);
        expect(enabled[`pod:${id}`]).toBe(true);
        expect(JSON.parse(await fs.readFile(join(pods, id, "pod.json"), "utf8")).id).toBe(id);
        expect(lifecycle.packages().find(p => p.id === id)?.directory).toBe(join(pods, id));
      }
    } finally { expired.resolve(); reads.mockRestore(); await lifecycle.close(); }
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test("a refused shipped import leaves one durable notice with the archive and recovery", async () => {
  const root = await mkdtemp(join(tmpdir(), "pe-shipped-refusal-"));
  const machine = stateMachine(root), shipped = join(root, "shipped");
  try {
    await exportPod({ pod: "snowdon-circuits", archivePath: join(shipped, "snowdon-circuits.zip") },
      { podsRoot: join(import.meta.dirname, "../../../../examples/pods") });
    const open = fs.open;
    vi.spyOn(fs, "open").mockImplementation(async (...args) => {
      if (String(args[0]).includes("pod-importing")) throw Object.assign(Error("capture unavailable"), { code: "EBUSY" });
      return open(...args);
    });
    const boot = () => importShippedPods({ shippedRoot: shipped, podsRoot: join(root, "Pods"), machine });
    const report = await boot();
    expect(report.outcomes).toMatchObject([{ outcome: "refused" }]);
    await boot();
    expect(notices(machine).filter(n => n.place === "Shipped example snowdon-circuits")).toMatchObject([
      { path: join(shipped, "snowdon-circuits.zip"), reason: expect.stringMatching(/import.*failed.*import.*capture unavailable/i) },
    ]);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test("all shipped Pods install when the event loop is starved during local staging", async () => {
  const root = await mkdtemp(join(tmpdir(), "pe-shipped-starvation-"));
  const shipped = join(root, "shipped"), home = join(root, "home"), pods = join(home, "Pods");
  const ids = ["document-profiler", "hydronic", "snowdon-circuits", "snowdon-ducts"];
  const machine = stateMachine(root);
  vi.stubEnv("PE_TOOLS_PRODUCT_HOME", home);
  const lifecycle = createPackageLifecycle({ machine, packages: options => listPackages({ ...options, podsRoots: pods, wait: "background" }) });
  bindPackageLifecycle(lifecycle);
  try {
    for (const pod of ids) await exportPod({ pod, archivePath: join(shipped, `${pod}.zip`) },
      { podsRoot: join(import.meta.dirname, "../../../../examples/pods") });
    let starved = false;
    const open = fs.open;
    vi.spyOn(fs, "open").mockImplementation(async (...args) => {
      if (!starved && String(args[0]).includes("pod-importing") && String(args[0]).endsWith(join("snowdon-circuits", "pod.json"))) {
        starved = true;
        const until = performance.now() + 2_100;
        while (performance.now() < until) { /* Synchronous provider work starves unrelated local IO. */ }
        await new Promise(resolve => setTimeout(resolve, 0)); // Let overdue timers run before IO resumes.
      }
      return open(...args);
    });
    const report = await importShippedPods({ shippedRoot: shipped, podsRoot: pods, machine });
    expect(starved).toBe(true);
    expect(report.outcomes).toEqual(ids.map(id => expect.objectContaining({ id, outcome: "imported" })));
    const enabled = JSON.parse(await fs.readFile(decisionsKind.in(machine).path, "utf8"));
    for (const id of ids) {
      expect(JSON.parse(await fs.readFile(join(pods, id, "pod.json"), "utf8")).id).toBe(id);
      expect(lifecycle.active(id)).toBe(true);
      expect(enabled[`pod:${id}`]).toBe(true);
    }
  } finally { await lifecycle.close(); await fs.rm(root, { recursive: true, force: true }); }
});

test("request Pod work still charges event-loop starvation to its unchanged deadline", async () => {
  await expect(readPackageWork("local request probe", undefined, async () => {
    const until = performance.now() + 2_100;
    while (performance.now() < until) { /* No slow IO: only event-loop starvation. */ }
    await new Promise(resolve => setTimeout(resolve, 0));
    return "ready";
  })).rejects.toThrow("Pod work exceeded 1666 ms");
});
