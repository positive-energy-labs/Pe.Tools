import type { RouteGraphJson } from "../../../../packages/agent-contracts/src/route-kernel-data.ts";
import type {
  SchemaTable,
  AcceptanceOwner,
  AcceptanceSnapshot,
} from "../../../../packages/agent-contracts/src/route-kernel-page.ts";
import type {
  EntryTable,
  ReadingSnapshot,
} from "../../../../packages/agent-contracts/src/route-kernel-bodies.ts";
import type { AdmittedRoute } from "../../../../packages/agent-contracts/src/route-kernel-admission.ts";
import type { resolveRouteBindings } from "../../../../packages/agent-contracts/src/route-module.ts";
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
export type MountedBindings = NonNullable<ReturnType<typeof resolveRouteBindings>>;
export type Snapshots = Readonly<Record<string, ReadingSnapshot<unknown>>>;
export const project = (keys: readonly string[], value: Readonly<Record<string, unknown>>) =>
  freezePage(Object.fromEntries(keys.map((key) => [key, value[key]])));
