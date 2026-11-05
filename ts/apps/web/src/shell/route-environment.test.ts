import { createFixtureWorkDoor } from "./fixture-work-door";
const command = { id: "write", key: "write", target: { kind: "host" as const }, input: {} };
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
import { createAdmittedReadingPlan } from "./admitted-reading-plan";
import {
  createNamedFixtureRouteEnvironment,
  createFixtureRouteEnvironment,
  selectRouteEnvironment,
} from "./fixture-lane";
import type { RouteFingerprintInput } from "../../../../packages/agent-contracts/src/route-kernel-admission.ts";
const unwrap = <T>(result: DecodeResult<T>): T => {
  if (!result.ok) throw new Error(result.reason);
  return result.value;
};
async function setup(
  readOnly = false,
  sourceOverride?: Omit<typeof builtinModule, "data"> & {
    data: import("../../../../packages/agent-contracts/src/route-kernel-data").RouteGraphJson;
  },
) {
  const source = sourceOverride ?? (readOnly ? readOnlyModule : builtinModule);
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
    key: (key: { freshnessGeneration: number | string | null }) =>
      key.freshnessGeneration === generation,
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
    work: (() => {
      const door = createFixtureWorkDoor(
        { route: "test", title: "", description: "", schema: z.object({ amount: z.number() }) },
        { amount: 0 },
      );
      return { read: door, submit: door };
    })(),
    availability: {},
    clock: { lifetime: "read", now: () => 42 },
    submitNative: () => {
      dispatch();
      throw Error("Command unavailable");
    },
  };
  const options = { issuer, validate, ports };
  const plan = createAdmittedReadingPlan({ route, issuer, key });
  const fixtureRead = plan.request("roster", { page: { search: "" }, work: {}, readings: {} })!;
  const fixtureOptions = {
    plan,
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
    fixtureRead,
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
  expect(() => s.environment.nativeWrite?.submit(command)).toThrow("Command unavailable");
  s.stale();
  s.emit();
  expect(deliver).toHaveBeenCalledTimes(1);
  stop();
  s.emit();
  stop();
  s.stale();
  expect(() => s.environment.nativeWrite?.submit(command)).toThrow("Command unavailable");
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
          seed: { readings: { roster: [] }, work: { amount: 1 } },
        });
  expect(owner.environment.reads.acquire(s.read, s.token).lifetime).toBe("read");
  expect(owner.environment.readings.lifetime).toBe("subscription");
  expect(owner.environment.work.read.lifetime).toBe("subscription");
  expect(owner.environment.clock.now()).toBe(42);
  owner.close();
  expect(() => owner.environment.reads.acquire(s.read, s.token)).toThrow("closed");
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
  expect(owner.environment.work.read.lifetime).toBe("subscription");
  expect(() => owner.environment.nativeWrite.submit(command)).toThrow("Command unavailable");
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

test("fixture plan separates the same operation by reading id and exact descriptor, then derives normally", async () => {
  const source = {
    ...builtinModule,
    data: {
      ...builtinModule.data,
      seeds: { example: { title: "Example", load: "exampleSeed" } },
      readings: {
        ...builtinModule.data.readings,
        rosterAgain: { ...builtinModule.data.readings.roster, args: "againArgs" },
        total: {
          ...builtinModule.data.readings.total,
          deps: {
            ...builtinModule.data.readings.total.deps,
            readings: ["roster", "rosterAgain"] as const,
          },
        },
      },
    },
    bodies: {
      ...builtinModule.bodies,
      exampleSeed: {
        slot: "seeds.example.load",
        kind: "seed",
        source: builtinModule.bodies.rosterArgs.source,
        run: () => ({ readings: { roster: [], rosterAgain: [] }, work: { amount: 2 } }),
      },
      againArgs: {
        ...builtinModule.bodies.rosterArgs,
        slot: "readings.rosterAgain.args",
        run: () => ({ filter: "second" }),
      },
    },
  };
  const s = await setup(false, source);
  const first = {
    id: unwrap(localCodec.encode({ namespace: "fixture", subject: "one" })),
    name: "First",
  };
  const fixture = createFixtureRouteEnvironment({
    ...s.fixtureOptions,
    seed: {
      readings: { roster: [first], rosterAgain: [], total: { total: 999 } },
      work: { amount: 3 },
    },
  });
  const plan = s.fixtureOptions.plan;
  const named = createNamedFixtureRouteEnvironment({ ...s.fixtureOptions, name: "example" });
  expect(named.read("roster", { page: { search: "" }, work: null }, s.token)).toMatchObject({
    current: true,
    value: [],
  });
  named.close();
  const second = plan.request("rosterAgain", { page: {}, work: {}, readings: {} })!;
  expect(second.key.op).toBe(s.fixtureRead.key.op);
  expect(second.key.sortedKeyInput).not.toBe(s.fixtureRead.key.sortedKeyInput);
  expect(fixture.environment.reads.acquire(s.fixtureRead, s.token).read()).toMatchObject({
    current: true,
    value: [first],
  });
  expect(fixture.environment.reads.acquire(second, s.token).read()).toMatchObject({
    current: true,
    value: [],
  });
  const unbound = s.issuer.mintRead(second.key, second.output, s.route);
  expect(fixture.environment.reads.acquire(unbound, s.token).read()).toMatchObject({
    status: "unavailable",
  });
  expect(() => fixture.environment.reads.acquire(Object.assign({}, second), s.token)).toThrow();
  expect(
    fixture.read("total", { page: { system: null, search: "" }, work: { amount: 3 } }, s.token),
  ).toMatchObject({ current: true, value: { total: 3 } });
  const bad = createFixtureRouteEnvironment({
    ...s.fixtureOptions,
    seed: { readings: { roster: 42, rosterAgain: [] } },
  });
  expect(bad.environment.reads.acquire(s.fixtureRead, s.token).read()).toMatchObject({
    status: "failed",
  });
  const missing = createFixtureRouteEnvironment({
    ...s.fixtureOptions,
    seed: { readings: { roster: [first] } },
  });
  expect(missing.read("total", { page: {}, work: { amount: 3 } }, s.token)).toMatchObject({
    status: "unavailable",
  });
  expect(s.dispatch).not.toHaveBeenCalled();
  fixture.close();
  bad.close();
  missing.close();
  plan.close();
  s.close();
});

test("named fixtures refuse unknown and empty names before live factories; read-only fixtures have no Work", async () => {
  const s = await setup(true);
  const { workSpec: _unused, ...options } = s.fixtureOptions;
  const live = vi.fn(() => s);
  for (const name of ["", "unknown", "toString"]) {
    const fixture = selectRouteEnvironment({
      search: { fixture: name },
      live,
      fixture: (name) => createNamedFixtureRouteEnvironment({ ...options, name }),
    });
    expect(fixture.environment.reads.acquire(s.fixtureRead, s.token).read()).toMatchObject({
      status: "unavailable",
    });
    expect(fixture.environment.work).toBeUndefined();
    fixture.close();
  }
  expect(live).not.toHaveBeenCalled();
  expect(s.dispatch).not.toHaveBeenCalled();
  const fixture = createFixtureRouteEnvironment({
    ...options,
    seed: { readings: { roster: [] }, work: { amount: 42 } },
  });
  expect(fixture.environment.work).toBeUndefined();
  fixture.close();
  s.fixtureOptions.plan.close();
  s.close();
});
