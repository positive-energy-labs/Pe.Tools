import type { SemanticPreviewKey } from "./semantic-actions.ts";
import type { BodyBindings, CodecBindings, EntryTable } from "./route-kernel-bodies.ts";
import type { RouteDiagnostic, RouteGraphJson } from "./route-kernel-data.ts";
import type { AdmittedRoute } from "./route-module.ts";
import type { IdentityBindings, SchemaTable } from "./route-kernel-page.ts";

import { z } from "zod";

/** Work transport serializes the exact fingerprint envelope, source plus digest. */
export const workFingerprintSchema = z
  .string()
  .regex(/^(builtin-closure|pod-bytes):[a-f0-9]{64}$/)
  .transform((value) => value as RouteFingerprint);

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
 * of body, renderer, adapter, refinement, transform, codec and seed modules,
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
    readonly client: "web" | "pea" | "shared" | "host";
    readonly entry: string;
    readonly members: readonly ExecutableMember[];
  }[];
}
/** Native geometry entries cannot omit their policy even in checked TS authoring.
 * Journal-owned semantic previews use their declared rollback transport instead.
 * Admission also traverses catalog/Reading dependencies, which this finite map cannot infer. */
type LinkedReadings<G extends RouteGraphJson, E extends EntryTable> = {
  readonly [K in keyof G["readings"]]: G["readings"][K] &
    (G["readings"][K] extends { entry: infer C extends Exclude<keyof E, SemanticPreviewKey> }
      ? "Geometry" extends E[C]["axes"]["touches"][number]
        ? {
            readonly kind: "use";
            readonly geometry: NonNullable<
              Extract<RouteGraphJson["readings"][string], { kind: "use" }>["geometry"]
            >;
          }
        : unknown
      : unknown);
};
export interface RouteModule<
  G extends RouteGraphJson,
  S extends SchemaTable,
  E extends EntryTable,
  Render = unknown,
> {
  readonly data: G & { readonly readings: LinkedReadings<G, E> };
  readonly schemas: S;
  readonly codecs: CodecBindings<G, S>;
  readonly identities: IdentityBindings<G>;
  readonly entries: E;
  readonly bodies: BodyBindings<G, S, E, Render>;
  /** Source adapters imported by the module travel in its verified executable closure. */
  readonly sources?: Readonly<Record<string, unknown>>;
  readonly artifact: RouteFingerprintInput;
}
/** Only A's admission implementation mints this value after all checks succeed.
 * Freeze/copy data and binding tables at runtime, capture executable references once,
 * and expose no mutable registry. A private identity table authenticates this EXACT object
 * at registration, mounting and dispatch; copies/proxies/forged prototypes fail validation.
 * Private nominal membership is deliberately lost by object spread. Branding is an API boundary, not a JS security sandbox. */
export type { AdmittedRoute } from "./route-module.ts";
export type RouteAdmission<
  G extends RouteGraphJson,
  S extends SchemaTable = SchemaTable,
  E extends EntryTable = EntryTable,
  Render = unknown,
> =
  | { readonly ok: true; readonly route: AdmittedRoute<G, S, E, Render> }
  | { readonly ok: false; readonly diagnostics: readonly RouteDiagnostic[] };
/** Infer the client render value from pane bodies, rather than a mapped-type inference hole. */
export type RouteBodyRender<B> =
  Extract<B[keyof B], { readonly kind: "pane" }> extends {
    readonly run: (...args: never[]) => infer Render;
  }
    ? Render
    : never;
/** TODO: A validates linked catalog footprint, not route opt-in: every native Geometry read and
 * transitive native geometry dependency requires an overview or explicit-detail declaration.
 * Journal-owned semantic plans retain their Geometry and Read or rolled-back TransactRead axes without that policy. Default
 * overview closure contains no detailed request. Detail demand AND refresh must be explicit.
 * Validate mixed-subject schema/identity agreement and finite dependency keys, then hash
 * declared body bytes. */
export interface RouteAdmissionPort {
  admit<
    G extends RouteGraphJson,
    S extends SchemaTable,
    E extends EntryTable,
    B extends BodyBindings<G, S, E, unknown>,
  >(
    module: Omit<RouteModule<G, S, E>, "bodies"> & { readonly bodies: B },
  ): RouteAdmission<G, S, E, RouteBodyRender<B>>;
}
/** Registration/discovery/execution consume the same admitted handle. Refused descriptors
 * have no executable handle. No namespace prefix bypass, no publication before admission. */
export interface AdmittedRouteRegistry {
  /** Return only the exact issued handle; copied/foreign/retired handles return null. */
  resolve<G extends RouteGraphJson, S extends SchemaTable, E extends EntryTable, Render>(
    candidate: AdmittedRoute<G, S, E, Render>,
  ): AdmittedRoute<G, S, E, Render> | null;
  resolve(candidate: unknown): AdmittedRoute | null;
  register(route: AdmittedRoute): { deactivate(): void };
}
