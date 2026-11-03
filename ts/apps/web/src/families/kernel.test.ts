import { afterEach, expect, test, vi } from "vite-plus/test";
import { familiesModule, familiesEntries } from "./kernel";
import { familiesRouteState, familyCellKey } from "@pe/agent-contracts";
import {
  builtinClosureFingerprint,
  createBuiltinRouteInventory,
} from "../../../../packages/agent-contracts/src/route-module";
import { createRouteShell } from "../shell/admitted-mount";
import { createFixtureWorkDoor } from "../shell/fixture-work-door";
import { sourceRouteServices } from "../shell/source-route-services";
import type { KernelServices } from "../../../../packages/agent-contracts/src/route-kernel-environment";
import type { Observation } from "../../../../packages/agent-contracts/src/work-journal-door";
const takenAt = "2026-11-02T18:13:00Z";
const filter = {
  categoryNames: ["Mechanical Equipment"],
  familyNames: ["Magna3 - Mechanical Equipment"],
  placementScope: "AllLoaded" as const,
};
const document = { session: "families-w2", openId: "local-copy" };
const observation = {
  id: "w2",
  work: { binding: "open", route: "families", target: null, open: document },
  document,
  filter,
  capturedAt: takenAt,
  completedAt: takenAt,
  result: { families: [], issues: [], page: null },
};
const seed = familiesRouteState.schema.parse({ scope: { edit: { value: filter } }, takenAt });
const address = {
  familyName: "Magna3 - Mechanical Equipment",
  typeName: "Grundfos_MAGNA3 32-60 GF",
  parameter: "Amperage",
};
const key = familyCellKey(address);
const edit = { address, current: "1.01", value: { value: "1.1", storageType: "Double" as const } };
const closes: (() => void)[] = [];
afterEach(() => closes.splice(0).forEach((close) => close()));
// Synthetic evidence proves composition only, never production source-closure enrollment.
async function admitted(workOnly = true) {
  const { preview: _preview, ...readings } = familiesModule.data.readings;
  const { apply: _apply, stop: _stop, ...verbs } = familiesModule.data.verbs;
  const {
    previewArgs: _previewArgs,
    apply: _applyBody,
    applyReady: _ready,
    stop: _stopBody,
    ...bodies
  } = familiesModule.bodies;
  const {
    "families.apply": _applyEntry,
    "families.apply.preview": _previewEntry,
    "families.cancel-read": _stopEntry,
    ...entries
  } = familiesEntries;
  const candidate = workOnly
    ? {
        ...familiesModule,
        data: {
          ...familiesModule.data,
          capabilities: ["work"] as const,
          readings,
          verbs,
          stages: { audit: { word: "Auditing", panes: ["main"], verbs: ["read"] } },
          panes: { main: { ...familiesModule.data.panes.main, verbs: ["read", "edit", "revert"] } },
        },
        bodies,
        entries,
      }
    : familiesModule;
  const envelope = {
    source: "builtin-closure" as const,
    version: 1 as const,
    data: candidate.data,
    hostVersion: "fixture",
    variants: [{ client: "web" as const, entry: "families/kernel.ts" }],
    modules: [{ id: "families/kernel.ts", sha256: "a".repeat(64) }],
    inputs: [],
    externals: [],
  };
  const fingerprint = await builtinClosureFingerprint(envelope);
  const inventory = createBuiltinRouteInventory({
    families: {
      module: candidate,
      closure: { envelope, fingerprint },
      catalog: Object.entries(candidate.entries).map(([key, e]) => ({ key, ...e.axes, uses: [] })),
    },
  });
  const result = (await inventory.prepare("families", fingerprint)).admitUnknown(candidate);
  if (!result.ok) throw Error(JSON.stringify(result.diagnostics));
  return result.route;
}
function settled(value: unknown): Promise<any> {
  return new Promise((resolve) =>
    (value as Observation<any>).subscribe(
      (s) => {
        if (s.kind !== "pending") resolve(s);
      },
      () => {},
    ),
  );
}
async function setup(application = false) {
  const frames = new Map<string, (v: any) => void>();
  const requests: any[] = [];
  const store = createFixtureWorkDoor(familiesRouteState, seed);
  const submit = vi.fn((command: Parameters<typeof store.submit>[0]) => store.submit(command));
  const services: KernelServices = {
    ...(application
      ? sourceRouteServices({})
      : {
          reads: {
            lifetime: "read" as const,
            acquire(request: any) {
              requests.push(request);
              return {
                lifetime: "read" as const,
                key: request.key,
                read: () => ({
                  status: "pending" as const,
                  current: false as const,
                  reason: "Waiting",
                }),
                release() {},
              };
            },
          },
          readings: {
            lifetime: "subscription" as const,
            subscribe(request: any, _: unknown, deliver: any) {
              frames.set(request.key.op, deliver);
              return () => {};
            },
          },
        }),
    target: () => ({ kind: "document", ref: document }),
    work: { ...store, submit },
    clock: { lifetime: "read", now: Date.now },
    availability: {},
  };
  const mount = createRouteShell(services).mount(await admitted(), {
    read: () => new URLSearchParams(),
    write() {},
    subscribe: () => () => {},
  });
  closes.push(mount.close);
  const read = () => {
    mount.invoke("read", { filter, readId: "00000000-0000-4000-8000-000000000001" });
    if (!application)
      frames.get("families.read")!({
        status: "ready",
        current: true,
        hash: "matrix",
        value: observation,
      });
  };

  return { mount, submit, requests, frames, read };
}
test("mounted Families edits and Revert use one accepted Work", async () => {
  const f = await setup();
  f.read();
  await settled(f.mount.invoke("edit", edit, f.mount.workBasis()!));
  expect(f.mount.work()?.value).toMatchObject({
    cells: { [key]: { edit: { value: edit.value } } },
  });
  await settled(f.mount.invoke("revert", key, f.mount.workBasis()!));
  expect(f.mount.work()?.value).toMatchObject({ cells: {} });
  expect(await f.mount.history!.undo()).toMatchObject({ ok: true });
  expect(f.mount.work()?.value).toMatchObject({
    cells: { [key]: { edit: { value: edit.value } } },
  });
  expect(await f.mount.history!.redo()).toMatchObject({ ok: true });
  expect(f.mount.work()?.value).toMatchObject({ cells: {} });
  expect(f.submit).not.toHaveBeenCalled();
});
test("delayed edit preserves the rendered expectedRevision", async () => {
  const f = await setup();
  f.read();
  const basis = f.mount.workBasis()!;
  await settled(f.mount.invoke("edit", edit, basis));
  f.read();
  const result = await settled(
    f.mount.invoke("edit", { ...edit, value: { ...edit.value, value: "1.3" } }, basis),
  );
  expect(result).toMatchObject({ kind: "refused", refusal: { code: "stale_revision" } });
});
test("kernel gap: semantic Families preview is refused as native geometry", async () => {
  await expect(admitted(false)).rejects.toThrow(/Geometry dependency requires an explicit policy/);
});
test("unenrolled Families source refuses rather than calling a native fallback", async () => {
  const f = await setup(true);
  f.read();
  expect(f.mount.read("main")).toMatchObject({
    props: { children: expect.stringContaining("No source for families.read") },
  });
  expect(() => f.mount.invoke("edit", edit, f.mount.workBasis()!)).toThrow(/Reading unavailable/);
});
