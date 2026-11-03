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
  salvagePresent: "salvagePresent",
  salvageDeps: { page: [], work: [], readings: ["names"] },
  readings: {
    ...captures.data.readings,
    names: {
      kind: "derive",
      output: "names",
      derive: "names",
      deps: { page: [], work: [], readings: [] },
      demand: "visible",
      retain: { evidence: "scope", resource: "scope" },
      refresh: "explicit",
    },
  },
  panes: { captures: { ...captures.data.panes.captures, draws: ["captures", "names"] } },
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
const schemas = {
  ...captures.schemas,
  work: ductsDocumentSchema,
  slot: z.string(),
  names: z.record(z.string(), z.string()),
};
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
  names: { slot: "readings.names.derive", kind: "derive", source, run: () => ({ "100": "FC-1" }) },
  salvagePresent: {
    slot: "salvagePresent",
    kind: "present",
    source,
    run: (patches, evidence) => {
      expect(Object.keys(evidence)).toEqual(["page", "work", "readings"]);
      expect(Object.keys(evidence.readings)).toEqual(["names"]);
      expect(evidence.page).toEqual({});
      expect(evidence.work).toEqual({});
      expect(Object.isFrozen(evidence)).toBe(true);
      const names = evidence.readings.names;
      if (!names.current) throw Error("Names unavailable");
      expect(Object.isFrozen(names.value)).toBe(true);
      return {
        sentence: "Carry over 1 recovered input",
        rows: patches.map((patch) => `${names.value[String(patch.path[1])]} drop: 0.18 in-wg`),
      };
    },
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
async function witness(raw?: unknown, failure?: "throw" | "invalid") {
  const module = {
    ...captures,
    data,
    schemas,
    bodies: {
      ...bodies,
      salvagePresent: {
        ...bodies.salvagePresent,
        run: (...[patches, evidence]: Parameters<typeof bodies.salvagePresent.run>) => {
          if (failure === "throw") throw Error("Presentation failed");
          if (failure === "invalid") return Promise.resolve("late");
          return bodies.salvagePresent.run(patches, evidence);
        },
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
test("H7: canonical recovery presents named rows from captured evidence and accepts the keyed edit", async () => {
  const f = await witness(unreadable);
  recovery(f);
  await vi.waitFor(() => expect(f.mount.recovery().startFresh).toBe(true));
  await f.mount.startFresh();
  expect(f.mount.review("work.salvage")).toMatchObject({
    sentence: "Carry over 1 recovered input",
    rows: ["FC-1 drop: 0.18 in-wg"],
    stale: false,
  });
  const review = f.mount.review("work.salvage")!;
  expect(JSON.stringify({ sentence: review.sentence, rows: review.rows })).not.toMatch(/100|900/);
  await settle(f.mount.confirm("work.salvage") as Observation<WorkWriteOutcome>);
  expect(
    ductsDocumentSchema.parse(f.mount.work()!.value).componentDrops["100"]?.edit?.value.inWg,
  ).toBe(0.18);
  expect(f.saved.get("ducts:aside:1")).toEqual(unreadable);
});
test.each(["throw", "invalid"] as const)(
  "H7: %s recovery presentation refuses before submission",
  async (failure) => {
    const f = await witness(unreadable, failure);
    recovery(f);
    await vi.waitFor(() => expect(f.mount.recovery().startFresh).toBe(true));
    await expect(f.mount.startFresh()).rejects.toThrow(
      failure === "throw" ? /present-threw/ : /present-invalid/,
    );
    expect(f.mount.review("work.salvage")).toBeNull();
    expect(ductsDocumentSchema.parse(f.mount.work()!.value).componentDrops).toEqual({});
  },
);
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

test("H7: a later Work edit hides named recovery evidence and refuses stale confirmation", async () => {
  const f = await witness(unreadable);
  recovery(f);
  await vi.waitFor(() => expect(f.mount.recovery().startFresh).toBe(true));
  await f.mount.startFresh();
  await settle(f.mount.invoke("slot", "") as Observation<WorkWriteOutcome>);
  expect(f.mount.review("work.salvage")).toMatchObject({ sentence: null, rows: [], stale: true });
  expect(() => f.mount.confirm("work.salvage")).toThrow(/stale/);
});
