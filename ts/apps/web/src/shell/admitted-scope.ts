import { bindWork, workKey } from "@pe/agent-contracts";
import type { RouteGraphJson } from "../../../../packages/agent-contracts/src/route-kernel-data.ts";
import { canonicalEnvironmentInput } from "../../../../packages/agent-contracts/src/route-kernel-environment.ts";
import {
  createRouteTokenIssuer,
  type SchemaTable,
} from "../../../../packages/agent-contracts/src/route-kernel-page.ts";
import {
  createAdmittedRouteRegistry,
  resolveRouteBindings,
} from "../../../../packages/agent-contracts/src/route-module.ts";
import { routeWorkSubject } from "../../../../packages/agent-contracts/src/route-work-subject.ts";
import { createRouteScopeGate } from "../../../../packages/runtime/src/route-scope-gate.ts";
import type {
  MountContext,
  MountedOwner,
  MountedRoute,
  MountedSnapshot,
  Snapshots,
} from "./admitted-context.ts";
import { currentReadingHashes, projectEvidence } from "./admitted-context.ts";
import type { PlaceInput } from "./admitted-place.ts";
import { createApplicationWorkRegistry } from "./application-work-registry.ts";
import { createPagePolicy } from "./page-port.ts";
import { createRouteEnvironment, type EnvironmentValidation } from "./route-environment.ts";
export function createAdmittedScope<W extends Record<string, unknown>>({
  route,
  input,
  workRegistry,
  snapshots,
  closed,
  observeReceipts,
  notify,
}: {
  route: MountedRoute<W>;
  input: PlaceInput;
  workRegistry: ReturnType<typeof createApplicationWorkRegistry>;
  snapshots(): Snapshots;
  closed(): boolean;
  observeReceipts(): void;
  notify(): void;
}) {
  const { address, target } = input;
  const registry = createAdmittedRouteRegistry();
  const registration = registry.register(route);
  const resolve = () => {
    const bindings = resolveRouteBindings(registry, route);
    if (!bindings) throw Error("Foreign or retired mount admission");
    return bindings;
  };
  const bindings = resolve();
  // COMMON 3: admission owns slot/kind checks. A linked cell admission is valid but
  // this shell cannot execute it; retain that capability refusal before acquisition.
  for (const body of Object.values(bindings.bodies))
    if (body.kind === "admit") {
      registration.deactivate();
      throw Error(`Unsupported admitted mount body slot: ${body.slot}`);
    }
  // Migration bodies execute only in host admission. The Work feed proves registration
  // and finishes persistent migration before exposing Work; no body or schema is sent here.
  // Result landing owns presentation for verbs without a sealed ModelWrite preview.
  for (const [id, verb] of Object.entries(route.data.verbs)) {
    if (
      verb.present &&
      (verb.kind !== "command" || bindings.entries[verb.entry]?.axes.effect !== "ModelWrite")
    ) {
      registration.deactivate();
      throw Error(
        `Unsupported admitted presentation phase: verbs.${id}.present requires a sealed preview`,
      );
    }
  }
  const policy = createPagePolicy<RouteGraphJson, SchemaTable>(
    route.data,
    bindings.schemas,
    () => "unresolved",
    route.data.transition
      ? (current, patch, origin) => {
          const deps = route.data.transitionDeps ?? { page: [], work: [], readings: [] };
          if (deps.readings.some((id) => !snapshots()[id]?.current))
            return { ok: false, reason: "Transition reading evidence unavailable or stale" };
          const acceptedWork = owner.read()?.work?.value;
          if (deps.work.length && !acceptedWork)
            return { ok: false, reason: "Transition Work unavailable" };
          const evidence = Object.fromEntries(deps.readings.map((id) => [id, snapshots()[id]]));
          const result = resolve().bodies[route.data.transition!]!.run(
            current,
            patch,
            origin,
            projectEvidence(deps, current, acceptedWork ?? {}, evidence),
          ) as import("../../../../packages/agent-contracts/src/route-kernel-page.ts").DecodeResult<unknown>;
          // Re-entrant publication cannot decide on the evidence captured above.
          if (
            deps.readings.some(
              (id) => snapshots()[id] !== evidence[id] || !snapshots()[id]?.current,
            )
          )
            return { ok: false, reason: "Transition reading evidence changed" };
          return result;
        }
      : undefined,
  );

  const initial = policy.initial();
  if (!initial.ok) {
    registration.deactivate();
    throw Error(initial.reason);
  }
  const identityForPage = (page: Readonly<Record<string, unknown>>) => ({
    target,
    work: route.data.work
      ? bindWork(
          route.data.work.route,
          input.work.address,
          routeWorkSubject(route.data, bindings, page) ?? address.read().get("work") ?? undefined,
          input.work.open ?? undefined,
        )
      : null,
  });
  const registryForWork = workRegistry;
  const leases = new Map<
    string,
    ReturnType<typeof registryForWork.acquire> & { released?: boolean }
  >();
  const entryFor = (key: import("@pe/agent-contracts").WorkKey) => {
    const id = workKey(key);
    let lease = leases.get(id);
    const current = owner.read()?.scope.identity.work;
    const shown = current && workKey(current) === id;
    if (shown && !closed()) {
      for (const [other, held] of leases)
        if (other !== id && !held.released) {
          held.released = true;
          held.release();
        }
    }
    if (!lease || (lease.released && shown && !closed())) {
      lease = registryForWork.acquire(key);
      leases.set(id, lease);
      const unsubscribe = lease.entry.subscribe(() => {
        observeReceipts();
        notify();
      });
      const release = lease.release.bind(lease);
      lease.release = () => {
        unsubscribe();
        release();
      };
    }
    return lease.entry;
  };
  const mountJournal = (key: import("@pe/agent-contracts").WorkKey) => entryFor(key).journal;
  const workSpec = route.resolvedWork
    ? {
        route: route.resolvedWork.spec.route,
        title: route.data.name,
        description: "",
        schema: route.resolvedWork.schema,
      }
    : undefined;
  const issuer = createRouteTokenIssuer();
  const ownerOptions = {
    dependencies: () => currentReadingHashes(snapshots()),
    scopeFields: [
      route.data.subject.field,
      ...(route.data.workSubject ? [route.data.workSubject] : []),
    ],
    identityForPage,
    preparePage: policy.prepare,
    issuer,
  };
  const owner: MountedOwner<W> = createRouteScopeGate<RouteGraphJson, SchemaTable, W>(
    workSpec
      ? {
          ...ownerOptions,
          workSchema: workSpec.schema,
          hashWork: canonicalEnvironmentInput,
          journal: mountJournal,
        }
      : ownerOptions,
  );
  owner.enter(identityForPage(initial.value), initial.value);
  const read = (): MountedSnapshot<W> => {
    const snapshot = owner.read();
    if (!snapshot) throw Error("Mount has no accepted snapshot");
    return snapshot;
  };

  return {
    registry,
    registration,
    resolve,
    bindings,
    policy,
    issuer,
    owner,
    read,
    entryFor,
    mountJournal,
    workSpec,
    release() {
      for (const lease of leases.values()) lease.release();
    },
  };
}

export function createAdmittedEnvironment<W extends Record<string, unknown>>(
  context: MountContext<W>,
  create: (validate: EnvironmentValidation) => ReturnType<typeof createRouteEnvironment>,
) {
  const { route, registry, owner, registration } = context;
  const plan = context.readings().plan;
  const validate: EnvironmentValidation = {
    admitted: (candidate) => candidate === route && registry.resolve(route) === route,
    token: (token) => owner.current(token),
    scope: (scope) => owner.current(scope),
    invocation: (invocation) => owner.current(invocation),
    key: (key) => context.readings().ownsKey(key),
    detail: () => false,
    geometryScope: () => false,
  };
  try {
    return create(validate);
  } catch (error) {
    owner.close();
    plan.close();
    registration.deactivate();
    throw error;
  }
}
