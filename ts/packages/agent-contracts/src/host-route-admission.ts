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
/** The host executes Work migrations and recovery extraction from neutral bindings.
 * Recovery reads raw persisted Work; the web salvage body derives patches from its output.
 * Dependencies (including codecs) are ordinary imports of these neutral bodies.
 * Browser slots remain in data and the closure but are never loaded or fabricated here. */
export interface HostRouteModule {
  readonly data: RouteGraphJson;
  readonly schemas: Readonly<Record<string, z.ZodType>>;
  readonly bodies: Readonly<
    Record<
      string,
      {
        readonly slot: string;
        readonly kind: "migration" | "recovery";
        readonly source: { readonly module: string; readonly export: string };
        readonly run: (doc: unknown) => unknown;
      }
    >
  >;
}
export type HostRouteAdmission =
  | { readonly ok: true; readonly route: HostAdmittedRoute }
  | { readonly ok: false; readonly diagnostics: readonly RouteDiagnostic[] };
export interface HostRouteAdmissionPort {
  /** Decode the unchanged declaration, compare it to the verified builtin closure,
   * and require every host slot. UI-only slots supply no host bindings or authority. */
  admitHost(module: HostRouteModule): HostRouteAdmission;
}

import { z as hostZ } from "zod";
import { RouteGraphJson as hostGraphSchema } from "./route-kernel-data.ts";
const hostModuleSchema = hostZ.strictObject({
  data: hostGraphSchema,
  schemas: hostZ.record(
    hostZ.string(),
    hostZ.custom<z.ZodType>((v) => v instanceof hostZ.ZodType),
  ),
  bodies: hostZ.record(
    hostZ.string(),
    hostZ.strictObject({
      slot: hostZ.string(),
      kind: hostZ.enum(["migration", "recovery"]),
      source: hostZ.strictObject({ module: hostZ.string().min(1), export: hostZ.string().min(1) }),
      run: hostZ.custom<(doc: unknown) => unknown>((v) => typeof v === "function"),
    }),
  ),
});
/** Capture exports before fingerprint verification yields. Never freeze caller-owned Zod internals. */
export function captureHostModule(input: unknown): HostRouteModule {
  const value = hostModuleSchema.parse(input);
  return Object.freeze({
    data: structuredClone(value.data),
    schemas: Object.freeze({ ...value.schemas }),
    bodies: Object.freeze(
      Object.fromEntries(
        Object.entries(value.bodies).map(([id, body]) => [
          id,
          Object.freeze({ ...body, source: Object.freeze({ ...body.source }) }),
        ]),
      ),
    ),
  });
}
