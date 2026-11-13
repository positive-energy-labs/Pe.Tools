import type { z } from "zod";
import { z as hostZ } from "zod";
import type { RouteFingerprint } from "./route-kernel-admission.ts";
import type { RouteDiagnostic, RouteGraphJson } from "./route-kernel-data.ts";
import { RouteGraphJson as hostGraphSchema } from "./route-kernel-data.ts";
import type { RouteStateSpec, RouteWriteAdmission } from "./route-state.ts";

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
/** The host captures neutral Work bindings.
 * Dependencies (including codecs) are ordinary imports of these neutral bodies.
 * Browser slots remain in data and the closure but are never loaded or fabricated here. */
export interface HostWorkRegistration {
  spec: RouteStateSpec<z.ZodType>;
  admit?: RouteWriteAdmission;
}
export interface HostRouteModule extends Omit<HostWorkRegistration, "spec"> {
  readonly data: RouteGraphJson;
  readonly schemas: Readonly<Record<string, z.ZodType>>;
  /** Complete neutral owner export. No hook is reconstructed from a field allowlist. */
  readonly workState?: Readonly<RouteStateSpec<z.ZodType>>;
  /** Typed modules name Work owners directly, without executable reading slots. */
  readonly readWorks?: readonly string[];
  readonly reads?: Readonly<Record<string, {
    readonly name:string; readonly input:z.ZodType; readonly output:z.ZodType;
    readonly run:(context:any,args:any)=>unknown;
  }>>;
  readonly leaves?: Readonly<Record<string,(args:unknown,services:HostLeafServices)=>Promise<unknown>>>;

}
export interface HostLeafServices {
  readonly evaluation:string;
  readonly origin:unknown;
  take(name:string,args:unknown):Promise<unknown>;
  revision(name:string,args:unknown):number;
}
export type HostRouteAdmission =
  | { readonly ok: true; readonly route: HostAdmittedRoute }
  | { readonly ok: false; readonly diagnostics: readonly RouteDiagnostic[] };
export interface HostRouteAdmissionPort {
  /** Decode the unchanged declaration, compare it to the verified builtin closure,
   * and require every host slot. UI-only slots supply no host bindings or authority. */
  admitHost(module: HostRouteModule): HostRouteAdmission;
}

// Exhaustive against RouteStateSpec: adding a field requires deciding its boundary validation.
const workStateFields = {
  route: hostZ.string().min(1),
  title: hostZ.string(),
  description: hostZ.string(),
  finds: hostZ.array(hostZ.string()).optional(),
  schema: hostZ.custom<z.ZodType>((v) => v instanceof hostZ.ZodType),
  schemaVersion: hostZ.number().int().positive().optional(),
  editable: hostZ.array(hostZ.array(hostZ.union([hostZ.string(), hostZ.number()]))).optional(),
  reconcileEdit: hostZ
    .custom<RouteStateSpec<z.ZodType>["reconcileEdit"]>((v) => typeof v === "function")
    .optional(),
  // Kernel Work only (findings): a route module's Work takes the generic doors its mount starts and edits through.
  authoredThrough: hostZ.never().optional(),
} satisfies Record<keyof RouteStateSpec<z.ZodType>, z.ZodType>;
const workStateSchema = hostZ.strictObject(workStateFields);
const hostModuleSchema = hostZ.strictObject({
  data: hostGraphSchema,
  schemas: hostZ.record(
    hostZ.string(),
    hostZ.custom<z.ZodType>((v) => v instanceof hostZ.ZodType),
  ),
  readWorks: hostZ.array(hostZ.string().min(1)).max(128).optional(),
  reads: hostZ.record(hostZ.string(),hostZ.object({name:hostZ.string(),input:hostZ.custom<z.ZodType>(v=>v instanceof hostZ.ZodType),
    output:hostZ.custom<z.ZodType>(v=>v instanceof hostZ.ZodType),run:hostZ.custom<(context:any,args:any)=>unknown>(v=>typeof v === "function")})).optional(),
  leaves:hostZ.record(hostZ.string(),hostZ.custom<NonNullable<HostRouteModule["leaves"]>[string]>(v=>typeof v === "function")).optional(),
  admit: hostZ.custom<RouteWriteAdmission>((v) => typeof v === "function").optional(),
  workState: hostZ
    .custom<RouteStateSpec<z.ZodType>>((v) => workStateSchema.safeParse(v).success)
    .optional(),

});
/** Capture exports before fingerprint verification yields. Never freeze caller-owned Zod internals. */
export function captureHostModule(input: unknown): HostRouteModule {
  const value = hostModuleSchema.parse(input);
  return Object.freeze({
    data: structuredClone(value.data),
    schemas: Object.freeze({ ...value.schemas }),
    ...(value.readWorks ? {readWorks:Object.freeze([...value.readWorks])} : {}),
    ...(value.reads?{reads:Object.freeze(Object.fromEntries(Object.entries(value.reads).map(([key,read])=>[key,Object.freeze({...read})])))}:{}),
    ...(value.leaves?{leaves:Object.freeze({...value.leaves})}:{}),
    ...(Object.hasOwn(value, "admit") ? { admit: value.admit } : {}),
    ...(value.workState
      ? {
          workState: Object.freeze(
            Object.fromEntries(
              Object.entries(value.workState).map(([key, field]) => [
                key,
                key === "schema" || typeof field === "function" || field === undefined
                  ? field
                  : freezeStateData(structuredClone(field)),
              ]),
            ),
          ) as unknown as Readonly<RouteStateSpec<z.ZodType>>,
        }
      : {}),

  });
}

function freezeStateData<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freezeStateData(child);
    Object.freeze(value);
  }
  return value;
}
