/** Presence isolates every route; an unknown or empty name never falls through to the host. */
export const fixtureName = (search: Record<string, unknown>): string | null =>
  typeof search.fixture === "string" ? search.fixture : null;
export const currentFixture = () =>
  typeof location === "undefined"
    ? null
    : fixtureName(Object.fromEntries(new URLSearchParams(location.search)));

import { applyPatches, workKey, type RouteStateSpec } from "@pe/agent-contracts";
import { z } from "zod";
import type { CausalParentId } from "../../../../packages/agent-contracts/src/route-kernel-page.ts";
import type {
  FixtureEnvironment,
  ResolvedRead,
  ReadHandle,
} from "../../../../packages/agent-contracts/src/route-kernel-environment.ts";
import type { Immutable } from "../../../../packages/agent-contracts/src/route-kernel-data.ts";
import type { ReadingSnapshot } from "../../../../packages/agent-contracts/src/route-kernel-bodies.ts";
import { createRouteEnvironment, type EnvironmentOptions } from "./route-environment";

export interface RouteFixtureSeed {
  readonly readings: Readonly<Record<string, unknown>>;
  readonly work?: unknown;
}
function freezeValue<T>(value: T): asserts value is T & Immutable<T> {
  if (value !== null && typeof value === "object") {
    Object.values(value).forEach(freezeValue);
    Object.freeze(value);
  }
}
/** Fixed composition boundary: fixture construction never imports a host transport.
 * A separate closure per environment owns its Works, even for identical keys and seeds. */
export function createFixtureRouteEnvironment(
  options: Omit<EnvironmentOptions, "ports"> & {
    readonly seed: RouteFixtureSeed | undefined;
    readonly workSpec: RouteStateSpec<z.ZodType>;
    readonly now: () => number;
  },
) {
  const capturedSeed = structuredClone(options.seed);
  const works = new Map<string, { revision: number; value: unknown }>();
  const journalParents = new Set<string>();
  // This fixture journal owns issuance; arbitrary strings do not pass its decoder.
  const parentSchema = z.custom<CausalParentId>(
    (value) => typeof value === "string" && journalParents.has(value),
  );
  const snapshot = <T>(request: ResolvedRead<T>): ReadingSnapshot<T> => {
    const seed = capturedSeed;
    if (!seed || !Object.hasOwn(seed.readings, request.key.op))
      return {
        status: "unavailable",
        current: false,
        reason: `Missing fixture seed: ${request.key.op}`,
      };
    const parsed = request.output.safeParse(structuredClone(seed.readings[request.key.op]));
    if (!parsed.success) return { status: "failed", current: false, reason: parsed.error.message };
    const value = structuredClone(parsed.data);
    freezeValue(value);
    return { status: "ready", current: true, value, hash: JSON.stringify(value) };
  };
  const acquire = <T>(request: ResolvedRead<T>): ReadHandle<T> => {
    let released = false;
    return {
      lifetime: "read",
      key: request.key,
      release: () => {
        released = true;
      },
      read: () =>
        released
          ? { status: "unavailable", current: false, reason: "Read retired" }
          : snapshot(request),
    };
  };
  const owner = createRouteEnvironment({
    ...options,
    ports: {
      reads: { lifetime: "read", acquire },
      geometry: {
        acquire: (request) => {
          let released = false;
          return {
            lifetime: "read",
            key: request.key,
            release: () => {
              released = true;
            },
            read: () => {
              if (released)
                return { status: "unavailable", current: false, reason: "Read retired" };
              const seed = capturedSeed;
              if (!seed || !Object.hasOwn(seed.readings, request.key.op))
                return {
                  status: "unavailable",
                  current: false,
                  reason: "Missing geometry fixture seed",
                };
              const parsed = request.output.safeParse(
                structuredClone(seed.readings[request.key.op]),
              );
              if (!parsed.success)
                return { status: "failed", current: false, reason: parsed.error.message };
              const value = structuredClone(parsed.data);
              freezeValue(value);
              return { status: "ready", current: true, value, hash: JSON.stringify(value) };
            },
          };
        },
      },
      readings: {
        lifetime: "subscription",
        subscribe: (request, _token, deliver) => {
          deliver(snapshot(request));
          return () => {};
        },
      },
      work: {
        read: {
          lifetime: "read",
          read: (scope) => {
            const key = scope.identity.work;
            if (!key || !capturedSeed) return null;
            const id = workKey(key);
            let state = works.get(id);
            if (!state) {
              const parsed = options.workSpec.schema.safeParse(structuredClone(capturedSeed.work));
              if (!parsed.success) return null;
              state = { revision: 0, value: parsed.data };
              works.set(id, state);
            }
            const value = structuredClone(state.value);
            freezeValue(value);
            return { key, revision: state.revision, value };
          },
        },
        submit: {
          lifetime: "command",
          submit: (route, invocation, write) => {
            const key = invocation.token.scope.identity.work;
            const prior = key && works.get(workKey(key));
            if (!key || !prior || route.data.key !== key.route)
              throw new Error("Fixture Work unavailable");
            const result = applyPatches(
              options.workSpec,
              { version: 1, revision: prior.revision, doc: prior.value },
              "human",
              structuredClone(write.patches).map((patch) => ({ ...patch, path: [...patch.path] })),
              write.expectedRevision,
              false,
              write.kind === "restore",
            );
            if (!result.ok) throw new Error(result.error);
            works.set(workKey(key), {
              revision: result.envelope.revision,
              value: result.envelope.doc,
            });
            const id = crypto.randomUUID();
            journalParents.add(id);
            return Object.freeze({
              lifetime: "command",
              id,
              causalParent: invocation.causalParent ?? parentSchema.parse(id),
            });
          },
        },
      },
      clock: { lifetime: "read", now: options.now },
      availability: {},
    },
  });
  const environment: FixtureEnvironment = { ...owner.environment, nativeWrite: undefined };
  return { environment: Object.freeze(environment), close: owner.close };
}

/** Presence, including empty/unknown names, always selects the refusing fixture implementation.
 * Only the composition root imports this selector; bodies receive RouteEnvironment alone. */
export function selectRouteEnvironment<Live, Fixture>(options: {
  readonly search: Record<string, unknown>;
  readonly live: () => Live;
  readonly fixture: (name: string) => Fixture;
}) {
  const name = fixtureName(options.search);
  return name === null ? options.live() : options.fixture(name);
}
