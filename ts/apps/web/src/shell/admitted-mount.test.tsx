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
async function admitted(explicit = false) {
  const selectedModule = {
    ...module,
    data: {
      ...data,
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
  const keys: number[] = [];
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
