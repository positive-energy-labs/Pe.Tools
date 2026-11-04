import type { AdmittedRoute } from "../../../../packages/agent-contracts/src/route-kernel-admission.ts";
import type {
  EntryTable,
  ReadingSnapshot,
} from "../../../../packages/agent-contracts/src/route-kernel-bodies.ts";
import type { RouteGraphJson } from "../../../../packages/agent-contracts/src/route-kernel-data.ts";
import type {
  AcceptanceOwner,
  AcceptanceSnapshot,
  SchemaTable,
} from "../../../../packages/agent-contracts/src/route-kernel-page.ts";
import { freezePage } from "./page-port.ts";
export type MountedRoute<W extends Record<string, unknown>> = AdmittedRoute<
  RouteGraphJson,
  SchemaTable,
  EntryTable,
  unknown,
  W
>;
export type MountedOwner<W> = AcceptanceOwner<RouteGraphJson, SchemaTable, W>;
export type MountedSnapshot<W> = AcceptanceSnapshot<RouteGraphJson, SchemaTable, W>;
export type Snapshots = Readonly<Record<string, ReadingSnapshot<unknown>>>;
export const project = <T>(keys: readonly string[], value: Readonly<Record<string, T>>) =>
  freezePage(Object.fromEntries(keys.map((key) => [key, value[key]])));

/** One composition contract; service surfaces stay inferred from their factories. */
export type MountContext<W extends Record<string, unknown>> = ReturnType<
  typeof import("./admitted-scope.ts").createAdmittedScope<W>
> & {
  route: MountedRoute<W>;
  input: import("./admitted-place.ts").PlaceInput;
  environmentIssuer: ReturnType<
    typeof import("../../../../packages/agent-contracts/src/route-kernel-environment.ts").createRouteEnvironmentIssuer
  >;
  ports: ReturnType<typeof import("./page-port.ts").createPagePorts>;
  cells: ReturnType<typeof import("./admitted-cells.ts").createAdmittedCells>;
  observers: ReturnType<typeof import("./admitted-observers.ts").createAdmittedObservers>;
  work(this: void): ReturnType<typeof import("./admitted-work.ts").createAdmittedWork>;

  geometry(this: void): ReturnType<typeof import("./admitted-geometry.ts").createAdmittedGeometry>;
  environment(
    this: void,
  ): ReturnType<typeof import("./route-environment.ts").createRouteEnvironment>;
  readings(
    this: void,
  ): ReturnType<typeof import("./admitted-readings.ts").createAdmittedReadings<W>>;
  invocation(
    this: void,
  ): ReturnType<typeof import("./admitted-invoke.ts").createAdmittedInvocation<W>>;
  history(this: void): ReturnType<typeof import("./admitted-history.ts").createAdmittedHistory<W>>;
  cellActions(
    this: void,
  ): ReturnType<typeof import("./admitted-cells.ts").createAdmittedCellActions<W>>;
  submitNative: NonNullable<
    import("../../../../packages/agent-contracts/src/route-kernel-environment.ts").KernelServices["submitNative"]
  >;
  recoveryHost:
    | Pick<typeof import("../route/host.ts"), "startFreshRouteWork" | "salvageRouteWork">
    | undefined;
  sourceEvidence: Partial<import("./source-route-services.ts").SourceReadingEvidence>;
  notify(this: void): void;
  schedule(this: void): void;
  action(this: void): void;
  closed(this: void): boolean;
  available(this: void): boolean;
  beforeSync(this: void): void;
  duringDraw<T>(this: void, draw: () => T): T;
  sourceTimeline: WeakMap<
    object,
    import("../../../../packages/runtime/src/work-journal.ts").TimelineEntry[]
  >;
  now: import("../../../../packages/agent-contracts/src/route-kernel-environment.ts").KernelServices["clock"]["now"];
};

export function projectEvidence(
  deps: import("../../../../packages/agent-contracts/src/route-kernel-data.ts").ReadingDependencies,
  page: Readonly<Record<string, unknown>>,
  work: Readonly<Record<string, unknown>>,
  readings: Snapshots,
) {
  return Object.freeze({
    page: project(deps.page, page),
    work: project(deps.work, work),
    readings: project(deps.readings, readings),
  });
}
export function readingHashes(keys: readonly string[], readings: Snapshots) {
  return Object.fromEntries(
    keys.map((key) => {
      const reading = readings[key];
      if (!reading?.current) throw Error(`Reading unavailable: ${key}`);
      return [key, reading.hash];
    }),
  );
}
export const currentReadingHashes = (readings: Snapshots) =>
  readingHashes(
    Object.keys(readings).filter((key) => readings[key]?.current),
    readings,
  );
