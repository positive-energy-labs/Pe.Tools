import { Context, Effect, Exit, Layer, Scope } from "effect";
import { expect, test, vi } from "vite-plus/test";
import { RouteWorkspace, observeResources } from "@pe/runtime";
import { bindWork, workKey, type ReadingFrame, type ReadingRequest } from "@pe/agent-contracts";
import {
  builtinClosureFingerprint,
  type BuiltinClosure,
} from "../../../packages/agent-contracts/src/route-module.ts";
import { workFingerprintSchema } from "../../../packages/agent-contracts/src/route-kernel-admission.ts";
import type { HostRouteModule } from "../../../packages/agent-contracts/src/host-route-admission.ts";
import { createRouteRegistrations } from "../../../packages/mcps/src/pea/routes.ts";
import { AdmittedBuiltins, admittedBuiltinsLayer } from "../src/admitted-builtins.ts";
import { builtinEnrollments, type BuiltinEnrollment } from "../src/builtin-enrollment.ts";
import { fixture } from "./fixtures/builtin.neutral.ts";

async function entry(
  module = fixture,
  workOwner?: BuiltinClosure["workOwner"],
): Promise<BuiltinEnrollment> {
  const envelope: BuiltinClosure = {
    source: "builtin-closure",
    version: 1,
    data: module.data,
    workOwner,
    hostVersion: "u8b",
    modules: [{ id: "builtin.neutral.ts", sha256: "a".repeat(64) }],
    variants: [{ client: "web", entry: "builtin.neutral.ts" }],
    inputs: [],
    externals: [],
  };
  // Omit absent optional fields because JCS refuses undefined.
  if (!workOwner) delete (envelope as { workOwner?: unknown }).workOwner;
  return {
    routeKey: module.data.key,
    closure: { envelope, fingerprint: await builtinClosureFingerprint(envelope) },
    load: async () => module,
  };
}
function workspace() {
  const saved = new Map<string, unknown>();
  const store = {
    getState: async ({ targetKey }: { targetKey: string }) => saved.get(targetKey),
    setState: async ({ targetKey, value }: { targetKey: string; value: unknown }) => {
      saved.set(targetKey, value);
    },
    listState: async () => ({
      records: [...saved].map(([targetKey, value]) => ({ targetKey, route: "u8b", value })),
      truncated: false,
      unreadable: 0,
      unindexed: 0,
    }),
  };
  return { saved, store, workspace: new RouteWorkspace({ registrations: [], store }) };
}
async function open(ws: RouteWorkspace, inventory?: readonly BuiltinEnrollment[]) {
  // effect-edge: test-runner
  return Effect.runPromise(
    Effect.gen(function* () {
      const scope = yield* Scope.make();
      const result = yield* Effect.exit(
        Layer.buildWithScope(admittedBuiltinsLayer(ws, inventory), scope),
      );
      if (Exit.isFailure(result)) {
        yield* Scope.close(scope, Exit.void);
        return { scope, result, service: undefined };
      }
      return { scope, result, service: Context.get(result.value, AdmittedBuiltins) };
    }),
  );
}
async function close(scope: Scope.Scope) {
  // effect-edge: test-runner
  await Effect.runPromise(Scope.close(scope, Exit.void));
}
test("Captures admits only a registry receipt using its generated full web closure", async () => {
  const f = workspace();
  const run = await open(f.workspace);
  expect(run.service).toBeDefined();
  const route = run.service!.routes.get("captures")!;
  try {
    expect(route.fingerprint).toBe(builtinEnrollments[0]!.closure.fingerprint);
    expect(run.service!.registry.resolve(route)).toBe(route);
    expect(route.data.work).toBeUndefined();
  } finally {
    await close(run.scope);
  }
  expect(run.service!.registry.resolve(route)).toBeNull();
});
test("neutral Work migration precedes exact feeds; stale fingerprints refuse and shutdown retires both feeds", async () => {
  const f = workspace();
  const key = bindWork("u8b", null);
  f.saved.set(workKey(key), {
    version: 1,
    schemaVersion: 1,
    revision: 7,
    doc: { old: 3 },
    history: [],
  });
  const run = await open(f.workspace, [await entry()]);
  expect(run.service).toBeDefined();
  const route = run.service!.routes.get("u8b")!;
  const observe = observeResources(f.workspace, { observe: () => () => {} });
  const release: (() => void)[] = [];
  const frames: ReadingFrame[][] = [];
  try {
    expect(f.saved.get(workKey(key))).toMatchObject({
      schemaVersion: 2,
      revision: 8,
      doc: { amount: 4 },
    });
    for (const kind of ["work", "work-acks"] as const)
      for (const fingerprint of [
        route.workFingerprint,
        workFingerprintSchema.parse(`builtin-closure:${"0".repeat(64)}`),
      ]) {
        const values: ReadingFrame[] = [];
        frames.push(values);
        const admission = { routeKey: route.data.key, fingerprint };
        const request: ReadingRequest =
          kind === "work" ? { ...key, kind, admission } : { kind, work: key, admission };
        release.push(observe(request, (value) => values.push(value)));
      }
    await vi.waitFor(() =>
      expect([frames[0], frames[1], frames[3]].every((values) => values!.length > 0)).toBe(true),
    );
    expect(frames[0]![0]).toMatchObject({ kind: "snapshot", value: { doc: { amount: 4 } } });
    expect(frames[1]![0]).toMatchObject({
      kind: "failure",
      failure: { kind: "registration-mismatch" },
    });
    expect(frames[3]![0]).toMatchObject({
      kind: "failure",
      failure: { kind: "registration-mismatch" },
    });
  } finally {
    await close(run.scope);
  }
  await vi.waitFor(() => expect(frames[0]!.at(-1)).toMatchObject({ kind: "failure" }));
  expect(frames[2]!.at(-1)).toMatchObject({ kind: "failure" });
  expect(run.service!.registry.resolve(route)).toBeNull();
  release.forEach((stop) => stop());
});
test("owner precedes presenter with an unchanged pinned fingerprint and one migration", async () => {
  const f = workspace();
  const owner = await entry();
  const pinned = workFingerprintSchema.parse(`builtin-closure:${owner.closure.fingerprint}`);
  const presenterModule: HostRouteModule = {
    data: {
      ...fixture.data,
      key: "u8b-presenter",
      address: "/u8b-presenter",
      work: { route: "u8b" },
    },
    schemas: {},
    bodies: {},
  };
  const presenter = await entry(presenterModule, { route: "u8b", fingerprint: pinned });
  const run = await open(f.workspace, [owner, presenter]);
  expect(run.service).toBeDefined();
  try {
    expect(run.service!.routes.get("u8b-presenter")!.workFingerprint).toBe(pinned);
  } finally {
    await close(run.scope);
  }
  const reversed = await open(f.workspace, [presenter, owner]);
  expect(Exit.isFailure(reversed.result)).toBe(true);
  const stale = await entry(presenterModule, {
    route: "u8b",
    fingerprint: workFingerprintSchema.parse(`builtin-closure:${"0".repeat(64)}`),
  });
  const mismatch = await open(f.workspace, [owner, stale]);
  expect(Exit.isFailure(mismatch.result)).toBe(true);
});
test("partial startup failure unwinds prior Work registration with a typed failure", async () => {
  const f = workspace();
  const good = await entry();
  const bad = {
    ...good,
    routeKey: "broken",
    load: async () => {
      throw Error("load failed");
    },
  };
  const run = await open(f.workspace, [good, bad]);
  expect(Exit.isFailure(run.result)).toBe(true);
  expect(String(run.result)).toContain("BuiltinEnrollmentFailed");
  expect(
    await f.workspace.admitFeed(bindWork("u8b", null), {
      routeKey: "u8b",
      fingerprint: workFingerprintSchema.parse(`builtin-closure:${good.closure.fingerprint}`),
    }),
  ).toMatchObject({ code: "WorkRouteUnregistered" });
});
test("cutover excludes the admitted owner from legacy Work registration", () => {
  const keys = createRouteRegistrations().map((r) => r.spec.route);
  expect(keys).not.toContain("captures");
  expect(keys.length).toBeGreaterThan(0);
  expect(
    createRouteRegistrations({ admittedKeys: [keys[0]!] }).some((r) => r.spec.route === keys[0]),
  ).toBe(false);
});

test("shutdown fences a neutral load that resolves after its acquisition scope closes", async () => {
  const f = workspace();
  const good = await entry();
  let resolveLoad!: (value: HostRouteModule) => void;
  let loading = false;
  const pending = new Promise<HostRouteModule>((resolve) => {
    resolveLoad = resolve;
  });
  // effect-edge: test-runner
  const scope = await Effect.runPromise(Scope.make());
  // effect-edge: test-runner
  const building = Effect.runPromise(
    Effect.exit(
      Layer.buildWithScope(
        admittedBuiltinsLayer(f.workspace, [
          {
            ...good,
            load: () => {
              loading = true;
              return pending;
            },
          },
        ]),
        scope,
      ),
    ),
  );
  await vi.waitFor(() => expect(loading).toBe(true));
  await close(scope);
  resolveLoad(fixture);
  expect(Exit.isFailure(await building)).toBe(true);
  expect(
    await f.workspace.admitFeed(bindWork("u8b", null), {
      routeKey: "u8b",
      fingerprint: workFingerprintSchema.parse(`builtin-closure:${good.closure.fingerprint}`),
    }),
  ).toMatchObject({ code: "WorkRouteUnregistered" });
});
