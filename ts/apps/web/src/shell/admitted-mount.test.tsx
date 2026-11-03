// @vitest-environment jsdom
import { createElement, StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { z } from "zod";
import type { BodyBindings } from "../../../../packages/agent-contracts/src/route-kernel-bodies";
import type { RouteGraphJson } from "../../../../packages/agent-contracts/src/route-kernel-data";
import type { KernelServices } from "../../../../packages/agent-contracts/src/route-kernel-environment";
import {
  builtinClosureFingerprint,
  createBuiltinRouteInventory,
} from "../../../../packages/agent-contracts/src/route-module";

import { identityCodecs } from "./page-port";
import { createRouteShell, admittedMountBodyKinds } from "./admitted-mount";
import { AdmittedPane, admittedRouterAddress } from "./admitted-pane";
const data = {
  version: 1,
  capabilities: [],
  key: "note",
  address: "/note",
  name: "Note",
  directory: {
    group: "Test",
    summary: "Composition witness",
    label: "Test",
    icon: "File",
    exposure: "Preview",
    surfaces: { web: "full", pwa: "full", tray: false },
    aliases: [],
    runtimeNeed: "Host",
    listed: true,
    satellites: [],
  },
  identities: { note: { kind: "local", codec: "local" } },
  fields: {
    note: {
      role: "subject",
      schema: "subject",
      codec: "json",
      initial: null,
      cardinality: "one",
      identity: "note",
      picker: { reading: "notes", options: "pick" },
      url: "push",
      share: true,
      agent: "set",
    },
    selected: { role: "selection", kinds: ["note"] },
    query: {
      role: "query",
      schema: "text",
      codec: "text",
      initial: "",
      url: "replace",
      share: true,
      agent: "set",
    },
    pose: {
      role: "pose",
      schema: "pose",
      codec: "json",
      initial: { x: 0 },
      url: "replace",
      share: true,
      agent: "set",
    },
  },
  subject: { field: "note", noun: "note", roster: "notes", detail: "notes", pane: "main" },
  readings: {
    notes: {
      kind: "use",
      entry: "notes.read",
      args: "args",
      deps: { page: ["query"], work: [], readings: [] },
      demand: "visible",
      retain: { evidence: "scope", resource: "scope" },
      refresh: "explicit",
    },
    label: {
      kind: "derive",
      output: "text",
      derive: "label",
      demand: "visible",
      retain: { evidence: "scope", resource: "scope" },
      refresh: "dependencies",
      deps: { page: [], work: [], readings: ["notes"] },
    },
  },
  verbs: {},
  panes: {
    main: { label: "Note", purpose: "Read", draws: ["notes", "label"], verbs: [], body: "main" },
  },
  layout: { kind: "pane", id: "main" },
  stages: { main: { word: "Note", panes: ["main"], verbs: [] } },
  stageOrder: ["main"],
  predicates: {},
  cells: {},
  workFields: {},
  seeds: { sample: { title: "Sample", load: "seed" } },
  needs: "nothing",
  resetOnTarget: [],
  observe: [],
} as const satisfies RouteGraphJson;
const schemas = {
  subject: z
    .custom<
      import("../../../../packages/agent-contracts/src/route-kernel-page").IdentityId<"local">
    >((value) => typeof value === "string" && identityCodecs.local.decode(value).ok)
    .nullable(),
  text: z.string(),
  pose: z.object({ x: z.number() }),
};
const entries = {
  "notes.read": {
    input: z.object({ query: z.string() }),
    output: z.string(),
    axes: {
      subject: "None",
      touches: ["Metadata"],
      effect: "Read",
      cost: "Cheap",
      cardinality: "One",
    },
  },
} as const;
const source = { module: "witness.ts", export: "module" };
const bodies = {
  args: {
    slot: "readings.notes.args",
    kind: "args",
    source,
    run: (ctx) => ({ query: ctx.page.query }),
  },
  label: {
    slot: "readings.label.derive",
    kind: "derive",
    source,
    run: (ctx) => (ctx.readings.notes.current ? `Label ${ctx.readings.notes.value}` : "pending"),
  },
  pick: { slot: "fields.note.picker.options", kind: "picker", source, run: () => [] },
  main: {
    slot: "panes.main.body",
    kind: "pane",
    source,
    run: (ctx) =>
      createElement(
        "span",
        null,
        ctx.readings.label.current ? ctx.readings.label.value : "pending",
      ),
  },
  seed: {
    slot: "seeds.sample.load",
    kind: "seed",
    source,
    run: () => ({ readings: { notes: "fixture" } }),
  },
} satisfies BodyBindings<typeof data, typeof schemas, typeof entries>;
const module = {
  data,
  schemas,
  entries,
  bodies,
  identities: { local: identityCodecs.local },
  codecs: {
    text: { encode: String, decode: (value: string) => ({ ok: true as const, value }) },
    json: {
      encode: JSON.stringify,
      decode: (text: string) => {
        try {
          return { ok: true as const, value: JSON.parse(text) };
        } catch {
          return { ok: false as const, reason: "Invalid JSON" };
        }
      },
    },
  },
};
async function admitted(
  explicit = false,
  query = false,
  amendment: { data?: Record<string, unknown>; bodies?: Record<string, unknown> } = {},
) {
  const selectedModule = {
    ...module,
    schemas: { ...schemas, ids: z.object({ elementIds: z.array(z.number()) }) },
    bodies: {
      ...bodies,
      ...amendment.bodies,
      ...(query
        ? {
            queryArgs: {
              slot: "verbs.capture.args",
              kind: "args",
              source,
              run: (_ctx: unknown, input: { elementIds: number[] }) => ({
                query: input.elementIds.join(","),
              }),
            },
            main: { ...bodies.main, run: (ctx: unknown) => ctx },
          }
        : {}),
    },
    data: {
      ...data,
      ...amendment.data,
      ...(query
        ? {
            verbs: {
              capture: {
                kind: "query" as const,
                entry: "notes.read",
                args: "queryArgs",
                input: "ids",
                label: "Capture",
                review: "none" as const,
                cancellation: "scope" as const,
                deps: { page: [], work: [], readings: [] },
                captures: [],
              },
            },
            panes: { main: { ...data.panes.main, verbs: ["capture"] } },
          }
        : {}),
      readings: {
        ...data.readings,
        notes: {
          ...data.readings.notes,
          demand: explicit ? ("explicit" as const) : ("visible" as const),
        },
      },
    },
  };
  const envelope = {
    source: "builtin-closure" as const,
    version: 1 as const,
    data: selectedModule.data,
    hostVersion: "test",
    variants: [{ client: "web" as const, entry: "witness.ts" }],
    modules: [{ id: "witness.ts", sha256: "a".repeat(64) }],
    inputs: [],
    externals: [],
  };

  const fingerprint = await builtinClosureFingerprint(envelope);
  const inventory = createBuiltinRouteInventory({
    note: {
      module: selectedModule,
      closure: { envelope, fingerprint },
      catalog: [{ key: "notes.read", ...entries["notes.read"].axes, uses: [] }],
    },
  });
  const result = (await inventory.prepare("note", fingerprint)).admit(selectedModule);
  if (!result.ok) throw Error(JSON.stringify(result.diagnostics));
  return result.route;
}
function locationPort(search = "") {
  let location = { pathname: "/note", search, hash: "#main" };
  const listeners = new Set<() => void>();
  const writes: string[] = [];
  const navigate = (href: string) => {
    const url = new URL(href, "http://test");
    location = { pathname: url.pathname, search: url.search, hash: url.hash };
    listeners.forEach((listener) => listener());
  };
  const history = {
    get location() {
      return location;
    },
    push: (href: string) => {
      writes.push("push");
      navigate(href);
    },
    replace: (href: string) => {
      writes.push("replace");
      navigate(href);
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  return { address: admittedRouterAddress(history), navigate, writes, listeners };
}
function transports() {
  const frames: ((value: unknown) => void)[] = [];
  const keys: (number | string | null)[] = [];
  const releases = vi.fn();
  const unsubscribes = vi.fn();
  const services: KernelServices = {
    reads: {
      lifetime: "read",
      acquire: (request) => {
        keys.push(request.key.freshnessGeneration);
        return {
          lifetime: "read",
          key: request.key,
          release: releases,
          read: () => ({ status: "pending", current: false, reason: "Waiting" }),
        };
      },
    },
    readings: {
      lifetime: "subscription",
      subscribe: (_request, _token, deliver) => {
        frames.push(deliver as (value: unknown) => void);
        return unsubscribes;
      },
    },
    clock: { lifetime: "read", now: Date.now },
    availability: {},
  };
  return { services, frames, releases, unsubscribes, keys };
}
const ready = (value: string) => ({ status: "ready", current: true, value, hash: value });
const closes: (() => void)[] = [];
afterEach(() => {
  cleanup();
  closes.splice(0).forEach((close) => close());
});
test("composition rejects stale refresh/page frames and disposes all delivery", async () => {
  const t = transports();
  const location = locationPort("?query=restored");
  const mount = createRouteShell(t.services).mount(await admitted(), location.address);
  closes.push(mount.close);
  expect(mount.page.read().query).toBe("restored");
  const changed = vi.fn();
  mount.subscribe(changed);
  t.frames[0]!(ready("first"));
  expect(mount.read("main")).toMatchObject({ props: { children: "Label first" } });
  mount.refresh("label");
  expect(t.keys).toEqual([0, 1]);
  t.frames[1]!(ready("second"));
  t.frames[0]!(ready("stale"));
  expect(mount.read("main")).toMatchObject({ props: { children: "Label second" } });
  mount.controls.query("query", "next");
  t.frames[1]!(ready("old page"));
  expect(mount.read("main")).toMatchObject({ props: { children: "pending" } });
  t.frames[2]!(ready("new"));
  expect(mount.read("main")).toMatchObject({ props: { children: "Label new" } });
  mount.close();
  const count = changed.mock.calls.length;
  t.frames[2]!(ready("disposed"));
  expect(changed).toHaveBeenCalledTimes(count);
  expect(t.releases).toHaveBeenCalledTimes(3);
  expect(t.unsubscribes).toHaveBeenCalledTimes(3);
  expect(location.listeners.size).toBe(0);
  expect(() => mount.read("main")).toThrow(/retired/);
  expect(() => mount.refresh()).toThrow(/retired/);
});
test("URL restore couples subject/selection/pose; history honors only origin overrides", async () => {
  const location = locationPort();
  const mount = createRouteShell(transports().services).mount(
    await admitted(),
    location.address,
    () => ({ query: "memory" }),
  );
  closes.push(mount.close);
  expect(mount.page.read().query).toBe("memory");
  mount.page.pose({ pose: { x: 1 } }, "named");
  mount.page.pose({ pose: { x: 2 } }, "gesture");
  expect(location.writes).toEqual(["push", "replace"]);
  const id = identityCodecs.local.encode({ namespace: "note", subject: "A" });
  if (!id.ok) throw Error(id.reason);
  const search = new URLSearchParams({
    note: JSON.stringify(id.value),
    selected: JSON.stringify([{ kind: "note", id: id.value }]),
    query: "",
    pose: JSON.stringify({ x: 7 }),
  });
  location.navigate(`/note?${search}`);
  expect(mount.page.read()).toMatchObject({
    note: id.value,
    selected: [{ kind: "note", id: id.value }],
    query: "",
    pose: { x: 7 },
  });
  expect(location.writes).toEqual(["push", "replace"]);
});
test.each(["sample", "", "missing"])("fixture %s opens no live service", async (fixture) => {
  const t = transports();
  const acquire = vi.spyOn(t.services.reads, "acquire");
  const subscribe = vi.spyOn(t.services.readings, "subscribe");
  const mount = createRouteShell(t.services).mount(
    await admitted(),
    locationPort(`?fixture=${fixture}`).address,
  );
  closes.push(mount.close);
  expect(mount.read("main")).toMatchObject({
    props: { children: fixture === "sample" ? "Label fixture" : "pending" },
  });
  expect(acquire).not.toHaveBeenCalled();
  expect(subscribe).not.toHaveBeenCalled();
});
test("React facade owns StrictMode mount/dispose with no route callback", async () => {
  const location = locationPort("?fixture=sample");
  render(
    createElement(
      StrictMode,
      null,
      createElement(AdmittedPane, {
        shell: createRouteShell(transports().services),
        route: await admitted(),
        address: location.address,
        pane: "main",
      }),
    ),
  );
  expect(screen.getByText("Label fixture")).toBeTruthy();
  cleanup();
  expect(location.listeners.size).toBe(0);
});

test("explicit readings wait for demand and malformed live output cannot reach bodies", async () => {
  const t = transports();
  const mount = createRouteShell(t.services).mount(await admitted(true), locationPort().address);
  closes.push(mount.close);
  expect(t.frames).toHaveLength(0);
  mount.refresh("notes");
  expect(t.frames).toHaveLength(1);
  t.frames[0]!({ ...ready("bad"), value: 12 });
  expect(mount.read("main")).toMatchObject({ props: { children: "pending" } });
  t.frames[0]!(ready("valid"));
  expect(mount.read("main")).toMatchObject({ props: { children: "Label valid" } });
});
import { createFixtureWorkDoor } from "./fixture-work-door";
import type {
  WorkJournalDoor,
  WorkFeedState,
  WorkWriteOutcome,
  Observation,
} from "../../../../packages/agent-contracts/src/work-journal-door";
import type { InvocationBasis } from "../../../../packages/agent-contracts/src/route-kernel-page";

async function workRoute(
  review: "none" | "shown" = "none",
  modelWrite = false,
  needs: "nothing" | "document" = "nothing",
  presenter?: (result: unknown) => unknown,
  cellBodies = false,
) {
  const workData = {
    ...data,
    needs,
    ...(cellBodies
      ? {
          salvage: "salvage",
          cells: {
            amount: {
              segment: null,
              key: "text",
              value: "number",
              groupOf: "cellGroup",
              show: "cellShow",
              label: "cellLabel",
              focus: "cellFocus",
              take: "cellTake",
              deps: { page: ["query"], work: ["amount"], readings: ["notes"] },
            },
          },
        }
      : {}),
    capabilities: ["work", "native-write"] as const,
    work: { route: "note", schema: "work", version: 1, migrations: {} },
    ...(needs === "document" ? {} : { workSubject: "note" }),
    readings: {
      ...data.readings,
      ...(modelWrite
        ? {
            preview: {
              ...data.readings.notes,
              entry: "native.write.preview",
              args: "previewArgs",
              demand: "explicit" as const,
              deps: { page: [], work: [], readings: [] },
            },
          }
        : {}),
    },
    verbs: {
      native: {
        kind: "command" as const,
        entry: "native.write",
        intent: "native",
        ...(presenter ? { present: "nativePresent" } : {}),
        input: "number",
        label: "Native",
        review: "shown" as const,
        deps: { page: [], work: ["amount"], readings: [] },
        captures: [],
      },
      change: {
        kind: "work" as const,
        input: "number",
        label: "Change",
        review,
        deps: { page: [], work: ["amount"], readings: [] },
        captures: [],
        patches: "change",
      },
    },
    panes: { ...data.panes, main: { ...data.panes.main, verbs: ["change"] } },
  } as const;
  const workModule = {
    ...module,
    data: workData,
    entries: {
      ...entries,
      "native.write": {
        input: z.object({ amount: z.number() }),
        output: z.unknown(),
        axes: {
          ...entries["notes.read"].axes,
          effect: modelWrite ? ("ModelWrite" as const) : ("SessionWrite" as const),
        },
        ...(modelWrite ? { input: z.strictObject({ work: workHandleSchema }) } : {}),
      },
      ...(modelWrite
        ? {
            "native.write.preview": {
              input: z.strictObject({ work: workHandleSchema }),
              output: writePreviewSchema,
              axes: {
                ...entries["notes.read"].axes,
                effect: "TransactRead" as const,
                rollsBack: true,
              },
            },
          }
        : {}),
    },
    schemas: { ...schemas, work: z.object({ amount: z.number() }), number: z.number() },
    bodies: {
      ...bodies,
      ...(cellBodies
        ? {
            salvage: {
              slot: "salvage",
              kind: "salvage",
              source,
              run: (old, ctx) => {
                expect(Object.keys(ctx)).toEqual(["page", "work", "readings"]);
                return { ok: true, value: [{ path: ["amount"], value: old.amount }] };
              },
            },
            cellGroup: { slot: "cells.amount.groupOf", kind: "group", source, run: (key) => [key] },
            cellShow: {
              slot: "cells.amount.show",
              kind: "show",
              source,
              run: (value) => String(value),
            },
            cellLabel: {
              slot: "cells.amount.label",
              kind: "label",
              source,
              run: (group) => group.toUpperCase(),
            },
            cellFocus: {
              slot: "cells.amount.focus",
              kind: "focus",
              source,
              run: (key) => ({ query: key }),
            },
            cellTake: {
              slot: "cells.amount.take",
              kind: "take",
              source,
              run: (ctx) => {
                expect(Object.keys(ctx.page)).toEqual(["query"]);
                expect(Object.keys(ctx.work)).toEqual(["amount"]);
                expect(Object.keys(ctx.readings)).toEqual(["notes"]);
                return [{ path: ["amount"], value: ctx.work.amount + 1 }];
              },
            },
          }
        : {}),
      ...(presenter
        ? {
            nativePresent: {
              slot: "verbs.native.present",
              kind: "present",
              source,
              run: presenter,
            },
          }
        : {}),
      ...(modelWrite
        ? {
            previewArgs: {
              slot: "readings.preview.args",
              kind: "args",
              source,
              run: () => null,
            },
          }
        : {}),
      main: {
        ...bodies.main,
        run: (ctx: {
          history?: import("../../../../packages/agent-contracts/src/route-kernel-bodies").WorkHistoryPort;
        }) => createElement("button", { onClick: () => ctx.history!.undo() }, "Pane undo"),
      },
      native: {
        slot: "verbs.native.intent",
        kind: "intent",
        source,
        run: (ctx: { work: { amount: number } }) => (modelWrite ? {} : { amount: ctx.work.amount }),
      },
      change: {
        slot: "verbs.change.patches",
        kind: "work",
        source,
        run: (ctx: { work: { amount: number } }, input: number) => [
          { path: ["amount"] as const, value: ctx.work.amount + input },
        ],
      },
      seed: {
        ...bodies.seed,
        run: () => ({ readings: { notes: "fixture" }, work: { amount: 0 } }),
      },
    },
  } as const;
  const envelope = {
    source: "builtin-closure" as const,
    version: 1 as const,
    data: workData,
    hostVersion: "test",
    variants: [{ client: "web" as const, entry: "witness.ts" }],
    modules: [{ id: "witness.ts", sha256: "a".repeat(64) }],
    inputs: [],
    externals: [],
  };
  const fingerprint = await builtinClosureFingerprint(envelope);
  const inventory = createBuiltinRouteInventory({
    note: {
      module: workModule,
      closure: { envelope, fingerprint },
      catalog: [
        { key: "notes.read", ...entries["notes.read"].axes, uses: [] },
        { key: "native.write", ...workModule.entries["native.write"].axes, uses: [] },
        ...(modelWrite
          ? [
              {
                key: "native.write.preview",
                ...workModule.entries["native.write.preview"]!.axes,
                uses: [],
              },
            ]
          : []),
      ],
    },
  });
  const result = (await inventory.prepare("note", fingerprint)).admit(workModule);
  if (!result.ok) throw Error(JSON.stringify(result.diagnostics));
  return result.route;
}
const settle = (observation: Observation<WorkWriteOutcome>) =>
  new Promise<WorkWriteOutcome>((resolve) =>
    observation.subscribe(
      (value) => {
        if (value.kind !== "pending") resolve(value);
      },
      () => {},
    ),
  );

test.each(["ack-first", "stream-first"])(
  "Work mount composes B with %s and recovers after departure",
  async (order) => {
    const t = transports();
    const store = createFixtureWorkDoor(
      { route: "note", title: "", description: "", schema: z.object({ amount: z.number() }) },
      { amount: 0 },
    );
    let deliverStream: ((state: WorkFeedState) => void) | undefined;
    const door: WorkJournalDoor = {
      ...store,
      open: (scope) => ({
        subscribe(deliver, end) {
          return store.open(scope).subscribe((state) => {
            if (state.kind === "ack" && order === "ack-first") deliverStream = () => deliver(state);
            else deliver(state);
          }, end);
        },
      }),
    };
    const shell = createRouteShell({ ...t.services, work: door });
    const route = await workRoute();
    const mount = shell.mount(route, locationPort().address);
    expect(mount.work()?.value).toEqual({ amount: 0 });
    await settle(mount.invoke("change", 2) as Observation<WorkWriteOutcome>);
    deliverStream?.({ kind: "pending" });
    expect(mount.work()).toEqual({ revision: 1, value: { amount: 2 } });
    const pending = mount.invoke("change", 3) as Observation<WorkWriteOutcome>;
    mount.close();
    await settle(pending);
    const reopened = shell.mount(route, locationPort().address);
    closes.push(reopened.close);
    expect(reopened.work()).toEqual({ revision: 2, value: { amount: 5 } });
  },
);

test("review uses accepted Work, becomes stale on stream edit, and subject enters unloaded Work atomically", async () => {
  const t = transports();
  const store = createFixtureWorkDoor(
    { route: "note", title: "", description: "", schema: z.object({ amount: z.number() }) },
    { amount: 0 },
  );
  const route = await workRoute("shown");
  const mount = createRouteShell({ ...t.services, work: store }).mount(
    route,
    locationPort().address,
  );
  closes.push(mount.close);
  mount.invoke("change", 2);
  expect(mount.review("change")?.preview).toEqual([{ path: ["amount"], value: 2 }]);
  await settle(
    store.submitWork(
      {
        route: "note",
        key: { binding: "workspace", route: "note", target: null, work: "default" },
        target: null,
        subject: null,
      },
      {
        patches: [{ path: ["amount"], value: 9 }],
        expectedRevision: 0,
        kind: "apply",
        press: "external",
      },
      {} as InvocationBasis,
    ),
  );
  expect(mount.review("change")?.stale).toBe(true);
  expect(() => mount.confirm("change")).toThrow("stale");
  const subject = identityCodecs.local.encode({ namespace: "note", subject: "other" });
  if (!subject.ok) throw Error(subject.reason);
  const publications: unknown[] = [];
  mount.subscribe(() => publications.push({ page: mount.page.read().note, work: mount.work() }));
  expect(mount.controls.subject(subject.value).kind).toBe("accepted");
  expect(publications.length).toBeGreaterThan(0);
  expect(
    publications.every(
      (publication) =>
        (publication as { page: unknown; work: { value: { amount: number } } | null }).page !==
          subject.value ||
        (publication as { work: { value: { amount: number } } | null }).work?.value.amount !== 9,
    ),
  ).toBe(true);
});

test("fixture selection centrally isolates Work across mounts", async () => {
  const t = transports();
  const route = await workRoute();
  const shell = createRouteShell(t.services);
  const a = shell.mount(route, locationPort("?fixture=sample").address),
    b = shell.mount(route, locationPort("?fixture=sample").address);
  closes.push(a.close, b.close);
  await settle(a.invoke("change", 4) as Observation<WorkWriteOutcome>);
  expect(a.work()?.value).toEqual({ amount: 4 });
  expect(b.work()?.value).toEqual({ amount: 0 });
  await settle(b.invoke("change", 8) as Observation<WorkWriteOutcome>);
  expect(b.work()?.value).toEqual({ amount: 8 });
  expect(a.work()?.value).toEqual({ amount: 4 });
  expect(t.frames).toHaveLength(0);
});

test("mount native review submits accepted Work through the command door", async () => {
  const t = transports();
  const store = createFixtureWorkDoor(
    { route: "note", title: "", description: "", schema: z.object({ amount: z.number() }) },
    { amount: 6 },
  );
  const submit = vi.fn((command: Parameters<WorkJournalDoor["submit"]>[0]) =>
    store.submit(command),
  );
  const mount = createRouteShell({ ...t.services, work: { ...store, submit } }).mount(
    await workRoute(),
    locationPort().address,
  );
  closes.push(mount.close);
  mount.invoke("native", 0);
  expect(submit).not.toHaveBeenCalled();
  expect(mount.review("native")?.preview).toMatchObject({
    input: { amount: 6 },
    work: { revision: 0 },
  });
  mount.confirm("native");
  expect(submit).toHaveBeenCalledWith(
    expect.objectContaining({ key: "native.write", input: { amount: 6 } }),
  );
});

test("stale-base recomputes a Work verb once over the accepted revision", async () => {
  const t = transports();
  const store = createFixtureWorkDoor(
    { route: "note", title: "", description: "", schema: z.object({ amount: z.number() }) },
    { amount: 0 },
  );
  let first = true;
  const submitWork: WorkJournalDoor["submitWork"] = (scope, write, invocation) => {
    if (!first) return store.submitWork(scope, write, invocation);
    first = false;
    return {
      subscribe(deliver, end) {
        store
          .submitWork(scope, { ...write, patches: [{ path: ["amount"], value: 10 }] }, invocation)
          .subscribe(
            (value) => {
              if (value.kind !== "accepted") return;
              deliver({
                kind: "refused",
                refusal: {
                  kind: "refused",
                  code: "stale_revision",
                  revision: value.ack.revision,
                  error: "Moved",
                  hint: "Rebase",
                },
              });
              end();
            },
            () => {},
          );
        return () => {};
      },
    };
  };
  const mount = createRouteShell({ ...t.services, work: { ...store, submitWork } }).mount(
    await workRoute(),
    locationPort().address,
  );
  closes.push(mount.close);
  const outcome = await settle(mount.invoke("change", 2) as Observation<WorkWriteOutcome>);
  expect(outcome).toMatchObject({ kind: "accepted", ack: { base: 1, revision: 2 } });
  expect(mount.work()?.value).toEqual({ amount: 12 });
});

test("query validates and delivers invocation input without changing Page; new runs supersede", async () => {
  const t = transports();
  const acquire = vi.spyOn(t.services.reads, "acquire");
  const m = createRouteShell(t.services).mount(await admitted(true, true), locationPort().address);
  closes.push(m.close);
  const page = m.page.read();
  const pane = () => m.read("main") as any;
  expect(() => pane().verbs.capture({ elementIds: ["bad"] })).toThrow();
  expect(acquire).not.toHaveBeenCalled();
  const input = { elementIds: [101, 202] };
  pane().verbs.capture(input);
  input.elementIds.push(303);
  expect(acquire.mock.calls[0]![0].key.sortedKeyInput).toBe('{"query":"101,202"}');
  t.frames[0]!(ready("first"));
  expect(pane().readings.notes.value).toBe("first");
  pane().verbs.capture({ elementIds: [404] });
  expect(t.releases).toHaveBeenCalledTimes(1);
  expect(acquire.mock.calls[1]![0].key.sortedKeyInput).toBe('{"query":"404"}');
  t.frames[1]!(ready("second"));
  t.frames[0]!(ready("late"));
  expect(pane().readings.notes.value).toBe("second");
  pane().verbs.capture({ elementIds: [404] });
  expect(acquire).toHaveBeenCalledTimes(3);
  expect(t.releases).toHaveBeenCalledTimes(2);
  expect(m.page.read()).toEqual(page);
  m.controls.query("query", "changed");
  t.frames[2]!(ready("departed"));
  expect(pane().readings.notes.current).toBe(false);
  expect(acquire).toHaveBeenCalledTimes(3);
});

import { workHandleSchema, writePreviewSchema, type WorkHandle } from "@pe/agent-contracts";
const sealedPreview = (handle: WorkHandle) => ({
  previewOnly: true,
  derivedRequest: { amount: 7 },
  seal: { requestHash: "sealed", work: { handle }, incarnation: {}, dependencies: "deps" },
  takenAt: "2026-11-03T00:00:00Z",
  response: { changes: [{ kind: "Parameter", key: "amount", before: 6, after: 7 }] },
});
async function nativeFixture(presenter?: (result: unknown) => unknown) {
  const t = transports();
  const store = createFixtureWorkDoor(
    { route: "note", title: "", description: "", schema: z.object({ amount: z.number() }) },
    { amount: 6 },
  );
  const submit = vi.fn((command: Parameters<WorkJournalDoor["submit"]>[0]) =>
    store.submit(command),
  );
  const acquire = vi.spyOn(t.services.reads, "acquire");
  const mount = createRouteShell({ ...t.services, work: { ...store, submit } }).mount(
    await workRoute("none", true, "nothing", presenter),
    locationPort().address,
  );
  closes.push(mount.close);
  const preview = () => {
    const index = acquire.mock.calls.findLastIndex(
      ([request]) => request.key.op === "native.write.preview",
    );
    const input = JSON.parse(acquire.mock.calls[index]![0].key.sortedKeyInput);
    return {
      input,
      deliver: (handle = input.work) =>
        t.frames[index]!({
          status: "ready",
          current: true,
          hash: "seal",
          value: sealedPreview(handle),
        }),
    };
  };
  return { ...t, mount, submit, acquire, preview };
}
test("ModelWrite waits for sealed preview, reviews old-to-new, and submits accepted handle rather than draft", async () => {
  const f = await nativeFixture();
  await settle(f.mount.invoke("change", 1) as Observation<WorkWriteOutcome>);
  expect(f.mount.invoke("native", 999)).toEqual({ kind: "preview" });
  expect(f.mount.review("native")).toBeNull();
  expect(() => f.mount.confirm("native")).toThrow("No review");
  expect(f.submit).not.toHaveBeenCalled();
  const p = f.preview();
  expect(p.input).toEqual({
    work: {
      key: { binding: "workspace", route: "note", target: null, work: "default" },
      revision: 1,
    },
  });
  p.deliver();
  expect(f.mount.review("native")).toMatchObject({
    stale: false,
    preview: { previewOnly: true },
    rows: ["Parameter amount: 6 \u2192 7"],
  });
  f.mount.confirm("native");
  expect(f.submit).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ key: "native.write", input: p.input }),
  );
});
test.each(["during-preview", "after-review"])(
  "Work changes %s refuse stale review without re-deriving",
  async (when) => {
    const f = await nativeFixture();
    f.mount.invoke("native", 0);
    const p = f.preview();
    if (when === "after-review") p.deliver();
    await settle(f.mount.invoke("change", 2) as Observation<WorkWriteOutcome>);
    p.deliver();
    expect(() => f.mount.confirm("native")).toThrow(
      when === "after-review" ? "stale" : "No review",
    );
    expect(f.submit).not.toHaveBeenCalled();
    expect(f.acquire.mock.calls.filter(([r]) => r.key.op === "native.write.preview")).toHaveLength(
      1,
    );
    f.mount.invoke("native", 0);
    const next = f.preview();
    expect(next.input.work.revision).toBe(1);
    next.deliver();
    f.mount.confirm("native");
    expect(f.submit).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ input: next.input }),
    );
  },
);
test("a preview for another Work revision never becomes a review", async () => {
  const f = await nativeFixture();
  f.mount.invoke("native", 0);
  const p = f.preview();
  expect(() => p.deliver({ ...p.input.work, revision: 91 })).toThrow("different Work handle");
  expect(f.mount.review("native")).toBeNull();
  expect(f.submit).not.toHaveBeenCalled();
});

import * as actionClient from "../../../../packages/mcps/src/shared/takeoff-action-client";
import { actionReceiptSchema } from "@pe/agent-contracts";
import { sourceRouteServices } from "./source-route-services";
test("shared preview transport renders before-to-after review and commits identical Work through the door", async () => {
  const previewCall = vi.spyOn(actionClient, "submitAction").mockImplementation(async (admission) =>
    actionReceiptSchema.parse({
      ...admission,
      state: "succeeded",
      caller: { kind: "human", via: "local" },
      basis: null,
      steps: [],
      prepared: { state: "ready", value: null },
      recovery: [],
      result: sealedPreview((admission.input as { work: WorkHandle }).work),
      startedAt: "2026-11-03T00:00:00Z",
    }),
  );
  try {
    const store = createFixtureWorkDoor(
      { route: "note", title: "", description: "", schema: z.object({ amount: z.number() }) },
      { amount: 6 },
    );
    const submit = vi.fn((command: Parameters<WorkJournalDoor["submit"]>[0]) =>
      store.submit(command),
    );
    const shell = createRouteShell({ ...sourceRouteServices({}), work: { ...store, submit } });
    const mounted = vi.spyOn(shell, "mount");
    render(
      createElement(AdmittedPane, {
        shell,
        route: await workRoute("none", true, "nothing", () => ({
          sentence: "Review table",
          rows: ["Parameter amount: 6 \u2192 7"],
        })),
        address: locationPort().address,
        pane: "main",
      }),
    );
    const mount = mounted.mock.results[0]!.value;
    act(() => {
      mount.invoke("native", 1234);
    });
    await screen.findByText("Parameter amount: 6 \u2192 7");
    expect(screen.getByText("Review table")).toBeTruthy();
    expect(previewCall).toHaveBeenCalledTimes(1);
    expect(submit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Commit native" }));
    expect(submit).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        key: "native.write",
        input: previewCall.mock.calls[0]![0].input,
      }),
    );
  } finally {
    previewCall.mockRestore();
  }
});

import {
  builtinData,
  schemas as fixtureSchemas,
  entries as fixtureEntries,
} from "../../../../packages/agent-contracts/src/route-kernel.fixtures";
const nativeEntries = {
  ...fixtureEntries,
  apply: {
    ...fixtureEntries.apply,
    input: z.strictObject({ work: workHandleSchema }),
  },
};
type NativeIntent = BodyBindings<
  typeof builtinData,
  typeof fixtureSchemas,
  typeof nativeEntries
>["apply"]["run"];
const acceptedWorkIntent: NativeIntent = () => ({});
// @ts-expect-error Work identity belongs to B and cannot come from a route intent body.
const forgedWorkIntent: NativeIntent = () => ({ work: { key: {}, revision: 99 } });
test("typed native intent leaves accepted Work binding to the mount", () => {
  expect(acceptedWorkIntent).toBeTypeOf("function");
  expect(forgedWorkIntent).toBeTypeOf("function");
});

import { testConsents } from "../../../host/tests/effect-test";
import type { ConsentEvent } from "../../../host/src/run-consent";
import { createWorkFeedClient } from "./work-feed-client";
test.each(["reject", "timeout"])(
  "mounted native submission follows real consent owner: %s",
  async (decision) => {
    const f = await nativeFixture();
    vi.useFakeTimers();
    const run = { thread: "u8n", turn: decision };
    const events: ConsentEvent[] = [];
    const runs = testConsents((_, event) => events.push(event));
    runs.open(run);
    let applied = 0;
    const client = createWorkFeedClient(undefined, {
      write: async () => {
        throw Error("Not a Work write");
      },
      submit: async (admission) => {
        await runs.authorize(
          {
            caller: { kind: "pea", context: "fixture", thread: run.thread, run, root: run },
            run,
            root: run,
          },
          admission.id,
          [{ kind: "file", path: "C:/fixture/native.json" }],
        );
        applied++;
        return actionReceiptSchema.parse({
          ...admission,
          state: "succeeded",
          caller: { kind: "human", via: "local" },
          basis: null,
          steps: [],
          prepared: { state: "ready", value: null },
          recovery: [],
          result: {},
          startedAt: "2026-11-03T00:00:00Z",
        });
      },
    });
    f.submit.mockImplementation((command) => client.submit(command));
    try {
      f.mount.invoke("native", 0);
      f.preview().deliver();
      const submission = f.mount.confirm("native") as ReturnType<WorkJournalDoor["submit"]>;
      await vi.advanceTimersByTimeAsync(0);
      expect(applied).toBe(0);
      const request = events.find((event) => event.kind === "permission_request");
      if (!request || request.kind !== "permission_request") throw Error("Consent window missing");
      if (decision === "reject") {
        expect(runs.decide(run.thread, request.requestId, "stop_writes")).toBe(true);
        await vi.advanceTimersByTimeAsync(60_000);
      } else {
        await vi.advanceTimersByTimeAsync(59_999);
        expect(applied).toBe(0);
        await vi.advanceTimersByTimeAsync(1);
      }
      expect(applied).toBe(decision === "timeout" ? 1 : 0);
      let outcome: unknown;
      submission.accepted.subscribe(
        (value) => {
          outcome = value;
        },
        () => {},
      );
      expect(outcome).toMatchObject({
        kind: decision === "timeout" ? "accepted-native" : "rejected",
      });
    } finally {
      runs.closeAll();
      vi.useRealTimers();
    }
  },
);

async function historyFixture(pea = false) {
  const t = transports();
  const store = createFixtureWorkDoor(
    { route: "note", title: "", description: "", schema: z.object({ amount: z.number() }) },
    { amount: 0 },
  );
  const acks: import("@pe/agent-contracts").WorkWriteAck[] = [];
  const outcomes: WorkWriteOutcome[] = [];
  let stream: ((state: WorkFeedState) => void) | undefined;
  let paused = false;
  let scope: Parameters<WorkJournalDoor["open"]>[0];
  const author = (ack: import("@pe/agent-contracts").WorkWriteAck) => ({
    ...ack,
    by: pea && ack.kind === "apply" ? ("pea" as const) : ack.by,
  });
  const submitWork = vi.fn<WorkJournalDoor["submitWork"]>((key, write, invocation) => ({
    subscribe(deliver, end) {
      return store.submitWork(key, write, invocation).subscribe((outcome) => {
        outcomes.push(outcome);
        if (outcome.kind === "accepted") {
          const ack = author(outcome.ack);
          acks.push(ack);
          deliver({ kind: "accepted", ack });
        } else deliver(outcome);
      }, end);
    },
  }));
  const door: WorkJournalDoor = {
    ...store,
    submitWork,
    open(key) {
      scope = key;
      return {
        subscribe(deliver, end) {
          stream = deliver;
          return store.open(key).subscribe((state) => {
            if (state.kind === "ack") {
              if (!paused) deliver({ kind: "ack", ack: author(state.ack) });
            } else deliver(state);
          }, end);
        },
      };
    },
  };
  const route = await workRoute();
  const shell = createRouteShell({ ...t.services, work: door });
  const mount = shell.mount(route, locationPort().address);
  closes.push(mount.close);
  return {
    mount,
    shell,
    route,
    door,
    acks,
    outcomes,
    submitWork,
    pause: () => {
      paused = true;
    },
    flush: () => {
      acks.forEach((ack) => stream?.({ kind: "ack", ack }));
      paused = false;
    },
    external: async (amount: number) =>
      settle(
        submitWork(
          scope!,
          {
            kind: "apply",
            press: "external",
            expectedRevision: acks.at(-1)?.revision ?? 0,
            patches: [{ path: ["amount"], value: amount }],
          },
          {} as Parameters<WorkJournalDoor["submitWork"]>[2],
        ),
      ),
  };
}

test("admitted Work undo/redo crosses the door with restoreOf and declared labels", async () => {
  const f = await historyFixture();
  await settle(f.mount.invoke("change", 2) as Observation<WorkWriteOutcome>);
  expect(f.mount.journal()?.moves.at(-1)?.label).toBe("Change");
  expect(await f.mount.history!.undo()).toMatchObject({ ok: true });
  expect(f.mount.work()).toEqual({ revision: 2, value: { amount: 0 } });
  expect(f.submitWork.mock.calls.at(-1)?.[1]).toMatchObject({
    kind: "restore",
    restoreOf: 1,
    expectedRevision: 1,
  });
  expect(await f.mount.history!.redo()).toMatchObject({ ok: true });
  expect(f.mount.work()).toEqual({ revision: 3, value: { amount: 2 } });
  expect(f.mount.journal()?.moves.map((m) => [m.kind, m.label])).toEqual([
    ["apply", "Change"],
    ["undo", "Change"],
    ["redo", "Change"],
  ]);
});

test("admitted mount undoes Pea's accepted feed step", async () => {
  const f = await historyFixture(true);
  await f.external(7);
  expect(f.mount.journal()?.undo.at(-1)?.by).toBe("pea");
  expect(await f.mount.history!.undo()).toMatchObject({ ok: true });
  expect(f.mount.work()?.value).toEqual({ amount: 0 });
});

test("Revert appends an inverse step and undo restores the reverted value", async () => {
  const f = await historyFixture();
  await settle(f.mount.invoke("change", 5) as Observation<WorkWriteOutcome>);
  expect(await f.mount.history!.revert()).toMatchObject({ ok: true });
  expect(f.mount.work()?.value).toEqual({ amount: 0 });
  expect(f.mount.journal()?.undo.map((s) => s.label)).toEqual(["Change", "Revert Change"]);
  expect(f.mount.journal()?.moves.at(-1)?.label).toBe("Revert Change");
  expect(await f.mount.history!.undo()).toMatchObject({ ok: true });
  expect(f.mount.work()?.value).toEqual({ amount: 5 });
});

test("undo refuses the door's stale base after a concurrent write without retrying", async () => {
  const f = await historyFixture();
  await settle(f.mount.invoke("change", 5) as Observation<WorkWriteOutcome>);
  f.pause();
  await f.external(9);
  const before = f.submitWork.mock.calls.length;
  expect(await f.mount.history!.undo()).toMatchObject({ ok: false, code: "write-refused" });
  expect(f.submitWork.mock.calls).toHaveLength(before + 1);
  expect(f.submitWork.mock.calls.at(-1)?.[1].expectedRevision).toBe(1);
  expect(f.outcomes.at(-1)).toMatchObject({
    kind: "refused",
    refusal: { code: "stale_revision", revision: 2 },
  });
  expect(f.mount.journalRefusal()).toBeTruthy();
  f.flush();
  expect(f.mount.journalRefusal()).toBeNull();
  expect(f.mount.work()).toEqual({ revision: 2, value: { amount: 9 } });
  expect(await f.mount.history!.undo(f.acks[0]!.press!)).toMatchObject({
    ok: false,
    code: "entry-changed",
  });
});

test("a departed mount recovers undo history solely from open's feed", async () => {
  const f = await historyFixture();
  await settle(f.mount.invoke("change", 6) as Observation<WorkWriteOutcome>);
  f.mount.close();
  // A new shell has no retained journal or submit callback. Snapshot then replay owns recovery.
  const door: WorkJournalDoor = {
    ...f.door,
    open: (scope) => ({
      subscribe(deliver) {
        deliver({ kind: "ready", snapshot: { key: scope.key, revision: 1, value: { amount: 6 } } });
        for (const ack of f.acks) deliver({ kind: "ack", ack });
        return () => {};
      },
    }),
  };
  const mount = createRouteShell({ ...transports().services, work: door }).mount(
    f.route,
    locationPort().address,
  );
  closes.push(mount.close);
  expect(mount.journal()?.undo).toHaveLength(1);
  expect(await mount.history!.undo()).toMatchObject({ ok: true });
  expect(mount.work()?.value).toEqual({ amount: 0 });
});

test("shared shell buttons expose Work undo and redo without route callbacks", async () => {
  const f = await historyFixture();
  const { JournalButtons } = await import("./situation-band");
  render(
    createElement(
      "div",
      null,
      createElement(JournalButtons, { owner: f.mount, words: true }),
      f.mount.read("main") as import("react").ReactNode,
    ),
  );
  await act(async () => {
    await settle(f.mount.invoke("change", 4) as Observation<WorkWriteOutcome>);
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Undo Change" }));
  });
  expect(f.mount.work()?.value).toEqual({ amount: 0 });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Redo Change" }));
  });
  expect(f.mount.work()?.value).toEqual({ amount: 4 });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Pane undo" }));
  });
  expect(f.mount.work()?.value).toEqual({ amount: 0 });
});

test("transition adjusts and refuses through the Page port, with current projected evidence", async () => {
  const run = vi.fn((current, patch, origin, ctx) => {
    expect(Object.keys(ctx.page)).toEqual(["query"]);
    expect(Object.keys(ctx.work)).toEqual([]);
    expect(Object.keys(ctx.readings)).toEqual(["notes"]);
    expect(ctx.readings.notes.current).toBe(true);
    expect(Object.isFrozen(ctx.readings.notes)).toBe(true);
    if (origin.kind === "restore") return { ok: true, value: patch };
    expect(current.pose.x).toBe(0);
    return patch.pose.x < 0
      ? { ok: false, reason: "Outside scene" }
      : { ok: true, value: { pose: { x: patch.pose.x + ctx.readings.notes.value.length } } };
  });
  const route = await admitted(false, false, {
    data: {
      transition: "move",
      transitionDeps: { page: ["query"], work: [], readings: ["notes"] },
    },
    bodies: { move: { slot: "transition", kind: "transition", source, run } },
  });
  const t = transports();
  const location = locationPort();
  const mount = createRouteShell(t.services).mount(route, location.address);
  closes.push(mount.close);
  expect(mount.initialRestore.kind).toBe("refused");
  expect(mount.page.pose({ pose: { x: 2 } }, "named").kind).toBe("refused");
  expect(run).not.toHaveBeenCalled();
  t.frames.at(-1)!(ready("scene"));
  expect(mount.page.pose({ pose: { x: -1 } }, "named").kind).toBe("refused");
  expect(mount.page.read().pose).toEqual({ x: 0 });
  expect(location.writes).toEqual([]);
  expect(mount.page.pose({ pose: { x: 2 } }, "named").kind).toBe("accepted");
  expect(mount.page.read().pose).toEqual({ x: 7 });
  mount.refresh("notes");
  const calls = run.mock.calls.length;
  expect(mount.page.pose({ pose: { x: 8 } }, "named").kind).toBe("refused");
  expect(run).toHaveBeenCalledTimes(calls);
  expect(mount.page.read().pose).toEqual({ x: 7 });
});

test("transition returned patches retain role and schema checks; restore invokes it", async () => {
  let value: unknown = { query: "smuggled" };
  const run = vi.fn((_page, patch, origin) =>
    origin.kind === "restore" ? { ok: true, value: patch } : { ok: true, value },
  );
  const route = await admitted(false, false, {
    data: { transition: "move" },
    bodies: { move: { slot: "transition", kind: "transition", source, run } },
  });
  const mount = createRouteShell(transports().services).mount(route, locationPort().address);
  closes.push(mount.close);
  expect(run.mock.calls[0]![2].kind).toBe("restore");
  expect(mount.page.pose({ pose: { x: 1 } }, "named").kind).toBe("refused");
  value = { pose: { x: "invalid" } };
  expect(mount.page.pose({ pose: { x: 1 } }, "named").kind).toBe("refused");
  expect(mount.page.read().pose).toEqual({ x: 0 });
});

test("slot census refuses unsupported bodies at mount admission and invokes picker options", async () => {
  expect(admittedMountBodyKinds).toEqual([
    "args",
    "adapter",
    "derive",
    "picker",
    "ready",
    "work",
    "intent",
    "page",
    "pane",
    "seed",
    "transition",
    "predicate",
    "show",
    "subject",
    "placement",
    "present",
    "group",
    "label",
    "focus",
    "take",
    "salvage",
  ]);
  const run = vi.fn((snapshot) => (snapshot.current ? [{ id: null, label: snapshot.value }] : []));
  const route = await admitted(false, false, {
    bodies: { pick: { ...bodies.pick, run } },
  });
  const t = transports();
  const mount = createRouteShell(t.services).mount(route, locationPort().address);
  closes.push(mount.close);
  expect(run).toHaveBeenCalled();
  t.frames.at(-1)!(ready("options"));
  expect(mount.picker("note")).toEqual([{ id: null, label: "options" }]);
});

test("Page verbs also pass through transition and refuse atomically", async () => {
  const run = vi.fn(() => ({ ok: false, reason: "No Page verb" }));
  const route = await admitted(false, false, {
    data: {
      transition: "move",
      verbs: {
        edit: {
          kind: "page",
          patch: "edit",
          fields: ["query"],
          input: "text",
          label: "Edit",
          review: "none",
          deps: { page: [], work: [], readings: [] },
          captures: [],
        },
      },
    },
    bodies: {
      move: {
        slot: "transition",
        kind: "transition",
        source,
        run: (_page: unknown, patch: unknown, origin: { kind: string }) =>
          origin.kind === "restore" ? { ok: true, value: patch } : run(),
      },
      edit: { slot: "verbs.edit.patch", kind: "page", source, run: () => ({ query: "changed" }) },
    },
  });
  const mount = createRouteShell(transports().services).mount(route, locationPort().address);
  closes.push(mount.close);
  expect(mount.invoke("edit", "change")).toMatchObject({ kind: "refused" });
  expect(mount.page.read().query).toBe("");
  expect(run).toHaveBeenCalledOnce();
});

test("transition refuses a re-entrant evidence change before acceptance", async () => {
  const t = transports();
  const route = await admitted(false, false, {
    data: { transition: "move", transitionDeps: { page: [], work: [], readings: ["notes"] } },
    bodies: {
      move: {
        slot: "transition",
        kind: "transition",
        source,
        run: (_page: unknown, patch: unknown) => {
          t.frames.at(-1)!(ready("replacement"));
          return { ok: true, value: patch };
        },
      },
    },
  });
  const mount = createRouteShell(t.services).mount(route, locationPort().address);
  closes.push(mount.close);
  t.frames.at(-1)!(ready("scene"));
  expect(mount.page.pose({ pose: { x: 10 } }, "named").kind).toBe("refused");
  expect(mount.page.read().pose).toEqual({ x: 0 });
});

test("remaining slot census refuses cells, placement, presentation and migrations before acquisition", async () => {
  const empty = { page: [], work: [], readings: [] };
  const cases = [
    ...["admit"].map((key) => ({
      data: {
        cells: {
          test: {
            segment: null,
            key: "text",
            value: "text",
            groupOf: "group",
            deps: empty,
            ...(key === "groupOf" ? {} : { [key]: "unsupported" }),
          },
        },
      },
      bodies: {
        group: { slot: "cells.test.groupOf", kind: "group", source, run: () => [] },
        ...(key === "groupOf"
          ? {}
          : { unsupported: { slot: `cells.test.${key}`, kind: key, source, run: () => [] } }),
      },
    })),
    {
      data: {
        capabilities: ["work"],
        work: { route: "note", schema: "pose", version: 2, migrations: { 1: "unsupported" } },
      },
      bodies: {
        unsupported: { slot: "work.migrations.1", kind: "migration", source, run: () => ({}) },
      },
    },
  ];
  for (const amendment of cases) {
    const t = transports();
    const route = await admitted(false, false, amendment);
    expect(() => createRouteShell(t.services).mount(route, locationPort().address)).toThrow(
      /Unsupported admitted mount body slot/,
    );
    expect(t.keys).toEqual([]);
  }
});

const transitionData = {
  ...data,
  transition: "move",
  transitionDeps: { page: ["query"], work: [], readings: ["notes"] },
} as const;
export function transitionProjectionWitness(
  ctx: Parameters<
    BodyBindings<typeof transitionData, typeof schemas, typeof entries>["move"]["run"]
  >[3],
) {
  const query: string = ctx.page.query;
  const evidence = ctx.readings.notes;
  // @ts-expect-error Only transitionDeps readings are available.
  ctx.readings.label;
  // @ts-expect-error Only transitionDeps Page fields are in the evidence context.
  ctx.page.pose;
  return { query, evidence };
}

test("transition dependency references are linked at admission", async () => {
  await expect(
    admitted(false, false, {
      data: { transition: "move", transitionDeps: { page: [], work: [], readings: ["missing"] } },
      bodies: {
        move: {
          slot: "transition",
          kind: "transition",
          source,
          run: () => ({ ok: true, value: {} }),
        },
      },
    }),
  ).rejects.toThrow(/missing/);
});

import { applicationSources, applicationRouteShell } from "./application-route-shell";
import { useRouteTarget } from "../route/route-target";
vi.mock("../route/route-target", async (original) => ({
  ...(await original<typeof import("../route/route-target")>()),
  useRouteTarget: vi.fn(),
}));
const documentA = { kind: "document" as const, ref: { session: "u8x", openId: "A" } };
const documentB = { kind: "document" as const, ref: { session: "u8x", openId: "B" } };

test.each([
  ["nothing", false],
  ["document", false],
  ["document", true],
] as const)(
  "%s mount gives reads, Work and submit one captured target (ModelWrite=%s)",
  async (needs, modelWrite) => {
    const contexts: Parameters<import("./readings").UseSource["open"]>[0][] = [];
    const services = sourceRouteServices(
      {
        "native.write.preview": {
          kind: "use",
          open(context, deliver) {
            contexts.push(context);
            deliver({
              kind: "complete",
              revision: 0,
              value: sealedPreview((context.args as { work: WorkHandle }).work),
            });
          },
        },
        "notes.read": {
          kind: "use",
          open(context, deliver) {
            contexts.push(context);
            deliver({ kind: "complete", value: "note", revision: 0 });
          },
        },
      },
      { target: () => (needs === "nothing" ? { kind: "host" } : documentA) },
    );
    const store = createFixtureWorkDoor(
      { route: "note", title: "", description: "", schema: z.object({ amount: z.number() }) },
      { amount: 6 },
    );
    const open = vi.spyOn(store, "open");
    const submit = vi.fn((command: Parameters<WorkJournalDoor["submit"]>[0]) =>
      store.submit(command),
    );
    const mount = createRouteShell({ ...services, work: { ...store, submit } }).mount(
      await workRoute("none", modelWrite, needs),
      locationPort().address,
    );
    closes.push(mount.close);
    const expected = needs === "nothing" ? { kind: "host" } : documentA;
    expect(contexts[0]!.target).toEqual(expected);
    expect(contexts[0]!.attempt.target).toBe(contexts[0]!.target);
    expect(open.mock.calls[0]![0].target).toEqual(expected);
    expect(open.mock.calls[0]![0].key).toMatchObject(
      needs === "nothing"
        ? { binding: "workspace", target: null }
        : { binding: "open", open: documentA.ref },
    );
    mount.invoke("native", 0);
    mount.confirm("native");
    expect(submit.mock.calls[0]![0].target).toEqual(contexts[0]!.target);
    expect(
      contexts.every((context) => JSON.stringify(context.target) === JSON.stringify(expected)),
    ).toBe(true);
    if (modelWrite)
      expect(submit.mock.calls[0]![0].input).toEqual({
        work: {
          key: open.mock.calls[0]![0].key,
          revision: 0,
        },
      });
  },
);

test("application target change remounts once and retires the old ordinary source", async () => {
  const contexts: Parameters<import("./readings").UseSource["open"]>[0][] = [];
  const released = vi.fn();
  Object.assign(applicationSources, {
    "notes.read": {
      kind: "use",
      open(
        context: Parameters<import("./readings").UseSource["open"]>[0],
        deliver: Parameters<import("./readings").UseSource["open"]>[1],
      ) {
        contexts.push(context);
        deliver({ kind: "complete", value: "note", revision: 0 });
        return released;
      },
    },
  });
  const selected = vi.mocked(useRouteTarget);
  selected.mockReturnValue({ resolution: { kind: "resolved", target: documentA } } as ReturnType<
    typeof useRouteTarget
  >);
  const route = await admitted(false, false, { data: { needs: "document" } });
  const address = locationPort().address;
  try {
    const view = render(createElement(applicationRouteShell, { route, address, pane: "main" }));
    expect(contexts.map((c) => c.target)).toEqual([documentA]);
    view.rerender(createElement(applicationRouteShell, { route, address, pane: "main" }));
    expect(contexts).toHaveLength(1);
    selected.mockReturnValue({ resolution: { kind: "resolved", target: documentB } } as ReturnType<
      typeof useRouteTarget
    >);
    view.rerender(createElement(applicationRouteShell, { route, address, pane: "main" }));
    expect(contexts.map((c) => c.target)).toEqual([documentA, documentB]);
    expect(contexts[0]!.signal.aborted).toBe(true);
    expect(contexts[1]!.signal.aborted).toBe(false);
    await act(async () => {});
    expect(released).toHaveBeenCalledOnce();
    view.unmount();
    expect(contexts[1]!.signal.aborted).toBe(true);
  } finally {
    Reflect.deleteProperty(applicationSources, "notes.read");
  }
});

test("global predicates drive layout gates on publication and never run during draw", async () => {
  const predicate = vi.fn((ctx) => {
    expect(Object.keys(ctx)).toEqual(["page", "work", "readings"]);
    return ctx.page.query === "show" && ctx.readings.notes.current;
  });
  const route = await admitted(false, false, {
    data: {
      predicates: { allowed: "allowed" },
      layout: { kind: "gate", when: "allowed", child: data.layout },
    },
    bodies: { allowed: { slot: "predicates.allowed", kind: "predicate", source, run: predicate } },
  });
  const t = transports(),
    mount = createRouteShell(t.services).mount(route, locationPort().address);
  closes.push(mount.close);
  expect(mount.read("main")).toBeNull();
  mount.controls.query("query", "show");
  t.frames.at(-1)!(ready("yes"));
  expect(mount.visible("main")).toBe(true);
  const calls = predicate.mock.calls.length;
  mount.read("main");
  mount.read("main");
  expect(predicate).toHaveBeenCalledTimes(calls);
  mount.controls.query("query", "hide");
  expect(mount.read("main")).toBeNull();
});

test("subject display receives only subject and is cached outside draw", async () => {
  const show = vi.fn((value) => (value === null ? "No note" : String(value)));
  const route = await admitted(false, false, {
    data: { subject: { ...data.subject, show: "show" } },
    bodies: { show: { slot: "subject.show", kind: "show", source, run: show } },
  });
  const mount = createRouteShell(transports().services).mount(route, locationPort().address);
  closes.push(mount.close);
  expect(mount.subjectDisplay()).toBe("No note");
  const calls = show.mock.calls.length;
  mount.read("main");
  mount.subjectDisplay();
  expect(show).toHaveBeenCalledTimes(calls);
  expect(show.mock.calls.every((call) => call.length === 1)).toBe(true);
});

test("subject text observes global publications with validated cached output", async () => {
  const text = vi.fn((ctx) => {
    expect(Object.keys(ctx)).toEqual(["page", "work", "readings"]);
    return ctx.page.query;
  });
  const route = await admitted(false, false, {
    data: { subjectText: "text" },
    bodies: { text: { slot: "subjectText", kind: "subject", source, run: text } },
  });
  const mount = createRouteShell(transports().services).mount(route, locationPort().address);
  closes.push(mount.close);
  mount.controls.query("query", "changed");
  expect(mount.subjectText()).toBe("changed");
  const calls = text.mock.calls.length;
  mount.read("main");
  mount.subjectText();
  expect(text).toHaveBeenCalledTimes(calls);
});

test("row placement uses shared query dispatch with captured input and refuses outside allowed union", async () => {
  const choose = vi.fn((row) => [row]);
  const route = await admitted(true, true);
  // amend the query witness's placement through a fresh admission below
  const rowRoute = await admitted(false, false, {
    data: {
      ...route.data,
      panes: {
        main: {
          ...route.data.panes.main,
          verbs: { row: "text", allowed: ["capture"], choose: "choose" },
        },
      },
    },
    bodies: {
      main: { ...bodies.main, run: (ctx) => ctx.place("capture", { elementIds: [1] }) },
      queryArgs: {
        slot: "verbs.capture.args",
        kind: "args",
        source,
        run: (_ctx, input) => ({ query: input.elementIds.join(",") }),
      },
      choose: { slot: "panes.main.verbs.choose", kind: "placement", source, run: choose },
    },
  });
  const t = transports();
  const acquire = vi.spyOn(t.services.reads, "acquire");
  const mount = createRouteShell(t.services).mount(rowRoute, locationPort().address);
  closes.push(mount.close);
  const input = { elementIds: [42] },
    verbs = mount.place("main", "capture", input);
  input.elementIds[0] = 99;
  verbs.capture!();
  expect(acquire.mock.calls.at(-1)![0].key.sortedKeyInput).toBe(JSON.stringify({ query: "42" }));
  expect(() => mount.place("main", "outside", input)).toThrow("Undeclared pane verb");
  const calls = choose.mock.calls.length;
  expect(() => mount.read("main")).toThrow("during render");
  expect(choose).toHaveBeenCalledTimes(calls);
});

test("presenter runs once on the sealed current preview and publishes sentence/rows outside render", async () => {
  const presenter = vi.fn((result) => {
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.keys(result)).toContain("seal");
    return { sentence: "Review table", rows: ["Remove column"] };
  });
  const f = await nativeFixture(presenter);
  f.mount.invoke("native", 0);
  expect(presenter).not.toHaveBeenCalled();
  f.preview().deliver();
  expect(presenter).toHaveBeenCalledOnce();
  expect(f.mount.review("native")).toMatchObject({
    sentence: "Review table",
    rows: ["Remove column"],
    stale: false,
  });
  f.mount.read("main");
  f.mount.review("native");
  expect(presenter).toHaveBeenCalledOnce();
  await settle(f.mount.invoke("change", 1) as Observation<WorkWriteOutcome>);
  expect(f.mount.review("native")?.stale).toBe(true);
  expect(() => f.mount.confirm("native")).toThrow("stale");
  expect(presenter).toHaveBeenCalledOnce();
});
test("invalid presenter output cannot become a review", async () => {
  const f = await nativeFixture(() => ({ sentence: 12, rows: ["bad"] }));
  f.mount.invoke("native", 0);
  expect(() => f.preview().deliver()).toThrow();
  expect(f.mount.review("native")).toBeNull();
  expect(f.submit).not.toHaveBeenCalled();
});

import * as workHost from "../route/host";
test("cell displays, focus, take and salvage use real shared Page/Work owners", async () => {
  const t = transports(),
    store = createFixtureWorkDoor(
      { route: "note", title: "", description: "", schema: z.object({ amount: z.number() }) },
      { amount: 6 },
    );
  const mount = createRouteShell({ ...t.services, work: store }).mount(
    await workRoute("none", false, "nothing", undefined, true),
    locationPort().address,
  );
  closes.push(mount.close);
  expect(mount.cells().amount).toEqual([
    { key: "amount", group: ["amount"], labels: ["AMOUNT"], text: "6" },
  ]);
  expect(() => mount.takeCell("amount", "amount")).toThrow("Reading unavailable");
  expect(mount.focusCell("amount", "amount").kind).toBe("accepted");
  expect(mount.page.read().query).toBe("amount");
  t.frames.at(-1)!(ready("notes"));
  await settle(mount.takeCell("amount", "amount"));
  expect(mount.work()?.value).toEqual({ amount: 7 });
  expect(mount.cells().amount![0]!.text).toBe("7");
  const saved = vi
    .spyOn(workHost, "salvageRouteWork")
    .mockResolvedValue({ from: "old", value: { amount: 12 } });
  try {
    await mount.salvage();
    expect(mount.work()?.value).toEqual({ amount: 7 });
    await settle(mount.confirm("work.salvage") as Observation<WorkWriteOutcome>);
    expect(mount.work()?.value).toEqual({ amount: 12 });
  } finally {
    saved.mockRestore();
  }
});

test("presentation without sealed preview stays explicitly refused until result landing", async()=>{
 const route=await workRoute("none",false,"nothing",()=>"result");const t=transports();expect(()=>createRouteShell(t.services).mount(route,locationPort().address)).toThrow("requires a sealed preview");expect(t.keys).toEqual([]);
});
