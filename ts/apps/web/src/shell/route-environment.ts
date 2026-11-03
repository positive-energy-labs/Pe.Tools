import { Context, Effect, Layer } from "effect";
import {
  canonicalEnvironmentInput,
  createRouteEnvironmentIssuer,
  type EnvironmentFor,
  type KernelServices,
  ExplicitDetailRequest,
  PreparedDetailReach,
  ResolvedRead,
  ResolvedGeometryRead,
  type RouteEnvironmentIssuer,
  type RouteEnvironment,
  type ResolvedReadKey,
  type ReadHandle,
  type GeometryOutcome,
  type GeometryScope,
} from "../../../../packages/agent-contracts/src/route-kernel-environment.ts";
import type { RouteGraphJson } from "../../../../packages/agent-contracts/src/route-kernel-data.ts";
import type { AdmittedRoute } from "../../../../packages/agent-contracts/src/route-kernel-admission.ts";
import type {
  AcceptanceToken,
  InvocationToken,
  ScopeToken,
} from "../../../../packages/agent-contracts/src/route-kernel-page.ts";
import type { ReadingSnapshot } from "../../../../packages/agent-contracts/src/route-kernel-bodies.ts";

/** These checks are supplied by admission, the acceptance owner and host freshness owner.
 * Issuer membership alone cannot authenticate a current scope or document incarnation. */
export interface EnvironmentValidation {
  admitted(route: AdmittedRoute): boolean;
  token(token: AcceptanceToken): boolean;
  invocation(invocation: InvocationToken): boolean;
  /** The invocation must name an admitted explicit detail verb, never a background refresh. */
  detail(invocation: InvocationToken): boolean;
  /** Resolve subject identities against this exact document lifetime and owner scope. */
  geometryScope(subject: GeometryScope, token: AcceptanceToken): boolean;
  scope(scope: ScopeToken): boolean;
  key(key: ResolvedReadKey, token: AcceptanceToken): boolean;
}
/** The transport/service owner retains its Effect scope. No host import is reachable here. */
export interface EnvironmentPorts {
  readonly reads: RouteEnvironment["reads"];
  readonly geometry: Pick<RouteEnvironment["geometry"], "acquire">;
  readonly readings: RouteEnvironment["readings"];
  readonly work: RouteEnvironment["work"];
  readonly clock: RouteEnvironment["clock"];
  readonly availability: RouteEnvironment["availability"];
  readonly submitNative?: import("../../../../packages/agent-contracts/src/work-journal-door").WorkJournalDoor["submit"];
}
export interface EnvironmentOptions {
  readonly issuer: RouteEnvironmentIssuer;
  readonly validate: EnvironmentValidation;
  readonly ports: Omit<EnvironmentPorts, "work" | "geometry"> &
    Partial<Pick<EnvironmentPorts, "work" | "geometry">>;
}

// Mounted owners consume these capabilities through mount-environment.ts.
/** Resource ownership ends on release/unsubscribe/Effect scope close. Submitted commands
 * belong to ActionJournal and deliberately survive this environment's disposal. */
export function createRouteEnvironment({ issuer, validate, ports }: EnvironmentOptions) {
  const resources = new Set<() => void>();
  let closed = false;
  const check = (condition: boolean, reason: string): void => {
    if (closed || !condition) throw new Error(closed ? "Environment closed" : reason);
  };
  const valid = (
    request: ResolvedRead<unknown> | ResolvedGeometryRead<unknown>,
    token: AcceptanceToken,
  ) =>
    issuer.owns(request) &&
    validate.admitted(request.route) &&
    validate.token(token) &&
    validate.scope(token.scope) &&
    validate.key(request.key, token);
  const track = (release: () => void) => {
    let active = true;
    const stop = () => {
      if (!active) return;
      active = false;
      resources.delete(stop);
      release();
    };
    resources.add(stop);
    return { stop, active: () => active && !closed };
  };
  const handle = <T>(inner: ReadHandle<T>, current: () => boolean): ReadHandle<T> => {
    const resource = track(() => inner.release());
    return Object.freeze<ReadHandle<T>>({
      lifetime: "read",
      key: inner.key,
      release: resource.stop,
      read: () =>
        resource.active() && current()
          ? inner.read()
          : { status: "unavailable", current: false, reason: "Read retired" },
    });
  };
  const command: NonNullable<EnvironmentPorts["submitNative"]> = (request) => {
    check(!!ports.submitNative, "Native writes unavailable");
    return ports.submitNative!(request);
  };
  const environment = Object.freeze<Partial<RouteEnvironment>>({
    reads: {
      lifetime: "read",
      acquire: <T>(request: ResolvedRead<T>, token: AcceptanceToken) => {
        check(request instanceof ResolvedRead && valid(request, token), "Unissued or stale read");
        return handle(ports.reads.acquire(request, token), () => valid(request, token));
      },
    },
    ...(ports.geometry
      ? {
          geometry: {
            lifetime: "read",
            requestDetail: (invocation: InvocationToken) => {
              if (
                closed ||
                !validate.invocation(invocation) ||
                !validate.detail(invocation) ||
                !validate.token(invocation.token)
              )
                return { ok: false, reason: "Explicit current invocation required" };
              return { ok: true, value: issuer.mintExplicit(invocation.token) };
            },
            prepareReach: (subject, reachFt, explicit) => {
              if (
                closed ||
                !issuer.owns(explicit) ||
                !(explicit instanceof ExplicitDetailRequest) ||
                !validate.token(explicit.token) ||
                !validate.geometryScope(subject, explicit.token) ||
                !Number.isFinite(reachFt) ||
                reachFt < 5 ||
                (subject.kind === "subjects" && subject.ids.length === 0)
              )
                return { ok: false, reason: "Explicit bounded detail reach required" };
              return { ok: true, value: issuer.mintReach(subject, reachFt, explicit) };
            },
            acquire: <T>(
              request: ResolvedGeometryRead<T>,
              token: AcceptanceToken,
            ): ReadHandle<GeometryOutcome<T>> => {
              check(
                request instanceof ResolvedGeometryRead &&
                  valid(request, token) &&
                  request.token === token,
                "Unissued, rebound or stale geometry descriptor",
              );
              const demand = request.request;
              check(
                request.descriptor
                  ? request.key.sortedKeyInput === request.descriptor.normalizedInput
                  : request.key.sortedKeyInput === canonicalEnvironmentInput(demand),
                "Geometry key/request mismatch",
              );
              check(
                demand.representation === "overview"
                  ? demand.scope === token.scope && validate.scope(demand.scope)
                  : issuer.owns(demand.reach) &&
                      demand.reach instanceof PreparedDetailReach &&
                      issuer.owns(demand.reach.explicit) &&
                      demand.reach.explicit.token === token &&
                      validate.geometryScope(demand.reach.subject, token) &&
                      demand.reach.reachFt >= 5 &&
                      Number.isFinite(demand.reach.reachFt),
                "Geometry scope/attempt mismatch",
              );
              return handle(
                ports.geometry!.acquire(request, token),
                () => valid(request, token) && validate.scope(token.scope),
              );
            },
          },
        }
      : {}),
    readings: {
      lifetime: "subscription",
      subscribe: <T>(
        request: ResolvedRead<T>,
        token: AcceptanceToken,
        deliver: (value: ReadingSnapshot<T>) => void,
      ) => {
        check(
          request instanceof ResolvedRead && valid(request, token),
          "Unissued or stale subscription",
        );
        // Install the retirement guard before a service may synchronously deliver its first frame.
        let unsubscribe = () => {};
        const resource = track(() => unsubscribe());
        try {
          unsubscribe = ports.readings.subscribe(request, token, (value) => {
            if (resource.active() && valid(request, token)) deliver(value);
          });
        } catch (error) {
          resource.stop();
          throw error;
        }
        if (!resource.active()) unsubscribe();
        return resource.stop;
      },
    },
    ...(ports.work
      ? {
          work: {
            read: {
              lifetime: "subscription",
              receipts: (scope) => ({
                subscribe(deliver, end) {
                  check(true, "Environment closed");
                  let unsubscribe = () => {};
                  const resource = track(() => unsubscribe());
                  unsubscribe = ports.work!.read.receipts(scope).subscribe((value) => {
                    if (resource.active()) deliver(value);
                  }, end);
                  if (!resource.active()) unsubscribe();
                  return resource.stop;
                },
              }),
              open: (scope) => ({
                subscribe(deliver, end) {
                  check(true, "Environment closed");
                  let unsubscribe = () => {};
                  const resource = track(() => unsubscribe());
                  unsubscribe = ports.work!.read.open(scope).subscribe((value) => {
                    if (resource.active()) deliver(value);
                  }, end);
                  if (!resource.active()) unsubscribe();
                  return resource.stop;
                },
              }),
            },
            submit: {
              submitWork: (scope, write, invocation) => {
                check(validate.token(invocation.token), "Stale Work invocation");
                return ports.work!.submit.submitWork(scope, write, invocation);
              },
              submit: (command) => ports.work!.submit.submit(command),
              accepted: (id) => ports.work!.submit.accepted(id),
            },
          },
        }
      : {}),
    clock: ports.clock,
    availability: Object.freeze({ ...ports.availability }),
    ...(ports.submitNative ? { nativeWrite: issuer.mintNative(command) } : {}),
  });
  return {
    environment: environment as RouteEnvironment,
    close: () => {
      if (closed) return;
      closed = true;
      for (const release of resources) release();
    },
  };
}

export class RouteEnvironmentService extends Context.Service<
  RouteEnvironmentService,
  RouteEnvironment
>()("pe/RouteEnvironment") {}
export const routeEnvironmentLayer = (options: EnvironmentOptions) =>
  Layer.effect(
    RouteEnvironmentService,
    Effect.gen(function* () {
      const owner = createRouteEnvironment(options);
      yield* Effect.addFinalizer(() => Effect.sync(owner.close));
      return owner.environment;
    }),
  );

/** Group transports are thin clients of host doors. This kernel owns issuance and
 * retirement guards; host services retain deduplication and freshness ownership. */
interface GroupPorts {
  readonly work: RouteEnvironment["work"];
  readonly geometry: Pick<RouteEnvironment["geometry"], "acquire">;
  readonly nativeWrite: NonNullable<EnvironmentPorts["submitNative"]>;
}
type PortGroup<
  D extends Pick<RouteGraphJson, "capabilities">,
  C extends RouteGraphJson["capabilities"][number],
  K extends keyof GroupPorts,
> = C extends D["capabilities"][number] ? Pick<GroupPorts, K> : { readonly [P in K]?: never };
export type CapabilityPortsFor<D extends Pick<RouteGraphJson, "capabilities">> = PortGroup<
  D,
  "work",
  "work"
> &
  PortGroup<D, "geometry", "geometry"> &
  PortGroup<D, "native-write", "nativeWrite">;

/** Application composition installs baseline services once. Only this kernel mints
 * descriptors; routes receive the selected environment, never an issuer. */
export function createRouteEnvironmentKernel(services: KernelServices) {
  const { reads, readings, clock, availability } = services;
  const baseline = { reads, readings, clock, availability };
  return {
    bind<const D extends Pick<RouteGraphJson, "capabilities">>(
      declaration: D,
      validate: EnvironmentValidation,
      groups: CapabilityPortsFor<NoInfer<D>>,
    ) {
      const issuer = createRouteEnvironmentIssuer();
      const supplied = groups as {
        work?: EnvironmentPorts["work"];
        geometry?: EnvironmentPorts["geometry"];
        nativeWrite?: EnvironmentPorts["submitNative"];
      };
      for (const [group, port] of [
        ["work", "work"],
        ["geometry", "geometry"],
        ["native-write", "nativeWrite"],
      ] as const) {
        if (declaration.capabilities.includes(group) !== (supplied[port] !== undefined))
          throw new Error(`Capability service mismatch: ${group}`);
      }
      const owner = createRouteEnvironment({
        issuer,
        validate,
        // The checked group set is captured above; absent groups are not synthesized.
        ports: { ...baseline, ...supplied, submitNative: supplied.nativeWrite } as EnvironmentPorts,
      });
      return {
        environment: owner.environment as unknown as EnvironmentFor<D>,
        close: owner.close,
        resolveRead: issuer.mintRead,
        resolveGeometry: issuer.mintGeometry,
      };
    },
  };
}
