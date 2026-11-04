import type { z } from "zod";
import type { ExecutionTarget } from "./target.ts";
import type { WorkKey, WorkWriteAck } from "./route-state.ts";
import type { Immutable, RouteGraphJson } from "./route-kernel-data.ts";

export type SchemaTable = Readonly<Record<string, z.ZodType>>;
export type WorkSchema<G extends RouteGraphJson, S extends SchemaTable> =
  G extends { work: { schema: infer K } } ? S[Extract<K, keyof S>]
    : RouteGraphJson extends G ? S[keyof S] : never;
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
  | { readonly kind: "ids"; readonly ids: readonly T[]; readonly active?: T }
  | { readonly kind: "all" };
type FieldValue<G extends RouteGraphJson, S extends SchemaTable, F> = F extends {
  role: "selection";
  kinds: readonly (infer K)[];
}
  ? readonly Extract<SelectionItem<G>, { kind: K }>[]
  : F extends { role: "subject"; identity: readonly (infer K)[]; cardinality: infer C }
    ? C extends "many"
      ? Many<Extract<SelectionItem<G>, { kind: K }>>
      : Extract<SelectionItem<G>, { kind: K }> | null
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
export type WorkOf<G extends RouteGraphJson, S extends SchemaTable> = [WorkSchema<G, S>] extends [
  never,
]
  ? null
  : z.output<WorkSchema<G, S>>;
export type RoleKeys<G extends RouteGraphJson, R> = {
  [K in keyof G["fields"]]: G["fields"][K]["role"] extends R ? K : never;
}[keyof G["fields"]];

const epoch: unique symbol = Symbol("scope-epoch");
const pageEpoch: unique symbol = Symbol("page-epoch");
export type ScopeEpoch = { readonly [epoch]: true };
export type PageEpoch = { readonly [pageEpoch]: true };
export interface ScopeIdentity {
  readonly target: Immutable<ExecutionTarget> | null;
  readonly work: Immutable<WorkKey> | null;
}
let mintScope: (identity: ScopeIdentity, epoch: ScopeEpoch) => ScopeToken;
let mintAttempt: (scope: ScopeToken, channel: string, attempt: number) => AcceptanceToken;
let mintInvocation: (id: string, basis: InvocationBasis) => InvocationToken;
let mintLease: (basis: InvocationBasis) => LeaseToken;
let mintRestore: (id: string) => RestoreToken;

/** Minted by one owner instance. Never reused across A?B?A or remounts. */
export class ScopeToken {
  declare private readonly scopeAuthority: void;
  private constructor(
    readonly identity: ScopeIdentity,
    readonly epoch: ScopeEpoch,
  ) {
    Object.freeze(this);
  }
  static {
    mintScope = (identity, epoch) => new ScopeToken(identity, epoch);
  }
}
/** Attempt sequence is channel-local; it is NOT a Work revision. */
export class AcceptanceToken {
  declare private readonly attemptAuthority: void;
  private constructor(
    readonly scope: ScopeToken,
    readonly channel: string,
    readonly attempt: number,
  ) {
    Object.freeze(this);
  }
  static {
    mintAttempt = (scope, channel, attempt) => new AcceptanceToken(scope, channel, attempt);
  }
}
declare const causalParent: unique symbol;
export type CausalParentId = string & { readonly [causalParent]: true };
/** An edit carries its rendered accepted Work key (token.scope.identity.work) and
 * workRevision unchanged to submitWork.expectedRevision. A stale-base refusal, including
 * a delayed submit, must not be retried with a newer basis or recomputed patches. */
export interface InvocationBasis {
  readonly causalParent?: CausalParentId;
  readonly token: AcceptanceToken;
  readonly pageEpoch: PageEpoch;
  readonly pageRevision: number;
  readonly workRevision: number | null;
  readonly dependencies: Readonly<Record<string, string>>;
}
export class InvocationToken implements InvocationBasis {
  declare private readonly invocationAuthority: void;
  readonly token: AcceptanceToken;
  readonly pageEpoch: PageEpoch;
  readonly pageRevision: number;
  readonly workRevision: number | null;
  readonly dependencies: Readonly<Record<string, string>>;
  readonly causalParent?: CausalParentId;
  private constructor(
    readonly id: string,
    basis: InvocationBasis,
  ) {
    this.token = basis.token;
    this.pageEpoch = basis.pageEpoch;
    this.pageRevision = basis.pageRevision;
    this.workRevision = basis.workRevision;
    this.dependencies = Object.freeze({ ...basis.dependencies });
    this.causalParent = basis.causalParent;
    Object.freeze(this);
  }
  static {
    mintInvocation = (id, basis) => new InvocationToken(id, basis);
  }
}
export class LeaseToken implements InvocationBasis {
  declare private readonly leaseAuthority: void;
  readonly token: AcceptanceToken;
  readonly pageEpoch: PageEpoch;
  readonly pageRevision: number;
  readonly workRevision: number | null;
  readonly dependencies: Readonly<Record<string, string>>;
  readonly causalParent?: CausalParentId;
  private constructor(basis: InvocationBasis) {
    this.token = basis.token;
    this.pageEpoch = basis.pageEpoch;
    this.pageRevision = basis.pageRevision;
    this.workRevision = basis.workRevision;
    this.dependencies = Object.freeze({ ...basis.dependencies });
    this.causalParent = basis.causalParent;
    Object.freeze(this);
  }
  static {
    mintLease = (basis) => new LeaseToken(basis);
  }
}
export class RestoreToken {
  declare private readonly restoreAuthority: void;
  private constructor(readonly id: string) {
    Object.freeze(this);
  }
  static {
    mintRestore = (id) => new RestoreToken(id);
  }
}

/** Kernel-only mint capability. Keep the issuer private to the owning kernel, not in a pane.
 * Membership is exact instance identity; fields, prototypes and copied brands confer nothing.
 * Epoch ownership does not imply freshness: the acceptance owner retires scopes and attempts. */
export function createRouteTokenIssuer() {
  const issued = new WeakSet<object>();
  const pageEpochs = new WeakSet<PageEpoch>();
  const own = <T extends object>(value: T): T => {
    issued.add(value);
    return value;
  };
  const owns = (value: unknown): boolean =>
    typeof value === "object" && value !== null && issued.has(value);
  const basisOwned = (basis: InvocationBasis) =>
    basis.token instanceof AcceptanceToken && owns(basis.token) && pageEpochs.has(basis.pageEpoch);
  return Object.freeze({
    owns,
    scope(identity: ScopeIdentity): ScopeToken {
      const copy = structuredClone(identity);
      const freeze = (value: unknown): void => {
        if (value && typeof value === "object" && !Object.isFrozen(value)) {
          Object.values(value).forEach(freeze);
          Object.freeze(value);
        }
      };
      freeze(copy);
      return own(mintScope(copy, own(Object.freeze({ [epoch]: true }))));
    },
    pageEpoch(): PageEpoch {
      const value: PageEpoch = Object.freeze({ [pageEpoch]: true });
      pageEpochs.add(value);
      return own(value);
    },
    attempt(scope: ScopeToken, channel: string, attempt: number): DecodeResult<AcceptanceToken> {
      return owns(scope) && scope instanceof ScopeToken
        ? { ok: true, value: own(mintAttempt(scope, channel, attempt)) }
        : { ok: false, reason: "foreign-scope" };
    },
    invocation(id: string, basis: InvocationBasis): DecodeResult<InvocationToken> {
      return basisOwned(basis)
        ? { ok: true, value: own(mintInvocation(id, basis)) }
        : { ok: false, reason: "foreign-basis" };
    },
    lease(basis: InvocationBasis): DecodeResult<LeaseToken> {
      return basisOwned(basis)
        ? { ok: true, value: own(mintLease(basis)) }
        : { ok: false, reason: "foreign-basis" };
    },
    restore(id: string): RestoreToken {
      return own(mintRestore(id));
    },
  });
}
export type RouteTokenIssuer = ReturnType<typeof createRouteTokenIssuer>;
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
  /** Runtime rejects keys outside the pose role, including wider objects and raw JS. */
  pose<P extends Partial<Pick<PageOf<G, S>, RoleKeys<G, "pose">>>>(
    patch: P & Record<Exclude<keyof P, RoleKeys<G, "pose">>, never>,
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
 * Runtime rejects restore origins at movePage, and checks role-specific keys before mutation.
 * Selection-only moves preserve pose. Stale invocations cannot exempt themselves from epochs. */
export interface PageOwner<G extends RouteGraphJson, S extends SchemaTable> {
  movePage(patch: PagePatch<G, S>, origin: Exclude<MoveOrigin, { kind: "restore" }>): MoveResult;
  restorePage(
    state: Pick<PageOf<G, S>, RoleKeys<G, "subject" | "selection">> &
      Partial<Pick<PageOf<G, S>, RoleKeys<G, "pose" | "stage" | "query" | "draft">>>,
    origin: Extract<MoveOrigin, { kind: "restore" }>,
  ): MoveResult;
}

// JsonValue is already deeply readonly; expanding its recursive union through Immutable
// exceeds TypeScript's depth limit. Keep that field's existing readonly contract.
type ImmutableWorkAck = Immutable<Omit<WorkWriteAck, "meta">> &
  Readonly<Pick<WorkWriteAck, "meta">>;

/** Full snapshots and accepted deltas are distinct. A snapshot never fabricates journal history. */
export type WorkDelivery<W> =
  | {
      readonly kind: "snapshot";
      readonly key: Immutable<WorkKey>;
      readonly revision: number;
      readonly value: Immutable<W>;
      readonly hash: string;
    }
  | { readonly kind: "ack"; readonly write: ImmutableWorkAck }
  | { readonly kind: "stream"; readonly write: ImmutableWorkAck };
export type WorkReduction =
  | { readonly kind: "published"; readonly revision: number; readonly receipt: "recorded" | "none" }
  | {
      readonly kind: "duplicate";
      readonly revision: number;
      readonly receipt: "recorded" | "duplicate" | "none";
    }
  | { readonly kind: "receipt-only"; readonly key: Immutable<WorkKey>; readonly revision: number }
  | {
      readonly kind: "recover";
      readonly key: Immutable<WorkKey>;
      readonly after: number | null;
      readonly reason: "gap" | "contradiction";
    }
  | {
      readonly kind: "refused";
      readonly reason: "foreign-token" | "wrong-work" | "retired" | "closed";
    };
export interface AcceptanceSnapshot<G extends RouteGraphJson, S extends SchemaTable, W = Immutable<WorkOf<G, S>>> {
  readonly scope: ScopeToken;
  readonly pageEpoch: PageEpoch;
  readonly pageRevision: number;
  readonly page: PageOf<G, S>;
  readonly work: { readonly revision: number; readonly value: W } | null;
}
/** B implements this one owner below React. C's Page transactions use this owner, not a second store.
 * TODO: B proves A -> B -> A, remount, both ack/stream orders, contradiction, gap and late receipt schedules.
 * enter always mints a fresh scope AND Page epoch, including same-identity re-entry. It retires
 * prior attempts and atomically commits Page plus unloaded Work BEFORE any subscriber runs.
 * capture retires the prior attempt in that channel. Authority is exact owner-issued object
 * identity (private tables), never equality of epoch/id fields. Reject copies and foreign owners.
 * Snapshot revision < current is ignored. Equal revision requires equal canonical content hash;
 * disagreement requests recovery without publishing. A newer full snapshot may bridge a gap.
 * Deltas use WorkWriteAck.base/revision, never attempt numbers. A contiguous delta publishes once.
 * Ack and stream share one canonical ack identity (Work key + revision); exclude replay from
 * equality. Equal canonical acks deduplicate; unequal ones recover, never overwrite history.
 * A snapshot arriving before its ack does NOT consume that ack: the ack still files its inverse,
 * provenance and receipt into the original Work journal without republishing Work. Keep delta
 * fingerprints or verify against recovered history when a snapshot skipped their revisions.
 * Gapped deltas request a full snapshot and retain their receipts for reconciliation.
 * Retired/departed attempts cannot publish Page or Work, even after A -> B -> A. Authentic command
 * acks still file to their ORIGINAL Work journal, including after close; late reads are refused.
 * close releases subscriptions and disables publication, not journal receipt delivery.
 */
export interface AcceptanceOwner<G extends RouteGraphJson, S extends SchemaTable, W = Immutable<WorkOf<G, S>>> extends PageOwner<
  G,
  S
> {
  enter(identity: ScopeIdentity, page: PageOf<G, S>): ScopeToken;
  capture(channel: string): AcceptanceToken;
  retire(token: AcceptanceToken): void;
  /** Read-only freshness authority, including accepted invocation/lease continuations.
   * Rejects foreign, copied, retired, replaced and closed tokens without preparing Page. */
  current(token: ScopeToken | AcceptanceToken | InvocationToken | LeaseToken): boolean;
  /** Captures current revisions and declared dependencies; refuses stale/foreign attempts. */
  invocation(
    token: AcceptanceToken,
    dependencies: Readonly<Record<string, string>>,
    causalParent?: CausalParentId,
  ): DecodeResult<InvocationToken>;
  acceptWork(
    token: InvocationToken,
    delivery: Extract<WorkDelivery<W>, { kind: "ack" }>,
  ): WorkReduction;
  acceptWork(
    token: AcceptanceToken,
    delivery: Exclude<WorkDelivery<W>, { kind: "ack" }>,
  ): WorkReduction;
  /** Rechecks scope, Page epoch/revision and dependency basis before the single publication. */
  acceptPage(token: InvocationToken | LeaseToken, patch: PagePatch<G, S>): MoveResult;
  read(): AcceptanceSnapshot<G, S, W> | null;
  /** Accepted Page moves carry their origin only to this publication, never persisted state. */
  subscribe(
    listener: (snapshot: AcceptanceSnapshot<G, S, W>, origin?: MoveOrigin) => void,
  ): () => void;
  close(): void;
}
