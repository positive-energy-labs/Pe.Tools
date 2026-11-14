import { expect, test } from "vite-plus/test";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { mkdtemp, stateFixture, stateMachine } from "../../../tests/isolated-home/storage.ts";
import { tmpdir } from "node:os";
import { PictureCaptures } from "../src/captures-route.ts";
import { exportPod, installArchive } from "../src/pod-transfer.ts";
import { importShippedPods, ledgerKind } from "../src/installed-pods.ts";
import { listPackages } from "../src/packages.ts";
import { createContributionContent } from "../src/pe-routes.ts";

// The package half of JP5 survives retirement of Home's Pod-route trust UI.
test.each([false, true])("Page Pod bootstrap preserves authored changes: %s", async modified => {
  const directory = await mkdtemp(resolve(tmpdir(), "pe-page-pod-bootstrap-"));
  const podsRoot = resolve(directory, "Pods"), shippedRoot = resolve(directory, "shipped");
  const examples = resolve(import.meta.dirname, "../../../../examples/pods");
  const source = resolve(directory, "old/snowdon-circuits");
  const machine = stateMachine(directory);
  const captures = new PictureCaptures(stateFixture(resolve(directory, "pictures")), 64 * 1024 * 1024, Date.now);
  let content: ReturnType<typeof createContributionContent> | undefined;
  try {
    await cp(resolve(examples, "snowdon-circuits"), source, { recursive: true, filter: path => !path.split(/[\\/]/).includes("node_modules") });
    await writeFile(resolve(source, "README.md"), "An earlier shipped Page Pod.");
    const old = await exportPod({ pod: "snowdon-circuits", archivePath: resolve(directory, "old.zip") }, { podsRoot: resolve(directory, "old"), captures });
    await installArchive(await readFile(old.archivePath), old.archivePath, undefined, { podsRoot, machine, captures });
    await mkdir(resolve(machine.state, "shipped-pod-originals"), { recursive: true });
    await cp(old.archivePath, resolve(machine.state, "shipped-pod-originals", `${old.archiveSha256}.zip`));
    await exportPod({ pod: "snowdon-circuits", archivePath: resolve(shippedRoot, "snowdon-circuits.zip") }, { podsRoot: examples, captures });
    if (modified) await writeFile(resolve(podsRoot, "snowdon-circuits/README.md"), "Keep this authored worksheet note.");
    const before = (await listPackages({ podsRoots: podsRoot })).packages[0]!.members.map(m => [m.path, m.sha256]);
    const completed = Promise.withResolvers<Awaited<ReturnType<typeof importShippedPods>>>();
    content = createContributionContent({ worldRoot: stateFixture(directory), homeRoot: directory, packages: () => listPackages({ podsRoots: podsRoot }), decisionsMachine: machine,
      bootstrap: async () => { try { const report = await importShippedPods({ shippedRoot, podsRoot, captures, ledger: ledgerKind.in(machine) }); completed.resolve(report); } catch (error) { completed.reject(error); throw error; } } });
    const report = await completed.promise;
    await content.lifecycle.ready;
    const kept = (await listPackages({ podsRoots: podsRoot })).packages[0]!;
    if (modified) {
      expect(kept.members.map(m => [m.path, m.sha256])).toEqual(before);
      expect(kept.diagnostics.find(d => d.code === "ShippedExampleUpdateKept")).toMatchObject({ message: expect.stringContaining("authored members differ") });
    } else {
      expect(report.outcomes[0]?.outcome).toBe("updated");
      expect(await readFile(resolve(podsRoot, "snowdon-circuits/README.md"), "utf8")).toBe(await readFile(resolve(examples, "snowdon-circuits/README.md"), "utf8"));
    }
  } finally {
    await content?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
