import type { z } from "zod";
import type { RouteDiagnostic, RouteGraphJson } from "./route-kernel-data.ts";
import type { RouteFingerprint } from "./route-kernel-admission.ts";

declare const hostAdmission: unique symbol;
/** Host execution authority only. Never a web mount handle. */
export interface HostAdmittedRoute {
  readonly [hostAdmission]: true;
  readonly data: RouteGraphJson;
  readonly fingerprint: RouteFingerprint;
  readonly workFingerprint: RouteFingerprint;
  readonly resolvedWork?: {
    readonly spec: Extract<RouteGraphJson["work"], { schema: string }>;
    readonly schema: z.ZodType;
  };
}
/** The host currently executes only Work migrations from route bindings.
 * Migration dependencies (including codecs) are ordinary imports of these neutral bodies.
 * Browser slots remain in data and the closure but are never loaded or fabricated here. */
export interface HostRouteModule {
  readonly data: RouteGraphJson;
  readonly schemas: Readonly<Record<string, z.ZodType>>;
  readonly bodies: Readonly<Record<string, {
    readonly slot: string;
    readonly kind: "migration";
    readonly source: { readonly module: string; readonly export: string };
    readonly run: (doc: unknown) => unknown;
  }>>;
}
export type HostRouteAdmission =
  | { readonly ok: true; readonly route: HostAdmittedRoute }
  | { readonly ok: false; readonly diagnostics: readonly RouteDiagnostic[] };
export interface HostRouteAdmissionPort {
  /** Decode the unchanged declaration, compare it to the verified builtin closure,
   * and require every host slot. UI-only slots supply no host bindings or authority. */
  admitHost(module: HostRouteModule): HostRouteAdmission;
}
