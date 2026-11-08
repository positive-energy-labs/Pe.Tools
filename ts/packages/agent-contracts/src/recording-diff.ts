import type { IdentityId } from "./route-kernel-page.ts";
import type { GraphJsonValue } from "./route-graph.ts";

export type DiffJson = GraphJsonValue;
export interface DiffPort {
  readonly element: IdentityId<"element">;
  readonly index: number;
}
/** Section bounds survive changes to the member set. Loops have no admitted identity. */
export type RecordingDiffKey =
  | { readonly kind: "element"; readonly id: IdentityId<"element"> }
  | { readonly kind: "port"; readonly port: DiffPort }
  | { readonly kind: "system"; readonly systemName: string }
  | { readonly kind: "section"; readonly bounds: readonly [DiffPort, DiffPort] }
  | { readonly kind: "path"; readonly fan: DiffPort; readonly terminal: IdentityId<"element"> }
  | { readonly kind: "loop" };
export type RecordingDiffCoverage =
  | { readonly kind: "partial"; readonly reason: string }
  | {
      readonly kind: "complete";
      /** Same domain/query scope on both sides; evidence must attest its full id-set,
       * not merely the kinds reported by a reader. Every key must have an entry. */
      readonly scope: string;
      readonly evidence: string;
      readonly keys: readonly RecordingDiffKey[];
    };
export interface RecordingDiffEntry {
  readonly key: RecordingDiffKey;
  readonly model: DiffJson;
  readonly authored: DiffJson;
  readonly computed: DiffJson;
}
/** Point stays opaque to the algorithm. Bind Point to RecordingPoint at the caller;
 * there is deliberately no second point schema or persistence authority here. */
export interface RecordingDiffSnapshot<Point = unknown> {
  readonly point: Point;
  readonly document: IdentityId<"document">;
  readonly coverage: RecordingDiffCoverage;
  readonly entries: readonly RecordingDiffEntry[];
}
export interface RecordingFacetDifference {
  readonly facet: "model" | "authored" | "computed";
  /** Object keys, without delimiter escaping; arrays are atomic values. */
  readonly path: readonly string[];
  readonly before: DiffJson | undefined;
  readonly after: DiffJson | undefined;
}
export type RecordingDiffIncomparableReason =
  | "partial-coverage"
  | "coverage-mismatch"
  | "invalid-identity"
  | "duplicate-key"
  | "unsupported-loop"
  | "cross-document-correspondence-unavailable";
export type RecordingDiffResult =
  | {
      readonly kind: "incomparable";
      readonly reason: RecordingDiffIncomparableReason;
      readonly coverage: {
        readonly before: RecordingDiffCoverage;
        readonly after: RecordingDiffCoverage;
      };
    }
  | {
      readonly kind: "comparable";
      readonly added: readonly RecordingDiffEntry[];
      readonly removed: readonly RecordingDiffEntry[];
      readonly unchanged: readonly RecordingDiffEntry[];
      readonly changed: readonly {
        readonly before: RecordingDiffEntry;
        readonly after: RecordingDiffEntry;
        readonly differences: readonly RecordingFacetDifference[];
      }[];
    };
