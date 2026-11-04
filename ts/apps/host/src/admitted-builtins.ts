import { createRouteRegistrations } from "../../../packages/mcps/src/pea/routes.ts";
import { composeHostRouteRegistration } from "./host-route-registration.ts";
import type { HostWorkRegistration } from "../../../packages/agent-contracts/src/host-route-admission.ts";
import { Context, Effect, Layer, Schema } from "effect";
import type { RouteWorkspace } from "@pe/runtime";
import { admittedBuiltinKeys } from "../../../packages/agent-contracts/src/admitted-builtin-keys.ts";
import {
  createBuiltinRouteInventory,
  createHostAdmittedRouteRegistry,
} from "../../../packages/agent-contracts/src/route-module.ts";
import { captureHostModule } from "../../../packages/agent-contracts/src/host-route-admission.ts";
import type { HostAdmittedRoute } from "../../../packages/agent-contracts/src/host-route-admission.ts";
import { builtinEnrollments, type BuiltinEnrollment } from "./builtin-enrollment.ts";
import { registerAdmittedHostRoute } from "./pod-routes.ts";

export class BuiltinEnrollmentFailed extends Schema.TaggedError<BuiltinEnrollmentFailed>()(
  "BuiltinEnrollmentFailed",
  {
    routeKey: Schema.String,
    reason: Schema.String,
  },
) {
  override get message() {
    return `Builtin ${this.routeKey} enrollment failed: ${this.reason}. Regenerate from ts/apps/web: node scripts/route-graphs.ts --builtin-closure-only`;
  }
}
export class AdmittedBuiltins extends Context.Service<
  AdmittedBuiltins,
  {
    readonly routes: ReadonlyMap<string, HostAdmittedRoute>;
    readonly registry: ReturnType<typeof createHostAdmittedRouteRegistry>;
  }
>()("pe/AdmittedBuiltins") {}

/** Acquisition precedes HTTP publication. The workspace remains the composition root's instance. */
export function admittedBuiltinsLayer(
  workspace: RouteWorkspace,
  inventory: readonly BuiltinEnrollment[] = builtinEnrollments,
  registrations: readonly HostWorkRegistration[] = createRouteRegistrations({ admittedKeys: [] }),
) {
  return Layer.effect(
    AdmittedBuiltins,
    Effect.gen(function* () {
      const registry = createHostAdmittedRouteRegistry();
      const routes = new Map<string, HostAdmittedRoute>();
      const releases: (() => void)[] = [];
      let closed = false;
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          closed = true;
          for (const release of releases.reverse()) release();
          routes.clear();
        }),
      );
      const failed = (routeKey: string, reason: unknown) =>
        new BuiltinEnrollmentFailed({ routeKey, reason: String(reason) });
      if (
        inventory === builtinEnrollments &&
        inventory
          .map((r) => r.routeKey)
          .sort()
          .join("\n") !== [...admittedBuiltinKeys].sort().join("\n")
      )
        return yield* Effect.fail(
          failed("inventory", "Builtin cutover keys and host enrollment differ"),
        );
      const byKey = new Map(inventory.map((entry) => [entry.routeKey, entry]));
      if (byKey.size !== inventory.length)
        return yield* Effect.fail(failed("inventory", "Duplicate builtin enrollment"));
      // A presenter admits its owner first, from the closure's `workOwner`; each key admits once.
      const admit = (
        entry: BuiltinEnrollment,
      ): Effect.Effect<HostAdmittedRoute, BuiltinEnrollmentFailed> =>
        Effect.gen(function* () {
          const key = entry.routeKey;
          const done = routes.get(key);
          if (done) return done;
          const ownerKey = entry.closure.envelope.workOwner?.route;
          const ownerEntry = ownerKey === undefined ? undefined : byKey.get(ownerKey);
          if (ownerKey !== undefined && (!ownerEntry || ownerEntry.closure.envelope.workOwner))
            return yield* Effect.fail(failed(key, `${ownerKey} cannot own presented Work`));
          const owner = ownerEntry && (yield* admit(ownerEntry));
          const loaded = yield* Effect.tryPromise({
            try: entry.load,
            catch: (reason) => failed(key, reason),
          });
          if (closed) return yield* Effect.fail(failed(key, "Enrollment retired"));
          const module = yield* Effect.try({
            try: () => captureHostModule(composeHostRouteRegistration(loaded, registrations)),
            catch: (reason) => failed(key, reason),
          });
          const prepared = yield* Effect.tryPromise({
            try: () =>
              createBuiltinRouteInventory({
                [key]: { host: true, module, workOwner: owner, closure: entry.closure, catalog: [] },
              }).prepare(key, entry.closure.fingerprint),
            catch: (reason) => failed(key, reason),
          });
          if (closed) return yield* Effect.fail(failed(key, "Enrollment retired"));
          const admitted = yield* Effect.try({
            try: () => prepared.admitHost(module),
            catch: (reason) => failed(key, reason),
          });
          if (!admitted.ok)
            return yield* Effect.fail(failed(key, JSON.stringify(admitted.diagnostics)));
          const route = admitted.route;
          if (route.data.key !== key)
            return yield* Effect.fail(failed(key, "Inventory and declaration keys differ"));
          const receipt = yield* Effect.try({
            try: () => registry.register(route),
            catch: (reason) => failed(key, reason),
          });
          releases.push(receipt.deactivate);
          routes.set(key, route);
          if (route.data.work?.route === key) {
            const registration = yield* Effect.try({
              try: () => registerAdmittedHostRoute(route, workspace),
              catch: (reason) => failed(key, reason),
            });
            releases.push(registration.close);
            const failure = yield* Effect.tryPromise({
              try: () => registration.ready,
              catch: (reason) => failed(key, reason),
            });
            if (failure) return yield* Effect.fail(failed(key, JSON.stringify(failure)));
          }
          return route;
        });
      for (const entry of inventory) yield* admit(entry);
      return { routes, registry };
    }),
  );
}
