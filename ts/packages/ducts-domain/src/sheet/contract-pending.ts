/**
 * TEMPORARY (run fans-20261116, writer P2-B): the phase-2 contract block, verbatim, until writer A's
 * `@pe/agent-contracts` declarations merge. Deleted in this branch's final commit; never the authority.
 */
import type { Author, ValueSource } from "@pe/agent-contracts";

export type FanBlockerKind =
  | "open-end"
  | "inferred-join"
  | "unknown-drop"
  | "no-flow"
  | "flow-mismatch"
  | "shared-leg"
  | "class-change"
  | "not-priced"
  | "implausible-loss"
  | "equipment-pairing"
  | "backflow";
export type FanRef = { unitId: number; portIndex: number };
export type SourcedValue<T> =
  | { status: "valid"; value: T; source: ValueSource;
      author: Author | null; ref: string; version: string | number | null;
      units: string | null }
  | { status: "missing"; value: null; source: "none";
      author: null; ref: null; version: null; units: string | null }
  | { status: "invalid"; value: null; source: ValueSource;
      author: Author | null; ref: string; version: string | number | null;
      units: string | null };
export type AuthoredValue<T> = {
  value: T; author: Author; source: ValueSource; ref: string;
  version: string | number | null;
};
export type CoverageGap = {
  kind: "native-peer" | "budget" | "pricing" | "host-calc" | "cycle";
  elementId: number | null; ref: string;
};
export type Encounter = {
  fan: FanRef; host: FanRef; elementId: number; connector: number;
  side: "supply" | "return";
  verdict: "unruled" | "accepted" | "refused";
  static: { kind: "none" } | { kind: "host-calc"; basis: string;
    inWg: number; source: string };
};
export type FanClaim =
  | { kind: "complete"; basis: string; requiredEspInWg: number;
      coverage: readonly []; blockingIds: readonly [] }
  | { kind: "to-boundary"; basis: string; knownInWg: number;
      boundaries: readonly [Encounter, ...Encounter[]];
      coverage: readonly []; blockingIds: readonly string[] }
  | { kind: "incomplete"; basis: string; knownInWg: number;
      coverage: readonly CoverageGap[]; blockingIds: readonly string[] };
export type InputTarget = {
  work: "fans" | "ducts"; segment: string; row: string;
};
export type FanCloser =
  | { kind: "cell"; target: InputTarget;
      offers: readonly AuthoredValue<number>[] }
  | { kind: "heal"; pair: readonly [string, string] }
  | { kind: "encounter"; encounter: Encounter }
  | { kind: "none"; reason: string };
export type FanIssue = {
  id: string; kind: FanBlockerKind; elementId: number;
  severity: "blocking" | "warning"; closer: FanCloser;
};
export type LegEvidence =
  | { kind: "friction"; roughnessFt: number; lengthFt: number;
      hydraulicDiameterFt: number; ref: string }
  | { kind: "coefficient"; coefficient: number;
      velocityPressureInWg: number; basisElementId: number;
      rule: string; table: string;
      lookup: Readonly<Record<string, number | string>>; ref: string }
  | { kind: "drop"; value: SourcedValue<number> }
  | { kind: "unpriced"; issueId: string };
export type FanEspValues = {
  rated: SourcedValue<number>;
  required: FanClaim;
  staged: SourcedValue<number>;
};
