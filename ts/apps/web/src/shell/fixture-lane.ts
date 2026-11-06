import { createFixtureWorkDoor } from "./fixture-work-door";
/** Presence isolates every route; an unknown or empty name never falls through to the host. */
export const fixtureName = (search: Record<string, unknown>): string | null =>
  typeof search.fixture === "string" ? search.fixture : null;
export const currentFixture = () =>
  typeof location === "undefined"
    ? null
    : fixtureName(Object.fromEntries(new URLSearchParams(location.search)));

import { type RouteStateSpec } from "@pe/agent-contracts";
import { z } from "zod";
import type {
  FixtureEnvironment,
  ResolvedRead,
  ReadHandle,
} from "../../../../packages/agent-contracts/src/route-kernel-environment.ts";
import type { Immutable } from "../../../../packages/agent-contracts/src/route-kernel-data.ts";
import type { ReadingSnapshot } from "../../../../packages/agent-contracts/src/route-kernel-bodies.ts";
import type { AdmittedReadingPlan, ReadingPlanContext } from "./admitted-reading-plan";
import type { AcceptanceToken } from "../../../../packages/agent-contracts/src/route-kernel-page";
import {
  createRouteEnvironment,
  type EnvironmentOptions,
  type EnvironmentPorts,
} from "./route-environment";

export interface RouteFixtureSeed {
  readonly page?: Readonly<Record<string, unknown>>;
  readonly readings: Readonly<Record<string, unknown>>;
  readonly work?: unknown;
  readonly works?: Readonly<Record<string, unknown>>;
}
/** Fixture Page is declaration data; the admitted Page policy owns field/role/schema decoding. */
export function fixturePage(seed: unknown): Readonly<Record<string, unknown>> {
  const parsed = z.object({ page: z.record(z.string(), z.unknown()).optional() }).safeParse(seed);
  if (!parsed.success) throw Error("Invalid fixture Page seed");
  return parsed.data.page ?? {};
}
const fixtureSelector = z.strictObject({
  fixtureSelect: z.strictObject({
    fields: z.array(z.string().min(1)),
    values: z.record(z.string(), z.unknown()),
    fallback: z.unknown(),
  }),
});
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
    readonly plan: AdmittedReadingPlan;
    readonly workSpec?: RouteStateSpec<z.ZodType>;
    readonly now: () => number;
  },
) {
  const declaresWork = options.plan.route.data.capabilities.includes("work");
  if (declaresWork !== (options.workSpec !== undefined))
    throw Error("Fixture Work declaration mismatch");
  const capturedSeed = structuredClone(options.seed);
  const snapshot = <T>(request: Pick<ResolvedRead<T>, "output" | "key">): ReadingSnapshot<T> => {
    const seed = capturedSeed;
    const id = options.plan.readingId(request);
    if (!seed || !id || !Object.hasOwn(seed.readings, id))
      return {
        status: "unavailable",
        current: false,
        reason: `Missing fixture seed: ${id ?? "unbound reading"}`,
      };
    let selected = seed.readings[id];
    if (
      selected !== null &&
      typeof selected === "object" &&
      Object.hasOwn(selected, "fixtureSelect")
    ) {
      const selector = fixtureSelector.safeParse(selected);
      if (!selector.success)
        return { status: "failed", current: false, reason: selector.error.message };
      const args = z
        .record(z.string(), z.unknown())
        .safeParse(JSON.parse(request.key.sortedKeyInput));
      const { fields, values, fallback } = selector.data.fixtureSelect;
      if (!args.success || fields.some((field) => !Object.hasOwn(args.data, field)))
        return {
          status: "unavailable",
          current: false,
          reason: "Fixture selector argument missing",
        };
      const key = JSON.stringify(fields.map((field) => args.data[field]));
      selected = Object.hasOwn(values, key) ? values[key] : fallback;
    }
    const parsed = request.output.safeParse(structuredClone(selected));
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
      ...(options.plan.route.data.capabilities.includes("geometry")
        ? {
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
                    return snapshot(request);
                  },
                };
              },
            },
          }
        : {}),
      readings: {
        lifetime: "subscription",
        subscribe: (request, _token, deliver) => {
          deliver(snapshot(request));
          return () => {};
        },
      },
      ...(declaresWork
        ? {
            work: (() => {
              const door = createFixtureWorkDoor(
                options.workSpec!,
                capturedSeed?.work,
                options.plan.workSchemas(),
                capturedSeed?.works,
              );
              return { read: door, submit: door };
            })(),
          }
        : {}),
      clock: { lifetime: "read", now: options.now },
      availability: {},
    } as EnvironmentPorts,
  });
  const environment: FixtureEnvironment = { ...owner.environment, nativeWrite: undefined };
  return {
    environment: Object.freeze(environment),
    read: (id: string, state: ReadingPlanContext, token: AcceptanceToken) =>
      !capturedSeed
        ? { status: "unavailable" as const, current: false as const, reason: "Fixture unavailable" }
        : options.plan.read(id, state, (request) => {
            const handle = environment.reads.acquire(request, token);
            try {
              return handle.read();
            } finally {
              handle.release();
            }
          }),
    close: owner.close,
  };
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

/** Resolve only declared fixture bodies, before a live source factory can be selected. */
export function createNamedFixtureRouteEnvironment(
  options: Omit<Parameters<typeof createFixtureRouteEnvironment>[0], "seed"> & {
    readonly name: string;
  },
) {
  const seed = options.plan.seed(options.name);
  const parsed = z
    .object({
      readings: z.record(z.string(), z.unknown()),
      work: z.unknown().optional(),
      works: z.record(z.string(), z.unknown()).optional(),
      page: z.record(z.string(), z.unknown()).optional(),
    })
    .safeParse(seed);
  return createFixtureRouteEnvironment({
    ...options,
    seed: parsed.success ? parsed.data : undefined,
  });
}
