import type { z } from "zod";
import type { ExecutionTarget } from "./target.ts";
import type { WorkKey } from "./route-state.ts";
import type { Immutable, RouteGraphJson } from "./route-kernel-data.ts";

export type SchemaTable = Readonly<Record<string, z.ZodType>>;
export type SchemaValue<S extends SchemaTable, K> = K extends keyof S ? z.output<S[K]> : never;
declare const identity: unique symbol;
export type IdentityKind = "document" | "link" | "element" | "local";
export type IdentityId<K extends IdentityKind> = string & { readonly [identity]: K };
export interface IdentityParts {
  document: { readonly document: string };
  link: {
    readonly document: string;
    readonly linkUniqueId: string;
    readonly linkedDocument: string;
  };
  element: {
    readonly document: string;
    readonly link: IdentityParts["link"] | null;
    readonly uniqueId: string;
  };
  local: { readonly namespace: string; readonly subject: string };
}
export type DecodeResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: string };
/** C implements codecs. Encode validates nonempty parts, rejects numeric ElementId aliases,
 * and emits JSON tuples (document=[document], link=[document,linkUniqueId,linkedDocument],
 * element=[document,linkTuple|null,uniqueId], local=[namespace,subject]). No delimiter splitting.
 * A native link instance number is resolved within its document lifetime before encoding.
 * URL serialization escapes the whole encoded value exactly once. Decode checks canonical form. */
export interface IdentityCodec<K extends IdentityKind> {
  readonly kind: K;
  encode(parts: IdentityParts[K]): DecodeResult<IdentityId<K>>;
  decode(text: string): DecodeResult<IdentityId<K>>;
  parts(id: IdentityId<K>): IdentityParts[K];
}
export type IdentityCodecs = { readonly [K in IdentityKind]: IdentityCodec<K> };
export type IdentityBindings<G extends RouteGraphJson> = {
  readonly [K in keyof G["identities"] as G["identities"][K]["codec"]]: IdentityCodec<
    G["identities"][K]["kind"]
  >;
};
export type SelectionItem<G extends RouteGraphJson> = {
  [K in keyof G["identities"] & string]: {
    readonly kind: K;
    readonly id: IdentityId<G["identities"][K]["kind"]>;
  };
}[keyof G["identities"] & string];
/** Ordered unique (kind,id) pairs; duplicates collapse to their first occurrence. Never `all`.
 * Focus and hover are ephemeral attention, not another selected domain object. */
export type Selection<G extends RouteGraphJson> = readonly SelectionItem<G>[];
export type Many<T> =
  | { readonly kind: "ids"; readonly ids: readonly T[] }
  | { readonly kind: "all" };
type FieldValue<G extends RouteGraphJson, S extends SchemaTable, F> = F extends {
  role: "selection";
  kinds: readonly (infer K)[];
}
  ? readonly Extract<SelectionItem<G>, { kind: K }>[]
  : F extends { role: "subject"; identity: infer K; cardinality: infer C }
    ? K extends keyof G["identities"]
      ? C extends "many"
        ? Many<IdentityId<G["identities"][K]["kind"]>>
        : IdentityId<G["identities"][K]["kind"]> | null
      : never
    : F extends { schema: infer K }
      ? SchemaValue<S, K>
      : never;
export type PageOf<G extends RouteGraphJson, S extends SchemaTable> = {
  readonly [K in keyof G["fields"]]: Immutable<FieldValue<G, S, G["fields"][K]>>;
};
export type WorkOf<G extends RouteGraphJson, S extends SchemaTable> = G extends {
  work: { schema: infer K };
}
  ? SchemaValue<S, K>
  : null;
export type RoleKeys<G extends RouteGraphJson, R> = {
  [K in keyof G["fields"]]: G["fields"][K]["role"] extends R ? K : never;
}[keyof G["fields"]];

declare const epoch: unique symbol;
declare const pageEpoch: unique symbol;
declare const lease: unique symbol;
declare const invocation: unique symbol;
declare const restore: unique symbol;
export type ScopeEpoch = { readonly [epoch]: true };
export type PageEpoch = { readonly [pageEpoch]: true };
export interface ScopeIdentity {
  readonly target: Immutable<ExecutionTarget> | null;
  readonly work: Immutable<WorkKey> | null;
}
/** Minted by one owner instance. Never reused across A→B→A or remounts. */
export interface ScopeToken {
  readonly identity: ScopeIdentity;
  readonly epoch: ScopeEpoch;
}
/** Attempt sequence is channel-local; it is NOT a Work revision. */
export interface AcceptanceToken {
  readonly scope: ScopeToken;
  readonly channel: string;
  readonly attempt: number;
}
export interface InvocationBasis {
  readonly token: AcceptanceToken;
  readonly pageEpoch: PageEpoch;
  readonly pageRevision: number;
  readonly workRevision: number | null;
  readonly dependencies: Readonly<Record<string, string>>;
}
export type InvocationToken = InvocationBasis & {
  readonly id: string;
  readonly [invocation]: true;
};
export type LeaseToken = InvocationBasis & { readonly [lease]: true };
export type RestoreToken = { readonly id: string; readonly [restore]: true };
export type MoveOrigin =
  | {
      readonly kind: "human";
      readonly source: "subject" | "stage" | "selection" | "setting" | "pose" | "query" | "draft";
      readonly history: "push" | "replace";
    }
  | { readonly kind: "pea"; readonly lease: LeaseToken }
  | {
      readonly kind: "restore";
      readonly source: "url" | "tab" | "initial";
      readonly token: RestoreToken;
    }
  | {
      readonly kind: "invocation";
      readonly token: InvocationToken;
      readonly purpose: "review" | "result";
    }
  | { readonly kind: "scope"; readonly token: ScopeToken };
export type MoveResult =
  | {
      readonly kind: "accepted";
      readonly revision: number;
      readonly changed: boolean;
      readonly membership: "verified" | "unresolved";
    }
  | { readonly kind: "refused"; readonly code: string; readonly message: string };
export interface PagePort<G extends RouteGraphJson, S extends SchemaTable> {
  read(): PageOf<G, S>;
  select(next: PageOf<G, S>[RoleKeys<G, "selection">]): MoveResult;
  set<K extends RoleKeys<G, "setting">>(key: K, value: PageOf<G, S>[K]): MoveResult;
  pose(
    patch: Partial<Pick<PageOf<G, S>, RoleKeys<G, "pose">>>,
    intent: "gesture" | "named",
  ): MoveResult;
}
/** Kernel controls only; panes receive PagePort and declared verbs, not these capabilities. */
export interface FieldControls<G extends RouteGraphJson, S extends SchemaTable> {
  subject(value: PageOf<G, S>[RoleKeys<G, "subject">]): MoveResult;
  stage(value: PageOf<G, S>[RoleKeys<G, "stage">]): MoveResult;
  query<K extends RoleKeys<G, "query">>(key: K, value: PageOf<G, S>[K]): MoveResult;
  draft<K extends RoleKeys<G, "draft">>(key: K, value: PageOf<G, S>[K]): MoveResult;
}
export type PagePatch<G extends RouteGraphJson, S extends SchemaTable> = Partial<PageOf<G, S>>;
/** Presence-aware restore: explicit empty/default wins over memory. Membership can remain
 * unresolved while evidence loads; never discard an explicitly restored selection on arrival.
 * Subject changes outside restore clear selection and frame in the SAME publication.
 * Selection-only moves preserve pose. Stale invocations cannot exempt themselves from epochs. */
export interface PageOwner<G extends RouteGraphJson, S extends SchemaTable> {
  movePage(patch: PagePatch<G, S>, origin: MoveOrigin): MoveResult;
  restorePage(
    state: Pick<PageOf<G, S>, RoleKeys<G, "subject" | "selection">> &
      Partial<Pick<PageOf<G, S>, RoleKeys<G, "pose" | "stage" | "query" | "draft">>>,
    origin: Extract<MoveOrigin, { kind: "restore" }>,
  ): MoveResult;
}
