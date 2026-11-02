import type { BodyBindings, CodecBindings, EntryTable } from "./route-kernel-bodies.ts";
import type { Immutable, RouteDiagnostic, RouteGraphJson } from "./route-kernel-data.ts";
import type { IdentityBindings, SchemaTable } from "./route-kernel-page.ts";

declare const admitted: unique symbol;
declare const fingerprint: unique symbol;
export type RouteFingerprint = string & { readonly [fingerprint]: "sha256:route-v1" };
export interface ExecutableMember {
  /** Case-sensitive POSIX package-relative path; reject .., absolute paths and duplicates. */
  readonly path: string;
  /** SHA-256 of exact shipped bytes, including whitespace, line endings and source maps if loaded. */
  readonly sha256: string;
}
/** Fingerprint v1 = SHA256(UTF8("pe.route.v1\n") || UTF8(JCS(envelope))).
 * JCS is RFC 8785: reject non-JSON values, non-finite numbers and lone surrogates.
 * envelope = {version:1,data,contracts,executables}; data is decoded RouteGraphJson,
 * contracts is [{id,sha256}] sorted by id (catalog/schema/codec/kernel contracts),
 * executables is [{client,entry,members:[{path,sha256}]}] sorted by client then entry,
 * members sorted by path. Sorts use UTF-16 code units, never locale ordering.
 * Each member hash covers exact shipped artifact bytes. Include the transitive closure
 * of body, renderer, adapter, refinement, transform, codec, migration and seed modules,
 * plus all transitively loaded assets/dependencies. No timestamps or absolute paths.
 * Bundles may represent that closure as one member. Externals need pinned content hashes;
 * unresolved/dynamic dependency closure refuses admission. Function.toString is forbidden.
 * Web/Pea variants occupy separate client entries in the SAME envelope. Admission verifies
 * actual loaded bytes before publishing. A checks hashing; P supplies the Pod artifact. */
export interface RouteFingerprintInput {
  readonly version: 1;
  readonly data: RouteGraphJson;
  readonly contracts: readonly { readonly id: string; readonly sha256: string }[];
  readonly executables: readonly {
    readonly client: "web" | "pea" | "shared";
    readonly entry: string;
    readonly members: readonly ExecutableMember[];
  }[];
}
export interface RouteModule<
  G extends RouteGraphJson,
  S extends SchemaTable,
  E extends EntryTable,
  Render = unknown,
> {
  readonly data: G;
  readonly schemas: S;
  readonly codecs: CodecBindings<G, S>;
  readonly identities: IdentityBindings<G>;
  readonly entries: E;
  readonly bodies: BodyBindings<G, S, E, Render>;
  readonly artifact: RouteFingerprintInput;
}
/** Only A's admission implementation mints this value after all checks succeed.
 * Freeze/copy data and binding tables at runtime, capture executable references once,
 * and expose no mutable registry. Branding is an API boundary, not a JS security sandbox. */
export interface AdmittedRoute<G extends RouteGraphJson = RouteGraphJson> {
  readonly [admitted]: true;
  readonly data: Immutable<G>;
  readonly fingerprint: RouteFingerprint;
}
export type RouteAdmission<G extends RouteGraphJson> =
  | { readonly ok: true; readonly route: AdmittedRoute<G> }
  | { readonly ok: false; readonly diagnostics: readonly RouteDiagnostic[] };
export interface RouteAdmissionPort {
  admit<G extends RouteGraphJson, S extends SchemaTable, E extends EntryTable, Render>(
    module: RouteModule<G, S, E, Render>,
  ): RouteAdmission<G>;
}
/** Registration/discovery/execution consume the same admitted handle. Refused descriptors
 * have no executable handle. No namespace prefix bypass, no publication before admission. */
export interface AdmittedRouteRegistry {
  register(route: AdmittedRoute): { deactivate(): void };
}
