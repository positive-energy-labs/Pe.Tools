import { Effect } from "effect";
import { createHash } from "node:crypto";
import { expect, test, vi } from "vite-plus/test";
import { z } from "zod";
import type { RouteFingerprintInput } from "../../../../packages/agent-contracts/src/route-kernel-admission.ts";
import {
  canonicalEnvironmentInput,
  createRouteEnvironmentIssuer,
} from "../../../../packages/agent-contracts/src/route-kernel-environment.ts";
import {
  createRouteTokenIssuer,
  type DecodeResult,
} from "../../../../packages/agent-contracts/src/route-kernel-page.ts";
import {
  builtinModule,
  readOnlyModule,
  localCodec,
} from "../../../../packages/agent-contracts/src/route-kernel.fixtures.ts";
import {
  createRouteAdmission,
  routeFingerprint,
} from "../../../../packages/agent-contracts/src/route-module.ts";
import { effectTest } from "../../../host/tests/effect-test.ts";
import { createAdmittedReadingPlan } from "./admitted-reading-plan";

import { createFixtureWorkDoor } from "./fixture-work-door";
import {
  createRouteEnvironment,
  routeEnvironmentLayer,
  RouteEnvironmentService,
  type EnvironmentPorts,
} from "./route-environment";
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
