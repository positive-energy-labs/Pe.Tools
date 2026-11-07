import { placeInput } from "../shell/admitted-place.test-fixture";
// @vitest-environment jsdom
import { createElement } from "react";
import { act, cleanup as cleanupView, render, screen } from "@testing-library/react";
import { z } from "zod";
import { afterEach, expect, test, vi } from "vite-plus/test";
import {
  fansDocumentSchema,
  bindWork,
  workKey,
  address,
  fansRouteState,
  salvageWork,
  type WorkWriteAck,
  documentRequestSchema,
} from "@pe/agent-contracts";
import { RouteWorkspace, observeResources } from "@pe/runtime";
import {
  builtinClosureFingerprint,
  createBuiltinRouteInventory,
} from "../../../../packages/agent-contracts/src/route-module";
import type {
  BodyBindings,
  PaneContext,
} from "../../../../packages/agent-contracts/src/route-kernel-bodies";
import type {
  Observation,
  WorkWriteOutcome,
} from "../../../../packages/agent-contracts/src/work-journal-door";
import { module as captures } from "../shell/admitted-module.test.fixture";
import { createRouteShell } from "../shell/admitted-mount";
import { createWorkFeedClient } from "../shell/work-feed-client";
import {
  describeInputHistory,
  inputHistoryMetaSchema,
  presentInputHistory,
} from "../ducts/sheet/input-history.neutral";
import { sourceRouteServices } from "../shell/source-route-services";
import * as recoveryHost from "../route/host";
import { peClient } from "../host/pe-client";
import * as sourceServices from "../shell/source-route-services";
import { applicationRouteShell } from "../shell/application-route-shell";
import { useRouteTarget } from "../route/route-target";
import { RouteActivity, RouteVisibility, type RouteActivityScope } from "../route/activity";
vi.mock("../route/route-target", async (original) => ({
  ...(await original<typeof import("../route/route-target")>()),
  useRouteTarget: vi.fn(),
}));

const source = { module: "fans/recovery-bootstrap-gap.test.ts", export: "witness" };
const data = {
  ...captures.data,
  key: "ducts",
  address: "/ducts",
  name: "Ducts",
  capabilities: ["work"],
  needs: "project",
  work: { route: "ducts", schema: "work", version: 1, migrations: {} },
  historyDetail: "historyDetail",
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
  work: fansDocumentSchema,
  slot: z.string(),
  names: z.record(z.string(), z.string()),
  historyDetail: inputHistoryMetaSchema,
};
// The witness edits one real Ducts slot through the generic mount.
const bodies = {
  ...captures.bodies,
  main: {
    ...captures.bodies.main,
    run: (ctx: PaneContext<typeof data, typeof schemas, typeof captures.entries, "captures">) =>
      ctx.work?.parameters.fanFlow?.edit?.value ?? "No authored fan slot",
  },
  slot: {
    slot: "verbs.slot.patches",
    kind: "work",
    source,
    run: (_ctx, value) => [
      { path: ["parameters", "fanFlow"], value: { edit: { value: value || "PE_M_Fan_AirFlow" } } },
    ],
  },
  describe: {
    slot: "verbs.slot.describe",
    kind: "describe",
    source,
    run: () => ({ label: "fanFlow → PE_M_Fan_AirFlow" }),
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
      const cell = salvageWork(fansDocumentSchema, raw).doc.componentDrops["100"];
      return { ok: true, value: cell ? [{ path: ["componentDrops", "100"], value: cell }] : [] };
    },
  },
} satisfies BodyBindings<typeof data, typeof schemas, typeof captures.entries>;
const extract = (raw: unknown) => salvageWork(fansDocumentSchema, raw).doc;
const neutral = {
  data,
  schemas,
  bodies: { salvage: { slot: "salvage", kind: "recovery" as const, source, run: extract } },
  // The fan cells are the recovery material (fans Work since FANSPLIT), keyed as this witness route.
  workState: { ...fansRouteState, route: "ducts", salvage: extract },
};
const cleanup: (() => void)[] = [];
afterEach(() => {
  cleanupView();
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
async function witness(
  raw?: unknown,
  failure?: "throw" | "invalid",
  limits?: { maxCount: number; maxBytes: number },
  description?: { label: string; meta?: z.output<typeof inputHistoryMetaSchema> },
  onHistory?: (history: Parameters<typeof bodies.main.run>[0]["history"]) => void,
) {
  const module = {
    ...captures,
    data,
    schemas,
    bodies: {
      ...bodies,
      main: {
        ...bodies.main,
        run: (ctx: Parameters<typeof bodies.main.run>[0]) => {
          onHistory?.(ctx.history);
          return bodies.main.run(ctx);
        },
      },
      describe: {
        ...bodies.describe,
        run: description ? () => description : bodies.describe.run,
      },
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
    workHistoryLimits: limits,
    store: {
      getState: async ({ route }) => saved.get(route),
      setState: async ({ route, value }) => {
        saved.set(route, structuredClone(value));
      },
    },
  });
  const registration = ws.registerAdmitted(host.route);
  await registration.ready;
  // ADR 0033 deletes undecodable Work on read; exercise explicit recovery before mounting it.
  if (raw === unreadable)
    expect(await ws.startFresh(bindWork("ducts", null, undefined, { session: "fixture", openId: "w1f" }), "ducts", "human")).toMatchObject({ ok: true });
  cleanup.push(() => registration.close());
  const observe = observeResources(ws, { observe: () => () => {} });
  let skipped = 0;
  type Frame = Parameters<Parameters<typeof observe>[1]>[0];
  const subscriptions = new Set<{
    request: Parameters<typeof observe>[0];
    deliver(frame: Frame): void;
    stop(): void;
  }>();
  const client = createWorkFeedClient(
    {
      subscribe(request, deliver) {
        const entry = {
          request,
          deliver: (frame: Frame) => {
            if (request.kind === "work-acks" && frame.kind === "event" && skipped > 0) {
              skipped--;
              return;
            }
            deliver(frame);
          },
          stop: () => {},
        };
        entry.stop = observe(request, entry.deliver);
        subscriptions.add(entry);
        return () => {
          entry.stop();
          subscriptions.delete(entry);
        };
      },
      dirty(request) {
        for (const entry of subscriptions)
          if (entry.request.kind === request.kind) {
            entry.stop();
            entry.stop = observe(entry.request, (frame) => entry.deliver(frame));
          }
      },
    },
    {
      write: (key, write) => ws.write(key, "ducts", "human", write),
      submit: async () => {
        throw Error("Unexpected native dispatch");
      },
    },
  );
  const states: import("../../../../packages/agent-contracts/src/work-journal-door").WorkFeedState[] =
    [];
  const work = {
    ...client,
    open: (scope: Parameters<typeof client.open>[0]) => ({
      subscribe: (...[deliver, end]: Parameters<ReturnType<typeof client.open>["subscribe"]>) =>
        client.open(scope).subscribe((state) => {
          states.push(state);
          deliver(state);
        }, end),
    }),
  };
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
  let eligibility: "writable" | "read-only" = "writable";
  const input = placeInput(address, {
    target: { kind: "document", ref: { session: "fixture", openId: "w1f" } },
    custody: { current: () => eligibility === "writable" },
  });
  const mount = createRouteShell(services).mount(web.route, input);
  cleanup.push(mount.close);
  return {
    mount,
    eligibility(next: "writable" | "read-only") {
      eligibility = next;
    },
    route: web.route,
    services,
    address,
    ws,
    saved,
    states,
    skipAcks(count: number) {
      skipped = count;
    },
    reopen() {
      const next = createRouteShell(services).mount(web.route, input);
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
  vi.mocked(recoveryHost.salvageRouteWork).mockRestore();
  vi.spyOn(peClient, "response").mockImplementation(async () =>
    Response.json(await f.ws.salvage(f.mount.workBasis()!.token.scope.identity.work!, "ducts")),
  );
  await vi.waitFor(() => expect(f.mount.recovery().carryOver).toBe(true));
  await f.mount.salvage();
  expect(f.mount.review("work.salvage")).toMatchObject({
    sentence: "Carry over 1 recovered input",
    rows: ["FC-1 drop: 0.18 in-wg"],
    stale: false,
  });
  const review = f.mount.review("work.salvage")!;
  expect(JSON.stringify({ sentence: review.sentence, rows: review.rows })).not.toMatch(/100|900/);
  await settle(f.mount.confirm("work.salvage") as Observation<WorkWriteOutcome>);
  expect(
    fansDocumentSchema.parse(f.mount.work()!.value).componentDrops["100"]?.edit?.value.inWg,
  ).toBe(0.18);
  expect(f.saved.get("ducts:aside:1")).toEqual(unreadable);
});
test.each(["throw", "invalid"] as const)(
  "H7: %s recovery presentation refuses before submission",
  async (failure) => {
    const f = await witness(unreadable, failure);
    recovery(f);
    await vi.waitFor(() => expect(f.mount.recovery().carryOver).toBe(true));
    await expect(f.mount.salvage()).rejects.toThrow(
      failure === "throw" ? /present-threw/ : /present-invalid/,
    );
    expect(f.mount.review("work.salvage")).toBeNull();
    expect(fansDocumentSchema.parse(f.mount.work()!.value).componentDrops).toEqual({});
  },
);


test("H7: a later Work edit hides named recovery evidence and refuses stale confirmation", async () => {
  const f = await witness(unreadable);
  recovery(f);
  await vi.waitFor(() => expect(f.mount.recovery().carryOver).toBe(true));
  await f.mount.salvage();
  await settle(f.mount.invoke("slot", "") as Observation<WorkWriteOutcome>);
  expect(f.mount.review("work.salvage")).toMatchObject({ sentence: null, rows: [], stale: true });
  expect(() => f.mount.confirm("work.salvage")).toThrow(/stale/);
});








test.each([true, false])(
  "D4: a prepared recovery review respects Place write eligibility (%s)",
  async (writable) => {
    const f = await witness(unreadable);
    recovery(f);
    await vi.waitFor(() => expect(f.mount.recovery().carryOver).toBe(true));
    await f.mount.salvage();
    expect(f.mount.review("work.salvage")?.stale).toBe(false);
    const before = structuredClone(f.saved.get("ducts"));
    f.eligibility(writable ? "writable" : "read-only");
    if (writable) await settle(f.mount.confirm("work.salvage") as Observation<WorkWriteOutcome>);
    else
      expect(() => f.mount.confirm("work.salvage")).toThrow(
        expect.objectContaining({ reason: "place-read-only" }),
      );
    if (writable) expect(f.saved.get("ducts")).not.toEqual(before);
    else expect(f.saved.get("ducts")).toEqual(before);
  },
);





test.each(["w1f", "other-document"])(
  "P07: a hidden Place keeps its own Work when the active target is %s",
  async (activeOpenId) => {
    const f = await witness();
    f.mount.close();
    const own = { kind: "open", ref: { session: "fixture", openId: "w1f" } } as const;
    const ownPin = JSON.stringify(own);
    const activePin = JSON.stringify({
      kind: "open",
      ref: { session: "fixture", openId: activeOpenId },
    });
    let search = new URLSearchParams({ target: ownPin });
    const listeners = new Set<() => void>();
    const address = {
      read: () => search,
      write() {},
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    };
    const owners = new Set<{ dispose(): void }>();
    cleanup.push(() => owners.forEach((owner) => owner.dispose()));
    let visible = true;
    const scope: RouteActivityScope = {
      pathname: "/ducts",
      search: { target: ownPin },
      current: () => visible,
      retain: (owner) => {
        owners.add(owner);
      },
      retire: (owner) => {
        owners.delete(owner);
        owner.dispose();
      },
    };
    vi.mocked(useRouteTarget).mockImplementation((_manifest, _registry, _seed, target) => {
      const request = documentRequestSchema.parse(JSON.parse(target!));
      if (request.kind !== "open") throw Error("Expected exact fixture lifetime");
      return {
        resolution: { kind: "resolved", target: { kind: "document", ref: request.ref } },
        workAddress: null,
        resolvedAddress: null,
    inventoryResult: { state: "absent" },
        workOpen: null,
      } as ReturnType<typeof useRouteTarget>;
    });
    vi.spyOn(sourceServices, "sourceRouteServices").mockImplementation((_sources, composition) => ({
      ...f.services,
      target: composition?.target,
    }));
    const open = vi.spyOn(f.services.work, "open");
    const tree = () =>
      createElement(
        RouteActivity,
        { value: scope },
        createElement(
          RouteVisibility,
          { value: visible },
          createElement(applicationRouteShell, { route: f.route, address }),
        ),
      );
    const view = render(tree());
    await vi.waitFor(() => expect(open).toHaveBeenCalled());
    visible = false;
    view.rerender(tree());
    act(() => {
      search = new URLSearchParams({ target: activePin });
      listeners.forEach((listener) => listener());
    });
    expect(open.mock.calls.map(([scope]) => workKey(scope.key))).toEqual([
      workKey(bindWork("ducts", null, undefined, own.ref)),
    ]);
  },
);












