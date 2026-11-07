import { createFixtureWorkDoor } from "./fixture-work-door";




const command = { id: "write", key: "write", target: { kind: "host" as const }, input: {} };
import { createHash } from "node:crypto";
import { expect, test, vi } from "vite-plus/test";
import { Effect } from "effect";
import { effectTest } from "../../../host/tests/effect-test.ts";
import { z } from "zod";
import { builtinModule, readOnlyModule } from "../../../../packages/agent-contracts/src/route-kernel.fixtures.ts";
import {
  createRouteAdmission,
  routeFingerprint,
} from "../../../../packages/agent-contracts/src/route-module.ts";
import {
  createRouteTokenIssuer,
  type DecodeResult,
} from "../../../../packages/agent-contracts/src/route-kernel-page.ts";
import { createRouteEnvironmentIssuer } from "../../../../packages/agent-contracts/src/route-kernel-environment.ts";
import {
  createRouteEnvironment,
  routeEnvironmentLayer,
  RouteEnvironmentService,
  type EnvironmentPorts,
} from "./route-environment";
import { createAdmittedReadingPlan } from "./admitted-reading-plan";

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
