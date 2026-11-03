import { expect, test, vi } from "vite-plus/test";
import { z } from "zod";
import {
  readOnlyModule,
  podData,
  podEntries,
} from "../../../../packages/agent-contracts/src/route-kernel.fixtures";
import {
  builtinClosureFingerprint,
  createBuiltinRouteInventory,
} from "../../../../packages/agent-contracts/src/route-module";
import { createRouteShell } from "./admitted-mount";
import { sourceRouteServices } from "./source-route-services";
import { identityCodecs } from "./page-port";
import type {
  GeometryReadDoor,
  ResolvedReadDescriptor,
} from "../../../../packages/agent-contracts/src/native-read-door";
import {
  canonicalEnvironmentInput,
  createRouteEnvironmentIssuer,
} from "../../../../packages/agent-contracts/src/route-kernel-environment";
import { createRouteTokenIssuer } from "../../../../packages/agent-contracts/src/route-kernel-page";
const nativeId = '["doc",null,"unique-element"]';
const outcome = {
  kind: "ready" as const,
  value: { artifact: "scene" },
  representation: "overview" as const,
  geometryCost: {
    plannedCount: 50000,
    plannedCost: 100000,
    perSource: [],
    newlyTessellatedCount: 50000,
    cumulativeTessellatedCount: 50000,
  },
};
const once = <A>(value: A) => ({
  subscribe(next: (value: A) => void, end: () => void) {
    next(value);
    end();
    return () => {};
  },
});
async function admit() {
  const module = {
    ...readOnlyModule,
    data: {
      ...readOnlyModule.data,
      capabilities: ["geometry"] as const,
      seeds: { sample: { title: "Geometry", load: "geometrySeed" } },
      identities: {
        system: { kind: "element" as const, codec: "element" },
        element: { kind: "element" as const, codec: "element" },
      },
      fields: {
        ...readOnlyModule.data.fields,
        system: { ...readOnlyModule.data.fields.system, initial: nativeId },
      },
      readings: {
        ...readOnlyModule.data.readings,
        overview: podData.readings.overview,
        detail: podData.readings.detail,
      },
      panes: { main: { ...readOnlyModule.data.panes.main, draws: ["overview", "detail"] } },
    },
    schemas: {
      ...readOnlyModule.schemas,
      subjectOne: z.custom(
        (value) =>
          value === null || (typeof value === "string" && identityCodecs.element.decode(value).ok),
      ),
    },
    entries: {
      ...readOnlyModule.entries,
      scene: { ...podEntries.scene, axes: { ...podEntries.scene.axes, cap: 50000 } },
    },
    codecs: {
      ...readOnlyModule.codecs,
      subject: {
        encode: (v: unknown) => JSON.stringify(v),
        decode: (text: string) => ({ ok: true as const, value: JSON.parse(text) }),
      },
    },
    bodies: {
      ...readOnlyModule.bodies,
      geometrySeed: {
        slot: "seeds.sample.load",
        kind: "seed",
        source: { module: "bodies.js", export: "geometrySeed" },
        run: () => ({
          readings: {
            overview: outcome,
            detail: { ...outcome, representation: "meshes", value: { artifact: "detail" } },
          },
        }),
      },
      main: { ...readOnlyModule.bodies.main, run: (ctx: unknown) => ctx },
    },
  };
  const envelope = {
    source: "builtin-closure" as const,
    version: 1 as const,
    data: module.data,
    hostVersion: "u8g",
    variants: [{ client: "web" as const, entry: "bodies.js" }],
    modules: [{ id: "bodies.js", sha256: "a".repeat(64) }],
    inputs: [],
    externals: [],
  };
  const fingerprint = await builtinClosureFingerprint(envelope);
  const inventory = createBuiltinRouteInventory({
    witness: {
      module,
      closure: { envelope, fingerprint },
      catalog: Object.entries(module.entries).map(([key, entry]) => ({
        key,
        ...entry.axes,
        uses: [],
      })),
    },
  });
  const result = (await inventory.prepare("witness", fingerprint)).admit(module);
  if (!result.ok) throw Error(JSON.stringify(result.diagnostics));
  return result.route;
}
function door(result?: "retiring" | "refused") {
  const requests: any[] = [];
  const releases = vi.fn();
  let late: ((value: any) => void) | undefined;
  const geometry: GeometryReadDoor<unknown> = {
    lifetime: "read",
    resolve(request) {
      requests.push(request);
      return once({
        operationKey: "scene",
        processIncarnation: { pid: 1, startedAt: 2 },
        openDocumentLifetime: { openId: "doc" },
        normalizedInput: canonicalEnvironmentInput(request.native?.input ?? {}),
        freshnessGeneration: null,
        representation: request.representation === "overview" ? "overview" : "detail",
      } as ResolvedReadDescriptor);
    },
    join(descriptor) {
      return {
        subscribe(next) {
          late = next;
          next(
            result === "retiring"
              ? { kind: "retiring" }
              : result === "refused"
                ? { kind: "refused", failure: { code: "no", message: "Denied" } }
                : { kind: "value", descriptor, value: outcome, cost: { elements: 50000 } },
          );
          return releases;
        },
      };
    },
  };
  return { geometry, requests, releases, late: () => late };
}
function mount(
  route: Awaited<ReturnType<typeof admit>>,
  geometry: GeometryReadDoor<unknown>,
  search = "",
) {
  return createRouteShell(sourceRouteServices({}, { geometry })).mount(route, {
    read: () => new URLSearchParams(search),
    write: () => {},
    subscribe: () => () => {},
  });
}
test("mount composes default overview and declared explicit detail with cost metadata", async () => {
  const d = door();
  const m = mount(await admit(), d.geometry);
  try {
    const pane = m.read("main") as any;
    expect(d.requests.map((r) => r.representation)).toEqual(["overview"]);
    expect(pane.readings.overview.value.geometryCost.plannedCount).toBe(50000);
    expect(pane.readCosts.overview.elements).toBe(50000);
    expect(Object.keys(pane.readingActions)).toEqual(["detail"]);
    pane.readingActions.detail.readDetailed();
    expect(d.requests[1].representation).toBe("meshes");
    expect(d.requests[1].reach.reachFt).toBeGreaterThanOrEqual(5);
    expect(d.requests[1].reach.explicit.token.channel).toBe("detail");
    (m.read("main") as any).readingActions.detail.refresh();
    expect(d.releases).toHaveBeenCalledTimes(1);
  } finally {
    m.close();
  }
});
test.each(["retiring", "refused"] as const)("%s remains unavailable", async (result) => {
  const d = door(result);
  const m = mount(await admit(), d.geometry);
  try {
    expect((m.read("main") as any).readings.overview.current).toBe(false);
  } finally {
    m.close();
  }
});
test("selection supersedes joins, clears detail demand, and rejects late publication", async () => {
  const d = door();
  const m = mount(await admit(), d.geometry);
  (m.read("main") as any).readingActions.detail.readDetailed();
  const late = d.late();
  m.page.select([{ kind: "element", id: nativeId as any }]);
  expect(d.releases).toHaveBeenCalledTimes(2);
  late?.({ kind: "retiring" });
  expect((m.read("main") as any).readings.overview.current).toBe(true);
  expect((m.read("main") as any).readings.detail.current).toBe(false);
  m.close();
});
test.each(["", "unknown"])("fixture=%s never opens native", async (name) => {
  const d = door();
  const m = mount(await admit(), d.geometry, `fixture=${name}`);
  try {
    expect(d.requests).toHaveLength(0);
    expect((m.read("main") as any).readings.overview.current).toBe(false);
  } finally {
    m.close();
  }
});
test("D mints from host identity and retains exact descriptor authority", async () => {
  const route = await admit();
  const issuer = createRouteEnvironmentIssuer();
  const tokens = createRouteTokenIssuer();
  const scope = tokens.scope({ target: null, work: null });
  const attempt = tokens.attempt(scope, "geometry", 1);
  if (!attempt.ok) throw Error(attempt.reason);
  const host: ResolvedReadDescriptor = {
    operationKey: "scene",
    processIncarnation: { pid: 9, startedAt: 33 },
    openDocumentLifetime: { openId: "exact" },
    normalizedInput: "{}",
    freshnessGeneration: null,
    representation: "overview",
  };
  const descriptor = issuer.mintGeometryFromHost(host, z.any(), route, attempt.value, {
    representation: "overview",
    subjects: { kind: "ids", ids: [] },
    scope,
  });
  expect(descriptor.descriptor).toBe(host);
  expect(descriptor.key.processIncarnation).toBe('{"pid":9,"startedAt":33}');
  expect(descriptor.key.freshnessGeneration).toBeNull();
  expect(issuer.owns(descriptor)).toBe(true);
  expect(issuer.owns({ ...descriptor })).toBe(false);
  expect(issuer.owns(new Proxy(descriptor, {}))).toBe(false);
});

test("fixture geometry resolves same-operation seeds by reading id without native fallback", async () => {
  const d = door();
  const m = mount(await admit(), d.geometry, "fixture=sample");
  try {
    expect((m.read("main") as any).readings.overview.value.value.artifact).toBe("scene");
    (m.read("main") as any).readingActions.detail.readDetailed();
    expect((m.read("main") as any).readings.detail.value.value.artifact).toBe("detail");
    expect(d.requests).toHaveLength(0);
  } finally {
    m.close();
  }
});
test("subject changes retire overview and detail before replacement", async () => {
  const d = door();
  const m = mount(await admit(), d.geometry);
  (m.read("main") as any).readingActions.detail.readDetailed();
  m.controls.subject('["doc",null,"another-unique"]');
  expect(d.releases).toHaveBeenCalledTimes(2);
  expect(d.requests.map((r) => r.representation)).toEqual(["overview", "meshes", "overview"]);
  m.close();
});
