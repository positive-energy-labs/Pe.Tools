import { createHash } from "node:crypto";
import { expect, test, vi } from "vite-plus/test";
import { Effect } from "effect";
import { effectTest } from "../../../host/tests/effect-test.ts";
import { z } from "zod";
import {
  builtinModule,
  readOnlyModule,
  localCodec,
} from "../../../../packages/agent-contracts/src/route-kernel.fixtures.ts";
import {
  createRouteAdmission,
  routeFingerprint,
} from "../../../../packages/agent-contracts/src/route-module.ts";
import {
  createRouteTokenIssuer,
  type DecodeResult,
} from "../../../../packages/agent-contracts/src/route-kernel-page.ts";
import {
  canonicalEnvironmentInput,
  createRouteEnvironmentIssuer,
  type GeometryRequest,
} from "../../../../packages/agent-contracts/src/route-kernel-environment.ts";
import {
  createRouteEnvironment,
  routeEnvironmentLayer,
  RouteEnvironmentService,
  type EnvironmentPorts,
} from "./route-environment";
import { createFixtureRouteEnvironment, selectRouteEnvironment } from "./fixture-lane";
import type { RouteFingerprintInput } from "../../../../packages/agent-contracts/src/route-kernel-admission.ts";
const unwrap = <T>(result: DecodeResult<T>): T => {
  if (!result.ok) throw new Error(result.reason);
  return result.value;
};
async function setup(readOnly = false) {
  const source = readOnly ? readOnlyModule : builtinModule;
  const bytes = new TextEncoder().encode("test bodies");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const artifact: RouteFingerprintInput = {
    version: 1,
    data: source.data,
    contracts: [{ id: "contracts", sha256 }],
    executables: [
      { client: "shared", entry: "bodies.js", members: [{ path: "bodies.js", sha256 }] },
    ],
  };
  const admission = await createRouteAdmission({
    loadedBindings: source,
    artifact,
    expectedFingerprint: await routeFingerprint(artifact),
    contracts: [{ id: "contracts", bytes }],
    executables: [
      {
        client: "shared",
        entry: "bodies.js",
        resolved: true,
        members: [{ path: "bodies.js", bytes }],
      },
    ],
    catalog: Object.entries(source.entries).map(([key, entry]) => ({
      key,
      ...entry.axes,
      uses: [],
    })),
  });
  const admitted = admission.admitUnknown({ ...source, artifact });
  if (!admitted.ok) throw Error(JSON.stringify(admitted.diagnostics));
  const route = admitted.route;
  const tokens = createRouteTokenIssuer();
  const scope = tokens.scope({
    target: null,
    work: { binding: "workspace", target: null, route: route.data.key, work: "one" },
  });
  const token = unwrap(tokens.attempt(scope, "read", 1));
  const invocation = unwrap(
    tokens.invocation("invoke", {
      token,
      pageEpoch: tokens.pageEpoch(),
      pageRevision: 0,
      workRevision: 0,
      dependencies: {},
    }),
  );
  const issuer = createRouteEnvironmentIssuer();
  let current = true;
  let admittedNow = true;
  let generation = 1;
  const validate = {
    detail: () => true,
    geometryScope: () => true,
    admitted: (candidate: unknown) => admittedNow && candidate === route,
    token: (candidate: unknown) => current && candidate === token,
    invocation: (candidate: unknown) => current && candidate === invocation,
    scope: (candidate: unknown) => current && candidate === scope,
    key: (key: { freshnessGeneration: number }) => key.freshnessGeneration === generation,
  };
  const key = {
    op: "read",
    processIncarnation: "p1",
    documentLifetime: "d1",
    sortedKeyInput: "{}",
    freshnessGeneration: 1,
  };
  let emit = () => {};
  const release = vi.fn();
  const unsubscribe = vi.fn();
  const dispatch = vi.fn();
  const ports: EnvironmentPorts = {
    reads: {
      lifetime: "read",
      acquire: (request) => {
        dispatch();
        return {
          lifetime: "read",
          key: request.key,
          release,
          read: () => ({ status: "pending", current: false, reason: "Waiting" }),
        };
      },
    },
    geometry: {
      acquire: (request) => {
        dispatch();
        return {
          lifetime: "read",
          key: request.key,
          release,
          read: () => ({ status: "pending", current: false, reason: "Waiting" }),
        };
      },
    },
    readings: {
      lifetime: "subscription",
      subscribe: (_request, _token, deliver) => {
        emit = () => deliver({ status: "pending", current: false, reason: "Late" });
        dispatch();
        deliver({ status: "pending", current: false, reason: "Waiting" });
        return unsubscribe;
      },
    },
    work: {
      read: { lifetime: "read", read: () => null },
      submit: {
        lifetime: "command",
        submit: () => {
          throw Error("Command unavailable");
        },
      },
    },
    availability: {},
    clock: { lifetime: "read", now: () => 42 },
    submitNative: () => {
      dispatch();
      throw Error("Command unavailable");
    },
  };
  const options = { issuer, validate, ports };
  const fixtureOptions = {
    issuer,
    validate,
    workSpec: {
      route: route.data.key,
      title: "Test",
      description: "Test",
      schema: z.object({ amount: z.number() }),
    },
    now: () => 42,
  };
  return {
    ...createRouteEnvironment(options),
    options,
    fixtureOptions,
    issuer,
    token,
    scope,
    invocation,
    route,
    key,
    read: issuer.mintRead(key, z.number(), route),
    release,
    unsubscribe,
    emit: () => emit(),
    dispatch,
    stale: () => {
      current = false;
    },
    deactivate: () => {
      admittedNow = false;
    },
    refresh: () => {
      generation++;
    },
  };
}
test("copies, proxies, admission, attempts and document freshness gate transport", async () => {
  const s = await setup();
  for (const copy of [Object.assign({}, s.read), new Proxy(s.read, {})])
    expect(() => s.environment.reads.acquire(copy, s.token)).toThrow();
  expect(() => s.environment.reads.acquire(s.read, Object.assign({}, s.token))).toThrow();
  expect(s.dispatch).not.toHaveBeenCalled();
  s.environment.reads.acquire(s.read, s.token);
  s.refresh();
  expect(() => s.environment.reads.acquire(s.read, s.token)).toThrow();
  s.close();
  expect(s.release).toHaveBeenCalledTimes(1);
  const t = await setup();
  t.deactivate();
  expect(() => t.environment.reads.acquire(t.read, t.token)).toThrow();
});
test("geometry binds immutable key/request/token and refuses rebound composites", async () => {
  const s = await setup();
  const request: GeometryRequest = {
    representation: "overview",
    subjects: { kind: "ids", ids: [] },
    scope: s.scope,
  };
  const key = { ...s.key, sortedKeyInput: canonicalEnvironmentInput(request) };
  const geometry = s.issuer.mintGeometry(
    key,
    z.object({ kind: z.literal("unavailable"), reason: z.string() }),
    s.route,
    s.token,
    request,
  );
  key.documentLifetime = "mutated";
  expect(geometry.key.documentLifetime).toBe("d1");
  expect(Object.isFrozen(geometry.request)).toBe(true);
  expect(() =>
    s.environment.geometry.acquire(Object.assign({}, geometry, { request }), s.token),
  ).toThrow();
  expect(() =>
    s.issuer.mintGeometry(
      { ...key, sortedKeyInput: "{}" },
      geometry.output,
      s.route,
      s.token,
      request,
    ),
  ).toThrow();
  expect(s.dispatch).not.toHaveBeenCalled();
  const handle = s.environment.geometry.acquire(geometry, s.token);
  s.stale();
  expect(handle.read()).toMatchObject({ status: "unavailable" });
  expect(() => s.environment.geometry.acquire(geometry, s.token)).toThrow();
  s.close();
});
test("detail authority refuses background, copied, nonfinite and small reaches, without cost cap", async () => {
  const s = await setup();
  const explicit = unwrap(s.environment.geometry.requestDetail(s.invocation));
  const subject = {
    kind: "region" as const,
    id: unwrap(localCodec.encode({ namespace: "region", subject: "one" })),
  };
  for (const reach of [4.99, NaN, Infinity])
    expect(s.environment.geometry.prepareReach(subject, reach, explicit).ok).toBe(false);
  expect(s.environment.geometry.prepareReach(subject, 50000, explicit).ok).toBe(true);
  expect(s.environment.geometry.prepareReach(subject, 5, Object.assign({}, explicit)).ok).toBe(
    false,
  );
  s.stale();
  expect(s.environment.geometry.requestDetail(s.invocation).ok).toBe(false);
});
test("subscription and read lifetimes release once; command submission revalidates", async () => {
  const s = await setup();
  const deliver = vi.fn();
  const stop = s.environment.readings.subscribe(s.read, s.token, deliver);
  expect(deliver).toHaveBeenCalledTimes(1);
  expect(s.environment.nativeWrite?.lifetime).toBe("command");
  expect(() =>
    s.environment.nativeWrite?.submit({
      route: s.route,
      invocation: s.invocation,
      entry: "write",
      input: {},
    }),
  ).toThrow("Command unavailable");
  s.stale();
  s.emit();
  expect(deliver).toHaveBeenCalledTimes(1);
  stop();
  s.emit();
  stop();
  s.stale();
  expect(() =>
    s.environment.nativeWrite?.submit({
      route: s.route,
      invocation: s.invocation,
      entry: "write",
      input: {},
    }),
  ).toThrow("Stale");
  s.close();
  expect(s.unsubscribe).toHaveBeenCalledTimes(1);
});
effectTest("Effect service scope releases acquisitions", () =>
  Effect.gen(function* () {
    const s = yield* Effect.promise(() => setup());
    yield* Effect.scoped(
      Effect.gen(function* () {
        const environment = yield* RouteEnvironmentService;
        environment.reads.acquire(s.read, s.token);
      }).pipe(Effect.provide(routeEnvironmentLayer(s.options))),
    );
    expect(s.release).toHaveBeenCalledTimes(1);
  }),
);
test.each(["live", "fixture"] as const)("%s uses the same lifetime interface", async (kind) => {
  const s = await setup();
  const owner =
    kind === "live"
      ? s
      : createFixtureRouteEnvironment({
          ...s.fixtureOptions,
          seed: { readings: { read: 7 }, work: { amount: 1 } },
        });
  expect(owner.environment.reads.acquire(s.read, s.token).lifetime).toBe("read");
  expect(owner.environment.readings.lifetime).toBe("subscription");
  expect(owner.environment.work.submit.lifetime).toBe("command");
  expect(owner.environment.clock.now()).toBe(42);
  owner.close();
  expect(() => owner.environment.reads.acquire(s.read, s.token)).toThrow("closed");
});
test("missing/empty seed never calls live factory, and fixtures keep independent Works", async () => {
  const s = await setup();
  const real = vi.fn(() => s);
  for (const name of ["", "missing"]) {
    const selected = selectRouteEnvironment({
      search: { fixture: name },
      live: real,
      fixture: () => createFixtureRouteEnvironment({ ...s.fixtureOptions, seed: undefined }),
    });
    expect(selected.environment.reads.acquire(s.read, s.token).read()).toMatchObject({
      status: "unavailable",
    });
    expect(selected.environment.nativeWrite).toBeUndefined();
    selected.close();
  }
  expect(real).not.toHaveBeenCalled();
  expect(s.dispatch).not.toHaveBeenCalled();
  const seed = { readings: { read: 7 }, work: { amount: 1 } };
  const a = createFixtureRouteEnvironment({ ...s.fixtureOptions, seed });
  const b = createFixtureRouteEnvironment({
    ...s.fixtureOptions,
    seed: { ...seed, work: { amount: 9 } },
  });
  expect(a.environment.reads.acquire(s.read, s.token).read()).toMatchObject({
    status: "ready",
    value: 7,
  });
  expect(a.environment.work.read.read(s.scope)?.value).toEqual({ amount: 1 });
  seed.work.amount = 8;
  expect(a.environment.work.read.read(s.scope)?.value).toEqual({ amount: 1 });
  expect(b.environment.work.read.read(s.scope)?.value).toEqual({ amount: 9 });
  a.close();
  b.close();
});

test("fixture Work edits run the same pure derive and retain causal command handles", async () => {
  const s = await setup();
  const seed = { readings: {}, work: { amount: 1 } };
  const a = createFixtureRouteEnvironment({ ...s.fixtureOptions, seed });
  const b = createFixtureRouteEnvironment({ ...s.fixtureOptions, seed });
  a.environment.work.read.read(s.scope);
  b.environment.work.read.read(s.scope);
  const command = a.environment.work.submit.submit(s.route, s.invocation, {
    expectedRevision: 0,
    patches: [{ path: ["amount"], value: 7 }],
    press: null,
    kind: "apply",
  });
  expect(command).toMatchObject({
    lifetime: "command",
    id: command.id,
    causalParent: command.id,
  });
  const derive = (value: unknown) => z.object({ amount: z.number() }).parse(value).amount * 2;
  expect(derive(a.environment.work.read.read(s.scope)?.value)).toBe(14);
  expect(derive(b.environment.work.read.read(s.scope)?.value)).toBe(2);
  expect(() =>
    a.environment.work.submit.submit(s.route, s.invocation, {
      expectedRevision: 0,
      patches: [],
      press: null,
      kind: "apply",
    }),
  ).toThrow();
  a.close();
  b.close();
});

test("non-explicit invocations and subjects from another scope cannot acquire geometry", async () => {
  const s = await setup();
  const denied = createRouteEnvironment({
    ...s.options,
    validate: { ...s.options.validate, detail: () => false },
  });
  expect(denied.environment.geometry.requestDetail(s.invocation).ok).toBe(false);
  const explicit = unwrap(s.environment.geometry.requestDetail(s.invocation));
  const reach = unwrap(
    s.environment.geometry.prepareReach(
      { kind: "region", id: unwrap(localCodec.encode({ namespace: "regions", subject: "one" })) },
      5,
      explicit,
    ),
  );
  const request = { representation: "meshes" as const, reach };
  const geometry = s.issuer.mintGeometry(
    { ...s.key, sortedKeyInput: canonicalEnvironmentInput(request) },
    z.object({ kind: z.literal("unavailable"), reason: z.string() }),
    s.route,
    s.token,
    request,
  );
  const foreign = createRouteEnvironment({
    ...s.options,
    validate: { ...s.options.validate, geometryScope: () => false },
  });
  expect(() => foreign.environment.geometry.acquire(geometry, s.token)).toThrow("scope");
  expect(s.dispatch).not.toHaveBeenCalled();
  denied.close();
  foreign.close();
  s.close();
});

import { createMountEnvironment } from "./mount-environment";
import { createGraphMount } from "./mount-owner";
import { createRouteScopeGate } from "../../../../packages/runtime/src/route-scope-gate";
import { type RouteGraph } from "@pe/agent-contracts";
import { testSubject, testReadings, testSources, testFields } from "../test-route-subject";
import { createSubmissionJournal } from "./legacy-environment-bridge";

test("mounted capabilities select once, isolate Works, and gate reads, SSE and geometry with B", async () => {
  const s = await setup();
  const gate = createRouteScopeGate({
    dependencies: () => ({}),
    preparePage: () => ({ ok: false, reason: "not used" }),
  });
  const scope = gate.enter(s.scope.identity, {});
  const token = gate.capture("read");
  const invocation = unwrap(gate.invocation(token, {}));
  const live = vi.fn(() => s.options.ports);
  const make = (name: string) =>
    createMountEnvironment({
      route: s.route,
      search: { fixture: name },
      acceptance: gate,
      common: {
        issuer: s.issuer,
        validate: {
          ...s.options.validate,
          token: () => true,
          scope: () => true,
          invocation: () => true,
        },
      },
      live,
      fixture: (name) => ({
        ...s.fixtureOptions,
        seed: name === "seed" ? { readings: { read: 7 }, work: { amount: 1 } } : undefined,
      }),
    });
  const graph: RouteGraph<Record<string, unknown>, unknown> = {
    ...testSubject,
    key: s.route.data.key,
    address: "environment-owner",
    name: "Environment owner",
    fields: testFields,
    readings: testReadings,
    verbs: {},
    panes: { main: { label: "Main", purpose: "Proof", draws: [], verbs: [] } },
    stages: { main: { word: "Main", panes: ["main"], verbs: [] } },
    layout: { kind: "pane", id: "main" },
  };
  const mount = (environment: ReturnType<typeof make>) =>
    createGraphMount(graph, {
      environment,
      sources: testSources,
      getSnapshot: () => ({ target: { kind: "host" }, work: null }),
      subscribe: () => () => {},
      write: async () => {
        throw Error("Legacy write reached");
      },
      subscribeAcceptedDeltas: () => () => {},
    });
  const a = mount(make("seed"));
  const b = mount(make("seed"));
  const missing = mount(make("missing"));
  const read = s.issuer.mintRead(s.key, z.number(), s.route);
  expect(a.readings.acquire(read, token).read()).toMatchObject({ status: "ready", value: 7 });
  const delivery = vi.fn();
  const unsubscribe = a.readings.subscribeResolved(read, token, delivery);
  expect(delivery).toHaveBeenCalledWith(expect.objectContaining({ value: 7 }));
  expect(missing.readings.acquire(read, token).read()).toMatchObject({ status: "unavailable" });
  expect(a.readWork(scope)?.value).toEqual({ amount: 1 });
  expect(b.readWork(scope)?.value).toEqual({ amount: 1 });
  const command = a.submitWork(s.route, invocation, {
    expectedRevision: 0,
    press: null,
    kind: "apply",
    patches: [{ path: ["amount"], value: 8 }],
  });
  expect(command.lifetime).toBe("command");
  expect(command.causalParent).toBeTruthy();
  expect(a.readWork(scope)?.value).toEqual({ amount: 8 });
  expect(b.readWork(scope)?.value).toEqual({ amount: 1 });
  expect(() => a.submitNative({ route: s.route, invocation, entry: "write", input: {} })).toThrow(
    "unavailable",
  );
  const request: GeometryRequest = {
    representation: "overview",
    subjects: { kind: "ids", ids: [] },
    scope,
  };
  const geometry = s.issuer.mintGeometry(
    { ...s.key, sortedKeyInput: canonicalEnvironmentInput(request) },
    z.object({ kind: z.literal("unavailable"), reason: z.string() }),
    s.route,
    token,
    request,
  );
  expect(() => a.readings.acquireGeometry(Object.assign({}, geometry), token)).toThrow();
  expect(a.readings.acquireGeometry(geometry, token).read().status).toBe("failed");
  gate.retire(token);
  expect(() => a.readings.acquire(read, token)).toThrow("stale");
  expect(() => a.readings.subscribeResolved(read, token, delivery)).toThrow("stale");
  expect(() => a.readings.acquireGeometry(geometry, token)).toThrow("stale");
  expect(live).not.toHaveBeenCalled();
  expect(s.dispatch).not.toHaveBeenCalled();
  unsubscribe();
  a.dispose();
  b.dispose();
  missing.dispose();
  gate.close();
  s.close();
  expect(command.causalParent).toBeTruthy();
});

test("native journal submissions survive environment close and preserve their causal parent", async () => {
  const s = await setup();
  const journal = createSubmissionJournal();
  const parent = journal.submit("parent", async () => "parent");
  const execute = vi.fn(async () => "receipt");
  const submitted = journal.submit("child", execute, parent.causalParent);
  const environment = createRouteEnvironment({
    ...s.options,
    ports: { ...s.options.ports, submitNative: () => submitted },
  });
  const handle = environment.environment.nativeWrite!.submit({
    route: s.route,
    invocation: s.invocation,
    entry: "write",
    input: {},
  });
  environment.close();
  expect(handle.causalParent).toBe(parent.causalParent);
  expect("invoke" in handle).toBe(false);
  expect(await submitted.result).toBe("receipt");
  expect(execute).toHaveBeenCalledTimes(1);
  s.close();
});

import { createRouteEnvironmentKernel, type CapabilityPortsFor } from "./route-environment";

test("empty capability composition needs only application baseline and retains descriptor refusal", async () => {
  const s = await setup(true);
  const baseline = {
    reads: s.options.ports.reads,
    readings: s.options.ports.readings,
    clock: s.options.ports.clock,
    availability: s.options.ports.availability,
  };
  const kernel = createRouteEnvironmentKernel(baseline);
  const owner = kernel.bind(readOnlyModule.data, s.options.validate, {});
  expect(Object.keys(owner.environment).sort()).toEqual([
    "availability",
    "clock",
    "readings",
    "reads",
  ]);
  expect("issuer" in owner).toBe(false);
  const request = owner.resolveRead(s.key, z.number(), s.route);
  expect(owner.environment.reads.acquire(request, s.token).read().status).toBe("pending");
  expect(() => owner.environment.reads.acquire(s.read, s.token)).toThrow("Unissued");
  owner.close();
  expect(() => owner.environment.reads.acquire(request, s.token)).toThrow("closed");
  s.close();
});
test("declared groups require exact transports at runtime as well as at the type boundary", async () => {
  const s = await setup();
  const kernel = createRouteEnvironmentKernel({
    reads: s.options.ports.reads,
    readings: s.options.ports.readings,
    clock: s.options.ports.clock,
    availability: s.options.ports.availability,
  });
  const declaration = { capabilities: ["work", "geometry", "native-write"] } as const;
  const groups: CapabilityPortsFor<typeof declaration> = {
    work: s.options.ports.work,
    geometry: s.options.ports.geometry,
    nativeWrite: s.options.ports.submitNative!,
  };
  const owner = kernel.bind(declaration, s.options.validate, groups);
  expect(owner.environment.geometry.requestDetail(s.invocation).ok).toBe(true);
  expect(owner.environment.work.read.read(s.scope)).toBeNull();
  expect(() =>
    owner.environment.nativeWrite.submit({
      route: s.route,
      invocation: s.invocation,
      entry: "apply",
      input: {},
    }),
  ).toThrow("Command unavailable");
  expect(() => {
    // @ts-expect-error omitted groups cannot acquire services through a variable
    kernel.bind({ capabilities: [] } as const, s.options.validate, groups);
  }).toThrow("Capability service mismatch");
  expect(() => {
    // @ts-expect-error declared groups require their services
    kernel.bind(declaration, s.options.validate, {});
  }).toThrow("Capability service mismatch");
  owner.close();
  s.close();
});
