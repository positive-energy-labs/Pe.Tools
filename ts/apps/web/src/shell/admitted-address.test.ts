import { createHash } from "node:crypto";
import { afterEach, expect, test, vi } from "vite-plus/test";
import {
  builtinData,
  builtinModule,
  schemas,
  entries,
} from "../../../../packages/agent-contracts/src/route-kernel.fixtures";
import {
  createRouteAdmission,
  routeFingerprint,
  createAdmittedRouteRegistry,
} from "../../../../packages/agent-contracts/src/route-module";
import type { RouteFingerprintInput } from "../../../../packages/agent-contracts/src/route-kernel-admission";
import {
  createRouteTokenIssuer,
  type DecodeResult,
} from "../../../../packages/agent-contracts/src/route-kernel-page";
import { createRouteScopeGate } from "../../../../packages/runtime/src/route-scope-gate";
import { createPagePolicy, createPagePorts, identityCodecs } from "./page-port";
import { createAdmittedAddress, type AddressHistory } from "./admitted-address";

const data = {
  ...builtinData,
  fields: {
    ...builtinData.fields,
    system: { ...builtinData.fields.system, url: "push" },
    // This witness uses a literal text codec so ?search= is explicitly empty.
    hidden: { ...builtinData.fields.search, url: false },
    device: { ...builtinData.fields.search, role: "device", url: false },
    transient: { ...builtinData.fields.search, role: "transient", url: false },
  },
} as const;
const module = {
  ...builtinModule,
  data,
  codecs: {
    ...builtinModule.codecs,
    text: {
      encode: (text: unknown) => schemas.text.parse(text),
      decode: (text: string) => ({ ok: true as const, value: text }),
    },
  },
};
const value = <T>(result: DecodeResult<T>): T => {
  if (!result.ok) throw Error(result.reason);
  return result.value;
};
const local = (subject: string) =>
  value(identityCodecs.local.encode({ namespace: "system", subject }));
const selected = (subject: string) => [{ kind: "system" as const, id: local(subject) }];
const cleanups: (() => void)[] = [];
afterEach(() =>
  cleanups
    .splice(0)
    .reverse()
    .forEach((close) => close()),
);

async function fixture(search = new URLSearchParams(), memory: unknown = {}) {
  const bytes = new TextEncoder().encode("address witness executable");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const artifact: RouteFingerprintInput = {
    version: 1,
    data,
    contracts: [{ id: "contracts", sha256 }],
    executables: [
      { client: "shared", entry: "bodies.js", members: [{ path: "bodies.js", sha256 }] },
    ],
  };
  const admission = await createRouteAdmission({
    artifact,
    expectedFingerprint: await routeFingerprint(artifact),
    loadedBindings: module,
    contracts: [{ id: "contracts", bytes }],
    executables: [
      {
        client: "shared",
        entry: "bodies.js",
        resolved: true,
        members: [{ path: "bodies.js", bytes }],
      },
    ],
    catalog: Object.entries(entries).map(([key, entry]) => ({ key, ...entry.axes, uses: [] })),
  });
  const admitted = admission.admit({ ...module, artifact });
  if (!admitted.ok) throw Error(JSON.stringify(admitted.diagnostics));
  const registry = createAdmittedRouteRegistry();
  const registration = registry.register(admitted.route);
  const policy = createPagePolicy(data, schemas, () => "unresolved");
  const issuer = createRouteTokenIssuer();
  const owner = createRouteScopeGate<typeof data, typeof schemas>({
    workSchema: schemas.work,
    hashWork: JSON.stringify,
    dependencies: () => ({}),
    journal: () => {
      throw Error("No Work access in address test");
    },
    preparePage: policy.prepare,
    issuer,
  });
  owner.enter({ target: null, work: null }, value(policy.initial()));
  const restorePage = vi.spyOn(owner, "restorePage");
  const published = vi.fn();
  owner.subscribe(published);
  const writes: AddressHistory[] = [];
  const locations = [new URLSearchParams(search)];
  let index = 0;
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());
  const address = {
    read: () => new URLSearchParams(locations[index]),
    write(next: URLSearchParams, history: AddressHistory) {
      writes.push(history);
      if (history === "push") {
        locations.splice(index + 1);
        locations.push(new URLSearchParams(next));
        index++;
      } else locations[index] = new URLSearchParams(next);
      notify();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  const transport = createAdmittedAddress({
    route: admitted.route,
    registry,
    owner,
    policy,
    address,
    memory: () => memory,
    origin: { kind: "restore", source: "url", token: issuer.restore("url") },
  });
  cleanups.push(() => {
    transport.close();
    owner.close();
    registration.deactivate();
  });
  const ports = createPagePorts(data, { ...owner, readPage: () => owner.read()!.page });
  return {
    ...ports,
    owner,
    transport,
    writes,
    published,
    restorePage,
    address,
    registration,
    read: () => owner.read()!.page,
    go(delta: number) {
      index += delta;
      notify();
    },
    navigate(next: URLSearchParams) {
      locations[index] = next;
      notify();
    },
  };
}

test.each([
  ["absent", "", { search: "remembered" }, "remembered"],
  ["empty", "search=", { search: "remembered" }, ""],
  ["default", "search=", {}, ""],
  ["defaults without memory", "", {}, ""],
] as const)(
  "%s retains presence through URL/tab/default restore",
  async (_, query, memory, expected) => {
    const f = await fixture(new URLSearchParams(query), memory);
    expect(f.transport.initial.kind).toBe("accepted");
    expect(f.read().search).toBe(expected);
    expect(f.restorePage).toHaveBeenCalledTimes(1);
    expect(f.writes).toEqual([]);
  },
);

test.each([
  ["system", "broken"],
  ["selected", ""],
  ["selected", '{"kind":"all"}'],
  ["viewport", '{"x":"bad","y":0}'],
  ["system", '"not-an-identity"'],
])("malformed %s refuses atomically rather than falling through to memory", async (key, text) => {
  const f = await fixture(new URLSearchParams({ [key]: text }), { search: "remembered" });
  expect(f.transport.initial.kind).toBe("refused");
  expect(f.restorePage).not.toHaveBeenCalled();
  expect(f.published).not.toHaveBeenCalled();
  expect(f.read().search).toBe("");
});

test("explicit null, empty selection and default pose beat memory in one coupled publication", async () => {
  const f = await fixture(
    new URLSearchParams({ system: "null", selected: "[]", viewport: '{"x":0,"y":0}' }),
    { system: local("old"), selected: selected("old"), viewport: { x: 8, y: 9 } },
  );
  expect(f.read()).toMatchObject({ system: null, selected: [], viewport: { x: 0, y: 0 } });
  expect(f.restorePage).toHaveBeenCalledTimes(1);
  expect(f.published).toHaveBeenCalledTimes(0); // Initial state is already equal.
  f.navigate(
    new URLSearchParams({
      system: JSON.stringify(local("new")),
      selected: JSON.stringify(selected("new")),
      viewport: '{"x":7,"y":6}',
    }),
  );
  expect(f.published).toHaveBeenCalledTimes(1);
  expect(f.published.mock.calls[0]![0].page).toMatchObject({
    system: local("new"),
    selected: selected("new"),
    viewport: { x: 7, y: 6 },
  });
  expect(f.writes).toEqual([]);
});

test("Back and Forward restore coupled snapshots without writing history or reviving tab defaults", async () => {
  const f = await fixture(new URLSearchParams({ fixture: "browse", search: "" }), {
    search: "old",
  });
  f.controls.subject(local("A"));
  f.page.select(selected("A"));
  f.page.pose({ viewport: { x: 4, y: 5 } }, "gesture");
  expect(f.writes).toEqual(["push", "push", "replace"]);
  expect(f.address.read().get("fixture")).toBe("browse");
  f.go(-1);
  expect(f.read()).toMatchObject({
    system: local("A"),
    selected: [],
    viewport: { x: 0, y: 0 },
    search: "",
  });
  f.go(1);
  expect(f.read()).toMatchObject({
    system: local("A"),
    selected: selected("A"),
    viewport: { x: 4, y: 5 },
    search: "",
  });
  expect(f.writes).toEqual(["push", "push", "replace"]);
});

test.each(["setting", "hidden", "refused", "noop"])(
  "%s moves produce no address write",
  async (kind) => {
    const f = await fixture();
    if (kind === "setting") f.page.set("density", 2);
    if (kind === "hidden") f.controls.query("hidden", "private");
    if (kind === "refused")
      f.owner.movePage({ search: 3 } as never, {
        kind: "human",
        source: "query",
        history: "replace",
      });
    if (kind === "noop") f.controls.query("search", "");
    expect(f.writes).toEqual([]);
  },
);

test.each([
  ["subject", "push"],
  ["selection", "push"],
  ["pose", "replace"],
  ["query", "replace"],
] as const)("accepted %s uses %s history from its role and declaration", async (role, mode) => {
  const f = await fixture();
  if (role === "subject") f.controls.subject(local("A"));
  if (role === "selection") f.page.select(selected("A"));
  if (role === "pose") f.page.pose({ viewport: { x: 1, y: 2 } }, "gesture");
  if (role === "query") f.controls.query("search", "next");
  expect(f.writes).toEqual([mode]);
  expect(f.restorePage).toHaveBeenCalledTimes(1); // The router's own write notification is suppressed.
});

test("URL-ineligible fields cannot restore; repeated values refuse; close unsubscribes", async () => {
  const f = await fixture(new URLSearchParams("density=99&hidden=bad&device=bad&transient=bad"));
  expect(f.read()).toMatchObject({ density: 1, hidden: "", device: "", transient: "" });
  f.navigate(new URLSearchParams("search=a&search=b"));
  expect(f.read().search).toBe("");
  expect(f.restorePage).toHaveBeenCalledTimes(1);
  f.transport.close();
  f.controls.query("search", "after close");
  f.navigate(new URLSearchParams("search=ignored"));
  expect(f.read().search).toBe("after close");
  expect(f.writes).toEqual([]);
  expect(f.transport.restore().kind).toBe("refused");
});

test("retired admission refuses before running address codecs", async () => {
  const f = await fixture();
  f.registration.deactivate();
  expect(() => f.transport.restore()).toThrow(/admission/);
});
