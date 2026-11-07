import { placeInput } from "./typed-place.test-support";
import { RouteActivity, RouteVisibility } from "../route/activity";
import { draftCellSchema, actionReceiptSchema, memberWork } from "@pe/agent-contracts";
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
import { createRouteShell, PlaceWriteRefusal } from "./admitted-mount";
import { createAdmittedWork } from "./admitted-work";
import { createRouteScopeGate } from "../../../../packages/runtime/src/route-scope-gate";
import { createWorkJournal } from "../../../../packages/runtime/src/work-journal";
import type { ReadingContext, ReadingDelivery } from "./source-contract";
import { admittedRouterAddress } from "./typed-place-boundary";
import { AdmittedPane } from "./admitted-place.test-fixture";
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
test("only the final admitted body publishes; retained publication survives release", async () => {
  const attempts: { context: ReadingContext; deliver: ReadingDelivery }[] = [];
  const services = sourceRouteServices({ "notes.read": { kind: "use", open(context, deliver) { attempts.push({ context, deliver }); } } });
  const location = locationPort("?query=A");
  const mount = createRouteShell(services).mount(await admitted(), placeInput(location.address));
  const published: unknown[] = [];
  const stop = mount.subscribe(() => published.push(mount.readingStatus("notes").snapshot));
  try {
    expect(attempts).toHaveLength(1);
    mount.controls.query("query", "B");
    expect(attempts).toHaveLength(2);
    attempts[1]!.deliver({ kind: "complete", value: "B", revision: 1 });
    const accepted = mount.readingStatus("notes").snapshot;
    expect(published.at(-1)).toBe(accepted);
    attempts[0]!.deliver({ kind: "complete", value: "late-A", revision: 1 });
    expect(mount.readingStatus("notes").snapshot).toBe(accepted);
    mount.release();
    const resume = mount.subscribe(() => {});
    expect(mount.readingStatus("notes").snapshot).toBe(accepted);
    expect(attempts).toHaveLength(2);
    resume();
    mount.refresh("notes");
    const pending = attempts.at(-1)!;
    pending.deliver({ kind: "part", value: "partial", revision: 2 });
    expect(mount.readingStatus("notes").snapshot.current).toBe(false);
    pending.deliver({ kind: "complete", value: "current", revision: 3 });
    expect(mount.readingStatus("notes").snapshot).toMatchObject({ current: true, value: "current" });
    pending.deliver({ kind: "complete", value: 42, revision: 4 });
    expect(mount.readingStatus("notes").snapshot.current).toBe(false);
    mount.close();
    const closed = mount.readingStatus("notes").snapshot;
    pending.deliver({ kind: "complete", value: "closed", revision: 5 });
    expect(mount.readingStatus("notes").snapshot).toBe(closed);
  } finally { stop(); mount.close(); }
});

test("composition rejects stale refresh/page frames and disposes all delivery", async () => {
  const t = transports();
  const location = locationPort("?query=restored");
  const mount = createRouteShell(t.services).mount(await admitted(), placeInput(location.address));
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
    placeInput(location.address, { memory: () => ({ query: "memory" }) }),
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
test.each(["sample", "", "missing"])("fixture %s opens no live service", async (fixture) => {
  const t = transports();
  const acquire = vi.spyOn(t.services.reads, "acquire");
  const subscribe = vi.spyOn(t.services.readings, "subscribe");
  const mount = createRouteShell(t.services).mount(
    await admitted(),
    placeInput(locationPort(`?fixture=${fixture}`).address),
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
      }),
    ),
  );
  expect(screen.getByText("Label fixture")).toBeTruthy();
  cleanup();
  expect(location.listeners.size).toBe(0);
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
import type { InvocationBasis } from "../../../../packages/agent-contracts/src/route-kernel-page";

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
          salvage: "salvage",
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
            salvage: {
              slot: "salvage",
              kind: "salvage",
              source,
              run: (old: unknown, ctx: { page: unknown; work: unknown; readings: unknown }) => {
                expect(Object.keys(ctx)).toEqual(["page", "work", "readings"]);
                return {
                  ok: true as const,
                  value: [{ path: ["amount"], value: (old as { amount: number }).amount }],
                };
              },
            },
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

test("Page verbs dispatch declared ephemeral roles through human ports and refuse cross-role output", async () => {
  let patch: unknown = { editor: "open" };
  const route = await admitted(false, false, {
    data: {
      fields: { ...data.fields,
        editor: { ...data.fields.query, role: "device", url: false, share: false, agent: "none" },
        hover: { ...data.fields.query, role: "transient", url: false, share: false, agent: "none" },
      },
      verbs: { change: { kind: "page", input: "text", label: "Edit", review: "none", deps: { page: [], work: [], readings: [] }, captures: [], fields: ["editor"], patch: "patch" } },
      panes: { main: { ...data.panes.main, verbs: ["change"] } },
    },
    bodies: {
      patch: { slot: "verbs.change.patch", kind: "page", source, run: () => patch },
      main: { ...bodies.main, run: (ctx: unknown) => ctx },
    },
  });
  const t = transports();
  const mount = createRouteShell(t.services).mount(route, placeInput(locationPort().address));
  closes.push(mount.close);
  const invoke = () => (mount.read("main") as { verbs: { change(input: string): unknown } }).verbs.change("");
  expect(invoke()).toMatchObject({ kind: "accepted" });
  expect(Reflect.get(mount.page.read(), "editor")).toBe("open");
  patch = { hover: "foreign" };
  expect(invoke).toThrow("undeclared field");
  patch = { editor: 42 };
  expect(invoke).toThrow();
  expect(mount.page.read()).toMatchObject({ editor: "open", hover: "" });
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

test("review uses accepted Work, becomes stale on stream edit, and subject enters unloaded Work atomically", async () => {
  const t = transports();
  const store = createFixtureWorkDoor(
    { route: "note", title: "", description: "", schema: z.object({ amount: z.number() }) },
    { amount: 0 },
  );
  const route = await workRoute("shown");
  const mount = createRouteShell({ ...t.services, work: store }).mount(
    route,
    placeInput(locationPort().address),
  );
  closes.push(mount.close);
  await vi.waitFor(() => expect(mount.work()).not.toBeNull());
  mount.invoke("change", 2);
  expect(mount.review("change")?.preview).toEqual([{ path: ["amount"], value: 2 }]);
  await settle(
    store.submitWork(
      {
        route: "note",
        fingerprint: route.workFingerprint,
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
  const a = shell.mount(route, placeInput(locationPort("?fixture=sample").address)),
    b = shell.mount(route, placeInput(locationPort("?fixture=sample").address));
  closes.push(a.close, b.close);
  await vi.waitFor(() => {
    expect(a.work()).not.toBeNull();
    expect(b.work()).not.toBeNull();
  });
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
    placeInput(locationPort().address),
  );
  closes.push(mount.close);
  await vi.waitFor(() => expect(mount.work()).not.toBeNull());
  mount.invoke("native", 0);
  expect(submit).not.toHaveBeenCalled();
  expect(mount.review("native")?.preview).toMatchObject({
    input: { amount: 6 },
    work: { revision: 0 },
  });
  mount.confirm("native");
  expect(mount.timeline()).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        kind: "invocation",
        verb: "native",
        outcome: expect.objectContaining({ state: "running" }),
      }),
    ]),
  );
  expect(submit).toHaveBeenCalledWith(
    expect.objectContaining({ key: "native.write", input: { amount: 6 } }),
  );
});

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

test("query validates and delivers invocation input without changing Page; new runs supersede", async () => {
  const t = transports();
  const acquire = vi.spyOn(t.services.reads, "acquire");
  const m = createRouteShell(t.services).mount(
    await admitted(true, true),
    placeInput(locationPort().address),
  );
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
  t.frames[2]!(ready("retained"));
  expect(pane().readings.notes).toMatchObject({ current: true, value: "retained" });
  expect(acquire).toHaveBeenCalledTimes(3);
});

import { workHandleSchema, writePreviewSchema, type WorkHandle } from "@pe/agent-contracts";
const sealedPreview = (handle: WorkHandle) => ({
  previewOnly: true,
  derivedRequest: { amount: 7 },
  seal: {
    caller: { kind: "human", via: "local" },
    requestHash: "sealed",
    work: { handle },
    documentMark: { session: "", openId: "", observedSince: null, changedAt: null },
    incarnation: {},
    dependencies: "deps",
  },
  takenAt: "2026-11-03T00:00:00Z",
  response: { changes: [{ kind: "Parameter", key: "amount", before: 6, after: 7 }] },
});
async function nativeFixture(presenter?: (result: unknown, evidence: unknown) => unknown) {
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
    placeInput(locationPort().address),
  );
  closes.push(mount.close);
  await vi.waitFor(() => expect(mount.work()).not.toBeNull());
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
      expect.objectContaining({
        kind: "refused",
        reason: "review-stale",
      }),
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

import { sourceRouteServices } from "./source-route-services";

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

test("a disposed mount exposes no owner history to retained render props", async () => {
  const f = await historyFixture();
  f.mount.close();
  expect(f.mount.history!.entries).toEqual([]);
});

test("admitted Work undo/redo crosses the door with restoreOf and declared labels", async () => {
  const f = await historyFixture();
  await settle(f.mount.invoke("change", 2) as Observation<WorkWriteOutcome>);
  expect(f.mount.journal()?.moves.at(-1)?.label).toBe("Change");
  expect(await f.mount.history!.undo()).toMatchObject({ ok: true });
  expect(f.mount.work()).toMatchObject({ revision: 2, value: { amount: 0 } });
  expect(f.submitWork.mock.calls.at(-1)?.[1]).toMatchObject({
    kind: "restore",
    restoreOf: 1,
    expectedRevision: 1,
  });
  expect(await f.mount.history!.redo()).toMatchObject({ ok: true });
  expect(f.mount.work()).toMatchObject({ revision: 3, value: { amount: 2 } });
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
  const originalAt = f.mount.journal()!.undo.at(-1)!.at;
  expect(await f.mount.history!.revert()).toMatchObject({ ok: true });
  expect(f.mount.work()?.value).toEqual({ amount: 0 });
  expect(f.mount.journal()?.undo.map((s) => s.label)).toEqual(["Change", "Revert Change"]);
  expect(f.mount.journal()?.moves.at(-1)?.label).toBe("Revert Change");
  expect(await f.mount.history!.undo()).toMatchObject({ ok: true });
  expect(f.mount.work()?.value).toEqual({ amount: 5 });
  expect(f.mount.journal()!.undo[0]!.at).toBe(originalAt);
  const submitted = f.submitWork.mock.calls.length;
  f.failFeed();
  expect(f.mount.workProblem()).toBe("readings offline");
  await expect(f.mount.history!.revert()).rejects.toThrow("Work unavailable");
  expect(f.submitWork.mock.calls).toHaveLength(submitted);
  expect(f.mount.work()?.value).toEqual({ amount: 5 });
});

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

test("independent shells share authored edits, invalidate redo and recover inverse history after host restart", async () => {
  const f = await historyFixture(true);
  const second = await f.second();
  await settle(f.mount.invoke("change", 6) as Observation<WorkWriteOutcome>);
  await vi.waitFor(() =>
    expect(second.work()).toMatchObject({ revision: 1, value: { amount: 6 } }),
  );
  expect(await second.history!.undo()).toMatchObject({ ok: true });
  await vi.waitFor(() =>
    expect(f.mount.work()).toMatchObject({ revision: 2, value: { amount: 0 } }),
  );
  expect(await f.mount.history!.redo()).toMatchObject({ ok: true });
  await vi.waitFor(() => expect(second.work()?.revision).toBe(3));
  expect(await second.history!.undo()).toMatchObject({ ok: true });
  await f.external(9);
  await vi.waitFor(() => expect(f.mount.work()?.revision).toBe(5));
  expect(await f.mount.history!.redo()).toMatchObject({ ok: false, code: "empty" });
  expect(second.journal()?.undo.at(-1)).toMatchObject({ by: "pea", label: "Set amount" });
  f.mount.close();
  second.close();
  // No retained journal, submit callback, or constructed replay snapshot crosses this restart.
  const recovered = await f.restart();
  expect(recovered.work()).toMatchObject({ revision: 5, value: { amount: 9 } });
  expect(recovered.journal()?.undo.at(-1)).toMatchObject({ by: "pea", label: "Set amount" });
  expect(await recovered.history!.undo()).toMatchObject({ ok: true });
  expect(recovered.work()).toMatchObject({ revision: 6, value: { amount: 0 } });
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
    if (origin.kind === "restore") return { ok: true as const, value: patch };
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
  const mount = createRouteShell(t.services).mount(route, placeInput(location.address));
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
  const mount = createRouteShell(transports().services).mount(
    route,
    placeInput(locationPort().address),
  );
  closes.push(mount.close);
  expect(run.mock.calls[0]![2].kind).toBe("restore");
  expect(mount.page.pose({ pose: { x: 1 } }, "named").kind).toBe("refused");
  value = { pose: { x: "invalid" } };
  expect(mount.page.pose({ pose: { x: 1 } }, "named").kind).toBe("refused");
  expect(mount.page.read().pose).toEqual({ x: 0 });
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
  const mount = createRouteShell(transports().services).mount(
    route,
    placeInput(locationPort().address),
  );
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
          return { ok: true as const, value: patch };
        },
      },
    },
  });
  const mount = createRouteShell(t.services).mount(route, placeInput(locationPort().address));
  closes.push(mount.close);
  t.frames.at(-1)!(ready("scene"));
  expect(mount.page.pose({ pose: { x: 10 } }, "named").kind).toBe("refused");
  expect(mount.page.read().pose).toEqual({ x: 0 });
});

test("unused cell admission stays refused before acquisition", async () => {
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
  ];
  for (const amendment of cases) {
    const t = transports();
    const route = await admitted(false, false, amendment);
    expect(() =>
      createRouteShell(t.services).mount(route, placeInput(locationPort().address)),
    ).toThrow(/Unsupported admitted mount body slot/);
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

import { applicationRouteShell } from "./application-route-shell";
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
    const contexts: Parameters<import("./source-contract").UseSource["open"]>[0][] = [];
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
      placeInput(locationPort().address, {
        target: needs === "nothing" ? { kind: "host" } : documentA,
      }),
    );
    closes.push(mount.close);
    await vi.waitFor(() => expect(mount.work()).not.toBeNull());
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
  const contexts: Parameters<import("./source-contract").UseSource["open"]>[0][] = [];
  const released = vi.fn();
  const sources = {
    "notes.read": {
      kind: "use",
      open(
        context: Parameters<import("./source-contract").UseSource["open"]>[0],
        deliver: Parameters<import("./source-contract").UseSource["open"]>[1],
      ) {
        contexts.push(context);
        deliver({ kind: "complete", value: "note", revision: 0 });
        return released;
      },
    },
  };
  const selected = vi.mocked(useRouteTarget);
  selected.mockReturnValue({ resolution: { kind: "resolved", target: documentA } } as ReturnType<
    typeof useRouteTarget
  >);
  const route = await admitted(false, false, { data: { needs: "document" }, sources });
  const address = locationPort().address;
  try {
    const view = render(createElement(applicationRouteShell, { route, address }));
    expect(contexts.map((c) => c.target)).toEqual([documentA]);
    view.rerender(createElement(applicationRouteShell, { route, address }));
    expect(contexts).toHaveLength(1);
    selected.mockReturnValue({ resolution: { kind: "resolved", target: documentB } } as ReturnType<
      typeof useRouteTarget
    >);
    view.rerender(createElement(applicationRouteShell, { route, address }));
    expect(contexts.map((c) => c.target)).toEqual([documentA, documentB]);
    expect(contexts[0]!.signal.aborted).toBe(true);
    expect(contexts[1]!.signal.aborted).toBe(false);
    await act(async () => {});
    expect(released).toHaveBeenCalledOnce();
    view.unmount();
    expect(contexts[1]!.signal.aborted).toBe(true);
  } finally {
    selected.mockReset();
  }
});

test("admitted predicates update a rendered split from current evidence without running during draw", async () => {
  const predicate = vi.fn((ctx) => ctx.page.query === "show" && ctx.readings.notes.current);
  const route = await admitted(false, false, {
    schemas: { stage: z.enum(["main", "other"]) },
    data: {
      fields: {
        ...data.fields,
        stage: { ...data.fields.query, role: "stage", schema: "stage", initial: "main" },
      },
      stageOrder: ["main", "other"],
      predicates: { allowed: "allowed" },
      observe: ["notes"],
      panes: {
        ...data.panes,
        aside: { ...data.panes.main, label: "Aside", body: "aside" },
        unused: { ...data.panes.main, label: "Other stage", body: "unused" },
      },
      stages: {
        main: { ...data.stages.main, panes: ["main", "aside"] },
        other: { word: "Other", panes: ["unused"], verbs: [] },
      },
      layout: {
        kind: "split",
        id: "witness-split",
        axis: "h",
        size: 280,
        children: [
          data.layout,
          { kind: "gate", when: "allowed", child: { kind: "pane", id: "aside" } },
          { kind: "pane", id: "unused" },
        ],
      },
    },
    bodies: {
      allowed: { slot: "predicates.allowed", kind: "predicate", source, run: predicate },
      aside: { ...bodies.main, slot: "panes.aside.body" },
      unused: { ...bodies.main, slot: "panes.unused.body" },
    },
  });
  const t = transports();
  const shell = createRouteShell(t.services);
  const mounts = vi.spyOn(shell, "mount");
  const view = render(
    createElement(AdmittedPane, {
      shell,
      route,
      address: locationPort().address,
    }),
  );
  const mount = mounts.mock.results[0]!.value as ReturnType<
    ReturnType<typeof createRouteShell>["mount"]
  >;
  closes.push(mount.close);
  expect(mounts).toHaveBeenCalledOnce();
  expect(screen.queryByText("Aside")).toBeNull();
  act(() => {
    mount.controls.query("query" as never, "show" as never);
    t.frames.at(-1)!(ready("yes"));
  });
  expect(screen.getByText("Aside")).toBeTruthy();
  expect(screen.queryByText("Other stage")).toBeNull();
  const split = view.container.querySelector("[data-layout-split]")!;
  expect(split.getAttribute("data-axis")).toBe("horizontal");
  expect(split.getAttribute("style")).toContain("280px");
  const calls = predicate.mock.calls.length;
  mount.read("main");
  mount.read("aside");
  expect(predicate).toHaveBeenCalledTimes(calls);
  act(() => {
    mount.controls.query("query" as never, "hide" as never);
  });
  expect(screen.queryByText("Aside")).toBeNull();
});

test("subject display receives only subject and is cached outside draw", async () => {
  const show = vi.fn((value) => (value === null ? "No note" : String(value)));
  const route = await admitted(false, false, {
    data: { subject: { ...data.subject, show: "show" } },
    bodies: { show: { slot: "subject.show", kind: "show", source, run: show } },
  });
  const mount = createRouteShell(transports().services).mount(
    route,
    placeInput(locationPort().address),
  );
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
  const mount = createRouteShell(transports().services).mount(
    route,
    placeInput(locationPort().address),
  );
  closes.push(mount.close);
  mount.controls.query("query", "changed");
  expect(mount.subjectText()).toBe("changed");
  const calls = text.mock.calls.length;
  mount.read("main");
  mount.subjectText();
  expect(text).toHaveBeenCalledTimes(calls);
});

test("row placement uses shared query dispatch with captured input and refuses outside allowed union", async () => {
  const choose = vi.fn((row) => {
    expect(Object.isFrozen(row)).toBe(true);
    return [row];
  });
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
      main: {
        ...bodies.main,
        run: (ctx: { place: (row: string, input: unknown) => unknown }) =>
          ctx.place("capture", { elementIds: [1] }),
      },
      queryArgs: {
        slot: "verbs.capture.args",
        kind: "args",
        source,
        run: (_ctx: unknown, input: { elementIds: number[] }) => ({
          query: input.elementIds.join(","),
        }),
      },
      choose: { slot: "panes.main.verbs.choose", kind: "placement", source, run: choose },
    },
  });
  const t = transports();
  const acquire = vi.spyOn(t.services.reads, "acquire");
  const mount = createRouteShell(t.services).mount(rowRoute, placeInput(locationPort().address));
  closes.push(mount.close);
  const input = { elementIds: [42] },
    verbs = mount.place("main", "capture", input);
  input.elementIds[0] = 99;
  verbs.capture!();
  expect(acquire.mock.calls.at(-1)![0].key.sortedKeyInput).toBe(JSON.stringify({ query: "42" }));
  expect(() => mount.place("main", "outside", input)).toThrow("Undeclared pane verb");
  expect(() => mount.place("main", 123 as never, input)).toThrow();
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
test("a presenter throw refuses with a typed reason and never submits", async () => {
  const f = await nativeFixture(() => {
    throw Error("display failed");
  });
  f.mount.invoke("native", 0);
  expect(() => f.preview().deliver()).toThrow(
    expect.objectContaining({
      kind: "refused",
      reason: "present-threw",
    }),
  );
  expect(f.mount.review("native")).toBeNull();
  expect(f.mount.reviewRefusal("native")).toMatchObject({ reason: "present-threw" });
  expect(() => f.mount.confirm("native")).toThrow(
    expect.objectContaining({ reason: "present-threw" }),
  );
  expect(f.submit).not.toHaveBeenCalled();
});


test("invalid presenter output cannot become a review", async () => {
  const f = await nativeFixture(() => ({ sentence: 12, rows: ["bad"] }));
  f.mount.invoke("native", 0);
  expect(() => f.preview().deliver()).toThrow(
    expect.objectContaining({ reason: "present-invalid" }),
  );
  expect(f.mount.review("native")).toBeNull();
  expect(f.submit).not.toHaveBeenCalled();
});

import * as workHost from "../route/host";
test("cell displays, focus, clear refusal and salvage use real shared Page/Work owners", async () => {
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
  const saved = vi
    .spyOn(workHost, "salvageRouteWork")
    .mockResolvedValue({ from: "old", value: { amount: 12 } });
  try {
    await mount.salvage();
    expect(mount.work()?.value).toEqual({ amount: 6 });
    await settle(mount.confirm("work.salvage") as Observation<WorkWriteOutcome>);
    expect(mount.work()?.value).toEqual({ amount: 12 });
  } finally {
    saved.mockRestore();
  }
});

test("presentation without sealed preview stays explicitly refused until result landing", async () => {
  const route = await workRoute("none", false, "nothing", () => "result");
  const t = transports();
  expect(() =>
    createRouteShell(t.services).mount(route, placeInput(locationPort().address)),
  ).toThrow("requires a sealed preview");
  expect(t.keys).toEqual([]);
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

test("lands accepts an authoritative successful result through Page policy", async () => {
  const f = await landingFixture();
  f.deliver({
    kind: "accepted-native",
    outcome: "committed",
    receiptId: "receipt",
    result: { name: "saved table" },
  });
  expect(f.mount.page.read().query).toBe("saved table");
  expect(f.land).toHaveBeenCalledTimes(1);
  expect(f.mount.commandLanding(f.submission.handle.id)).toMatchObject({ kind: "decoded" });
});

test.each(["departure", "replacement", "superseded"] as const)(
  "lands leaves Page unchanged after %s and keeps receipt",
  async (mode) => {
    const f = await landingFixture();
    let page = f.mount;
    if (mode === "superseded") f.location.navigate("/note?query=replacement");
    else {
      f.mount.close();
      if (mode === "replacement") {
        page = f.shell.mount(f.route, placeInput(locationPort("?query=replacement").address));
        closes.push(page.close);
      }
    }
    const before = mode === "departure" ? null : page.page.read();
    const result = {
      kind: "accepted-native",
      outcome: "committed",
      receiptId: "receipt",
      result: { name: "late" },
    } as const;
    f.deliver(result);
    expect(f.land).not.toHaveBeenCalled();
    if (mode !== "departure") expect(page.page.read()).toEqual(before);
    expect(f.door.accepted(f.submission.handle.id)).toEqual(result);
  },
);

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

test("migration bodies stay on the host; mount exposes typed registration refusal without reopening an old tab", async () => {
  const migrate = vi.fn(() => {
    throw Error("must never execute in browser");
  });
  const route = await admitted(false, false, {
    data: {
      capabilities: ["work"],
      workSubject: "note",
      work: { route: "note", schema: "pose", version: 2, migrations: { 1: "upgrade" } },
    },
    bodies: { upgrade: { slot: "work.migrations.1", kind: "migration", source, run: migrate } },
  });
  const failure = {
    kind: "registration-mismatch" as const,
    routeKey: route.data.key,
    expected: route.workFingerprint,
    received: route.workFingerprint,
  };
  const open = vi.fn<WorkJournalDoor["open"]>((scope) => ({
    subscribe(deliver, end) {
      expect(scope.fingerprint).toBe(route.workFingerprint);
      deliver({ kind: "pending" });
      deliver({ kind: "failed", failure });
      end();
      return () => {};
    },
  }));
  const door: WorkJournalDoor = {
    lifetime: "subscription",
    open,
    receipts: () => ({
      subscribe() {
        return () => {};
      },
    }),
    submitWork: () => {
      throw Error("unavailable");
    },
    submit: () => {
      throw Error("unavailable");
    },
    accepted: () => ({ kind: "pending" }),
  };
  const location = locationPort();
  const mount = createRouteShell({ ...transports().services, work: door }).mount(
    route,
    placeInput(location.address),
  );
  closes.push(mount.close);
  expect(mount.workFailure()).toEqual(failure);
  expect(mount.workProblem()).toContain("Reload this tab");
  expect(mount.work()).toBeNull();
  location.navigate("/note?note=%5B%22note%22%2C%22B%22%5D");
  expect(open).toHaveBeenCalledOnce();
  expect(migrate).not.toHaveBeenCalled();
});

test("query lands once through transition on current success and refuses stale/superseded/decode failure", async () => {
  const land = vi.fn((value: string) => ({ pose: { x: value.length } }));
  const transition = vi.fn((_page, patch) => ({
    ok: true,
    value: patch.pose ? { ...patch, pose: { x: patch.pose.x + 1 } } : patch,
  }));
  const route = await admitted(true, true, {
    landing: true,
    data: { transition: "transition", transitionDeps: { page: [], work: [], readings: [] } },
    bodies: {
      landQuery: { slot: "verbs.capture.lands", kind: "lands", source, run: land },
      transition: { slot: "transition", kind: "transition", source, run: transition },
    },
  });
  const t = transports();
  const m = createRouteShell(t.services).mount(route, placeInput(locationPort().address));
  closes.push(m.close);
  const invoke = () => (m.read("main") as any).verbs.capture({ elementIds: [1] });
  invoke();
  const first = t.frames.at(-1)!;
  first({ status: "pending", current: false, reason: "pending" });
  expect(land).not.toHaveBeenCalled();
  invoke();
  const second = t.frames.at(-1)!;
  first(ready("superseded"));
  second({ status: "unavailable", current: false, value: "stale", reason: "stale" });
  expect(land).not.toHaveBeenCalled();
  second(ready("yes"));
  expect(land).toHaveBeenCalledOnce();
  expect(m.page.read().pose).toEqual({ x: 4 });
  second(ready("again"));
  expect(land).toHaveBeenCalledOnce();
  invoke();
  t.frames.at(-1)!(ready(17 as any));
  expect(m.queryLanding("notes")).toMatchObject({ kind: "result-undecodable", key: "notes.read" });
  expect(land).toHaveBeenCalledOnce();
  invoke();
  const departed = t.frames.at(-1)!;
  m.controls.query("query", "new scope");
  departed(ready("retained"));
  expect(land).toHaveBeenCalledTimes(2);
});

test("ModelWrite refuses a stale rendered Work basis before acquiring any preview", async () => {
  const f = await nativeFixture();
  const basis = f.mount.workBasis()!;
  await settle(f.mount.invoke("change", 8) as Observation<WorkWriteOutcome>);
  const before = f.acquire.mock.calls.length;
  expect(() => f.mount.invoke("native", 999, basis)).toThrow("Stale accepted Work basis");
  expect(f.acquire).toHaveBeenCalledTimes(before);
  expect(f.submit).not.toHaveBeenCalled();
  const current = f.mount.workBasis()!;
  expect(f.mount.invoke("native", 999, current)).toEqual({ kind: "preview" });
  expect(f.preview().input.work.revision).toBe(current.workRevision);
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

test("AdmittedPane subject picker goes through transition and reloads its accepted URL subject", async () => {
  const identity = identityCodecs.local.encode({ namespace: "note", subject: "picked" });
  if (!identity.ok) throw Error(identity.reason);
  const transition = vi.fn((_ctx: unknown, patch: unknown) => ({ ok: true, value: patch }));
  const route = await admitted(false, false, {
    data: { transition: "transition", panes: { main: { ...data.panes.main, draws: ["label"] } } },
    bodies: {
      pick: { ...bodies.pick, run: () => [{ id: identity.value, label: "Picked note" }] },
      transition: { slot: "transition", kind: "transition", source, run: transition },
      main: {
        ...bodies.main,
        run: (ctx: { page: { read(): { note: unknown } } }) =>
          createElement(
            "output",
            { "data-testid": "subject" },
            ctx.page.read().note === identity.value ? "picked" : "empty",
          ),
      },
    },
  });
  const location = locationPort();
  const t = transports();
  const shell = createRouteShell(t.services);
  const first = render(createElement(AdmittedPane, { shell, route, address: location.address }));
  await act(async () => t.frames[0]!(ready("roster")));
  fireEvent.click(screen.getByRole("button", { name: "Choose note" }));
  fireEvent.click(await screen.findByText("Picked note"));
  expect(screen.getByTestId("subject").textContent).toBe("picked");
  expect(transition).toHaveBeenCalledWith(
    expect.anything(),
    { note: identity.value },
    expect.objectContaining({ kind: "human", source: "subject" }),
    expect.anything(),
  );
  expect(location.address.read().get("note")).toContain("picked");
  first.unmount();
  render(createElement(AdmittedPane, { shell, route, address: location.address }));
  expect(screen.getByTestId("subject").textContent).toBe("picked");
});

test.each(["registration-mismatch", "migration-failed", "failed"] as const)(
  "AdmittedPane renders terminal Work failure %s without retrying in place",
  async (kind) => {
    const route = await workRoute();
    const failure =
      kind === "registration-mismatch"
        ? {
            kind,
            routeKey: route.data.key,
            expected: route.workFingerprint,
            received: route.workFingerprint,
          }
        : kind === "migration-failed"
          ? {
              kind,
              routeKey: route.data.key,
              fromVersion: 1,
              toVersion: 2,
              step: 1,
              message: "Saved Work could not migrate",
            }
          : { kind, code: "WorkUnavailable", message: "Work store is unavailable" };
    const expected =
      kind === "registration-mismatch"
        ? "This tab is running an older version of this route; reload."
        : failure.message!;
    const store = createFixtureWorkDoor(
      { route: "note", title: "", description: "", schema: z.object({ amount: z.number() }) },
      { amount: 0 },
    );
    const open = vi.fn<WorkJournalDoor["open"]>(() => ({
      subscribe(deliver, end) {
        deliver({ kind: "failed", failure });
        end();
        return () => {};
      },
    }));
    const t = transports();
    const shell = createRouteShell({ ...t.services, work: { ...store, open } });
    const mount = vi.spyOn(shell, "mount");
    const location = locationPort();
    render(createElement(AdmittedPane, { shell, route, address: location.address }));
    expect(await screen.findByText(expected)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /retry|reload/i })).toBeNull();
    expect(mount.mock.results[0]!.value.workFailure()).toEqual(failure);
    expect(mount.mock.results[0]!.value.workProblem()).toBeTruthy();
    await act(async () => mount.mock.results[0]!.value.controls.query("query", "redraw"));
    expect(screen.getByText(expected)).toBeTruthy();
    expect(open).toHaveBeenCalledOnce();
  },
);

test.each([false, true])(
  "read currency follows args across Work writes, Work arg = %s",
  async (readingWork) => {
    const t = transports();
    const store = createFixtureWorkDoor(
      { route: "note", title: "", description: "", schema: z.object({ amount: z.number() }) },
      { amount: 0 },
    );
    const route = await workRoute(
      "none",
      false,
      "nothing",
      undefined,
      false,
      undefined,
      readingWork,
    );
    const mount = createRouteShell({ ...t.services, work: store }).mount(
      route,
      placeInput(locationPort().address),
    );
    closes.push(mount.close);
    await vi.waitFor(() => expect(mount.work()).not.toBeNull());
    expect(t.keys).toHaveLength(1);
    mount.invoke("native", 0);
    expect(mount.review("native")?.stale).toBe(false);
    await settle(mount.invoke("change", 1) as Observation<WorkWriteOutcome>);
    expect(mount.review("native")?.stale).toBe(true);
    expect(() => mount.confirm("native")).toThrow(/stale/);
    expect(t.releases).toHaveBeenCalledTimes(readingWork ? 1 : 0);
    t.frames[0]!(ready("late"));
    // A Work field used by args supersedes the attempt; unrelated Work keeps it in flight.
    expect(t.keys).toHaveLength(readingWork ? 2 : 1);
    if (readingWork) t.frames[1]!(ready("current"));
    // Completed evidence also survives another unrelated Work edit.
    if (!readingWork) await settle(mount.invoke("change", 1) as Observation<WorkWriteOutcome>);
    expect(t.keys).toHaveLength(readingWork ? 2 : 1);
    expect(t.releases).toHaveBeenCalledTimes(readingWork ? 1 : 0);
  },
);

test("a changed declared query argument retires its in-flight completion", async () => {
  const t = transports();
  const mount = createRouteShell(t.services).mount(
    await admitted(true, true, { queryFromPage: true }),
    placeInput(locationPort().address),
  );
  closes.push(mount.close);
  mount.invoke("capture", { elementIds: [7] });
  const departed = t.frames[0]!;
  mount.controls.query("query", "new argument");
  departed(ready("late"));
  expect((mount.read("main") as any).readings.notes.current).toBe(false);
  expect(t.releases).toHaveBeenCalledOnce();
});

test("retained pane releases leases on hide and reuses its Page and history on show", async () => {
  const f = await historyFixture();
  const owners = new Set<{ dispose(): void }>();
  const scope = {
    pathname: "/note",
    search: {},
    current: () => true,
    retain: (owner: { dispose(): void }) => {
      owners.add(owner);
    },
    retire: (owner: { dispose(): void }) => {
      owners.delete(owner);
      owner.dispose();
    },
  };
  const spy = vi.spyOn(f.shell, "mount");
  const { address } = locationPort();
  const view = (visible: boolean) =>
    createElement(
      RouteActivity.Provider,
      { value: scope },
      createElement(
        RouteVisibility.Provider,
        { value: visible },
        createElement(AdmittedPane, { shell: f.shell, route: f.route, address }),
      ),
    );
  const rendered = render(view(true));
  const mount = spy.mock.results[0]!.value;
  await vi.waitFor(() => expect(mount.work()).not.toBeNull());
  await act(async () => {
    mount.controls.query("query", "retained");
    await settle(mount.invoke("change", 2) as Observation<WorkWriteOutcome>);
  });
  const moves = mount.journal()!.moves;
  rendered.rerender(view(false));
  expect(mount.page.read().query).toBe("retained");
  expect(() => mount.invoke("change", 3)).toThrow("Place is not writable");
  rendered.rerender(view(true));
  expect(spy).toHaveBeenCalledOnce();
  expect(mount.page.read().query).toBe("retained");
  expect(mount.journal()!.moves).toEqual(moves);
  rendered.unmount();
  for (const owner of owners) owner.dispose();
});

test("K4 hide and fold release attempt leases, retain accepted evidence and avoid reveal reads", async () => {
  const t = transports();
  const mount = createRouteShell(t.services).mount(
    await admitted(),
    placeInput(locationPort().address),
  );
  closes.push(mount.close);
  t.frames[0]!(ready("retained"));
  const status = mount.readingStatus("notes");
  expect(Object.isFrozen(status.snapshot)).toBe(true);
  mount.setPaneDemand("main", false);
  expect(mount.readingStatus("notes")).toMatchObject({
    demanded: false,
    leased: false,
    previous: "retained",
    snapshot: { current: true, value: "retained" },
  });
  expect(t.releases).toHaveBeenCalledOnce();
  mount.setPaneDemand("main", true);
  expect(t.keys).toEqual([0]);
  mount.release();
  mount.subscribe(() => {})();
  expect(t.keys).toEqual([0]);
  expect(mount.readingStatus("notes").snapshot.value).toBe("retained");
  mount.refreshPane("main");
  expect(t.keys).toEqual([0, 1]); // notes is both drawn and label's dependency.
  expect(mount.readingStatus("notes").previous).toBe("retained");
});

import { readingEvidencePort, type SourceReadingEvidence } from "./source-route-services";

test("K4 a host resolve generation change replaces the affected attempt, including after hide", async () => {
  const t = transports();
  const generations: ((event: { kind: "generation"; value: string }) => void)[] = [];
  const stop = vi.fn();
  const evidence: SourceReadingEvidence = {
    dependencies: () => [],
    observe: (_request, _token, deliver) => {
      generations.push(deliver);
      return stop;
    },
  };
  const mount = createRouteShell(
    Object.assign(t.services, { [readingEvidencePort]: evidence }),
  ).mount(await admitted(), placeInput(locationPort().address));
  closes.push(mount.close);
  generations[0]!({ kind: "generation", value: "host-1" });
  t.frames[0]!(ready("old"));
  generations[0]!({ kind: "generation", value: "host-1" });
  expect(t.keys).toEqual([0]);
  mount.release();
  expect(stop).toHaveBeenCalledOnce();
  mount.subscribe(() => {})();
  expect(t.keys).toEqual([0]);
  generations[1]!({ kind: "generation", value: "host-2" });
  expect(t.keys).toEqual([0, 1]);
  expect(mount.readingStatus("notes").previous).toBe("old");
  t.frames[0]!(ready("late"));
  expect(mount.readingStatus("notes").snapshot.current).toBe(false);
});

test("K4 only successful receipt effects from K1's receipt view invalidate a reading", async () => {
  const t = transports();
  const store = createFixtureWorkDoor(
    { route: "note", title: "", description: "", schema: z.object({ amount: z.number() }) },
    { amount: 0 },
  );
  let emit: (
    value: import("../../../../packages/agent-contracts/src/work-journal-door").ReceiptFeedState,
  ) => void = () => {};
  const door: WorkJournalDoor = {
    ...store,
    receipts: () => ({
      subscribe(deliver) {
        emit = deliver;
        return () => {};
      },
    }),
  };
  const effects = [{ kind: "file" as const, path: "model.data" }];
  let log: Parameters<SourceReadingEvidence["observe"]>[2] = () => {};
  const evidence: SourceReadingEvidence = {
    dependencies: () => effects,
    observe: (_request, _token, deliver) => {
      log = deliver;
      return () => {};
    },
  };
  const mount = createRouteShell(
    Object.assign({ ...t.services, work: door }, { [readingEvidencePort]: evidence }),
  ).mount(await workRoute(), placeInput(locationPort().address));
  closes.push(mount.close);
  await vi.waitFor(() => expect(mount.work()).not.toBeNull());
  t.frames[0]!(ready("first"));
  const accepted = mount.readingStatus("notes").snapshot;
  log({ kind: "log", value: { message: "source progress" } });
  expect(mount.timeline()).toContainEqual(
    expect.objectContaining({
      kind: "feed",
      subject: "notes",
      basis: { message: "source progress" },
    }),
  );
  expect(mount.readingStatus("notes").snapshot).toBe(accepted);
  const receipt = (id: string, state: string, path: string) =>
    actionReceiptSchema.parse({
      id,
      key: "external.write",
      caller: { kind: "human", via: "local" },
      target: { kind: "host" },
      basis: null,
      input: {},
      steps: [],
      effects: [{ kind: "file", path }],
      consumes: [],
      claims: [],
      consent: null,
      prepared: { state: "unprepared" },
      recovery: [],
      startedAt: "2026-11-03T00:00:00Z",
      state,
      ...(state === "succeeded" ? { result: {} } : { error: state, status: 400 }),
    });
  let cursor = 0;
  const send = (id: string, state: string, path: string) =>
    emit({
      kind: "receipt",
      cursor:
        ++cursor as import("../../../../packages/agent-contracts/src/work-journal-door").ReceiptCursor,
      receipt: receipt(id, state, path),
    });
  send("unrelated", "succeeded", "elsewhere.data");
  send("failed", "failed", "model.data");
  send("cancelled", "cancelled", "model.data");
  expect(t.keys).toEqual([0]);
  send("changed", "succeeded", "model.data");
  expect(t.keys).toEqual([0, 1]);
  expect(mount.readingStatus("notes").previous).toBe("first");
  emit({
    kind: "receipt",
    cursor:
      ++cursor as import("../../../../packages/agent-contracts/src/work-journal-door").ReceiptCursor,
    receipt: receipt("changed", "succeeded", "model.data"),
  });
  expect(t.keys).toEqual([0, 1]);
});

test("K4 pane refresh leaves an independent visible reading alone", async () => {
  const other = {
    ...data.readings.notes,
    args: "otherArgs",
    deps: { page: [], work: [], readings: [] },
  };
  const route = await admitted(false, false, {
    data: {
      readings: { other },
      panes: {
        ...data.panes,
        other: { label: "Other", purpose: "Read", draws: ["other"], verbs: [], body: "otherPane" },
      },
      layout: {
        kind: "split",
        id: "both",
        axis: "h",
        size: 1,
        children: [data.layout, { kind: "pane", id: "other" }],
      },
      stages: { main: { ...data.stages.main, panes: ["main", "other"] } },
    },
    bodies: {
      otherPane: { slot: "panes.other.body", kind: "pane", source, run: () => null },
      otherArgs: {
        slot: "readings.other.args",
        kind: "args",
        source,
        run: () => ({ query: "independent" }),
      },
    },
  });
  const t = transports();
  const mount = createRouteShell(t.services).mount(route, placeInput(locationPort().address));
  closes.push(mount.close);
  expect(t.keys).toEqual([0, 0]);
  t.frames[0]!(ready("main"));
  t.frames[1]!(ready("other"));
  const independent = mount.readingStatus("other").snapshot;
  mount.refreshPane("main");
  expect(t.keys).toEqual([0, 0, 1]);
  expect(mount.readingStatus("other").snapshot).toBe(independent);
  expect(mount.readingStatus("other").leased).toBe(true);
});

test.each(["feed", "worker", "port"] as const)(
  "K4 reveal resumes only the declared %s lease while retaining evidence",
  async (kind) => {
    const { args: _args, ...policy } = data.readings.notes;
    const route = await admitted(false, false, {
      data: { readings: { notes: { ...policy, kind, adapter: "args" } } },
      bodies: { args: { ...bodies.args, kind: "adapter", slot: "readings.notes.adapter" } },
    });
    const t = transports();
    const m = createRouteShell(t.services).mount(route, placeInput(locationPort().address));
    closes.push(m.close);
    t.frames[0]!(ready("kept"));
    m.release();
    expect(t.releases).toHaveBeenCalledOnce();
    expect(m.readingStatus("notes").snapshot.value).toBe("kept");
    m.subscribe(() => {})();
    expect(t.keys).toEqual([0, 0]);
    expect(m.readingStatus("notes").previous).toBe("kept");
    t.frames[1]!(ready("resumed"));
    expect(m.readingStatus("notes").snapshot.value).toBe("resumed");
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

test("recovery replaces saved evidence with a problem and clears it on a new attempt", async () => {
  const saved = vi
    .spyOn(workHost, "salvageRouteWork")
    .mockResolvedValue({ from: "old", value: { amount: 12 } });
  const t = transports();
  const store = createFixtureWorkDoor(
    { route: "note", title: "", description: "", schema: z.object({ amount: z.number() }) },
    { amount: 6 },
  );
  const mount = createRouteShell({ ...t.services, work: store }).mount(
    await workRoute("none", false, "nothing", undefined, true),
    placeInput(locationPort().address),
  );
  closes.push(mount.close);
  await vi.waitFor(() => expect(mount.work()).not.toBeNull());
  try {
    await vi.waitFor(() => expect(mount.recovery().carryOver).toBe(true));
    saved.mockRejectedValueOnce(Error("salvage offline"));
    await expect(mount.salvage()).rejects.toThrow("salvage offline");
    expect(mount.recovery()).toMatchObject({
      problem: "Error: salvage offline",
      busy: false,
      carryOver: false,
    });
    await mount.salvage();
    expect(mount.recovery()).toMatchObject({ problem: null, busy: false, carryOver: true });
    expect(mount.review("work.salvage")).not.toBeNull();
  } finally {
    saved.mockRestore();
  }
});

test("oversized command landings report a gap while the durable receipt and Page landing survive", async () => {
  const f = await landingFixture();
  const outcome = {
    kind: "accepted-native",
    outcome: "committed",
    receiptId: "large-receipt",
    result: { name: "x".repeat(1024 * 1024) },
  } satisfies Parameters<typeof f.deliver>[0];
  f.deliver(outcome);
  expect(f.mount.commandLanding(f.submission.handle.id)).toMatchObject({
    kind: "gap",
    receiptId: f.submission.handle.id,
  });
  expect(f.door.accepted(f.submission.handle.id)).toEqual(outcome);
  expect(f.land).toHaveBeenCalledTimes(1);
  expect(f.mount.page.read().query).toBe(outcome.result.name);
});

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
