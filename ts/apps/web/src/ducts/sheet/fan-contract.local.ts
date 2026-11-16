// TEMPORARY (writer P2-C): stands in for writer A's `@pe/agent-contracts` declarations until A merges.
// Copied from the frozen contract block; deleted in this branch's final commit.
type Author = "human" | "pea" | "unknown";
type ValueSource = "run" | "Work" | "model-store" | "model" | "project" | "firm" | "default";
export type FanRef = { unitId: number; portIndex: number };
export type SourcedValue<T> =
  | { status: "valid"; value: T; source: ValueSource; author: Author | null; ref: string; version: string | number | null; units: string | null }
  | { status: "missing"; value: null; source: "none"; author: null; ref: null; version: null; units: string | null }
  | { status: "invalid"; value: null; source: ValueSource; author: Author | null; ref: string; version: string | number | null; units: string | null };
export type AuthoredValue<T> = { value: T; author: Author; source: ValueSource; ref: string; version: string | number | null };
export type CoverageGap = { kind: "native-peer" | "budget" | "pricing" | "host-calc" | "cycle"; elementId: number | null; ref: string };
export type Encounter = { fan: FanRef; host: FanRef; elementId: number; connector: number; side: "supply" | "return"; verdict: "unruled" | "accepted" | "refused";
  static: { kind: "none" } | { kind: "host-calc"; basis: string; inWg: number; source: string } };
export type FanClaim =
  | { kind: "complete"; basis: string; requiredEspInWg: number; coverage: readonly []; blockingIds: readonly [] }
  | { kind: "to-boundary"; basis: string; knownInWg: number; boundaries: readonly [Encounter, ...Encounter[]]; coverage: readonly []; blockingIds: readonly string[] }
  | { kind: "incomplete"; basis: string; knownInWg: number; coverage: readonly CoverageGap[]; blockingIds: readonly string[] };
export type InputTarget = { work: "fans" | "ducts"; segment: string; row: string };
export type FanCloser =
  | { kind: "cell"; target: InputTarget; offers: readonly AuthoredValue<number>[] }
  | { kind: "heal"; pair: readonly [string, string] }
  | { kind: "encounter"; encounter: Encounter }
  | { kind: "none"; reason: string };
export type FanParameterCohort = { parameter: string; owner: { kind: "instance" | "type"; id: number };
  members: readonly { elementId: number; uniqueId: string }[]; basis: string; complete: boolean };
export type FanEspValues = { rated: SourcedValue<number>; required: FanClaim; staged: SourcedValue<number> };
