import { placeInput } from "./typed-place.test-support";

import { draftCellSchema, actionReceiptSchema, memberWork } from "@pe/agent-contracts";
// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup } from "@testing-library/react";
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
import { createRouteShell, PlaceWriteRefusal } from "./admitted-mount";
import { createAdmittedWork } from "./admitted-work";
import { createRouteScopeGate } from "../../../../packages/runtime/src/route-scope-gate";
import { createWorkJournal } from "../../../../packages/runtime/src/work-journal";

import { admittedRouterAddress } from "./typed-place-boundary";

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
  amendment: {
    data?: Record<string, unknown>;
    bodies?: Record<string, unknown>;
    schemas?: Record<string, z.ZodType>;
    sources?: Record<string, unknown>;
    landing?: boolean;
    queryFromPage?: boolean;
  } = {},
) {
  const selectedModule = {
    ...module,
    sources: amendment.sources ?? {},
    schemas: {
      ...schemas,
      ids: z.object({ elementIds: z.array(z.number()) }),
      ...amendment.schemas,
    },
    bodies: {
      ...bodies,
      ...amendment.bodies,
      ...(query
        ? {
            queryArgs: {
              slot: "verbs.capture.args",
              kind: "args",
              source,
              run: (ctx: { page: { query?: string } }, input: { elementIds: number[] }) => ({
                query: `${input.elementIds.join(",")}${amendment.queryFromPage ? ctx.page.query : ""}`,
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
                ...(amendment.landing ? { lands: "landQuery" } : {}),
                deps: { page: amendment.queryFromPage ? ["query"] : [], work: [], readings: [] },
                captures: [],
              },
            },
            panes: { main: { ...data.panes.main, verbs: ["capture"] } },
          }
        : {}),
      readings: {
        ...data.readings,
        ...((amendment.data?.readings ?? {}) as typeof data.readings),
        notes: {
          ...((amendment.data?.readings as typeof data.readings | undefined)?.notes ??
            data.readings.notes),
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
  closes
    .splice(0)
    .reverse()
    .forEach((close) => close());
});




test("a move renders even though its URL push leaves custody stale until the router re-renders", async () => {
  const location = locationPort();
  let current = true;
  const address = {
    ...location.address,
    write: (...args: Parameters<typeof location.address.write>) => {
      location.address.write(...args);
      current = false; // a retained route's custody lags its own history entry
    },
  };
  const mount = createRouteShell(transports().services).mount(
    await admitted(),
    placeInput(address, { custody: { current: () => current } }),
  );
  closes.push(mount.close);
  const before = mount.revision();
  mount.page.pose({ pose: { x: 1 } }, "named");
  expect(location.writes).toEqual(["push"]);
  expect(mount.revision()).toBeGreaterThan(before);
});



test("explicit readings wait for demand and malformed live output cannot reach bodies", async () => {
  const t = transports();
  const mount = createRouteShell(t.services).mount(
    await admitted(true),
    placeInput(locationPort().address),
  );
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
import { RouteWorkspace, observeResources } from "@pe/runtime";
import type {
  WorkJournalDoor,
  WorkFeedState,
  WorkWriteOutcome,
  Observation,
} from "../../../../packages/agent-contracts/src/work-journal-door";


async function workRoute(
  review: "none" | "shown" = "none",
  modelWrite = false,
  needs: "nothing" | "document" = "nothing",
  presenter?: (result: unknown, evidence: unknown) => unknown,
  cellBodies: false | true | "draft" = false,
  landing?: {
    run: (result: unknown, page: unknown) => unknown;
    output: z.ZodType;
    pane?: (ctx: unknown) => unknown;
    row?: boolean;
  },
  readingWork = false,
) {
  const workData = {
    ...data,
    needs,
    ...(cellBodies
      ? ({
          cells: {
            amount: {
              segment: null,
              key: "text",
              value: "number",
              groupOf: "cellGroup",
              ...(cellBodies === "draft" ? {} : { show: "cellShow" }),
              label: "cellLabel",
              focus: "cellFocus",
              deps: {
                page: ["query"],
                work: cellBodies === "draft" ? [] : ["amount"],
                readings: ["notes"],
              },
            },
          },
        } as const)
      : {}),
    capabilities: ["work", "native-write"] as const,
    work: { route: "note", schema: "work", version: 1, migrations: {} },
    workFields: { amount: { label: "amount", internal: false } },
    ...(needs === "document" ? {} : { workSubject: "note" }),
    readings: {
      ...data.readings,
      ...(readingWork
        ? {
            notes: {
              ...data.readings.notes,
              deps: { page: ["query"], work: ["amount"], readings: [] },
            },
          }
        : {}),
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
        ...(landing ? { lands: "landNative" } : {}),
        ...(presenter ? { present: "nativePresent" as const } : {}),
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
    panes: {
      ...data.panes,
      main: {
        ...data.panes.main,
        verbs: landing?.row
          ? { choose: "chooseChange", allowed: ["change"], row: "number" }
          : ["change"],
      },
    },
  } as const;
  const workModule = {
    ...module,
    data: workData,
    entries: {
      ...entries,
      "native.write": {
        input: z.object({ amount: z.number() }),
        output: landing?.output ?? z.unknown(),
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
    schemas: {
      ...schemas,
      work: z.object({ amount: cellBodies === "draft" ? draftCellSchema(z.number()) : z.number() }),
      number: z.number(),
    },
    bodies: {
      ...bodies,
      ...(readingWork
        ? {
            args: {
              ...bodies.args,
              run: ({ page, work }: { page: { query: string }; work: { amount: number } }) => ({
                query: `${page.query}:${work.amount}`,
              }),
            },
          }
        : {}),
      ...(landing?.row
        ? {
            chooseChange: {
              slot: "panes.main.verbs.choose",
              kind: "placement",
              source,
              run: () => ["change"],
            },
          }
        : {}),
      ...(landing
        ? { landNative: { slot: "verbs.native.lands", kind: "lands", source, run: landing.run } }
        : {}),
      ...(cellBodies
        ? {
            cellGroup: {
              slot: "cells.amount.groupOf",
              kind: "group",
              source,
              run: (key: string) => [key],
            },
            ...(cellBodies === "draft"
              ? {}
              : {
                  cellShow: {
                    slot: "cells.amount.show",
                    kind: "show",
                    source,
                    run: (value: number) => String(value),
                  },
                }),
            cellLabel: {
              slot: "cells.amount.label",
              kind: "label",
              source,
              run: (group: string) => group.toUpperCase(),
            },
            cellFocus: {
              slot: "cells.amount.focus",
              kind: "focus",
              source,
              run: (key: string) => ({ query: key }),
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
        run:
          landing?.pane ??
          ((ctx: {
            history?: import("../../../../packages/agent-contracts/src/route-kernel-bodies").WorkHistoryPort;
          }) => createElement("button", { onClick: () => ctx.history!.undo() }, "Pane undo")),
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
  const result = (await inventory.prepare("note", fingerprint)).admitUnknown(workModule);
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

test("fixture Page defaults select canonical member Work before acquisition and survive address restores", async () => {
  const pages: Record<string, unknown> = { sample: { pod: "test-pod", path: "settings/a.json", selected: "all" }, alternate: { pod: "other-pod", path: "settings/b.json" } };
  const make = async () => admitted(false, false, {
    schemas: { work: z.object({ amount: z.number() }) },
    data: {
      capabilities: ["work"], work: { route: "note", schema: "work", version: 1, migrations: {} }, workSubject: "note",
      fields: { ...data.fields, selected: { ...data.fields.selected, allowAll: true }, pod: data.fields.query, path: data.fields.query },
      transition: "deriveMember", transitionDeps: { page: [], work: [], readings: [] },
      seeds: { ...data.seeds, alternate: { title: "Alternate", load: "alternateSeed" } },
    },
    bodies: {
      seed: { ...bodies.seed, run: () => ({ page: pages.sample, readings: { notes: "fixture" }, work: { amount: 0 } }) },
      alternateSeed: { ...bodies.seed, slot: "seeds.alternate.load", run: () => ({ page: pages.alternate, readings: { notes: "fixture" }, work: { amount: 0 } }) },
      deriveMember: { slot: "transition", kind: "transition", source, run: (current: Record<string, unknown>, patch: Record<string, unknown>) => {
        const next = { ...current, ...patch };
        const member = next.pod && next.path ? memberWork({ pod: String(next.pod), path: String(next.path) }) : "default";
        const encoded = identityCodecs.local.encode({ namespace: "pods", subject: member });
        if (!encoded.ok) return encoded;
        return { ok: true, value: { ...patch, note: encoded.value } };
      } },
    },
  });
  const route = await make();
  const shell = createRouteShell(transports().services);
  const open = (query: string, memory = {}) => {
    const location = locationPort(query);
    const mount = shell.mount(route, placeInput(location.address, { memory: () => memory }));
    closes.push(mount.close);
    return { mount, location };
  };
  const first = open("?fixture=sample");
  await vi.waitFor(() => expect(first.mount.work()?.handle.key).toMatchObject({ binding: "workspace", work: "member:@test-pod/settings/a.json" }));
  expect(first.mount.page.read()).toMatchObject({ pod: "test-pod", selected: "all" });
  first.mount.restore();
  expect(first.mount.page.read()).toMatchObject({ pod: "test-pod", selected: "all" });
  const alternate = open("?fixture=alternate");
  expect(alternate.mount.page.read()).toMatchObject({ pod: "other-pod", path: "settings/b.json" });
  const empty = open("?fixture=sample&pod=&path=", { pod: "memory-pod", path: "memory.json" });
  await vi.waitFor(() => expect(empty.mount.work()?.handle.key).toMatchObject({ work: "default" }));
  expect(empty.mount.page.read()).toMatchObject({ pod: "", path: "" });
  const memory = open("?fixture=sample&path=url.json", { pod: "memory-pod", path: "memory.json" });
  expect(memory.mount.page.read()).toMatchObject({ pod: "memory-pod", path: "url.json" });
  for (const bad of [null, [], "bad", { unknown: "bad" }, { pod: 42 }, { pose: { x: "bad" } }, { pod: "test", device: "bad" }]) {
    pages.sample = bad;
    const invalid = await make();
    expect(() => shell.mount(invalid, placeInput(locationPort("?fixture=sample").address))).toThrow();
  }
});



test("D4: a new writer at either shared Work submission path cannot bypass Place authority", async () => {
  const route = await workRoute();
  const key = { binding: "workspace", route: "note", target: null, work: "default" } as const;
  const owner = createRouteScopeGate({
    dependencies: () => ({}),
    preparePage: (page) => ({
      ok: true,
      value: { page, changed: false, membership: "verified" },
    }),
    workSchema: z.object({ amount: z.number() }),
    hashWork: JSON.stringify,
    journal: createWorkJournal,
  });
  owner.enter({ target: null, work: key }, { note: null, selected: [], query: "", pose: { x: 0 } });
  const store = createFixtureWorkDoor(
    { route: "note", title: "", description: "", schema: z.object({ amount: z.number() }) },
    { amount: 0 },
  );
  const submitted = vi.spyOn(store, "submitWork");
  let authority: "writable" | "read-only" = "writable";
  const work = createAdmittedWork(
    route,
    owner,
    store,
    () => {
      if (authority === "read-only") throw new PlaceWriteRefusal();
    },
    () => {},
    () => {},
  );
  closes.push(work.close, owner.close);
  work.sync();
  await vi.waitFor(() => expect(work.ready()).toBe(true));
  const issued = owner.invocation(owner.capture("new-writer"), {});
  if (!issued.ok) throw Error(issued.reason);
  const request: Parameters<typeof work.submit>[0] = {
    kind: "apply",
    expectedRevision: 0,
    press: "new-writer",
    patches: [{ path: ["amount"], value: 4 }],
  };
  const write = () =>
    work.write(() => request.patches, issued.value, "new", { label: "New writer" });
  authority = "read-only";
  expect(write).toThrow(PlaceWriteRefusal);
  await expect(work.submit(request, issued.value)).rejects.toMatchObject({
    reason: "place-read-only",
  });
  expect(submitted).not.toHaveBeenCalled();
  expect(owner.read()?.work).toMatchObject({ revision: 0, value: { amount: 0 } });
  authority = "writable";
  expect(await settle(write())).toMatchObject({ kind: "accepted" });
  expect(submitted).toHaveBeenCalledTimes(1);
  expect(owner.read()?.work).toMatchObject({ revision: 1, value: { amount: 4 } });
});













import { workHandleSchema, writePreviewSchema } from "@pe/agent-contracts";








import { createWorkFeedClient } from "./work-feed-client";


async function historyFixture(pea = false) {
  const route = await workRoute();
  const disk = new Map<string, unknown>();
  const host = async () => {
    const workspace = new RouteWorkspace({
      registrations: [],
      store: {
        getState: async ({ targetKey }) =>
          structuredClone(
            disk.get(targetKey) ?? {
              version: 1,
              revision: 0,
              doc: { amount: 0 },
            },
          ),
        setState: async ({ targetKey, value }) => {
          disk.set(targetKey, structuredClone(value));
        },
      },
    });
    const registration = workspace.registerAdmitted(route);
    expect(await registration.ready).toBeNull();
    closes.push(registration.close);
    return workspace;
  };
  const workspace = await host();
  const acks: import("@pe/agent-contracts").WorkWriteAck[] = [];
  const outcomes: WorkWriteOutcome[] = [];
  const streams = new Set<(state: WorkFeedState) => void>();
  let paused = false;
  let scope: Parameters<WorkJournalDoor["open"]>[0];
  const connect = (ws: RouteWorkspace) => {
    const store = createWorkFeedClient(
      { subscribe: observeResources(ws, { observe: () => () => {} }), dirty() {} },
      {
        write: (key, write) => ws.write(key, key.route, "human", write),
        submit: async () => {
          throw Error("History never invokes native writes");
        },
      },
    );
    const submitWork = vi.fn<WorkJournalDoor["submitWork"]>((key, write, invocation) => ({
      subscribe(deliver, end) {
        return store.submitWork(key, write, invocation).subscribe((outcome) => {
          outcomes.push(outcome);
          deliver(outcome);
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
            streams.add(deliver);
            const stop = store.open(key).subscribe((state) => {
              if (state.kind === "ack") {
                acks.push(state.ack);
                if (paused) return;
              }
              deliver(state);
            }, end);
            return () => {
              streams.delete(deliver);
              stop();
            };
          },
        };
      },
    };
    return { door, submitWork };
  };
  const connected = connect(workspace);
  const shell = createRouteShell({ ...transports().services, work: connected.door });
  const mountOn = async (shell: ReturnType<typeof createRouteShell>) => {
    const mount = shell.mount(route, placeInput(locationPort().address));
    closes.push(mount.close);
    await vi.waitFor(() => expect(mount.work()).not.toBeNull());
    return mount;
  };
  const mount = await mountOn(shell);
  return {
    mount,
    shell,
    route,
    acks,
    outcomes,
    ...connected,
    second: () =>
      mountOn(createRouteShell({ ...transports().services, work: connect(workspace).door })),
    restart: async () =>
      mountOn(createRouteShell({ ...transports().services, work: connect(await host()).door })),
    failFeed: () => streams.forEach((deliver) => deliver({
      kind: "failed", failure: { kind: "failed", code: "stream.failed", message: "readings offline" },
    })),
    pause: () => {
      paused = true;
    },
    flush: () => {
      acks.forEach((ack) => streams.forEach((deliver) => deliver({ kind: "ack", ack })));
      paused = false;
    },
    external: async (amount: number) => {
      const result = await workspace.write(scope.key, "note", pea ? "pea" : "human", {
        kind: "apply",
        press: "external",
        label: "Set amount",
        expectedRevision: (await workspace.read(scope.key, "note"))!.revision,
        patches: [{ path: ["amount"], value: amount }],
      });
      if (!result.ok) throw Error(JSON.stringify(result));
      await vi.waitFor(() => expect(acks.at(-1)?.revision).toBe(result.revision));
      return result;
    },
  };
}









test("undo refuses a changed host inverse after a concurrent write without retrying", async () => {
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
    refusal: { error: "this inverse is unknown or its paths changed" },
  });
  expect(f.mount.journalRefusal()).toBeTruthy();
  f.flush();
  expect(f.mount.journalRefusal()).toBeNull();
  expect(f.mount.work()).toMatchObject({ revision: 2, value: { amount: 9 } });
  expect(await f.mount.history!.undo(f.acks[0]!.press!)).toMatchObject({
    ok: false,
    code: "entry-changed",
  });
});









test("slot census refuses unsupported bodies at mount admission and invokes picker options", async () => {
  // COMMON 3: prove refusal at the admission boundary instead of copying its kind census.
  await expect(
    admitted(false, false, { bodies: { pick: { ...bodies.pick, kind: "unsupported" } } }),
  ).rejects.toThrow(/Expected picker/);
  const identity = identityCodecs.local.encode({ namespace: "note", subject: "options" });
  if (!identity.ok) throw Error(identity.reason);
  const run = vi.fn((snapshot) =>
    snapshot.current ? [{ id: identity.value, label: snapshot.value }] : [],
  );
  const route = await admitted(false, false, {
    bodies: { pick: { ...bodies.pick, run } },
  });
  const t = transports();
  const mount = createRouteShell(t.services).mount(route, placeInput(locationPort().address));
  closes.push(mount.close);
  expect(run).toHaveBeenCalled();
  expect(mount.subjectState({})).toMatchObject({ ready: true, label: "" });
  mount.controls.subject(identity.value);
  expect(mount.subjectState({})).toMatchObject({ ready: false, label: "" });
  t.frames.at(-1)!(ready("options"));
  expect(mount.picker("note")).toEqual([{ id: identity.value, label: "options" }]);
  expect(mount.subjectState({})).toMatchObject({ ready: true, refusal: null, label: "options" });
  const old = t.frames.at(-1)!;
  mount.refresh();
  expect(mount.subjectState({})).toMatchObject({ ready: false, label: "" });
  old(ready("late old roster"));
  expect(mount.subjectState({})).toMatchObject({ ready: false, label: "" });
  t.frames.at(-1)!(ready("new roster"));
  expect(mount.subjectState({})).toMatchObject({ ready: true });
  mount.close();
  expect(mount.subjectState({})).toMatchObject({ ready: false, label: "" });
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


vi.mock("../route/route-target", async (original) => ({
  ...(await original<typeof import("../route/route-target")>()),
  useRouteTarget: vi.fn(),
}));




















test("cell displays, focus and clear refusal use real shared Page/Work owners", async () => {
  const t = transports(),
    store = createFixtureWorkDoor(
      { route: "note", title: "", description: "", schema: z.object({ amount: z.number() }) },
      { amount: 6 },
    );
  const mount = createRouteShell({ ...t.services, work: store }).mount(
    await workRoute("none", false, "nothing", undefined, true),
    placeInput(locationPort().address),
  );
  closes.push(mount.close);
  await vi.waitFor(() => expect(mount.work()).not.toBeNull());
  expect(mount.cells().amount).toEqual([
    { key: "amount", group: ["amount"], labels: ["AMOUNT"], text: "6" },
  ]);
  expect(() => mount.clearCell("amount", "amount")).toThrow("Reading unavailable");
  expect(mount.focusCell("amount", "amount").kind).toBe("accepted");
  expect(mount.page.read().query).toBe("amount");
});







async function landingFixture(
  output: z.ZodType = z.object({ name: z.string() }),
  submissionKey?: string,
) {
  const t = transports();
  const store = createFixtureWorkDoor(
    { route: "note", title: "", description: "", schema: z.object({ amount: z.number() }) },
    { amount: 0 },
  );
  let deliver: (
    result: import("../../../../packages/agent-contracts/src/work-journal-door").AcceptedResult,
  ) => void = () => {};
  let kept: import("../../../../packages/agent-contracts/src/work-journal-door").AcceptedResult = {
    kind: "pending",
  };
  let receiptFeed: (value: import("../../../../packages/agent-contracts/src/work-journal-door").ReceiptFeedState) => void = () => {};
  const land = vi.fn((result: unknown, current: unknown) => ({
    query: `${(current as { query: string }).query}${result === undefined ? "outputless" : (result as { name: string }).name}`,
  }));
  const door: WorkJournalDoor = {
    ...store,
    receipts: () => ({ subscribe(deliver) { receiptFeed = deliver; return () => {}; } }),
    submit: (command) => ({
      key: submissionKey ?? command.key,
      lifetime: "command",
      handle: {
        id: command.id as import("../../../../packages/agent-contracts/src/work-journal-door").JournalCommandId,
        lifetime: "command",
        causalParent:
          command.id as import("../../../../packages/agent-contracts/src/route-kernel-page").CausalParentId,
      },
      accepted: {
        subscribe(listener) {
          deliver = (result) => {
            kept = result;
            listener(result);
          };
          return () => {};
        },
      },
    }),
    accepted: () => kept,
  };
  const route = await workRoute("none", false, "nothing", undefined, false, { run: land, output });
  const shell = createRouteShell({ ...t.services, work: door });
  const location = locationPort();
  const mount = shell.mount(route, placeInput(location.address));
  closes.push(mount.close);
  await vi.waitFor(() => expect(mount.work()).not.toBeNull());
  mount.invoke("native", 0);
  const submission = mount.confirm("native") as ReturnType<WorkJournalDoor["submit"]>;
  return {
    shell,
    location,
    route,
    mount,
    submission,
    land,
    deliver: (result: Parameters<typeof deliver>[0]) => deliver(result),
    door,
    receiptFeed: (value: Parameters<typeof receiptFeed>[0]) => receiptFeed(value),
  };
}

test("a completed receipt never resurrects its local start when a later snapshot omits it", async () => {
  const { projectTimeline } = await import("./timeline");
  const f = await landingFixture();
  const id = f.submission.handle.id;
  const first = 1 as import("../../../../packages/agent-contracts/src/work-journal-door").ReceiptCursor;
  const next = 2 as typeof first;
  const rows = () => projectTimeline(f.mount.timeline(), f.route.data.verbs);
  expect(rows().find((row) => row.entry.press === id)?.outcome?.state).toBe("running");
  const receipt = actionReceiptSchema.parse({
    id, key: f.submission.key, state: "succeeded", result: {},
    caller: { kind: "human", via: "local" }, target: { kind: "host" }, input: {},
    basis: null, prepared: { state: "unprepared" }, steps: [], recovery: [], consumes: [],
    startedAt: "2026-11-05T08:53:19Z",
  });
  f.receiptFeed({ kind: "ready", receipts: { rows: [receipt], from: first, through: first } });
  expect(rows().filter((row) => row.outcome?.id === id)).toMatchObject([
    { kind: "receipt", outcome: { state: "succeeded" } },
  ]);
  f.receiptFeed({ kind: "ready", receipts: { rows: [], from: next, through: next } });
  expect(rows().some((row) => row.entry.press === id && row.outcome?.state === "running")).toBe(false);
});





test.each(["failed", "absent", "malformed"] as const)(
  "%s native output does not land",
  async (mode) => {
    const f = await landingFixture();
    f.deliver(
      mode === "failed"
        ? { kind: "rejected", failure: "failed", problem: "failed native write" }
        : {
            kind: "accepted-native",
            outcome: "committed",
            receiptId: "r",
            ...(mode === "malformed" ? { result: { name: 12 } } : {}),
          },
    );
    expect(f.land).not.toHaveBeenCalled();
    expect(f.mount.page.read().query).toBe("");
    if (mode !== "failed") {
      expect(f.mount.commandLanding(f.submission.handle.id)).toMatchObject({
        kind: "result-undecodable",
        key: "native.write",
      });
      expect(f.mount.commandProblems()).toHaveLength(1);
    }
  },
);

test("mount decodes by JournalSubmission.key rather than the current verb entry", async () => {
  const f = await landingFixture(undefined, "notes.read");
  f.deliver({
    kind: "accepted-native",
    outcome: "committed",
    receiptId: "r",
    result: { name: "would fit native.write" },
  });
  expect(f.land).not.toHaveBeenCalled();
  expect(f.mount.commandLanding(f.submission.handle.id)).toMatchObject({
    kind: "result-undecodable",
    key: "notes.read",
  });
});

test("mount admits absent output only when the submitted schema permits undefined", async () => {
  const f = await landingFixture(z.undefined());
  f.deliver({ kind: "accepted-native", outcome: "committed", receiptId: "r" });
  expect(f.mount.page.read().query).toBe("outputless");
  expect(f.land.mock.calls[0]![0]).toBeUndefined();
});







test("a mount never receives an admission referring to another route's Work", async () => {
  const owner = await workRoute();
  const { createAdmittedRouteRegistry, resolveRouteBindings } =
    await import("../../../../packages/agent-contracts/src/route-module");
  const registry = createAdmittedRouteRegistry();
  const registration = registry.register(owner);
  const module = {
    ...resolveRouteBindings(registry, owner)!,
    data: {
      ...owner.data,
      key: "foreign",
      address: "/foreign",
      work: { ...owner.data.work!, route: "note" },
    },
  };
  const envelope = {
    source: "builtin-closure" as const,
    version: 1 as const,
    data: module.data,
    hostVersion: "test",
    variants: [{ client: "web" as const, entry: "witness.ts" }],
    modules: [{ id: "witness.ts", sha256: "a".repeat(64) }],
    inputs: [],
    externals: [],
  };
  const fingerprint = await builtinClosureFingerprint(envelope);
  const inventory = createBuiltinRouteInventory({
    foreign: { module, closure: { envelope, fingerprint }, catalog: [] },
  });
  const result = (await inventory.prepare("foreign", fingerprint)).admitUnknown(module);
  expect(result.ok).toBe(false);
  registration.deactivate();
});

test.each(["accepted", "refused"] as const)(
  "pane Work outcome %s after departure never reaches replacement",
  async (kind) => {
    const t = transports();
    const store = createFixtureWorkDoor(
      { route: "note", title: "", description: "", schema: z.object({ amount: z.number() }) },
      { amount: 0 },
    );
    let pane: {
      workBasis: import("../../../../packages/agent-contracts/src/route-kernel-page").InvocationToken;
      verbs: { change(input: number, basis: unknown): Observation<WorkWriteOutcome> };
    };
    const route = await workRoute("none", false, "nothing", undefined, false, {
      output: z.string(),
      run: () => ({}),
      pane: (ctx) => {
        pane = ctx as typeof pane;
        return null;
      },
    });
    let finish: () => void = () => {
      throw Error("Write not submitted");
    };
    const door: WorkJournalDoor = {
      ...store,
      submitWork: (scope, write, invocation) => ({
        subscribe(deliver, end) {
          finish = () => {
            if (kind === "accepted")
              store.submitWork(scope, write, invocation).subscribe(deliver, end);
            else {
              deliver({
                kind: "refused",
                refusal: {
                  kind: "refused",
                  code: "stale_revision",
                  error: "Old subject stale",
                  hint: "Refresh",
                  revision: 7,
                },
              });
              end();
            }
          };
          return () => {};
        },
      }),
    };
    const mount = createRouteShell({ ...t.services, work: door }).mount(
      route,
      placeInput(locationPort().address),
    );
    closes.push(mount.close);
    await vi.waitFor(() => expect(mount.work()).not.toBeNull());
    mount.read("main");
    const outcome = pane!.verbs.change(2, pane!.workBasis);
    await Promise.resolve();
    const next = identityCodecs.local.encode({ namespace: "note", subject: "replacement" });
    if (!next.ok) throw Error(next.reason);
    mount.controls.subject(next.value);
    await vi.waitFor(() =>
      expect(mount.work()).toMatchObject({
        handle: { key: { work: "replacement" } },
        revision: 0,
        value: { amount: 0 },
      }),
    );
    mount.read("main");
    const replacement = mount.work();
    const changed = vi.fn();
    const stop = mount.subscribe(changed);
    finish();
    expect((await settle(outcome)).kind).toBe(kind);
    expect(mount.work()).toEqual(replacement);
    expect(mount.workProblem()).toBeNull();
    expect(changed).not.toHaveBeenCalled();
    stop();
  },
);























test("a null Place target refuses Work through the shared action boundary", async () => {
  const mount = createRouteShell(transports().services).mount(
    await workRoute("none", false, "nothing"),
    placeInput(locationPort().address, { target: null }),
  );
  closes.push(mount.close);
  expect(() => mount.invoke("change", 3)).toThrow(PlaceWriteRefusal);
});

test("resource release never withdraws the Place's write authority", async () => {
  const f = await historyFixture();
  f.mount.release();
  expect((await settle(f.mount.invoke("change", 2) as Observation<WorkWriteOutcome>)).kind).toBe(
    "accepted",
  );
});

test.each(["clear"] as const)(
  "cell %s captures its channel and label and refuses stale readings or lost custody",
  async (kind) => {
    const t = transports();
    const initial = { amount: { edit: { value: 3, by: "pea" } } };
    const store = createFixtureWorkDoor(
      {
        route: "note",
        title: "",
        description: "",
        schema: z.object({ amount: draftCellSchema(z.number()) }),
      },
      initial,
    );
    const submit = vi.spyOn(store, "submitWork");
    let custody: "current" | "departed" = "current";
    const route = await workRoute("none", false, "nothing", undefined, "draft", {
      output: z.unknown(),
      run: () => ({}),
      pane: (ctx) => ctx,
    });
    const mount = createRouteShell({ ...t.services, work: store }).mount(
      route,
      placeInput(locationPort().address, { custody: { current: () => custody === "current" } }),
    );
    closes.push(mount.close);
    await vi.waitFor(() => expect(mount.work()).not.toBeNull());
    const cellContext = mount.read("main") as {
      cells: Record<typeof kind, (id: string, key: string) => Observation<WorkWriteOutcome>>;
    };
    const run = () => cellContext.cells[kind]("amount", "amount");
    expect(() => run()).toThrow("Reading unavailable: notes");
    expect(submit).not.toHaveBeenCalled();
    t.frames.at(-1)!(ready("notes"));
    custody = "departed";
    expect(() => run()).toThrow(PlaceWriteRefusal);
    expect(submit).not.toHaveBeenCalled();
    custody = "current";
    expect((await settle(run())).kind).toBe("accepted");
    const label = "Clear amount";
    expect(submit.mock.calls[0]?.[1]).toMatchObject({ label });
    expect(submit.mock.calls[0]?.[2]).toMatchObject({ token: { channel: `cell-${kind}:amount` } });
    expect(mount.work()?.value).toEqual({
      amount: { edit: null },
    });
  },
);





test("a released feed resumes after custody returns through its address notification", async () => {
  const { args: _args, ...policy } = data.readings.notes;
  const route = await admitted(false, false, {
    data: { readings: { notes: { ...policy, kind: "feed", adapter: "args" } } },
    bodies: { args: { ...bodies.args, kind: "adapter", slot: "readings.notes.adapter" } },
  });
  let current = true;
  const location = locationPort();
  const t = transports();
  const m = createRouteShell(t.services).mount(route, placeInput(location.address, { custody: { current: () => current } }));
  closes.push(m.close);
  t.frames[0]!(ready("before hide"));
  m.release();
  current = false;
  const stop = m.subscribe(() => {});
  current = true;
  location.listeners.forEach((notify) => notify());
  expect(t.keys).toEqual([0, 0]);
  t.frames[1]!(ready("after reveal"));
  expect(m.readingStatus("notes").snapshot).toMatchObject({ current: true, value: "after reveal" });
  stop();
});

test("a malformed source reading refuses with a human message instead of schema diagnostics", async () => {
  const t = transports();
  const m = createRouteShell(t.services).mount(await admitted(), placeInput(locationPort().address));
  closes.push(m.close);
  t.frames[0]!({ status: "ready", current: true, value: null, hash: "null" });
  expect(m.readingStatus("notes").snapshot).toMatchObject({
    status: "failed", current: false,
    reason: "This reading could not be decoded. Refresh the pane to try again.",
  });
});

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
    const mount = shell.mount(route, placeInput(locationPort().address));
    await vi.waitFor(() => expect(mount.work()?.value).toEqual({ amount: 0 }));
    await settle(mount.invoke("change", 2) as Observation<WorkWriteOutcome>);
    deliverStream?.({ kind: "pending" });
    expect(mount.work()).toMatchObject({ revision: 1, value: { amount: 2 } });
    const pending = mount.invoke("change", 3) as Observation<WorkWriteOutcome>;
    mount.close();
    await settle(pending);
    const reopened = shell.mount(route, placeInput(locationPort().address));
    closes.push(reopened.close);
    await vi.waitFor(() =>
      expect(reopened.work()).toMatchObject({ revision: 2, value: { amount: 5 } }),
    );
  },
);

test("stale-base refuses without recomputing or retrying the Work edit", async () => {
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
    placeInput(locationPort().address),
  );
  closes.push(mount.close);
  await vi.waitFor(() => expect(mount.work()).not.toBeNull());
  const outcome = await settle(mount.invoke("change", 2) as Observation<WorkWriteOutcome>);
  expect(outcome).toMatchObject({
    kind: "refused",
    refusal: { code: "stale_revision", revision: 1 },
  });
  expect(mount.work()?.value).toEqual({ amount: 10 });
  const refused = mount.refusedEdits()[0]!;
  expect(refused.input).toMatchObject({
    expectedRevision: 0,
    patches: [{ path: ["amount"], value: 2 }],
  });
  expect(Object.isFrozen(refused.input.patches)).toBe(true);
  expect(() => mount.retryEdit(refused.id, mount.workBasis()!)).toThrow(
    /original, still-current basis/,
  );
  expect(mount.work()?.value).toEqual({ amount: 10 });
  mount.discardEdit(refused.id);
  expect(mount.refusedEdits()).toEqual([]);
});

test("rendered Work basis refuses old, copied and foreign edits; current basis accepts", async () => {
  const t = transports();
  const store = createFixtureWorkDoor(
    { route: "note", title: "", description: "", schema: z.object({ amount: z.number() }) },
    { amount: 0 },
  );
  let pane: {
    workBasis: import("../../../../packages/agent-contracts/src/route-kernel-page").InvocationToken;
    work: unknown;
    place(row: number, input: number): { change(): unknown };
    verbs: { change(input: number, basis?: unknown): unknown };
  };
  const route = await workRoute("none", false, "nothing", undefined, false, {
    output: z.string(),
    row: true,
    run: () => ({}),
    pane: (ctx) => {
      pane = ctx as typeof pane;
      return null;
    },
  });
  const submitWork = vi.fn(store.submitWork);
  const shell = createRouteShell({ ...t.services, work: { ...store, submitWork } });
  const mount = shell.mount(route, placeInput(locationPort().address));
  closes.push(mount.close);
  await vi.waitFor(() => expect(mount.work()).not.toBeNull());
  mount.read("main");
  const old = pane!.workBasis;
  expect(old.workRevision).toBe(0);
  expect(old.token.scope.identity.work).toBeTruthy();
  expect(pane!.work).toEqual({ amount: 0 });
  expect(() => pane!.verbs.change(2)).toThrow("rendered accepted basis");
  expect(() => pane!.verbs.change(2, { ...old })).toThrow("foreign");
  await settle(mount.invoke("change", 5) as Observation<WorkWriteOutcome>);
  const refusal = await settle(pane!.verbs.change(2, old) as Observation<WorkWriteOutcome>);
  expect(refusal).toMatchObject({
    kind: "refused",
    refusal: { code: "stale_revision", revision: 1 },
  });
  expect(mount.work()?.value).toEqual({ amount: 5 });
  expect(await settle(pane!.place(1, 2).change() as Observation<WorkWriteOutcome>)).toMatchObject({
    kind: "refused",
    refusal: { code: "stale_revision", revision: 1 },
  });
  expect(submitWork.mock.calls.at(-1)![2]).toBe(old);
  expect(submitWork.mock.calls.at(-1)![1].expectedRevision).toBe(old.workRevision);
  mount.read("main");
  expect(pane!.workBasis).not.toBe(old);
  expect(
    (await settle(pane!.verbs.change(2, pane!.workBasis) as Observation<WorkWriteOutcome>)).kind,
  ).toBe("accepted");
  expect(mount.work()?.value).toEqual({ amount: 7 });
  const replacement = shell.mount(route, placeInput(locationPort().address));
  closes.push(replacement.close);
  expect(() => replacement.invoke("change", 9, old)).toThrow("foreign");
});

test("a delayed submit keeps its captured expectedRevision across a newer accepted edit", async () => {
  const t = transports();
  const store = createFixtureWorkDoor(
    { route: "note", title: "", description: "", schema: z.object({ amount: z.number() }) },
    { amount: 0 },
  );
  let release: () => void = () => {};
  let delayed = true;
  const writes: number[] = [];
  const door: WorkJournalDoor = {
    ...store,
    submitWork(scope, write, invocation) {
      writes.push(write.expectedRevision!);
      if (!delayed) return store.submitWork(scope, write, invocation);
      delayed = false;
      return {
        subscribe(deliver, end) {
          release = () => {
            store.submitWork(scope, write, invocation).subscribe(deliver, end);
          };
          return () => {};
        },
      };
    },
  };
  const mount = createRouteShell({ ...t.services, work: door }).mount(
    await workRoute(),
    placeInput(locationPort().address),
  );
  closes.push(mount.close);
  await vi.waitFor(() => expect(mount.work()).not.toBeNull());
  const pending = settle(mount.invoke("change", 2) as Observation<WorkWriteOutcome>);
  await Promise.resolve();
  await settle(mount.invoke("change", 10) as Observation<WorkWriteOutcome>);
  release();
  expect(await pending).toMatchObject({
    kind: "refused",
    refusal: { code: "stale_revision", revision: 1 },
  });
  expect(writes).toEqual([0, 0]);
  expect(mount.work()).toMatchObject({ revision: 1, value: { amount: 10 } });
});
