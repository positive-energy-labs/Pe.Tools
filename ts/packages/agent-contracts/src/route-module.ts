import type { WorkOf } from "./route-kernel-page.ts";
import type { BodyBindings, EntryTable } from "./route-kernel-bodies.ts";
import type { SchemaTable } from "./route-kernel-page.ts";
import {
  captureHostModule,
  type HostRouteModule,
  type HostRouteAdmission,
  type HostRouteAdmissionPort,
  type HostAdmittedRoute,
} from "./host-route-admission.ts";
import type { RouteModule as KernelModule, RouteBodyRender } from "./route-kernel-admission.ts";
import { bare, manyCodec } from "./route-field.ts";
import { catalogEntries } from "./pe-api.ts";
import { requireLinkedCatalog, type CatalogAxes } from "./catalog.ts";
import type { z } from "zod";
import type { Command } from "./command.ts";
import type { RouteStateSpec } from "./route-state.ts";
import type { RouteGraph } from "./route-graph.ts";
import { validateRouteGraph } from "./route-graph.ts";

/** The same admission envelope for shipped and Pod-authored route modules. */
export interface RouteModule<B = unknown> {
  version: 1;
  namespace: string;
  key: string;
  moduleHash: string;
  graph: RouteGraph<any, any>;
  bodies: B;
}
export function validateRouteModule(module: RouteModule): void {
  if (module.version !== 1 || !/^[a-z0-9][a-z0-9.-]*$/.test(module.namespace))
    throw Error("Unsupported route registration version or namespace");
  if (module.key !== `${module.namespace}:${module.graph.key}`)
    throw Error("Route registration key must belong to its namespace");
  if (module.namespace !== "builtin" && !module.graph.key.startsWith(`pod.${module.namespace}.`))
    throw Error("A Pod cannot claim another author's route");
  if (!/^[a-f0-9]{64}$/.test(module.moduleHash))
    throw Error("Route registration needs its module SHA-256");
  if (!module.graph.directory) throw Error("Route registration needs a directory declaration");
  if (module.namespace !== "builtin") {
    for (const [id, field] of Object.entries(module.graph.fields)) {
      if (
        bare(field.schema).def.type === "array" ||
        (field.cardinality === "many" &&
          (field.codec !== manyCodec || !field.schema.safeParse("all").success))
      )
        throw Error(`fields.${id}: Array fields must use kernel manyField with ids | all`);
    }
  }
  const errors = validateRouteGraph(module.graph);
  if (errors.length)
    throw Error(errors.map((error) => `${error.path}: ${error.message}`).join("; "));
}

/** Executable entries travel with the graph and Work, never as a second installation. */
export interface ExecutableRouteModule<B> extends RouteModule<Record<string, B>> {
  work: RouteStateSpec<z.ZodType>;
  entries: Readonly<Record<string, Command & { axes: CatalogAxes }>>;
}
const previewOf = (entry: Command) => {
  const boundary = (entry as { writeBoundary?: import("./write-intent.ts").WriteBoundaryBinding })
    .writeBoundary;
  return boundary?.phase === "apply" ? boundary.previewKey : undefined;
};
export function validateExecutableRouteModule<B>(
  module: ExecutableRouteModule<B>,
  actualHash: string,
) {
  validateRouteModule(module);
  if (module.moduleHash !== actualHash) throw Error("Route module hash mismatch");
  for (const [key, entry] of Object.entries(module.entries))
    if (entry.needs !== "nothing" && entry.axes?.subject === "None")
      throw Error(`${key}: a document requirement cannot declare Subject None`);
  requireLinkedCatalog([
    ...catalogEntries,
    ...Object.entries(module.entries).map(([key, entry]) => ({
      ...entry.axes,
      key: `command:${key}`,
      uses: entry.native ?? [],
      ...entry.derivation,
      ...(previewOf(entry) ? { previewBy: `command:${previewOf(entry)}` } : {}),
    })),
  ]);
  if (module.work.route !== module.graph.key) throw Error("Work belongs to another route");
  for (const key of Object.keys(module.entries)) {
    if (module.namespace !== "builtin" && !key.startsWith(`pod.${module.namespace}.`))
      throw Error("Catalog key belongs to another author");
    if (!Object.hasOwn(module.bodies, key)) throw Error(`Missing executable body: ${key}`);
  }
  if (Object.keys(module.bodies).some((key) => !Object.hasOwn(module.entries, key)))
    throw Error("Executable body has no catalog entry");
}
/** Host-local admitted projection; consumers never mutate the executable registry. */
export const admittedRouteEntries = new Map<
  string,
  { entries: Readonly<Record<string, Command & { axes: CatalogAxes }>>; available: () => boolean }
>();

// Kernel admission is prepared independently of the legacy directory above. S2 removes
// the old executable-graph API when its remaining mount/Pod consumers migrate.
import { z as kernelZ } from "zod";
import { canonicalRouteJson } from "./route-graph.ts";
import {
  decodeRouteGraph,
  linkRouteBodies,
  routeBindingSchema,
  routeDiagnostic,
  type RouteBindings,
} from "./route-bodies.ts";
import type { CatalogLink } from "./catalog.ts";
import type {
  RouteGraphJson as KernelGraph,
  Immutable,
  RouteDiagnostic,
} from "./route-kernel-data.ts";
import type {
  RouteFingerprint,
  RouteFingerprintInput,
  RouteAdmissionPort,
  RouteAdmission,
  AdmittedRouteRegistry,
} from "./route-kernel-admission.ts";

const sha = kernelZ.string().regex(/^[a-f0-9]{64}$/);
const packagePath = kernelZ
  .string()
  .min(1)
  .refine(
    (path) =>
      !path.includes("\\") &&
      !path.includes(":") &&
      path.split("/").every((part) => part !== "" && part !== "." && part !== ".."),
    "Expected package-relative POSIX path",
  );
const envelopeSchema = kernelZ.strictObject({
  version: kernelZ.literal(1),
  data: kernelZ.unknown(),
  contracts: kernelZ
    .array(kernelZ.strictObject({ id: kernelZ.string().min(1), sha256: sha }))
    .min(1),
  executables: kernelZ
    .array(
      kernelZ.strictObject({
        client: kernelZ.enum(["web", "pea", "shared"]),
        entry: packagePath,
        members: kernelZ.array(kernelZ.strictObject({ path: packagePath, sha256: sha })).min(1),
      }),
    )
    .min(1),
});
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
function fingerprintEnvelope(input: unknown): RouteFingerprintInput {
  canonicalRouteJson(input);
  const parsed = envelopeSchema.parse(input);
  const decoded = decodeRouteGraph(parsed.data);
  if (!decoded.ok)
    throw Error(decoded.diagnostics.map((d) => `${d.path}: ${d.message}`).join("; "));
  const distinct = (keys: readonly string[]) => {
    if (new Set(keys).size !== keys.length) throw Error("Duplicate fingerprint member");
  };
  distinct(parsed.contracts.map((contract) => contract.id));
  distinct(parsed.executables.map((executable) => `${executable.client}:${executable.entry}`));
  for (const executable of parsed.executables) {
    distinct(executable.members.map((member) => member.path));
    if (!executable.members.some((member) => member.path === executable.entry))
      throw Error(`Missing executable entry bytes: ${executable.entry}`);
  }
  return {
    version: 1,
    data: decoded.data,
    contracts: parsed.contracts.sort((a, b) => compare(a.id, b.id)),
    executables: parsed.executables
      .sort((a, b) => compare(a.client, b.client) || compare(a.entry, b.entry))
      .map((executable) => ({
        ...executable,
        members: executable.members.sort((a, b) => compare(a.path, b.path)),
      })),
  };
}
async function hashBytes(bytes: Uint8Array): Promise<string> {
  const hash = await globalThis.crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
export async function routeFingerprint(input: RouteFingerprintInput): Promise<RouteFingerprint> {
  const hex = await hashBytes(
    new TextEncoder().encode(`pe.route.v1\n${canonicalRouteJson(fingerprintEnvelope(input))}`),
  );
  // The only brand assertion follows the specified SHA-256 computation.
  return hex as RouteFingerprint;
}
/** The loader supplies the complete resolved shipped closure, not function source strings.
 * Missing/dynamic dependencies must produce resolved:false. Both client variants belong here.
 * Contract bytes include catalog/schema/codec/kernel implementations or their pinned bundle.
 * This is loader evidence, not a sandbox for a malicious JavaScript loader. */
export interface PackageRouteAdmissionEvidence {
  /** Exact exports evaluated by the loader from the byte closure below. Admission
   * captures their references before hashing, so a replacement function cannot reuse a stamp. */
  readonly loadedBindings: unknown;
  readonly artifact: RouteFingerprintInput;
  readonly expectedFingerprint: string;
  readonly contracts: readonly { readonly id: string; readonly bytes: Uint8Array }[];
  readonly executables: readonly {
    readonly client: "web" | "pea" | "shared";
    readonly entry: string;
    readonly resolved: boolean;
    readonly members: readonly { readonly path: string; readonly bytes: Uint8Array }[];
  }[];
  readonly catalog: readonly CatalogLink[];
}
/** Build-owned source inventory. These are deployment consistency witnesses, not package bytes. */
export interface BuiltinClosure {
  readonly source: "builtin-closure";
  readonly version: 1;
  readonly data: KernelGraph;
  readonly hostVersion: string;
  readonly variants: readonly { readonly client: "web" | "pea"; readonly entry: string }[];
  readonly modules: readonly { readonly id: string; readonly sha256: string }[];
  readonly inputs: readonly { readonly id: string; readonly sha256: string }[];
  readonly externals: readonly { readonly id: string; readonly sha256: string }[];
}
export type RouteFingerprintEnvelope =
  | BuiltinClosure
  | {
      readonly source: "pod-bytes";
      readonly version: 1;
      readonly artifact: RouteFingerprintInput;
    };
export async function builtinClosureFingerprint(
  closure: BuiltinClosure,
): Promise<RouteFingerprint> {
  const decoded = decodeRouteGraph(closure.data);
  if (!decoded.ok) throw Error("Invalid builtin declaration");
  for (const list of [closure.modules, closure.inputs, closure.externals]) {
    if (new Set(list.map((member) => member.id)).size !== list.length)
      throw Error("Duplicate builtin closure member");
    for (const member of list) sha.parse(member.sha256);
  }
  if (
    !closure.variants.length ||
    closure.variants.some(
      (variant) => !closure.modules.some((member) => member.id === variant.entry),
    )
  )
    throw Error("Builtin entry is absent from source closure");
  return (await hashBytes(
    new TextEncoder().encode(
      `pe.route.fingerprint.v1\n${canonicalRouteJson({ ...closure, data: decoded.data })}`,
    ),
  )) as RouteFingerprint;
}
const sourceEvidence = new WeakMap<
  object,
  {
    module: unknown;
    host?: boolean;
    closure: BuiltinClosure;
    fingerprint: string;
    catalog: readonly CatalogLink[];
  }
>();
interface SourceRouteAdmissionEvidence {
  readonly source: "builtin-closure";
}
export type RouteAdmissionEvidence = PackageRouteAdmissionEvidence | SourceRouteAdmissionEvidence;
/** Trusted shell composition only. Authors supply keys, never a builtin receipt.
 * Like the byte evaluator, the build inventory is trusted code, not a JavaScript sandbox. */
export function createBuiltinRouteInventory<
  const T extends Record<
    string,
    {
      readonly module: unknown;
      readonly host?: boolean;
      readonly closure: { readonly envelope: BuiltinClosure; readonly fingerprint: string };
      readonly catalog: readonly CatalogLink[];
    }
  >,
>(inventory: T) {
  const entries = new Map(
    Object.entries(inventory).map(([key, entry]) => {
      const receipt: SourceRouteAdmissionEvidence = Object.freeze({ source: "builtin-closure" });
      sourceEvidence.set(receipt, {
        module: entry.host
          ? captureHostModule(entry.module)
          : routeBindingSchema.parse(entry.module),
        host: entry.host,
        closure: structuredClone(entry.closure.envelope),
        fingerprint: entry.closure.fingerprint,
        catalog: entry.catalog,
      });
      return [
        key,
        { receipt, module: entry.module, fingerprint: entry.closure.fingerprint },
      ] as const;
    }),
  );
  return Object.freeze({
    async prepare(key: keyof T & string, expectedFingerprint: string) {
      const entry = entries.get(key);
      if (!entry || entry.fingerprint !== expectedFingerprint)
        throw Error("Stale or unknown builtin stamp");
      return createRouteAdmission(entry.receipt);
    },
  });
}
export interface CheckedRouteAdmission extends RouteAdmissionPort, HostRouteAdmissionPort {
  admit<
    G extends KernelGraph,
    S extends SchemaTable,
    E extends EntryTable,
    B extends BodyBindings<G, S, E, unknown>,
  >(
    module: Omit<KernelModule<G, S, E>, "bodies" | "artifact"> & {
      readonly bodies: B;
      readonly artifact?: RouteFingerprintInput;
    },
  ): RouteAdmission<G, S, E, RouteBodyRender<B>>;
  /** Raw JSON/JS gets a runtime-safe handle, never fabricated literal inference. */
  admitUnknown(module: unknown): RouteAdmission<KernelGraph>;
}
const admittedBindings = new WeakMap<object, RouteBindings>();
const constructionKey = Symbol("checked admission");
function freezeData<T>(value: T): Immutable<T> {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freezeData(child);
    Object.freeze(value);
  }
  // Recursion above makes the generic mapped readonly view true at runtime.
  return value as Immutable<T>;
}
function snapshotBindings(bindings: RouteBindings): RouteBindings {
  // Do not freeze caller-owned Zod internals; clone schemas and capture executable
  // functions once. Runtime bodies are trusted code, not mutable registry lookups.
  return Object.freeze({
    sources: Object.freeze(
      Object.fromEntries(
        Object.entries(bindings.sources).map(([key, source]) => [
          key,
          source && typeof source === "object" ? Object.freeze({ ...source }) : source,
        ]),
      ),
    ),
    schemas: Object.freeze({
      ...Object.fromEntries(
        Object.entries(bindings.schemas).map(([key, schema]) => [key, schema.clone()]),
      ),
    }),
    codecs: Object.freeze(
      Object.fromEntries(
        Object.entries(bindings.codecs).map(([key, codec]) => [key, Object.freeze({ ...codec })]),
      ),
    ),
    identities: Object.freeze(
      Object.fromEntries(
        Object.entries(bindings.identities).map(([key, codec]) => [
          key,
          Object.freeze({ ...codec }),
        ]),
      ),
    ),
    entries: Object.freeze(
      Object.fromEntries(
        Object.entries(bindings.entries).map(([key, entry]) => [
          key,
          Object.freeze({
            input: entry.input.clone(),
            output: entry.output.clone(),
            axes: freezeData(structuredClone(entry.axes)),
          }),
        ]),
      ),
    ),
    bodies: Object.freeze(
      Object.fromEntries(
        Object.entries(bindings.bodies).map(([key, body]) => [
          key,
          Object.freeze({ ...body, source: Object.freeze({ ...body.source }) }),
        ]),
      ),
    ),
  });
}
declare const admittedTypes: unique symbol;
export class AdmittedRoute<
  G extends KernelGraph = KernelGraph,
  S extends SchemaTable = SchemaTable,
  E extends EntryTable = EntryTable,
  Render = unknown,
  W extends Record<string, unknown> = unknown extends WorkOf<G, S>
    ? Record<string, unknown>
    : Extract<Immutable<WorkOf<G, S>>, Record<string, unknown>>,
> {
  // Type witness only; executable bindings remain in the private exact-object table.
  declare readonly [admittedTypes]: { schemas: S; entries: E; render: Render };
  readonly #admissionAuthority = true;
  readonly data: Immutable<G>;
  readonly fingerprint: RouteFingerprint;
  readonly workFingerprint: RouteFingerprint;
  readonly resolvedWork?: {
    readonly spec: Extract<KernelGraph["work"], { schema: string }>;
    readonly schema: z.ZodType<W>;
  };
  private constructor(
    key: symbol,
    data: G,
    fingerprint: RouteFingerprint,
    bindings: RouteBindings,
    source: "builtin-closure" | "pod-bytes",
  ) {
    if (!this.#admissionAuthority || key !== constructionKey)
      throw Error("Admission requires the checked factory");
    this.data = freezeData(structuredClone(data));
    this.fingerprint = fingerprint;
    // The loader stamp is a digest; Work carries the source-discriminated envelope.
    this.workFingerprint = `${source}:${fingerprint}` as RouteFingerprint;
    const workSpec = this.data.work;
    this.resolvedWork = workSpec?.schema
      ? Object.freeze({
          spec: workSpec,
          // nominal boundary: string-keyed schema registry; admission at :568 proved identity; no Work value is cast
          schema: bindings.schemas[workSpec.schema] as z.ZodType<W>,
        })
      : undefined;
    admittedBindings.set(this, snapshotBindings(bindings));
    Object.freeze(this);
  }
  /** Async byte verification precedes the frozen synchronous admission port. */
  static async prepare(
    this: void,
    evidence: RouteAdmissionEvidence,
  ): Promise<CheckedRouteAdmission> {
    const diagnostics: RouteDiagnostic[] = [];
    let envelope: RouteFingerprintInput | undefined;
    let fingerprint: RouteFingerprint | undefined;
    let loadedBindings: RouteBindings | undefined;
    let source: BuiltinClosure | undefined;
    let hostModule: ReturnType<typeof captureHostModule> | undefined;
    let catalog: readonly CatalogLink[] = [];
    try {
      if ("source" in evidence) {
        const owned = sourceEvidence.get(evidence);
        if (!owned) throw Error("Builtin evidence requires the build-owned inventory");
        source = owned.closure;
        if (owned.host) hostModule = captureHostModule(owned.module);
        else loadedBindings = routeBindingSchema.parse(owned.module);
        catalog = owned.catalog;
        fingerprint = await builtinClosureFingerprint(source);
        if (fingerprint !== owned.fingerprint) throw Error("Builtin closure fingerprint mismatch");
      } else {
        envelope = fingerprintEnvelope(evidence.artifact);
        loadedBindings = routeBindingSchema.parse(evidence.loadedBindings);
        // Copy all loader evidence before the first await; callers cannot race verification.
        const contracts = evidence.contracts.map((item) => ({
          id: item.id,
          bytes: new Uint8Array(item.bytes),
        }));
        const executables = evidence.executables.map((item) => ({
          ...item,
          members: item.members.map((member) => ({
            path: member.path,
            bytes: new Uint8Array(member.bytes),
          })),
        }));
        const expected = sha.parse(evidence.expectedFingerprint);
        catalog = evidence.catalog.map((entry) => ({
          ...entry,
          touches: [...entry.touches],
          uses: entry.uses.map((use) => (typeof use === "string" ? use : { ...use })),
        }));
        if (executables.some((executable) => !executable.resolved))
          throw Error("Unresolved executable dependency closure");
        const actual: RouteFingerprintInput = {
          version: 1,
          data: envelope.data,
          contracts: await Promise.all(
            contracts.map(async (item) => ({ id: item.id, sha256: await hashBytes(item.bytes) })),
          ),
          executables: await Promise.all(
            executables.map(async (item) => ({
              client: item.client,
              entry: item.entry,
              members: await Promise.all(
                item.members.map(async (member) => ({
                  path: member.path,
                  sha256: await hashBytes(member.bytes),
                })),
              ),
            })),
          ),
        };
        if (canonicalRouteJson(fingerprintEnvelope(actual)) !== canonicalRouteJson(envelope))
          throw Error("Loaded artifact bytes or dependency closure do not match the manifest");
        fingerprint = await routeFingerprint(envelope);
        if (fingerprint !== expected) throw Error("Route fingerprint mismatch");
      }
    } catch (error) {
      diagnostics.push(
        routeDiagnostic(
          {},
          "artifact",
          "",
          "verified package or build-owned source fingerprint",
          String(error),
          "identity",
        ),
      );
    }
    const inspect = (module: unknown) => {
      if (hostModule)
        return {
          ok: false as const,
          diagnostics: [
            routeDiagnostic(
              {},
              "module",
              "",
              "web admission",
              "Host evidence cannot admit web bindings",
              "identity",
            ),
          ],
        };
      if (diagnostics.length) return { ok: false as const, diagnostics };
      const input = kernelZ
        .object({ data: kernelZ.unknown(), artifact: kernelZ.unknown().optional() })
        .safeParse(module);
      if (!input.success)
        return {
          ok: false as const,
          diagnostics: [
            routeDiagnostic({}, "module", "", "RouteModule", input.error.message, "schema"),
          ],
        };
      const decoded = decodeRouteGraph(input.data.data);
      if (!decoded.ok) return decoded;
      const bindings = routeBindingSchema.safeParse(module);
      if (!bindings.success)
        return {
          ok: false as const,
          diagnostics: bindings.error.issues.map((issue) =>
            routeDiagnostic(
              decoded.data,
              issue.path.join("."),
              "",
              "binding",
              issue.message,
              "schema",
            ),
          ),
        };
      try {
        if (
          (!source &&
            canonicalRouteJson(fingerprintEnvelope(input.data.artifact)) !==
              canonicalRouteJson(envelope)) ||
          canonicalRouteJson(decoded.data) !== canonicalRouteJson((source ?? envelope)?.data)
        )
          throw Error("Module and verified artifact data differ");
        const errors = linkRouteBodies(decoded.data, bindings.data, catalog);
        if (!loadedBindings || !sameLoadedBindings(bindings.data, loadedBindings))
          errors.push(
            routeDiagnostic(
              decoded.data,
              "bodies",
              "",
              "verified loaded exports",
              "Bindings differ from the exports captured with the verified bytes",
              "identity",
            ),
          );
        for (const [id, body] of Object.entries(bindings.data.bodies))
          if (
            !source &&
            !envelope?.executables.some((executable) =>
              executable.members.some((member) => member.path === body.source.module),
            )
          )
            errors.push(
              routeDiagnostic(
                decoded.data,
                body.slot,
                id,
                "packaged executable source",
                "Body source is absent from the verified closure",
                "missing",
                body.source,
              ),
            );
        if (errors.length) return { ok: false as const, diagnostics: errors };
        return { ok: true as const, data: decoded.data, bindings: bindings.data };
      } catch (error) {
        return {
          ok: false as const,
          diagnostics: [
            routeDiagnostic(
              decoded.data,
              "artifact",
              "",
              "verified artifact",
              String(error),
              "identity",
            ),
          ],
        };
      }
    };
    return {
      admitHost(module) {
        if (diagnostics.length) return { ok: false, diagnostics };
        if (!source || !fingerprint || !hostModule)
          return {
            ok: false,
            diagnostics: [
              routeDiagnostic(
                {},
                "module",
                "",
                "host builtin evidence",
                "Host admission requires a neutral builtin inventory",
                "identity",
              ),
            ],
          };
        try {
          return admitHostProjection(captureHostModule(module), hostModule, source, fingerprint);
        } catch (error) {
          return {
            ok: false,
            diagnostics: [
              routeDiagnostic({}, "module", "", "neutral host module", String(error), "schema"),
            ],
          };
        }
      },
      admit<
        G extends KernelGraph,
        S extends SchemaTable,
        E extends EntryTable,
        B extends BodyBindings<G, S, E, unknown>,
      >(
        module: Omit<KernelModule<G, S, E>, "bodies" | "artifact"> & {
          readonly bodies: B;
          readonly artifact?: RouteFingerprintInput;
        },
      ): RouteAdmission<G, S, E, RouteBodyRender<B>> {
        try {
          // Validate before cloning: structuredClone accepts undefined and non-finite numbers.
          canonicalRouteJson(module.data);
          const data = structuredClone(module.data);
          const inspected = inspect({ ...module, data });
          if (!inspected.ok) return inspected;
          if (!fingerprint) return { ok: false, diagnostics };
          return {
            ok: true,
            route: new AdmittedRoute<G, S, E, RouteBodyRender<B>>(
              constructionKey,
              data,
              fingerprint,
              inspected.bindings,
              source ? "builtin-closure" : "pod-bytes",
            ),
          };
        } catch (error) {
          return {
            ok: false,
            diagnostics: [
              routeDiagnostic({}, "data", "", "RouteGraphJson", String(error), "schema"),
            ],
          };
        }
      },
      admitUnknown(module) {
        const inspected = inspect(module);
        if (!inspected.ok) return inspected;
        if (!fingerprint) return { ok: false, diagnostics };
        return {
          ok: true,
          route: new AdmittedRoute(
            constructionKey,
            inspected.data,
            fingerprint,
            inspected.bindings,
            source ? "builtin-closure" : "pod-bytes",
          ),
        };
      },
    };
  }
}
export const createRouteAdmission = AdmittedRoute.prepare;
export function createAdmittedRouteRegistry(): AdmittedRouteRegistry {
  const active = new Map<AdmittedRoute, number>();
  const retired = new WeakSet<AdmittedRoute>();
  function resolve<G extends KernelGraph, S extends SchemaTable, E extends EntryTable, Render>(
    candidate: AdmittedRoute<G, S, E, Render>,
  ): AdmittedRoute<G, S, E, Render> | null;
  function resolve(candidate: unknown): AdmittedRoute | null;
  function resolve(candidate: unknown): AdmittedRoute | null {
    return candidate !== null &&
      typeof candidate === "object" &&
      admittedBindings.has(candidate) &&
      candidate instanceof AdmittedRoute &&
      active.has(candidate)
      ? candidate
      : null;
  }
  return {
    resolve,
    register(route) {
      if (!admittedBindings.has(route) || retired.has(route))
        throw Error("Foreign, copied or retired admission");
      active.set(route, (active.get(route) ?? 0) + 1);
      let live = true;
      return {
        deactivate() {
          if (!live) return;
          live = false;
          const count = active.get(route)! - 1;
          if (count) active.set(route, count);
          else {
            active.delete(route);
            retired.add(route);
          }
        },
      };
    },
  };
}
/** Mount/dispatch must resolve through their registry immediately before using these bindings. */
export function resolveRouteBindings<
  G extends KernelGraph,
  S extends SchemaTable,
  E extends EntryTable,
  Render,
>(
  registry: AdmittedRouteRegistry,
  candidate: AdmittedRoute<G, S, E, Render>,
):
  | (KernelGraph extends G
      ? RouteBindings
      : Omit<KernelModule<G, S, E, Render>, "data" | "artifact">)
  | null;
export function resolveRouteBindings(
  registry: AdmittedRouteRegistry,
  candidate: unknown,
): RouteBindings | null;
export function resolveRouteBindings(registry: AdmittedRouteRegistry, candidate: unknown): unknown {
  const route = registry.resolve(candidate);
  return route ? (admittedBindings.get(route) ?? null) : null;
}

function sameLoadedBindings(actual: RouteBindings, loaded: RouteBindings): boolean {
  const sameKeys = (a: object, b: object) =>
    canonicalRouteJson(Object.keys(a).sort()) === canonicalRouteJson(Object.keys(b).sort());
  for (const key of ["sources", "schemas", "codecs", "identities", "entries", "bodies"] as const)
    if (!sameKeys(actual[key], loaded[key])) return false;
  return (
    Object.entries(actual.sources).every(([id, source]) => {
      const expected = loaded.sources[id]!;
      return (
        source.kind === expected.kind &&
        source.open === expected.open &&
        source.derive === expected.derive &&
        source.key === expected.key &&
        source.effects === expected.effects &&
        source.recovers === expected.recovers &&
        canonicalRouteJson(source.dirties ?? []) === canonicalRouteJson(expected.dirties ?? [])
      );
    }) &&
    Object.entries(actual.schemas).every(([id, schema]) => schema === loaded.schemas[id]) &&
    Object.entries(actual.codecs).every(
      ([id, codec]) =>
        codec.encode === loaded.codecs[id]!.encode && codec.decode === loaded.codecs[id]!.decode,
    ) &&
    Object.entries(actual.identities).every(
      ([id, codec]) =>
        codec.kind === loaded.identities[id]!.kind &&
        codec.encode === loaded.identities[id]!.encode &&
        codec.decode === loaded.identities[id]!.decode &&
        codec.parts === loaded.identities[id]!.parts,
    ) &&
    Object.entries(actual.entries).every(
      ([id, entry]) =>
        entry.input === loaded.entries[id]!.input &&
        entry.output === loaded.entries[id]!.output &&
        canonicalRouteJson(entry.axes) === canonicalRouteJson(loaded.entries[id]!.axes),
    ) &&
    Object.entries(actual.bodies).every(
      ([id, body]) =>
        body.run === loaded.bodies[id]!.run &&
        body.slot === loaded.bodies[id]!.slot &&
        body.kind === loaded.bodies[id]!.kind &&
        canonicalRouteJson(body.source) === canonicalRouteJson(loaded.bodies[id]!.source),
    )
  );
}

const hostBindings = new WeakMap<HostAdmittedRoute, HostRouteModule>();
function admitHostProjection(
  module: HostRouteModule,
  captured: HostRouteModule,
  closure: BuiltinClosure,
  fingerprint: RouteFingerprint,
): HostRouteAdmission {
  const decoded = decodeRouteGraph(module.data);
  if (!decoded.ok) return decoded;
  const data = decoded.data;
  const errors: RouteDiagnostic[] = [];
  const fail = (path: string, message: string) =>
    errors.push(routeDiagnostic(data, path, "", "neutral host binding", message));
  if (canonicalRouteJson(data) !== canonicalRouteJson(closure.data))
    fail("data", "Neutral declaration differs from the verified builtin closure");
  if (canonicalRouteJson(data) !== canonicalRouteJson(captured.data))
    fail("data", "Neutral declaration changed after capture");
  for (const table of ["schemas", "bodies"] as const) {
    if (
      Object.keys(module[table]).sort().join("\n") !==
      Object.keys(captured[table]).sort().join("\n")
    )
      fail(table, "Bindings differ from captured exports");
  }
  for (const [id, schema] of Object.entries(module.schemas))
    if (captured.schemas[id] !== schema)
      fail(`schemas.${id}`, "Schema differs from captured exports");
  for (const [id, body] of Object.entries(module.bodies)) {
    const original = captured.bodies[id];
    if (
      !original ||
      original.run !== body.run ||
      original.slot !== body.slot ||
      original.kind !== body.kind ||
      canonicalRouteJson(original.source) !== canonicalRouteJson(body.source)
    )
      fail(`bodies.${id}`, "Body differs from captured exports");
  }
  if (
    Object.hasOwn(module, "admit") !== Object.hasOwn(captured, "admit") ||
    module.admit !== captured.admit ||
    (module.admit !== undefined && typeof module.admit !== "function")
  )
    fail("admit", "Host write admission differs from captured exports");
  if (module.admit && (!data.work?.schema || data.work.route !== data.key))
    fail("admit", "Only a Work owner declares write admission");
  const state = module.workState;
  const originalState = captured.workState;
  // Whole neutral exports have the same captured-function authority as named migration bodies.
  if (
    Object.keys(state ?? {})
      .sort()
      .join() !==
    Object.keys(originalState ?? {})
      .sort()
      .join()
  )
    fail("workState", "Work spec field set changed after capture");
  for (const [key, value] of Object.entries(state ?? {})) {
    const original = originalState?.[key as keyof NonNullable<typeof originalState>];
    if (key === "schema" || typeof value === "function") {
      if (value !== original) fail(`workState.${key}`, "Work spec export changed after capture");
    } else if (key === "migrations") {
      const migrations = value as NonNullable<NonNullable<typeof state>["migrations"]>;
      if (
        Object.keys(migrations).sort().join() !==
          Object.keys(originalState?.migrations ?? {})
            .sort()
            .join() ||
        Object.entries(migrations).some(
          ([age, run]) => originalState?.migrations?.[Number(age)] !== run,
        )
      )
        fail("workState.migrations", "Work migrations changed after capture");
    } else if (
      value === undefined || original === undefined
        ? value !== original
        : canonicalRouteJson(value) !== canonicalRouteJson(original)
    )
      fail(`workState.${key}`, "Work spec data changed after capture");
  }
  const work = data.work;
  let resolvedWork: HostAdmittedRoute["resolvedWork"];
  let workFingerprint = `builtin-closure:${fingerprint}` as RouteFingerprint;
  if (work && !data.capabilities.includes("work")) fail("work", "Work capability is missing");
  if (!work && data.capabilities.includes("work")) fail("work", "Work declaration is missing");
  if (work) {
    if (work.route !== data.key) fail("work.route", "Work belongs to its declaring route");
    if (!work.schema) fail("work.schema", "Owner must declare its Work schema");
    else {
      const schema = module.schemas[work.schema];
      if (!(schema && bare(schema) instanceof kernelZ.ZodObject))
        fail("work.schema", "Work needs a finite object schema");
      else
        resolvedWork = { spec: work as Extract<KernelGraph["work"], { schema: string }>, schema };
      for (let age = 1; age < work.version; age++)
        if (!Object.hasOwn(work.migrations, String(age)))
          fail(`work.migrations.${age}`, "Incomplete migration chain");
      for (const [age, id] of Object.entries(work.migrations)) {
        const body = module.bodies[id];
        if (Number(age) >= work.version)
          fail(`work.migrations.${age}`, "Migration age must precede current version");
        if (
          !body ||
          body.kind !== "migration" ||
          body.slot !== `work.migrations.${age}` ||
          typeof body.run !== "function"
        )
          fail(`work.migrations.${age}`, "Missing or misbound host migration");
      }
    }
  }
  if (work?.schema && work.route === data.key) {
    if (!state) fail("workState", "Host Work owner requires its complete RouteStateSpec");
    else {
      if (
        state.route !== work.route ||
        state.schema !== module.schemas[work.schema] ||
        (state.schemaVersion ?? 1) !== work.version
      )
        fail("workState", "Work spec differs from the declared owner/schema/version");
      if (
        Object.keys(state.migrations ?? {})
          .sort()
          .join() !== Object.keys(work.migrations).sort().join()
      )
        fail("workState.migrations", "Work spec migration chain differs from declaration");
      for (const [age, id] of Object.entries(work.migrations))
        if (state.migrations?.[Number(age)] !== module.bodies[id]?.run)
          fail(`workState.migrations.${age}`, "Work migration differs from captured body");
      if (data.salvage && state.salvage !== module.bodies[data.salvage]?.run)
        fail("workState.salvage", "Work recovery differs from captured body");
    }
  } else if (state) fail("workState", "Only a Work owner declares a Work spec");
  if (data.salvage && work?.schema) {
    const body = module.bodies[data.salvage];
    if (!body || body.kind !== "recovery" || body.slot !== "salvage")
      fail("salvage", "Missing or misbound host recovery extraction");
  }
  for (const [id, body] of Object.entries(module.bodies))
    if (
      !work?.schema ||
      (!(body.kind === "recovery" && id === data.salvage && body.slot === "salvage") &&
        !Object.entries(work.migrations).some(
          ([age, ref]) => ref === id && body.slot === `work.migrations.${age}`,
        ))
    )
      fail(`bodies.${id}`, "Undeclared host body");
  if (errors.length) return { ok: false, diagnostics: errors };
  // Only this factory, after source verification and host linking, asserts the nominal type.
  const route = Object.freeze({
    data: freezeData(structuredClone(data)),
    fingerprint,
    workFingerprint,
    resolvedWork:
      resolvedWork &&
      Object.freeze({
        spec: freezeData(structuredClone(resolvedWork.spec)),
        schema: resolvedWork.schema.clone(),
      }),
  }) as HostAdmittedRoute;
  hostBindings.set(
    route,
    Object.freeze({
      ...captured,
      ...(captured.workState
        ? {
            workState: Object.freeze({
              ...captured.workState,
              schema: captured.workState.schema.clone(),
            }),
          }
        : {}),
      schemas: Object.freeze(
        Object.fromEntries(
          Object.entries(captured.schemas).map(([id, schema]) => [id, schema.clone()]),
        ),
      ),
    }),
  );
  return { ok: true, route };
}
export function createHostAdmittedRouteRegistry() {
  const active = new Map<HostAdmittedRoute, number>();
  const retired = new WeakSet<HostAdmittedRoute>();
  return {
    resolve(route: HostAdmittedRoute) {
      return active.has(route) ? route : null;
    },
    register(route: HostAdmittedRoute) {
      if (!hostBindings.has(route) || retired.has(route))
        throw Error("Foreign, copied or retired host admission");
      active.set(route, (active.get(route) ?? 0) + 1);
      let live = true;
      return {
        deactivate() {
          if (!live) return;
          live = false;
          const count = active.get(route)! - 1;
          if (count) active.set(route, count);
          else {
            active.delete(route);
            retired.add(route);
          }
        },
      };
    },
  };
}
/** Workspace registration authenticates either authority, without granting host handles web authority. */
export function captureAdmittedHostBindings(route: AdmittedRoute | HostAdmittedRoute) {
  if (hostBindings.has(route as HostAdmittedRoute)) {
    const registry = createHostAdmittedRouteRegistry();
    const receipt = registry.register(route as HostAdmittedRoute);
    return {
      bindings: hostBindings.get(route as HostAdmittedRoute)!,
      deactivate: receipt.deactivate,
    };
  }
  const registry = createAdmittedRouteRegistry();
  const receipt = registry.register(route as AdmittedRoute);
  return {
    bindings: resolveRouteBindings(registry, route as AdmittedRoute)!,
    deactivate: receipt.deactivate,
  };
}
