import type { BodyBindings, EntryTable } from "./route-kernel-bodies.ts";
import type { SchemaTable } from "./route-kernel-page.ts";
import type { RouteModule as KernelModule, RouteBodyRender } from "./route-kernel-admission.ts";
import { bare, manyCodec } from "./route-field.ts";
import { catalogEntries } from "./pe-api.ts";
import { requireLinkedCatalog, type CatalogAxes } from "./catalog.ts";
import { routeDirectory } from "./generated/route-directory.ts";
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
  const builtin =
    module.namespace === "builtin"
      ? routeDirectory.find((row) => row.key === module.graph.key)
      : undefined;
  if (
    module.namespace === "builtin" &&
    (builtin?.moduleHash !== module.moduleHash || module.graph.moduleHash !== module.moduleHash)
  )
    throw Error("Builtin module hash does not match the generated directory");
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
      readonly closure: { readonly envelope: BuiltinClosure; readonly fingerprint: string };
      readonly catalog: readonly CatalogLink[];
    }
  >,
>(inventory: T) {
  const entries = new Map(
    Object.entries(inventory).map(([key, entry]) => {
      const receipt: SourceRouteAdmissionEvidence = Object.freeze({ source: "builtin-closure" });
      sourceEvidence.set(receipt, {
        module: routeBindingSchema.parse(entry.module),
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
export interface CheckedRouteAdmission extends RouteAdmissionPort {
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
    schemas: Object.freeze(
      Object.fromEntries(
        Object.entries(bindings.schemas).map(([key, schema]) => [key, schema.clone()]),
      ),
    ),
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
> {
  // Type witness only; executable bindings remain in the private exact-object table.
  declare readonly [admittedTypes]: { schemas: S; entries: E; render: Render };
  readonly #admissionAuthority = true;
  readonly data: Immutable<G>;
  readonly fingerprint: RouteFingerprint;
  readonly workFingerprint: RouteFingerprint;
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
    let catalog: readonly CatalogLink[] = [];
    try {
      if ("source" in evidence) {
        const owned = sourceEvidence.get(evidence);
        if (!owned) throw Error("Builtin evidence requires the build-owned inventory");
        source = owned.closure;
        loadedBindings = routeBindingSchema.parse(owned.module);
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
  for (const key of ["schemas", "codecs", "identities", "entries", "bodies"] as const)
    if (!sameKeys(actual[key], loaded[key])) return false;
  return (
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
