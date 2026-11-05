import { Cause, Context, Effect, Exit, Layer, Scope } from "effect";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { settle } from "./effect-test.ts";
import { RouteWorkspace } from "@pe/runtime";
import { bindWork } from "@pe/agent-contracts";
import { workFingerprintSchema } from "../../../packages/agent-contracts/src/route-kernel-admission.ts";
import type { HostRouteModule } from "../../../packages/agent-contracts/src/host-route-admission.ts";
import { createRouteRegistrations } from "../../../packages/mcps/src/pea/routes.ts";
import {
  AdmittedBuiltins,
  admittedBuiltinsLayer,
  BuiltinEnrollmentFailed,
  constructorWorkRegistrations,
} from "../src/admitted-builtins.ts";
import { builtinEnrollments, type BuiltinEnrollment } from "../src/builtin-enrollment.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileRouteDocumentStore } from "../src/route-document-store.ts";
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const enrollment = (key = "fans") => builtinEnrollments.find((entry) => entry.routeKey === key)!;
function workspace() {
  const root = mkdtempSync(join(tmpdir(), "pe-builtins-"));
  roots.push(root);
  return {
    workspace: new RouteWorkspace({ registrations: [], store: fileRouteDocumentStore(root) }),
  };
}

async function open(ws: RouteWorkspace, inventory?: readonly BuiltinEnrollment[]) {
  return settle(
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
async function close(scope: Scope.Closeable) {
  await settle(Scope.close(scope, Exit.void));
}
test("Captures admits only a registry receipt using its generated full web closure", async () => {
  const f = workspace();
  const run = await open(f.workspace);
  expect(run.service).toBeDefined();
  const route = run.service!.routes.get("captures")!;
  try {
    expect(route.fingerprint).toBe(
      builtinEnrollments.find((entry) => entry.routeKey === "captures")!.closure.fingerprint,
    );
    expect(run.service!.registry.resolve(route)).toBe(route);
    expect(route.data.work).toBeUndefined();
  } finally {
    await close(run.scope);
  }
  expect(run.service!.registry.resolve(route)).toBeNull();
});

test("Ducts and Fans own independent canonical host Work registrations", async () => {
  const f = workspace();
  const run = await open(f.workspace);
  try {
    if (!run.service) throw Error(JSON.stringify(run.result));
    const owner = run.service.routes.get("ducts")!;
    const presenter = run.service.routes.get("fans")!;
    // Q2: each admitted route owns its Work fingerprint.
    expect(presenter.workFingerprint).not.toBe(owner.workFingerprint);
    const view = await f.workspace.view(bindWork("ducts", null), "ducts");
    expect(view!.revision).toBe(0);
    expect(
      await f.workspace.write(bindWork("ducts", null), "ducts", "human", {
        kind: "apply",
        press: "criteria",
        label: "Return allowance",
        expectedRevision: 0,
        patches: [
          { path: ["criteria"], value: { edit: { value: { allowanceInWg: { return: 0.35 } } } } },
        ],
      }),
    ).toMatchObject({ ok: true });
    expect((await f.workspace.view(bindWork("ducts", null), "ducts"))!.doc).toMatchObject({
      criteria: { edit: { value: { allowanceInWg: { return: 0.35 } } } },
    });
    expect(presenter.resolvedWork!.spec.route).toBe("fans");
    expect(owner.resolvedWork!.spec.route).toBe("ducts");
    expect(createRouteRegistrations().filter((row) => row.spec.route === "ducts")).toHaveLength(1);
  } finally {
    await close(run.scope);
  }
});
test("fans enrolls alone with its own Work registration", async () => {
  const f = workspace();
  const fan = enrollment();
  const run = await open(f.workspace, [fan]);
  try {
    expect(run.service?.routes.get("fans")?.resolvedWork?.spec.route).toBe("fans");
    expect(run.service?.routes.has("ducts")).toBe(false);
    const key = bindWork("fans", null);
    expect(
      await f.workspace.admitFeed(key, {
        routeKey: "fans",
        fingerprint: workFingerprintSchema.parse(`builtin-closure:${fan.closure.fingerprint}`),
      }),
    ).toBeNull();
  } finally {
    await close(run.scope);
  }
});
test("partial startup failure unwinds prior Work registration with a typed failure", async () => {
  const f = workspace();
  const good = enrollment();
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
    await f.workspace.admitFeed(bindWork("fans", null), {
      routeKey: "fans",
      fingerprint: workFingerprintSchema.parse(`builtin-closure:${good.closure.fingerprint}`),
    }),
  ).toMatchObject({ code: "WorkRouteUnregistered" });
});
test("Pea's catalog lists admitted Work; the constructor guard keeps one registry owner per key", async () => {
  const registrations = createRouteRegistrations();
  for (const key of ["fans", "ducts", "families"])
    expect(registrations.filter((r) => r.spec.route === key), key).toHaveLength(1);
  const root = mkdtempSync(join(tmpdir(), "pe-builtins-"));
  roots.push(root);
  const ws = new RouteWorkspace({
    registrations: constructorWorkRegistrations(registrations),
    store: fileRouteDocumentStore(root),
  });
  const run = await open(ws);
  try {
    if (!run.service) throw Error(JSON.stringify(run.result));
    const listed = ws.list().map((r) => r.route);
    for (const key of ["fans", "ducts"]) expect(listed.filter((r) => r === key), key).toHaveLength(1);
    // The same owner answers the browser pane and Pea's work.* doors: a write lands one revision both read.
    const key = bindWork("fans", null);
    expect(
      await ws.write(key, "fans", "pea", {
        kind: "apply",
        press: null,
        expectedRevision: 0,
        patches: [{ path: ["writeIntent"], value: { edit: { value: { walk: { unitId: 1, portIndex: 0 } } } } }],
      }),
    ).toMatchObject({ ok: true });
    expect((await ws.view(key, "fans"))!.revision).toBe(1);
  } finally {
    await close(run.scope);
  }
  // Falsifier: without the guard the admitted owner collides with the constructor seat.
  const unguarded = new RouteWorkspace({ registrations, store: fileRouteDocumentStore(root) });
  const collided = await open(unguarded);
  expect(collided.service).toBeUndefined();
  expect(String(collided.result._tag === "Failure" ? Cause.pretty(collided.result.cause) : "")).toMatch(
    /duplicate route/,
  );
});

test("shutdown fences a neutral load that resolves after its acquisition scope closes", async () => {
  const f = workspace();
  const good = enrollment();
  let resolveLoad!: (value: HostRouteModule) => void;
  let loading = false;
  const pending = new Promise<HostRouteModule>((resolve) => {
    resolveLoad = resolve;
  });
  const scope = await settle(Scope.make());
  const building = settle(
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
  resolveLoad(await good.load());
  expect(Exit.isFailure(await building)).toBe(true);
  expect(
    await f.workspace.admitFeed(bindWork("fans", null), {
      routeKey: "fans",
      fingerprint: workFingerprintSchema.parse(`builtin-closure:${good.closure.fingerprint}`),
    }),
  ).toMatchObject({ code: "WorkRouteUnregistered" });
});

test("startup refuses a stale committed pin with the typed regeneration instruction", async () => {
  const good = enrollment();
  // Model the producer finding changed source while the deployment pin remains old.
  const stale = {
    ...good,
    closure: {
      ...good.closure,
      envelope: {
        ...good.closure.envelope,
        modules: good.closure.envelope.modules.map((member) => ({
          ...member,
          sha256: "b".repeat(64),
        })),
      },
    },
  };
  const run = await open(workspace().workspace, [stale]);
  expect(Exit.isFailure(run.result)).toBe(true);
  if (!Exit.isFailure(run.result)) throw Error("stale builtin admitted");
  const error = Cause.squash(run.result.cause);
  expect(error).toBeInstanceOf(BuiltinEnrollmentFailed);
  expect((error as BuiltinEnrollmentFailed).message).toContain(
    "node scripts/route-graphs.ts --builtin-closure-only",
  );
  expect(run.service).toBeUndefined();
});
