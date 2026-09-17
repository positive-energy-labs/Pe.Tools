import { releaseDemoAdmissions } from "../../../../packages/mcps/src/shared/takeoff-action-client";
import { PeReadings } from "#/readings";
import { mapReading, previousOf, readingAtom } from "#/readings";
import { scopedHostRpc } from "./client";
import {
  address,
  demoSeedSchema,
  exportSeed,
  demoExportWireSchema,
  familiesRouteState,
  familyCaptureSchema,
  parameterLinksRouteState,
  settingsRouteState,
  takeoffsRouteState,
  type DemoSeed,
} from "@pe/agent-contracts";
import * as Atom from "effect/unstable/reactivity/Atom";
import type {
  RouteStatePatch,
  RouteStateWriteResult,
  WorkKey,
  FamiliesRouteDocument,
  ParameterLinksDocument,
  SettingsRouteDocument,
  TakeoffsRouteDocument,
  DocumentRef,
} from "@pe/agent-contracts";
import { inspectAtomRegistry } from "#/state/atom-inspect";
import { makeAtomRegistry, type Slice } from "#/route";

type DemoRouteDocument =
  | SettingsRouteDocument
  | TakeoffsRouteDocument
  | FamiliesRouteDocument
  | ParameterLinksDocument;

export async function demoJson<T>(
  base: string,
  path: string,
  body?: unknown,
  method = body === undefined ? "GET" : "POST",
): Promise<T> {
  if (!/^\/demo\/instances(?:\/demo-[\w-]+)?$/.test(base))
    throw Error("Demo-only endpoint required");
  const response = await fetch(`${base}${path}`, {
    method,
    ...(body !== undefined
      ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }
      : {}),
  });
  if (!response.ok) throw Error(await response.text());
  return response.json() as Promise<T>;
}
export async function createDemoClient(seed: Exclude<DemoSeed, { route: "chat" }>) {
  const owner = await demoJson<{
    id: string;
    base: string;
    root: string;
    r10Path: string;
    target: DocumentRef;
    at: string;
    scope: WorkKey;
  }>("/demo/instances", "", { seed: exportSeed(seed) });
  if (!owner.base.startsWith(`/demo/instances/${owner.id}`))
    throw Error("Invalid isolated owner endpoint");
  const rpc = scopedHostRpc(owner.base);
  const resources = new PeReadings(() =>
    new URL(`${owner.base}/pe/resources`, window.location.href).toString(),
  );
  const registry = makeAtomRegistry();
  const receipt = Atom.make<unknown>(null);
  // One route per owner: the Work this owner serves is the seed's own route, never a default.
  const spec =
    seed.route === "family"
      ? settingsRouteState
      : seed.route === "families"
        ? familiesRouteState
        : seed.route === "parameter-links"
          ? parameterLinksRouteState
          : takeoffsRouteState;
  const work = Atom.map(
    readingAtom({ kind: "work", ...owner.scope, route: spec.route }, resources),
    (reading) =>
      mapReading(reading, (raw) => {
        const value = raw as { doc: unknown; revision: number };
        return {
          doc: spec.schema.parse(value.doc),
          revision: value.revision,
        } satisfies Slice<DemoRouteDocument>;
      }),
  );
  /**
   * Host readings, from this owner's capture stream only. Exposed to the inspector beside Work and
   * the receipt so a reading's schema, basis and cause are inspectable without a second system.
   */
  const readings = Atom.map(
    readingAtom({ kind: "family-readings", work: owner.scope }, resources),
    (reading) => mapReading(reading, (raw) => familyCaptureSchema.array().parse(raw)),
  );
  const releaseWork = registry.mount(work),
    releaseReadings = registry.mount(readings),
    releaseReceipt = registry.mount(receipt);
  /**
   * A Reading settles by observation, not by suspension: poll this owner's own atom until it
   * carries a revision at or past the one the write reported. ponytail: 50ms poll, 30s ceiling —
   * an isolated demo owner has exactly one writer, so there is nothing to contend with.
   */
  const settleWork = async (revision = 0) => {
    const deadline = Date.now() + 30_000;
    for (;;) {
      const seen = previousOf(registry.get(work));
      if (seen && (seen.revision ?? 0) >= revision) return;
      if (Date.now() > deadline) throw Error(`demo work never reached revision ${revision}`);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  };
  try {
    await settleWork();
  } catch (error) {
    releaseWork();
    releaseReadings();
    releaseReceipt();
    registry.dispose();
    resources.close();
    await demoJson(owner.base, "", undefined, "DELETE");
    throw error;
  }
  const inspector = inspectAtomRegistry(registry);
  const releaseInspector = inspector.expose(owner.id, {
    work: { candidate: work },
    readings: { captures: readings },
    operations: { receipt },
  });
  const refreshWork = async () => {
    const current = (await demoJson(owner.base, "/work")) as {
      revision: number;
    };
    await settleWork(current.revision);
    inspector.notify();
  };
  const apply = async (patches: RouteStatePatch[], revision?: number) => {
    const current = registry.get(work);
    const result = await demoJson<RouteStateWriteResult>(
      owner.base,
      "/work",
      {
        patches,
        revision: revision ?? previousOf(current)?.revision ?? undefined,
      },
      "PATCH",
    );
    await refreshWork();
    return result;
  };
  return {
    ...owner,
    rpc,
    resources,
    at: address(owner.at),
    registry,
    work,
    readings,
    receipt,
    inspector,
    refreshWork,
    apply,
    async command(name: string, input: unknown, revision?: number) {
      const current = registry.get(work);
      const result = await demoJson<RouteStateWriteResult>(owner.base, "/work/command", {
        name,
        input,
        id: `${owner.id}:${crypto.randomUUID()}`,
        revision: revision ?? previousOf(current)?.revision ?? undefined,
      });
      await refreshWork();
      return result;
    },
    newActionId: () => `${owner.id}:${crypto.randomUUID()}`,
    record: (row: unknown) => {
      registry.set(receipt, row);
      inspector.notify();
    },
    async export(page: unknown) {
      const exported = demoExportWireSchema.parse(await demoJson(owner.base, "/export"));
      return exported.kind === "complete"
        ? { ...exported, seed: demoSeedSchema.parse({ ...exported.seed, page }) }
        : exported;
    },
    async dispose() {
      releaseDemoAdmissions(owner.base);
      releaseInspector();
      releaseReceipt();
      releaseReadings();
      releaseWork();
      registry.dispose();
      // Retire this instance's transport before the instance: once closed it issues nothing
      // further, so no read can be born after the owner is gone. close() fences and ignores
      // frames from the torn-down connection — it does not drain them to listeners.
      resources.close();
      await demoJson(owner.base, "", undefined, "DELETE");
    },
  };
}
export type DemoClient = Awaited<ReturnType<typeof createDemoClient>>;
