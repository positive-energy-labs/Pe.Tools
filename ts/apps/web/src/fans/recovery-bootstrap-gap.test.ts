import { z } from "zod";
import { afterEach, expect, test, vi } from "vite-plus/test";
import {
  ductsDocumentSchema,
  ductsRouteState,
  salvageDuctsWork,
  type WorkWriteAck,
} from "@pe/agent-contracts";
import { RouteWorkspace, observeResources } from "@pe/runtime";
import {
  builtinClosureFingerprint,
  createBuiltinRouteInventory,
} from "../../../../packages/agent-contracts/src/route-module";
import type { BodyBindings } from "../../../../packages/agent-contracts/src/route-kernel-bodies";
import type {
  Observation,
  WorkWriteOutcome,
} from "../../../../packages/agent-contracts/src/work-journal-door";
import { module as captures } from "../captures/kernel";
import { createRouteShell } from "../shell/admitted-mount";
import { createWorkFeedClient } from "../shell/work-feed-client";
import { sourceRouteServices } from "../shell/source-route-services";
import * as recoveryHost from "../route/host";

const source = { module: "fans/recovery-bootstrap-gap.test.ts", export: "witness" };
const data = {
  ...captures.data,
  key: "ducts",
  address: "/ducts",
  name: "Ducts",
  capabilities: ["work"],
  needs: "project",
  work: { route: "ducts", schema: "work", version: 1, migrations: {} },
  salvage: "salvage",
  verbs: {
    slot: {
      kind: "work",
      input: "slot",
      label: "Edit parameter slot",
      describe: "describe",
      patches: "slot",
      review: "none",
      captures: [],
      deps: { page: [], work: [], readings: [] },
    },
  },
} as const;
const schemas = { ...captures.schemas, work: ductsDocumentSchema, slot: z.string() };
// The witness edits one real Ducts slot through the generic mount.
const bodies = {
  ...captures.bodies,
  main: { ...captures.bodies.main, run: () => null },
  slot: {
    slot: "verbs.slot.patches",
    kind: "work",
    source,
    run: () => [
      { path: ["parameters", "fanFlow"], value: { edit: { value: "PE_M_Fan_AirFlow" } } },
    ],
  },
  describe: {
    slot: "verbs.slot.describe",
    kind: "describe",
    source,
    run: () => "fanFlow → PE_M_Fan_AirFlow",
  },
  salvage: {
    slot: "salvage",
    kind: "salvage",
    source,
    run: (raw) => {
      const cell = salvageDuctsWork(raw).doc.componentDrops["100"];
      return { ok: true, value: cell ? [{ path: ["componentDrops", "100"], value: cell }] : [] };
    },
  },
} satisfies BodyBindings<typeof data, typeof schemas, typeof captures.entries>;
const extract = (raw: unknown) => salvageDuctsWork(raw).doc;
const neutral = {
  data,
  schemas,
  bodies: { salvage: { slot: "salvage", kind: "recovery" as const, source, run: extract } },
  workState: { ...ductsRouteState, salvage: extract },
};
const cleanup: (() => void)[] = [];
afterEach(() => {
  cleanup
    .splice(0)
    .reverse()
    .forEach((close) => close());
  vi.restoreAllMocks();
});
const settle = (o: Observation<WorkWriteOutcome>) =>
  new Promise<WorkWriteOutcome>((resolve) =>
    o.subscribe(
      (v) => {
        if (v.kind !== "pending") resolve(v);
      },
      () => {},
    ),
  );
async function witness(raw?: unknown, named = false) {
  const module = {
    ...captures,
    data,
    schemas,
    bodies: {
      ...bodies,
      salvage: {
        ...bodies.salvage,
        run: (value: unknown) => ({
          ...bodies.salvage.run(value),
          ...(named
            ? { sentence: "Carry over 1 recovered input", rows: ["FC-1 drop: 0.18 in-wg"] }
            : {}),
        }),
      },
    },
  };
  const envelope = {
    source: "builtin-closure" as const,
    version: 1 as const,
    data,
    hostVersion: "w1f-witness",
    variants: [{ client: "web" as const, entry: "witness.ts" }],
    modules: [{ id: "witness.ts", sha256: "a".repeat(64) }],
    inputs: [],
    externals: [],
  };
  const fingerprint = await builtinClosureFingerprint(envelope);
  const inventory = createBuiltinRouteInventory({
    web: {
      module,
      closure: { envelope, fingerprint },
      catalog: Object.entries(captures.entries).map(([key, e]) => ({ key, ...e.axes, uses: [] })),
    },
    host: { module: neutral, host: true, closure: { envelope, fingerprint }, catalog: [] },
  });
  const web = (await inventory.prepare("web", fingerprint)).admitUnknown(module);
  const host = (await inventory.prepare("host", fingerprint)).admitHost(neutral);
  if (!web.ok) throw Error(JSON.stringify(web.diagnostics));
  if (!host.ok) throw Error(JSON.stringify(host.diagnostics));
  const saved = new Map<string, unknown>(raw ? [["ducts", raw]] : []);
  const ws = new RouteWorkspace({
    registrations: [],
    store: {
      getState: async ({ route }) => saved.get(route),
      setState: async ({ route, value }) => {
        saved.set(route, structuredClone(value));
      },
    },
  });
  const registration = ws.registerAdmitted(host.route);
  await registration.ready;
  cleanup.push(() => registration.close());
  const observe = observeResources(ws, { observe: () => () => {} });
  const work = createWorkFeedClient(
    { subscribe: (request, deliver) => observe(request, deliver), dirty() {} },
    {
      write: (key, write) => ws.write(key, "ducts", "human", write),
      submit: async () => {
        throw Error("Unexpected native dispatch");
      },
    },
  );
  const services = {
    ...sourceRouteServices(
      {
        "captures.list": {
          kind: "use",
          open(_ctx, deliver) {
            deliver({ kind: "complete", value: [], revision: 1 });
          },
        },
      },
      { target: () => ({ kind: "document", ref: { session: "fixture", openId: "w1f" } }) },
    ),
    work,
  };
  const address = { read: () => new URLSearchParams(), write() {}, subscribe: () => () => {} };
  const mount = createRouteShell(services).mount(web.route, address);
  cleanup.push(mount.close);
  return {
    mount,
    ws,
    saved,
    reopen() {
      const next = createRouteShell(services).mount(web.route, address);
      cleanup.push(next.close);
      return next;
    },
  };
}
const unreadable = {
  version: 1,
  schemaVersion: 1,
  revision: 7,
  doc: { componentDrops: { "100": { edit: { value: { inWg: 0.18 } } } }, unknownOldField: true },
};
function recovery(f: Awaited<ReturnType<typeof witness>>) {
  vi.spyOn(recoveryHost, "startFreshRouteWork").mockImplementation((key) =>
    f.ws.startFresh(key, "ducts", "human"),
  );
  vi.spyOn(recoveryHost, "salvageRouteWork").mockImplementation(
    (key) => f.ws.salvage(key, "ducts") as ReturnType<typeof recoveryHost.salvageRouteWork>,
  );
}
test("H7: canonical recovery accepts a valid keyed edit through an empty unnamed review", async () => {
  const f = await witness(unreadable);
  recovery(f);
  await vi.waitFor(() => expect(f.mount.recovery().startFresh).toBe(true));
  await f.mount.startFresh();
  expect(f.mount.review("work.salvage")).toMatchObject({ sentence: null, rows: [], stale: false });
  await settle(f.mount.confirm("work.salvage") as Observation<WorkWriteOutcome>);
  expect(
    ductsDocumentSchema.parse(f.mount.work()!.value).componentDrops["100"]?.edit?.value.inWg,
  ).toBe(0.18);
  expect(f.saved.get("ducts:aside:1")).toEqual(unreadable);
});
test("H7: returning named recovery presentation is refused by the shared decoder", async () => {
  const f = await witness(unreadable, true);
  recovery(f);
  await vi.waitFor(() => expect(f.mount.recovery().startFresh).toBe(true));
  await expect(f.mount.startFresh()).rejects.toThrow(/sentence|rows|Unrecognized/);
  expect(f.mount.review("work.salvage")).toBeNull();
  expect(ductsDocumentSchema.parse(f.mount.work()!.value).componentDrops).toEqual({});
});
test("H8: the host retains and replays the label but a remount restores no journal or undo", async () => {
  const f = await witness();
  await vi.waitFor(() => expect(f.mount.workBasis()).not.toBeNull());
  await settle(f.mount.invoke("slot", "") as Observation<WorkWriteOutcome>);
  expect(f.mount.journal()!.moves.map((m) => m.label)).toEqual(["fanFlow → PE_M_Fan_AirFlow"]);
  const next = f.reopen();
  await vi.waitFor(() => expect(next.workBasis()).not.toBeNull());
  expect(ductsDocumentSchema.parse(next.work()!.value).parameters.fanFlow?.edit?.value).toBe(
    "PE_M_Fan_AirFlow",
  );
  const acks: WorkWriteAck[] = [];
  const stop = f.ws.observeAccepted(next.workBasis()!.token.scope.identity.work!, (ack) =>
    acks.push(ack),
  );
  cleanup.push(stop);
  await vi.waitFor(() =>
    expect(acks.map((ack) => ack.label)).toEqual(["fanFlow → PE_M_Fan_AirFlow"]),
  );
  expect(next.journal()!.moves).toEqual([]);
  expect(await next.history!.undo()).toMatchObject({ ok: false });
});
