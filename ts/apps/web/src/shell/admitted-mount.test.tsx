// @vitest-environment jsdom
import { createElement, StrictMode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
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
import { createRouteShell } from "./admitted-mount";
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
async function admitted(explicit = false, query = false) {
  const selectedModule = {
    ...module,
    schemas: { ...schemas, ids: z.object({ elementIds: z.array(z.number()) }) },
    bodies: {
      ...bodies,
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

async function workRoute(review: "none" | "shown" = "none") {
  const workData = {
    ...data,
    capabilities: ["work", "native-write"] as const,
    work: { route: "note", schema: "work", version: 1, migrations: {} },
    workSubject: "note",
    verbs: {
      native: {
        kind: "command" as const,
        entry: "native.write",
        intent: "native",
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
        axes: { ...entries["notes.read"].axes, effect: "SessionWrite" as const },
      },
    },
    schemas: { ...schemas, work: z.object({ amount: z.number() }), number: z.number() },
    bodies: {
      ...bodies,
      main: { ...bodies.main, run: () => null },
      native: {
        slot: "verbs.native.intent",
        kind: "intent",
        source,
        run: (ctx: { work: { amount: number } }) => ({ amount: ctx.work.amount }),
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
