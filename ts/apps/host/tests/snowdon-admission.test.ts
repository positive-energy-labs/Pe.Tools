import { expect, test, vi } from "vite-plus/test";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RouteWorkspace, observeResources } from "@pe/runtime";
import { bindWork, workKey, type ReadingFrame } from "@pe/agent-contracts";
import { workFingerprintSchema } from "../../../packages/agent-contracts/src/route-kernel-admission.ts";
import { createPackageLifecycle } from "../src/package-lifecycle.ts";
import { listPackages } from "../src/packages.ts";
import { createPodRoutes } from "../src/pod-routes.ts";
import { fileRouteDocumentStore } from "../src/route-document-store.ts";

test("shipped Snowdon artifact admits, migrates persisted Work, binds feeds and retires on deactivation", async () => {
  const root = await mkdtemp(join(tmpdir(), "p2-snowdon-"));
  await cp(
    new URL("../../../../examples/pods/snowdon-circuits", import.meta.url),
    join(root, "Pods/snowdon-circuits"),
    { recursive: true },
  );
  const lifecycle = createPackageLifecycle({
    packages: () => listPackages(join(root, "Pods")),
    decisionsPath: join(root, "enabled.json"),
  });
  const store = fileRouteDocumentStore(join(root, "Work"));
  const workspace = new RouteWorkspace({ registrations: [], store });
  const routes = createPodRoutes(lifecycle, { workspace, trustPath: join(root, "trust.json") });
  const releases: (() => void)[] = [];
  try {
    const [row] = await routes.list();
    expect(row?.packageId).toBe("snowdon-circuits");
    const key = bindWork(row!.workRoute, null);
    const inputs = { size: "10", length: 175, amps: 20, voltage: 208, phase: "3" };
    await store.setState({
      targetKey: workKey(key),
      route: key.route,
      value: { version: 1, schemaVersion: 1, revision: 7, doc: { state: { inputs } }, history: [] },
    });
    await routes.trust(row!.key, row!.fingerprint, true);
    expect(workspace.requiresAdmission(key.route)).toBe(true);
    const wire = await routes.bundle(row!.key, row!.fingerprint);
    expect(wire.fingerprint).toBe(row!.fingerprint);
    expect(`pod-bytes:${wire.artifact.fingerprint}`).toBe(row!.fingerprint);
    const observe = observeResources(workspace, { observe: () => () => {} });
    const admission = {
      routeKey: key.route,
      fingerprint: workFingerprintSchema.parse(row!.fingerprint),
    };
    const snapshots: ReadingFrame[] = [],
      acks: ReadingFrame[] = [],
      stale: ReadingFrame[] = [];
    releases.push(observe({ ...key, kind: "work", admission }, (frame) => snapshots.push(frame)));
    releases.push(
      observe({ kind: "work-acks", work: key, admission }, (frame) => acks.push(frame)),
    );
    releases.push(
      observe(
        {
          ...key,
          kind: "work",
          admission: {
            ...admission,
            fingerprint: workFingerprintSchema.parse(`pod-bytes:${"0".repeat(64)}`),
          },
        },
        (frame) => stale.push(frame),
      ),
    );
    await vi.waitFor(() =>
      expect(snapshots[0]).toMatchObject({
        kind: "snapshot",
        value: { schemaVersion: 2, revision: 8, doc: { version: 2, inputs } },
      }),
    );
    expect(await store.getState({ targetKey: workKey(key), route: key.route })).toMatchObject({
      schemaVersion: 2,
      doc: { version: 2, inputs },
    });
    expect(stale[0]).toMatchObject({ kind: "failure", failure: { kind: "registration-mismatch" } });
    await lifecycle.setEnabled("pod:snowdon-circuits", false);
    expect(workspace.list()).toEqual([]);
    await vi.waitFor(() =>
      expect(snapshots[1]).toMatchObject({
        kind: "failure",
        failure: { code: "WorkRouteUnregistered" },
      }),
    );
    expect(acks[0]).toMatchObject({ kind: "failure", failure: { code: "WorkRouteUnregistered" } });
  } finally {
    releases.forEach((release) => release());
    routes.close();
    await lifecycle.close();
    await rm(root, { recursive: true, force: true });
  }
});
