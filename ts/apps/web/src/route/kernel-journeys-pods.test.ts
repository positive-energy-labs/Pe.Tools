import { cp, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { expect, test, vi } from "vite-plus/test";
import { observeResources } from "@pe/runtime";
import { bindWork, routeFingerprint, workKey } from "@pe/agent-contracts";
import { fixture } from "../../../host/tests/host-read-graph.test-support";
import { createPackageLifecycle } from "../../../host/src/package-lifecycle";
import { listPackages } from "../../../host/src/packages";
import { createPodRoutes } from "../../../host/src/pod-routes";
import { fileRouteDocumentStore } from "../../../host/src/route-document-store";
import { registeredReads } from "../../../host/src/reads/routes";
import { loadPodRoute } from "./pod-module";
import { createPodRouteLoader } from "./pod-loader";
import { registerTypedRoute } from "../shell/route-registration";
import { publicRoutes } from "./route-discovery";
import { mountTypedRoute } from "../shell/typed-mount";
import { createWorkFeedClient } from "../shell/work-feed-client";
import type { UseSource } from "../shell/source-contract";

const evaluate = (bytes: Uint8Array) =>
  import(/* @vite-ignore */ `data:text/javascript;base64,${Buffer.from(bytes).toString("base64")}`);

// The published example supplies executable bytes. Only the native boundary is recorded.
async function podJourney() {
  const host = await fixture(true);
  await host.send(0, []); // Initialize the same HTTP/Work owner used by the Fans journeys.
  const root = resolve(host.dir, "Pods");
  const pod = resolve(root, "snowdon-circuits");
  await cp(resolve(process.cwd(), "../../../examples/pods/snowdon-circuits"), pod, {
    recursive: true,
    filter: (source) => !source.split(/[\\/]/).includes("node_modules"),
  });
  const lifecycle = createPackageLifecycle({
    packages: () => listPackages(root), decisionsPath: resolve(host.dir, "enabled.json"),
  });
  const routes = createPodRoutes(lifecycle, {
    workspace: host.workspace, trustPath: resolve(host.dir, "trust.json"),
  });
  const [row] = await routes.list();
  if (!row) throw Error("Published Snowdon is absent");
  // Recorded authored Work, as in pod-admission.test.tsx. Starting Work is not this story.
  const key = bindWork(row.workRoute, null);
  await fileRouteDocumentStore(resolve(host.dir, "work")).setState({
    targetKey: workKey(key), route: key.route,
    value: { version: 1, schemaVersion: 2, revision: 7,
      doc: { version: 2, inputs: { size: "10", length: 175, amps: 20, voltage: 208, phase: "3" } }, history: [] },
  });
  const name = `${row.workRoute}.calculation`;
  const pending = new Set<Promise<unknown>>();
  const mounts: ReturnType<typeof mountTypedRoute>[] = [];
  const listeners = new Set<() => void>();
  let generation = 0;
  const source: UseSource = {
    kind: "use",
    open(ctx, deliver) {
      let closed = false;
      const refresh = () => {
        const task = host.probe({ read: name, args: ctx.args,
          subscription: `jp-${++generation}`, generation,
        }).then(async (response) => {
          const packet = await response.json();
          if (!closed && !ctx.signal.aborted)
            deliver({ kind: "complete", value: packet, revision: generation });
        });
        pending.add(task);
        void task.finally(() => pending.delete(task));
      };
      listeners.add(refresh);
      refresh();
      return () => { closed = true; listeners.delete(refresh); };
    },
  };
  const stopWork = host.workspace.subscribe(() => listeners.forEach((notify) => notify()));
  const work = createWorkFeedClient({
    subscribe: observeResources(host.workspace, { observe: () => () => {} }), dirty() {},
  }, {
    write: (key, write) => host.workspace.write(key, key.route, "human", write),
    submit: () => { throw Error("This Pod has no native action"); },
  });
  const loader = createPodRouteLoader(async (entry) => {
    const loaded = await loadPodRoute(entry, await routes.bundle(entry.key, entry.fingerprint), evaluate);
    return registerTypedRoute(loaded.module, loaded.fingerprint);
  });
  return {
    host, pod, lifecycle, routes, row, name, loader,
    async mount() {
      const current = (await routes.list())[0]!;
      const loaded = await loadPodRoute(current, await routes.bundle(current.key, current.fingerprint), evaluate);
      const mount = mountTypedRoute(loaded.module, {
        target: { kind: "host" }, fixture: null,
        work: { address: null, open: null },
        address: { read: () => new URLSearchParams(), write() {}, subscribe: () => () => {} },
        memory: () => ({}), custody: { current: () => true },
      }, loaded.fingerprint, { work, sources: { [name]: source } });
      mounts.push(mount);
      mount.subscribe(() => {});
      await vi.waitFor(() => expect(mount.value()).toMatchObject({ current: true }), { timeout: 20_000 });
      return mount;
    },
    async close() {
      mounts.forEach((mount) => mount.dispose());
      loader.dispose(); stopWork();
      await Promise.allSettled([...pending]);
      routes.close(); await lifecycle.close(); await host.close();
    },
  };
}

test("JP1 discover, trust and use Snowdon, withdraw it, then reopen the trusted worksheet", async () => {
  const j = await podJourney();
  try {
    expect(j.row.trusted, "H16: discovery is not consent to execute").toBe(false);
    await expect(j.routes.bundle(j.row.key, j.row.fingerprint), "H16: untrusted bytes are unavailable").rejects.toThrow("trust");
    await j.loader.sync(await j.routes.list());
    expect(publicRoutes.typed(j.row.workRoute), "H16: discovery does not register browser code").toBeNull();
    expect((await j.host.probe({ read: j.name, args: {}, subscription: "untrusted", generation: 0 })).ok,
      "H16: untrusted Pod has no executable HTTP read").toBe(false);
    await j.routes.trust(j.row.key, j.row.fingerprint, true);
    await j.loader.sync(await j.routes.list());
    const mount = await j.mount();
    expect(publicRoutes.typed(j.row.workRoute), "H16: verified bytes enter discovery").not.toBeNull();
    expect(String(mount.draw("calculation")), "H16: verified host calculation reaches the typed pane over HTTP").toContain("Copper voltage-drop worksheet");
    const inputs = { size: "10", length: 300, amps: 20, voltage: 208, phase: "3" };
    expect(await mount.draw("calculation", (ctx) => ctx.cells.edit(inputs, { label: "Size the feeder" })),
      "H16: admitted Pod edits its own Work").toBeNull();
    await vi.waitFor(() => expect(String(mount.draw("calculation"))).toContain('"length": 300'));
    await j.lifecycle.setEnabled("pod:snowdon-circuits", false);
    await j.loader.sync(await j.routes.list());
    expect(publicRoutes.typed(j.row.workRoute), "H16: withdrawal retires browser registration").toBeNull();
    expect(registeredReads.reads.has(j.name), "H16: withdrawal retires host registration").toBe(false);
    expect((await j.host.probe({ read: j.name, args: {}, subscription: "withdrawn", generation: 0 })).ok,
      "H16: withdrawn host code cannot execute through HTTP").toBe(false);
    await j.lifecycle.setEnabled("pod:snowdon-circuits", true);
    await j.loader.sync(await j.routes.list());
    const reopened = await j.mount();
    expect(String(reopened.draw("calculation")), "H16: unchanged trusted publication reopens durable Work").toContain('"length": 300');
    expect((await j.host.workspace.read(bindWork(j.row.workRoute, null), j.row.workRoute))?.doc).toMatchObject({ inputs });
  } finally { await j.close(); }
}, 60_000);

test("JP2 reject tampered deliveries and replaced Pod bytes until their new publication is trusted", async () => {
  const j = await podJourney();
  try {
    await j.routes.trust(j.row.key, j.row.fingerprint, true);
    const trusted = (await j.routes.list())[0]!;
    const envelope = await j.routes.bundle(trusted.key, trusted.fingerprint);
    await j.loader.sync([trusted]);
    const mount = await j.mount();
    const before = mount.value();
    for (const client of ["web", "host"]) {
      const corrupt = structuredClone(envelope);
      corrupt.artifact.executables.find((entry) => entry.client === client)!.members[0]!.bytes.push(32);
      await expect(loadPodRoute(trusted, corrupt, evaluate), `H16: ${client} bytes are checked before evaluation`).rejects.toThrow("differ");
    }
    const foreign = { ...trusted, workRoute: "pod.foreign.worksheet" };
    await expect(loadPodRoute(foreign, envelope, evaluate), "H16: foreign inventory cannot borrow this publication").rejects.toThrow("identity");
    expect(mount.value(), "H16: refused delivery cannot replace the admitted pane").toEqual(before);
    // A verified browser delivery also contains host bytes. Importing it must not execute them.
    const hostTrap = structuredClone(envelope);
    const hostMember = hostTrap.artifact.executables.find((entry) => entry.client === "host")!.members[0]!;
    hostMember.bytes.push(...new TextEncoder().encode("\nthrow Error('JP host code executed in browser loader');"));
    (hostTrap.artifact.artifact.executables as { client: string; members: { sha256: string }[] }[])
      .find((entry) => entry.client === "host")!.members[0]!.sha256 =
      createHash("sha256").update(Uint8Array.from(hostMember.bytes)).digest("hex");
    hostTrap.artifact.fingerprint = await routeFingerprint(hostTrap.artifact.artifact);
    hostTrap.fingerprint = `pod-bytes:${hostTrap.artifact.fingerprint}`;
    await expect(loadPodRoute({ ...trusted, fingerprint: hostTrap.fingerprint }, hostTrap, evaluate),
      "H16: importing verified browser code does not execute its host entry").resolves.toMatchObject({ fingerprint: hostTrap.fingerprint });
    // Publish a valid new closure, rather than only corrupting a transport envelope.
    const wire = structuredClone(envelope.artifact);
    const member = wire.executables.find((entry) => entry.client === "web")!.members[0]!;
    member.bytes.push(...new TextEncoder().encode("\n// JP replacement publication"));
    (wire.artifact.executables as { client: string; members: { sha256: string }[] }[]).find((entry) => entry.client === "web")!.members[0]!.sha256 =
      createHash("sha256").update(Uint8Array.from(member.bytes)).digest("hex");
    wire.fingerprint = await routeFingerprint(wire.artifact);
    const fingerprint = `pod-bytes:${wire.fingerprint}`;
    const manifestPath = resolve(j.pod, "pod.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.routes[0].fingerprint = fingerprint;
    await writeFile(resolve(j.pod, j.row.artifact), JSON.stringify(wire));
    await writeFile(manifestPath, JSON.stringify(manifest));
    await j.lifecycle.refresh();
    const [replacement] = await j.routes.list();
    expect(replacement?.trusted, "H16: a new digest cannot inherit old trust").toBe(false);
    await j.loader.sync(await j.routes.list());
    expect(publicRoutes.typed(j.row.workRoute), "H16: replacement withdraws the old browser closure").toBeNull();
    expect(registeredReads.reads.has(j.name), "H16: replacement withdraws the old host closure").toBe(false);
    await expect(j.routes.bundle(j.row.key, j.row.fingerprint), "H16: stale fingerprint cannot fetch replacement code").rejects.toThrow();
    await j.routes.trust(j.row.key, fingerprint, true);
    await j.loader.sync(await j.routes.list());
    await vi.waitFor(() => expect(mount.owner(j.row.workRoute)?.ready,
      "H16: the old mounted admission cannot silently adopt replacement authority").toBe(false));
    expect(await mount.draw("calculation", (ctx) => ctx.cells.edit(
      { size: "10", length: 999, amps: 20, voltage: 208, phase: "3" }, { label: "Stale Pod edit" })),
      "H16: an old mounted Pod cannot write replacement Work").toMatchObject({ code: "unavailable" });
    const replaced = await j.mount();
    expect(String(replaced.draw("calculation")), "H16: explicit trust admits the replacement publication").toContain("Copper voltage-drop worksheet");
  } finally { await j.close(); }
}, 60_000);
