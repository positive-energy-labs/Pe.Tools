import { placeInput } from "./admitted-place.test-fixture";
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
import type { IdentityId } from "../../../../packages/agent-contracts/src/route-kernel-page";
import { sceneRequest } from "../scene/host";
function decoded<T>(result: { ok: true; value: T } | { ok: false; reason: string }): T {
  if (!result.ok) throw Error(result.reason);
  return result.value;
}
const nativeId = decoded(
  identityCodecs.element.encode({ document: "doc", link: null, uniqueId: "unique-element" }),
);
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
async function admit(
  options: {
    kind?: "element" | "local" | "document";
    subject?: string | null;
    input?: unknown;
    reachFt?: number;
    query?: boolean;
    queryTarget?: string | null;
  } = {},
) {
  const kind = options.kind ?? "element";
  const identityKey: "system" | "element" | "document" = kind === "local" ? "system" : kind;
  const module = {
    ...readOnlyModule,
    identities: { ...identityCodecs },
    data: {
      ...readOnlyModule.data,
      capabilities: ["geometry"] as const,
      ...(options.query
        ? {
            verbs: {
              capture: {
                kind: "query" as const,
                entry: "scene",
                ...(options.queryTarget === null
                  ? {}
                  : { reading: options.queryTarget ?? "detail" }),
                args: "captureArgs",
                input: "ids",
                label: "Capture",
                review: "none" as const,
                cancellation: "scope" as const,
                deps: { page: [], work: [], readings: [] },
                captures: [],
              },
            },
          }
        : {}),
      seeds: { sample: { title: "Geometry", load: "geometrySeed" } },
      identities: {
        system: { kind: "local" as const, codec: "local" as const },
        document: { kind: "document" as const, codec: "document" as const },
        element: { kind: "element" as const, codec: "element" as const },
      },
      fields: {
        ...readOnlyModule.data.fields,
        system: {
          ...readOnlyModule.data.fields.system,
          identity: identityKey,
          initial: options.subject === undefined ? nativeId : options.subject,
        },
      },
      readings: {
        ...readOnlyModule.data.readings,
        overview: { ...podData.readings.overview, demand: "visible" as const },
        detail: {
          ...podData.readings.detail,
          geometry: {
            ...podData.readings.detail.geometry,
            reachFt: options.reachFt ?? 5,
          },
        },
      },
      panes: {
        main: {
          ...readOnlyModule.data.panes.main,
          draws: ["overview", "detail"],
          ...(options.query ? { verbs: ["capture"] } : {}),
        },
      },
    } as const,
    schemas: {
      ...readOnlyModule.schemas,
      ids: z.object({ elementIds: z.array(z.number()) }),
      subjectOne: z.custom<IdentityId<"element" | "local" | "document"> | null>(
        (value) =>
          value === null || (typeof value === "string" && identityCodecs[kind].decode(value).ok),
      ),
    },
    entries: {
      ...readOnlyModule.entries,
      scene: {
        ...podEntries.scene,
        ...(options.input === undefined
          ? {}
          : { input: z.object({}).transform(() => options.input) }),
        ...(options.query
          ? {
              input: z
                .object({
                  elementIds: z.array(z.number()).optional(),
                  region: z.unknown().optional(),
                  contextRepresentation: z.literal("meshes").optional(),
                })
                .passthrough(),
            }
          : {}),
        axes: { ...podEntries.scene.axes, cap: 50000 },
      },
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
      ...(options.query
        ? {
            captureArgs: {
              slot: "verbs.capture.args" as const,
              kind: "args" as const,
              source: { module: "bodies.js", export: "captureArgs" },
              run: (_ctx: unknown, input: { elementIds: number[] }) => ({
                ...(options.subject === null
                  ? sceneRequest(input.elementIds, false, 15, "meshes")
                  : { ...regionInput, elementIds: input.elementIds }),
                contextRepresentation: "meshes",
              }),
            },
          }
        : {}),
      geometrySeed: {
        slot: "seeds.sample.load" as const,
        kind: "seed" as const,
        source: { module: "bodies.js", export: "geometrySeed" },
        run: () => ({
          readings: {
            overview: outcome,
            detail: {
              ...outcome,
              representation: "meshes" as const,
              value: { artifact: "detail" },
            },
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
function door(
  result?: "retiring" | "refused",
  lifetime: ResolvedReadDescriptor["openDocumentLifetime"] = { openId: "doc" },
) {
  const requests: any[] = [];
  const descriptors: ResolvedReadDescriptor[] = [];
  const joins: ResolvedReadDescriptor[] = [];
  const releases = vi.fn();
  let late: ((value: any) => void) | undefined;
  const geometry: GeometryReadDoor<unknown> = {
    lifetime: "read",
    resolve(request) {
      requests.push(request);
      const descriptor = {
        operationKey: "scene",
        processIncarnation: { pid: 1, startedAt: 2 },
        openDocumentLifetime: lifetime,
        normalizedInput: canonicalEnvironmentInput(request.native?.input ?? {}),
        freshnessGeneration: null,
        representation: request.representation === "overview" ? "overview" : "detail",
      } as ResolvedReadDescriptor;
      descriptors.push(descriptor);
      return once(descriptor);
    },
    join(descriptor) {
      joins.push(descriptor);
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
  return { geometry, requests, descriptors, joins, releases, late: () => late };
}
function mount(
  route: Awaited<ReturnType<typeof admit>>,
  geometry: GeometryReadDoor<unknown>,
  search = "",
) {
  return createRouteShell(
    sourceRouteServices(
      {},
      {
        geometry,
        target: () => ({ kind: "document", ref: { session: "geometry-test", openId: "doc" } }),
      },
    ),
  ).mount(
    route,
    placeInput(
      {
        read: () => new URLSearchParams(search),
        write: () => {},
        subscribe: () => () => {},
      },
      { target: { kind: "document", ref: { session: "geometry-test", openId: "doc" } } },
    ),
  );
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
    expect(d.requests[1].reach.subject).toEqual({ kind: "subjects", ids: [nativeId] });
    expect(d.requests[1].reach.explicit.token.channel).toBe("detail");
    (m.read("main") as any).readingActions.detail.refresh();
    expect(d.releases).toHaveBeenCalledTimes(1);
  } finally {
    m.close();
  }
});

const regionId = decoded(
  identityCodecs.local.encode({ namespace: "space.region", subject: "room-uid" }),
);
const regionInput = {
  ...sceneRequest([], false, 15, "meshes"),
  region: { kind: "room", uniqueId: "room-uid" },
};
test.each([5, 15])(
  "region detail prepares %s-ft reach and joins the exact host descriptor",
  async (reachFt) => {
    const d = door();
    const m = mount(
      await admit({ kind: "local", subject: regionId, input: regionInput, reachFt }),
      d.geometry,
    );
    try {
      const pane = m.read("main") as any;
      expect(d.requests).toHaveLength(1);
      expect(d.requests[0]).toMatchObject({
        representation: "overview",
        subjects: { kind: "ids", ids: [] },
      });
      expect(pane.readings.detail.current).toBe(false);
      expect(identityCodecs.element.decode(regionId).ok).toBe(false);
      pane.readingActions.detail.readDetailed();
      expect(d.requests).toHaveLength(2);
      const detail = d.requests[1];
      expect(detail).toMatchObject({
        representation: "meshes",
        native: {
          input: {
            region: { kind: "room", uniqueId: "room-uid" },
            elementIds: [],
            contextPaddingFt: 15,
          },
        },
        reach: { subject: { kind: "region", id: regionId }, reachFt },
      });
      expect(detail.reach.explicit.token.channel).toBe("detail");
      expect(detail.reach.explicit.token.scope).toBe(d.requests[0].scope);
      expect(detail.reach.explicit.token.scope.identity.target).toEqual({
        kind: "document",
        ref: { session: "geometry-test", openId: "doc" },
      });
      expect(d.joins[1]).toBe(d.descriptors[1]);
      expect((m.read("main") as any).readings.detail).toMatchObject({
        status: "ready",
        current: true,
      });
      const late = d.late();
      m.controls.subject(
        decoded(
          identityCodecs.local.encode({ namespace: "space.region", subject: "another-room" }),
        ),
      );
      expect(d.releases).toHaveBeenCalledTimes(2);
      late?.({ kind: "retiring" });
      expect((m.read("main") as any).readings.detail.current).toBe(false);
      expect(d.requests.map((r) => r.representation)).toEqual(["overview", "meshes", "overview"]);
    } finally {
      m.close();
    }
  },
);

test("a local subject without a native region never falls back to element detail", async () => {
  const d = door();
  const m = mount(await admit({ kind: "local", subject: regionId }), d.geometry);
  try {
    (m.read("main") as any).readingActions.detail.readDetailed();
    expect(d.requests).toHaveLength(1);
    expect((m.read("main") as any).readings.detail).toMatchObject({
      status: "unavailable",
      current: false,
    });
    expect(m.controls.subject(nativeId).kind).toBe("refused");
    expect(d.requests[0].subjects.ids).toEqual([]);
  } finally {
    m.close();
  }
});

test("document identity alone cannot authorize whole-project detail", async () => {
  const d = door();
  const m = mount(await admit({ kind: "document", subject: '["doc"]' }), d.geometry);
  try {
    (m.read("main") as any).readingActions.detail.readDetailed();
    expect(d.requests).toHaveLength(1);
    expect((m.read("main") as any).readings.detail.current).toBe(false);
  } finally {
    m.close();
  }
});

test("admission refuses detail reach below the 5-ft law", async () => {
  await expect(
    admit({ kind: "local", subject: regionId, input: regionInput, reachFt: 4 }),
  ).rejects.toThrow();
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
  m.page.select([{ kind: "element", id: nativeId }]);
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
  m.controls.subject(
    decoded(
      identityCodecs.element.encode({ document: "doc", link: null, uniqueId: "another-unique" }),
    ),
  );
  expect(d.releases).toHaveBeenCalledTimes(2);
  expect(d.requests.map((r) => r.representation)).toEqual(["overview", "meshes", "overview"]);
  m.close();
});

test("query detail input retains mount-owned region reach, exact join and supersession", async () => {
  const d = door();
  const m = mount(
    await admit({ kind: "local", subject: regionId, query: true, reachFt: 15 }),
    d.geometry,
  );
  try {
    const pane = () => m.read("main") as any;
    const page = m.page.read();
    expect(() => pane().verbs.capture({ elementIds: ["bad"] })).toThrow();
    expect(d.requests).toHaveLength(1);
    pane().verbs.capture({ elementIds: [101, 202] });
    expect(d.requests[1]).toMatchObject({
      representation: "meshes",
      native: { input: { elementIds: [101, 202] } },
      reach: { subject: { kind: "region", id: regionId }, reachFt: 15 },
    });
    expect(d.requests[1].reach.explicit.token.scope).toBe(d.requests[0].scope);
    expect(d.joins[1]).toBe(d.descriptors[1]);
    const late = d.late();
    pane().verbs.capture({ elementIds: [303] });
    expect(d.requests).toHaveLength(3);
    expect(d.releases).toHaveBeenCalledTimes(1);
    late?.({ kind: "retiring" });
    expect(pane().readings.detail.current).toBe(true);
    expect(d.joins[2]).toBe(d.descriptors[2]);
    expect(m.page.read()).toEqual(page);
  } finally {
    m.close();
  }
});

test.each([null, "missing"])(
  "query refuses ambiguous or foreign reading selector %s",
  async (queryTarget) => {
    const d = door();
    const m = mount(
      await admit({ kind: "local", subject: regionId, query: true, queryTarget }),
      d.geometry,
    );
    try {
      expect(() => (m.read("main") as any).verbs.capture({ elementIds: [1] })).toThrow(
        /exactly one/,
      );
      expect(d.requests).toHaveLength(1);
    } finally {
      m.close();
    }
  },
);

test("null region prepares validated native ids in the invocation document scope without changing Page", async () => {
  const d = door();
  const m = mount(
    await admit({ kind: "local", subject: null, query: true, reachFt: 15 }),
    d.geometry,
  );
  try {
    const pane = () => m.read("main") as any;
    const page = m.page.read();
    expect(d.requests.map((r) => r.representation)).toEqual(["overview"]);
    expect(pane().readings.detail.current).toBe(false);
    expect(() => pane().verbs.capture({ elementIds: [-1] })).toThrow();
    expect(d.requests).toHaveLength(1);
    pane().verbs.capture({ elementIds: [101, 202] });
    const detail = d.requests[1];
    expect(detail).toMatchObject({
      representation: "meshes",
      native: { input: { elementIds: [101, 202], contextPaddingFt: 15 } },
      reach: { subject: { kind: "subjects", ids: [101, 202] }, reachFt: 15 },
    });
    expect(detail.native.input).not.toHaveProperty("region");
    expect(detail.reach.subject.scope).toBe(detail.reach.explicit.token.scope);
    expect(detail.reach.subject.scope.identity.target).toEqual({
      kind: "document",
      ref: { session: "geometry-test", openId: "doc" },
    });
    expect(Object.isFrozen(detail.reach.subject.ids)).toBe(true);
    expect(d.joins[1]).toBe(d.descriptors[1]);
    expect(pane().readings.detail).toMatchObject({ status: "ready", current: true });
    const late = d.late();
    pane().verbs.capture({ elementIds: [303] });
    late?.({ kind: "retiring" });
    expect(d.requests[2].reach.subject.ids).toEqual([303]);
    expect(d.joins[2]).toBe(d.descriptors[2]);
    expect(pane().readings.detail.current).toBe(true);
    expect(m.page.read()).toEqual(page);
  } finally {
    m.close();
  }
});

test("null region and empty invocation ids refuse detail before resolving", async () => {
  const d = door();
  const m = mount(
    await admit({ kind: "local", subject: null, query: true, reachFt: 15 }),
    d.geometry,
  );
  try {
    const pane = () => m.read("main") as any;
    pane().verbs.capture({ elementIds: [] });
    expect(d.requests.map((r) => r.representation)).toEqual(["overview"]);
    expect(pane().readings.detail).toMatchObject({
      status: "unavailable",
      current: false,
      reason: expect.stringContaining("validated elementIds with an exact document target"),
    });
  } finally {
    m.close();
  }
});

test("native reach refuses foreign scopes, session-only targets and sub-law context", () => {
  const issuer = createRouteEnvironmentIssuer();
  const tokens = createRouteTokenIssuer();
  const target = { kind: "document" as const, ref: { session: "test", openId: "doc" } };
  const scope = tokens.scope({ target, work: null });
  const attempt = decoded(tokens.attempt(scope, "detail", 1));
  const explicit = issuer.mintExplicit(attempt);
  expect(() => issuer.mintReach({ kind: "subjects", ids: [101], scope }, 4, explicit)).toThrow();
  const foreign = tokens.scope({ target, work: null });
  expect(() =>
    issuer.mintReach({ kind: "subjects", ids: [101], scope: foreign }, 15, explicit),
  ).toThrow(/document scope/);
  const session = tokens.scope({ target: { kind: "session", session: "test" }, work: null });
  const sessionExplicit = issuer.mintExplicit(decoded(tokens.attempt(session, "detail", 1)));
  expect(() =>
    issuer.mintReach({ kind: "subjects", ids: [101], scope: session }, 15, sessionExplicit),
  ).toThrow(/document scope/);
});

test.each([{ openId: "foreign-doc" }, { kind: "session-only" as const }])(
  "native detail cannot join a descriptor for another document lifetime: %j",
  async (lifetime) => {
    const d = door(undefined, lifetime);
    const m = mount(
      await admit({ kind: "local", subject: null, query: true, reachFt: 15 }),
      d.geometry,
    );
    try {
      (m.read("main") as any).verbs.capture({ elementIds: [101] });
      expect(d.requests).toHaveLength(2);
      expect(d.joins).toHaveLength(1);
      expect((m.read("main") as any).readings.detail).toMatchObject({
        status: "unavailable",
        reason: expect.stringContaining("document lifetime"),
      });
    } finally {
      m.close();
    }
  },
);

test("K4 hidden geometry keeps its accepted value and only rejoins on host generation change", async () => {
  vi.useFakeTimers();
  const d = door();
  let generation = "host-1";
  const geometry: GeometryReadDoor<unknown> = {
    ...d.geometry,
    resolve(request, scope) {
      const observation = d.geometry.resolve(request, scope);
      return {
        subscribe(deliver, end) {
          return observation.subscribe(
            (descriptor) =>
              deliver(
                "kind" in descriptor
                  ? descriptor
                  : { ...descriptor, freshnessGeneration: generation },
              ),
            end,
          );
        },
      };
    },
  };
  const m = mount(await admit(), geometry);
  try {
    const original = m.readingStatus("overview").snapshot;
    expect(d.joins).toHaveLength(1);
    m.release();
    expect(d.releases).toHaveBeenCalledOnce();
    expect(m.readingStatus("overview").snapshot).toBe(original);
    expect(m.readingStatus("overview").leased).toBe(false);
    m.subscribe(() => {})();
    expect(d.joins).toHaveLength(1);
    generation = "host-2";
    await vi.advanceTimersByTimeAsync(5000);
    expect(d.joins).toHaveLength(2);
    expect(m.readingStatus("overview").snapshot.current).toBe(true);
  } finally {
    m.close();
    vi.useRealTimers();
  }
});
