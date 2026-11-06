import { contentHash, overlaps } from "./readings";
import { z } from "zod";
import {
  canonicalEnvironmentInput,
  type ResolvedRead,
  type ResolvedReadKey,
  type RouteEnvironmentIssuer,
} from "../../../../packages/agent-contracts/src/route-kernel-environment";
import type { ReadingSnapshot } from "../../../../packages/agent-contracts/src/route-kernel-bodies";
import type { AdmittedRoute } from "../../../../packages/agent-contracts/src/route-kernel-admission";
import type { RouteBindings } from "../../../../packages/agent-contracts/src/route-bodies";
import {
  createAdmittedRouteRegistry,
  resolveRouteBindings,
} from "../../../../packages/agent-contracts/src/route-module";
import type { ActionReceipt, Effect } from "@pe/agent-contracts";

/** Pane chrome consumes this projection; accepted evidence outlives attempt leases. */
export interface AdmittedReadingStatus {
  readonly snapshot: ReadingSnapshot<unknown>;
  readonly previous: unknown;
  readonly demanded: boolean;
  readonly leased: boolean;
}

export function readingClosure(route: AdmittedRoute, roots: Iterable<string>): Set<string> {
  const result = new Set<string>();
  const visit = (id: string) => {
    if (result.has(id)) return;
    const reading = route.data.readings[id];
    if (!reading) throw Error(`Unknown admitted reading: ${id}`);
    result.add(id);
    reading.deps.readings.forEach(visit);
  };
  for (const id of roots) visit(id);
  return result;
}

export function receiptHitsReading(
  receipt: Pick<ActionReceipt, "state" | "effects">,
  dependencies: readonly Effect[],
): boolean {
  if (receipt.state !== "succeeded") return false;
  return receipt.effects.some((effect) => dependencies.some((dep) => overlaps(effect, dep)));
}

export interface ReadingPlanContext {
  readonly page: Readonly<Record<string, unknown>>;
  readonly work: Readonly<Record<string, unknown>> | null;
  readonly workReadings?: Readonly<Record<string, ReadingSnapshot<unknown>>>;
}
const unavailable = (reason: string): ReadingSnapshot<unknown> => ({
  status: "unavailable",
  current: false,
  reason,
});

function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

/** The same declared seed resolver serves Page initialization and the admitted reading plan. */
export function admittedSeed(
  route: AdmittedRoute,
  bindings: Pick<RouteBindings, "bodies">,
  name: string,
) {
  const seed = name && Object.hasOwn(route.data.seeds, name) && route.data.seeds[name];
  return seed ? bindings.bodies[seed.load]!.run() : undefined;
}
/** One admitted plan serves fixture and live acquisition. Descriptor membership includes the
 * logical reading, even when two readings resolve the same operation and arguments. */
export function createAdmittedReadingPlan(options: {
  route: AdmittedRoute;
  issuer: RouteEnvironmentIssuer;
  key:
    | Omit<ResolvedReadKey, "op" | "sortedKeyInput">
    | ((id: string) => Omit<ResolvedReadKey, "op" | "sortedKeyInput">);
}) {
  const registry = createAdmittedRouteRegistry();
  const registration = registry.register(options.route);
  const descriptors = new WeakMap<object, string>();
  const bindings = () => {
    const resolved = resolveRouteBindings(registry, options.route);
    if (!resolved) throw Error("Reading plan admission retired");
    return resolved;
  };
  const declaration = (id: string) => {
    bindings();
    const reading = options.route.data.readings[id];
    if (!Object.hasOwn(options.route.data.readings, id) || !reading)
      throw Error(`Unknown admitted reading: ${id}`);
    return reading;
  };
  const project = (keys: readonly string[], value: Readonly<Record<string, unknown>>) =>
    freeze(structuredClone(Object.fromEntries(keys.map((key) => [key, value[key]]))));
  const request = (
    id: string,
    context: unknown,
    invocation?: { readonly input: unknown },
  ): ResolvedRead<unknown> | null => {
    const reading = declaration(id);
    if (reading.kind === "derive" || reading.kind === "work")
      throw Error(`Derived reading has no source: ${id}`);
    if (reading.kind === "use" && reading.geometry)
      throw Error("Geometry requires its prepared descriptor");
    const linked = bindings();
    const body = reading.kind === "use" ? reading.args : reading.adapter;
    const input = invocation ? invocation.input : body ? linked.bodies[body]!.run(context) : {};
    if (input === null && !invocation) return null;
    const entry = linked.entries[reading.entry]!;
    const args = entry.input.parse(input);
    const descriptor = options.issuer.mintRead(
      {
        ...(typeof options.key === "function" ? options.key(id) : options.key),
        op: reading.entry,
        sortedKeyInput: canonicalEnvironmentInput(args),
      },
      entry.output,
      options.route,
    );
    descriptors.set(descriptor, id);
    return descriptor;
  };
  return {
    route: options.route,
    fixtureProvider: (op: string) => bindings().sources[op]?.provide,
    workOwners: () => Object.fromEntries(Object.entries(options.route.data.readings).flatMap(([id, reading]) => reading.kind === "work" ? [[id, reading.route]] : [])),
    workSchemas: () =>
      Object.fromEntries(
        Object.entries(options.route.data.readings).flatMap(([id, reading]) =>
          reading.kind === "work" ? [[id, bindings().schemas[reading.output]]] : [],
        ),
      ),
    request,
    seed(name: string) {
      return admittedSeed(options.route, bindings(), name);
    },
    /** Geometry issuance stays with the geometry owner; bind only its exact admitted output. */
    bind(
      id: string,
      descriptor: {
        readonly route: AdmittedRoute;
        readonly key: ResolvedReadKey;
        readonly output: unknown;
      },
    ) {
      const reading = declaration(id);
      if (
        reading.kind === "derive" ||
        reading.kind === "work" ||
        descriptor.route !== options.route ||
        descriptor.key.op !== reading.entry ||
        descriptor.output !== bindings().entries[reading.entry]!.output ||
        !options.issuer.owns(descriptor)
      )
        throw Error("Descriptor does not resolve this admitted reading");
      if (descriptors.has(descriptor) && descriptors.get(descriptor) !== id)
        throw Error("Descriptor already bound to another reading");
      descriptors.set(descriptor, id);
    },
    readingId(descriptor: object) {
      bindings();
      return descriptors.get(descriptor);
    },
    read(
      id: string,
      state: ReadingPlanContext,
      acquire: (request: ResolvedRead<unknown>) => ReadingSnapshot<unknown>,
      geometry?: (id: string, context: unknown, input: unknown) => ReadingSnapshot<unknown>,
      invocationFor?: (id: string) => { readonly input: unknown } | undefined,
      cache = new Map<string, ReadingSnapshot<unknown>>(),
    ): ReadingSnapshot<unknown> {
      const evaluate = (id: string): ReadingSnapshot<unknown> => {
        const prior = cache.get(id);
        if (prior) return prior;
        const reading = declaration(id);
        const inputs = Object.fromEntries(reading.deps.readings.map((dep) => [dep, evaluate(dep)]));
        if (Object.values(inputs).some((value) => !value.current))
          return unavailable(`Reading dependencies unavailable: ${id}`);
        if (reading.deps.work.length && state.work === null)
          return unavailable(`Work unavailable: ${id}`);
        const context = Object.freeze({
          page: project(reading.deps.page, state.page),
          work: project(reading.deps.work, state.work ?? {}),
          readings: Object.freeze(inputs),
        });
        let result: ReadingSnapshot<unknown>;
        try {
          if (reading.kind === "work") {
            result = state.workReadings?.[id] ?? unavailable("Work reading unavailable");
          } else if (reading.kind === "derive") {
            const linked = bindings();
            const value = freeze(
              linked.schemas[reading.output]!.parse(linked.bodies[reading.derive]!.run(context)),
            );
            result = {
              status: "ready",
              current: true,
              value,
              hash: z.string().parse(contentHash(value)),
            };
          } else {
            if (reading.kind === "use" && reading.geometry) {
              const linked = bindings();
              const invocation = invocationFor?.(id);
              const args = invocation ? invocation.input : reading.args
                ? linked.bodies[reading.args]!.run(context) : {};
              // Null is the adapter's unavailable signal, as for every non-geometry reading.
              if (args === null && !invocation)
                return unavailable(`Reading arguments unavailable: ${id}`);
              const input = linked.entries[reading.entry]!.input.parse(args);
              result = geometry
                ? geometry(id, context, input)
                : unavailable("Geometry composition unavailable");
              cache.set(id, result);
              return result;
            }
            const descriptor = request(id, context, invocationFor?.(id));
            result = descriptor
              ? acquire(descriptor)
              : unavailable(`Reading arguments unavailable: ${id}`);
          }
        } catch (error) {
          result = { status: "failed", current: false, reason: error instanceof z.ZodError ? "This reading could not be decoded. Refresh the pane to try again." : String(error) };
        }
        cache.set(id, result);
        return result;
      };
      return evaluate(id);
    },
    close: () => registration.deactivate(),
  };
}
export type AdmittedReadingPlan = ReturnType<typeof createAdmittedReadingPlan>;
