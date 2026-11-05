import { applyPatches, canonicalRouteInput, workKey, type WorkKey } from "@pe/agent-contracts";
import type { z } from "zod";
import type { Immutable, RouteGraphJson } from "../../agent-contracts/src/route-kernel-data.ts";
import {
  AcceptanceToken,
  InvocationToken,
  LeaseToken,
  RestoreToken,
  createRouteTokenIssuer,
  type AcceptanceOwner,
  type AcceptanceSnapshot,
  type DecodeResult,
  type InvocationBasis,
  type MoveOrigin,
  type MoveResult,
  type PageOf,
  type PagePatch,
  type SchemaTable,
  ScopeToken,
  type ScopeIdentity,
  type WorkDelivery,
  type WorkOf,
  type WorkReduction,
  type RouteTokenIssuer,
} from "../../agent-contracts/src/route-kernel-page.ts";
import type { WorkJournal } from "./work-journal.ts";

type TransactionPatch<G extends RouteGraphJson, S extends SchemaTable> =
  | PagePatch<G, S>
  | Parameters<AcceptanceOwner<G, S>["restorePage"]>[0];

/** Pure Page policy is supplied by the client; all state and publication remain here. */
interface WorkServices<W> {
  readonly workSchema: z.ZodType<W>;
  readonly hashWork: (value: W) => string;
  /** The composition root retains one journal per Work, independently of mounted UI. */
  readonly journal: (key: WorkKey) => WorkJournal;
}
export type ScopeGateOptions<
  G extends RouteGraphJson,
  S extends SchemaTable,
  W = Immutable<WorkOf<G, S>>,
> = (
  | WorkServices<W>
  | { readonly workSchema?: never; readonly hashWork?: never; readonly journal?: never }
) & {
  /** Kernel composition resolves the new Work identity before publishing a subject move. */
  readonly scopeFields?: readonly string[];
  readonly identityForPage?: (page: PageOf<G, S>) => ScopeIdentity;
  readonly dependencies: () => Readonly<Record<string, string>>;
  readonly preparePage: (
    page: PageOf<G, S>,
    patch: TransactionPatch<G, S>,
    origin: MoveOrigin,
  ) => DecodeResult<{
    readonly page: PageOf<G, S>;
    readonly changed: boolean;
    readonly membership: "verified" | "unresolved";
  }>;
  readonly issuer?: RouteTokenIssuer;
};

function immutableCopy<T>(value: T): T {
  const copy: T = structuredClone(value);
  const freeze = (part: unknown): void => {
    if (part && typeof part === "object" && !Object.isFrozen(part)) {
      Object.values(part).forEach(freeze);
      Object.freeze(part);
    }
  };
  freeze(copy);
  return copy;
}
const refused = (message: string): MoveResult => ({ kind: "refused", code: "acceptance", message });

/** One synchronous acceptance owner below React. UI disposal retires publication, not receipts. */
export function createRouteScopeGate<
  G extends RouteGraphJson,
  S extends SchemaTable,
  W = Immutable<WorkOf<G, S>>,
>(options: ScopeGateOptions<G, S, W>): AcceptanceOwner<G, S, W> {
  const suppliedWork = [options.workSchema, options.hashWork, options.journal].filter(
    Boolean,
  ).length;
  if (suppliedWork !== 0 && suppliedWork !== 3) throw Error("Incomplete Work acceptance services");
  type Snapshot = AcceptanceSnapshot<G, S, W>;
  const work = options as Partial<WorkServices<W>>;
  const issuer = options.issuer ?? createRouteTokenIssuer();
  let state: Snapshot | null = null;
  let closed = false;
  const attempts = new Map<string, AcceptanceToken>();
  const invocations = new WeakSet<InvocationToken>();
  const generations = new Map<string, number>();
  const listeners = new Set<(snapshot: Snapshot, origin?: MoveOrigin) => void>();
  const continuations = new WeakMap<
    InvocationToken | LeaseToken,
    { page: number; work: number | null }
  >();
  const hashes = new Map<string, Map<number, string>>();
  const active = (token: AcceptanceToken): boolean =>
    !closed &&
    issuer.owns(token) &&
    state?.scope === token.scope &&
    attempts.get(token.channel) === token;
  const publish = (next: Snapshot, origin?: MoveOrigin): void => {
    state = Object.freeze(next);
    for (const listener of listeners) {
      if (closed || state !== next) break;
      listener(next, origin);
    }
  };
  const basisCurrent = (token: InvocationToken | LeaseToken): boolean => {
    if (
      !issuer.owns(token) ||
      (token instanceof InvocationToken && !invocations.has(token)) ||
      !active(token.token) ||
      !state ||
      token.pageEpoch !== state.pageEpoch
    )
      return false;
    const basis = continuations.get(token) ?? {
      page: token.pageRevision,
      work: token.workRevision,
    };
    const dependencies = options.dependencies();
    return (
      basis.page === state.pageRevision &&
      basis.work === (state.work?.revision ?? null) &&
      Object.entries(token.dependencies).every(
        ([key, hash]) => Object.hasOwn(dependencies, key) && dependencies[key] === hash,
      )
    );
  };
  const move = (patch: TransactionPatch<G, S>, origin: MoveOrigin): MoveResult => {
    if (closed || !state) return refused("Scope is closed or not entered");
    if (!origin || typeof origin !== "object") return refused("Missing move origin");
    const basis =
      origin.kind === "invocation" ? origin.token : origin.kind === "pea" ? origin.lease : null;
    if (
      origin.kind === "invocation" &&
      (!(origin.token instanceof InvocationToken) || !basisCurrent(origin.token))
    )
      return refused("Stale or foreign invocation basis");
    if (
      origin.kind === "pea" &&
      (!(origin.lease instanceof LeaseToken) || !basisCurrent(origin.lease))
    )
      return refused("Stale or foreign lease basis");
    if (origin.kind === "scope" && (!issuer.owns(origin.token) || origin.token !== state.scope))
      return refused("Foreign scope");
    if (
      origin.kind === "restore" &&
      (!(origin.token instanceof RestoreToken) || !issuer.owns(origin.token))
    )
      return refused("Foreign restore");
    const before = state;
    let prepared: ReturnType<typeof options.preparePage>;
    try {
      prepared = options.preparePage(before.page, patch, origin);
    } catch {
      return refused("Page preparation failed");
    }
    if (!prepared.ok) return refused(prepared.reason);
    if (state !== before || closed || (basis && !basisCurrent(basis)))
      return refused("Page changed or token retired during preparation");
    const { page, changed, membership } = prepared.value;
    const revision = before.pageRevision + (changed ? 1 : 0);
    if (changed) {
      const reenter =
        options.identityForPage &&
        options.scopeFields?.some(
          (key) =>
            JSON.stringify(before.page[key as keyof typeof before.page]) !==
            JSON.stringify(page[key as keyof typeof page]),
        );
      if (reenter) {
        const scope = issuer.scope(options.identityForPage!(page));
        attempts.clear();
        publish(
          {
            scope,
            pageEpoch: issuer.pageEpoch(),
            pageRevision: revision,
            page: immutableCopy(page),
            // Subject scope retires authority; an unchanged Work identity retains its basis.
            work:
              canonicalRouteInput(scope.identity) === canonicalRouteInput(before.scope.identity)
                ? before.work
                : null,
          },
          origin,
        );
        return { kind: "accepted", revision, changed, membership };
      }
      if (basis) continuations.set(basis, { page: revision, work: before.work?.revision ?? null });
      publish(
        {
          ...before,
          page: immutableCopy(page),
          pageRevision: revision,
          pageEpoch: basis ? before.pageEpoch : issuer.pageEpoch(),
        },
        origin,
      );
    }
    return { kind: "accepted", revision, changed, membership };
  };
  function acceptWork(
    token: InvocationToken,
    delivery: Extract<WorkDelivery<W>, { kind: "ack" }>,
  ): WorkReduction;
  function acceptWork(
    token: AcceptanceToken,
    delivery: Exclude<WorkDelivery<W>, { kind: "ack" }>,
  ): WorkReduction;
  function acceptWork(
    token: InvocationToken | AcceptanceToken,
    delivery: WorkDelivery<W>,
  ): WorkReduction {
    if (!work.workSchema || !work.hashWork || !work.journal)
      return { kind: "refused", reason: "wrong-work" };
    if (
      !issuer.owns(token) ||
      (delivery.kind === "ack"
        ? !(token instanceof InvocationToken) || !invocations.has(token)
        : !(token instanceof AcceptanceToken))
    )
      return { kind: "refused", reason: "foreign-token" };
    const attempt = token instanceof InvocationToken ? token.token : token;
    const key = delivery.kind === "snapshot" ? delivery.handle.key : delivery.write.key;
    if (!attempt.scope.identity.work || workKey(key) !== workKey(attempt.scope.identity.work))
      return { kind: "refused", reason: "wrong-work" };
    const live = active(attempt);
    if (!live && delivery.kind !== "ack")
      return { kind: "refused", reason: closed ? "closed" : "retired" };
    const journal = work.journal(key);
    const revision =
      delivery.kind === "snapshot" ? delivery.handle.revision : delivery.write.revision;
    const current = live ? (state?.work ?? null) : null;
    const recover = (reason: "gap" | "contradiction"): WorkReduction => ({
      kind: "recover",
      key,
      after: current?.revision ?? null,
      reason,
    });
    let receipt: "recorded" | "duplicate" | "none" = "none";
    if (delivery.kind !== "snapshot") {
      const result = journal.reconcile(
        immutableCopy({
          ...delivery.write,
          patches: [...delivery.write.patches].map((p) => ({ ...p, path: [...p.path] })),
          inverse: [...delivery.write.inverse].map((p) => ({ ...p, path: [...p.path] })),
        }),
      );
      if (result === "contradiction") return recover("contradiction");
      if (result === "wrong-work") return { kind: "refused", reason: "wrong-work" };
      receipt = result;
    }
    if (!live) return { kind: "receipt-only", key, revision };
    if (!state) return { kind: "refused", reason: "retired" };
    const scopeState = state;
    const known = hashes.get(workKey(key)) ?? new Map<number, string>();
    hashes.set(workKey(key), known);
    const continueInvocation = () => {
      if (
        token instanceof InvocationToken &&
        delivery.kind === "ack" &&
        (continuations.get(token)?.work ?? token.workRevision) === delivery.write.base
      ) {
        const prior = continuations.get(token);
        continuations.set(token, { page: prior?.page ?? token.pageRevision, work: revision });
      }
    };
    if (current && revision < current.revision)
      return { kind: "duplicate", revision: current.revision, receipt };
    if (delivery.kind !== "snapshot" && current && revision === current.revision) {
      // A snapshot may precede its delta. Check its postimage without applying the inverse.
      const projected = applyPatches(
        { route: key.route, title: "Work", description: "", schema: work.workSchema },
        { version: 1, revision: current.revision, doc: current.value },
        delivery.write.by,
        delivery.write.patches.map((p) => ({ ...p, path: [...p.path] })),
        current.revision,
        true,
        true,
      );
      if (!projected.ok || work.hashWork(projected.envelope.doc) !== work.hashWork(current.value))
        return recover("contradiction");
      continueInvocation();
      return { kind: "duplicate", revision, receipt };
    }
    let value: W;
    let hash: string;
    if (delivery.kind === "snapshot") {
      const decoded = work.workSchema.safeParse(delivery.value);
      if (!decoded.success || work.hashWork(decoded.data) !== delivery.hash)
        return recover("contradiction");
      value = decoded.data;
      hash = delivery.hash;
    } else {
      if (!current || delivery.write.base !== current.revision) return recover("gap");
      if (revision !== delivery.write.base + 1) return recover("contradiction");
      const result = applyPatches(
        { route: key.route, title: "Work", description: "", schema: work.workSchema },
        { version: 1, revision: current.revision, doc: current.value },
        delivery.write.by,
        delivery.write.patches.map((p) => ({ ...p, path: [...p.path] })),
        current.revision,
        true,
        true,
      );
      if (!result.ok) return recover("contradiction");
      value = result.envelope.doc;
      hash = work.hashWork(value);
    }
    if (known.has(revision) && known.get(revision) !== hash) return recover("contradiction");
    if (current && revision === current.revision) return { kind: "duplicate", revision, receipt };
    known.set(revision, hash);
    journal.observe({ revision, doc: value });
    continueInvocation();
    // An ack's key is the host's canonical Work key, so its key and revision are the handle.
    const handle = delivery.kind === "snapshot" ? delivery.handle : { key, revision };
    publish({
      ...scopeState,
      work: Object.freeze({ handle: immutableCopy(handle), revision, value: immutableCopy(value) }),
    });
    return { kind: "published", revision, receipt: receipt === "none" ? "none" : "recorded" };
  }
  return {
    current(token) {
      if (token instanceof ScopeToken)
        return !closed && issuer.owns(token) && state?.scope === token;
      if (token instanceof AcceptanceToken) return active(token);
      if (token instanceof InvocationToken || token instanceof LeaseToken)
        return basisCurrent(token);
      return false;
    },
    enter(identity, page): ScopeToken {
      if (closed) throw new Error("Acceptance owner is closed");
      attempts.clear();
      const scope = issuer.scope(identity);
      publish({
        scope,
        pageEpoch: issuer.pageEpoch(),
        pageRevision: 0,
        page: immutableCopy(page),
        work: null,
      });
      return scope;
    },
    capture(channel) {
      if (closed || !state) throw new Error("Acceptance owner is closed or not entered");
      const generation = (generations.get(channel) ?? 0) + 1;
      generations.set(channel, generation);
      const result = issuer.attempt(state.scope, channel, generation);
      if (!result.ok) throw new Error(result.reason);
      attempts.set(channel, result.value);
      return result.value;
    },
    retire(token) {
      if (issuer.owns(token) && attempts.get(token.channel) === token)
        attempts.delete(token.channel);
    },
    invocation(token, dependencies, causalParent) {
      if (!active(token) || !state) return { ok: false, reason: "Stale or foreign attempt" };
      const current = options.dependencies();
      if (
        Object.entries(dependencies).some(
          ([key, hash]) => !Object.hasOwn(current, key) || current[key] !== hash,
        )
      )
        return { ok: false, reason: "Stale reading basis" };
      const basis: InvocationBasis = {
        token,
        pageEpoch: state.pageEpoch,
        pageRevision: state.pageRevision,
        workRevision: state.work?.revision ?? null,
        dependencies,
        causalParent,
      };
      const issued = issuer.invocation(crypto.randomUUID(), basis);
      if (issued.ok) invocations.add(issued.value);
      return issued;
    },
    acceptWork,
    acceptPage(token, patch) {
      if (
        !(token instanceof InvocationToken || token instanceof LeaseToken) ||
        !basisCurrent(token)
      )
        return refused("Stale or foreign invocation basis");
      return move(
        patch,
        token instanceof InvocationToken
          ? { kind: "invocation", token, purpose: "result" }
          : { kind: "pea", lease: token },
      );
    },
    movePage(patch, origin) {
      if (!origin || typeof origin !== "object") return refused("Missing move origin");
      if (
        origin.kind !== "human" &&
        origin.kind !== "scope" &&
        origin.kind !== "invocation" &&
        origin.kind !== "pea"
      )
        return refused("Use coupled restorePage");
      return move(patch, origin);
    },
    restorePage(patch, origin) {
      if (!origin || typeof origin !== "object" || origin.kind !== "restore")
        return refused("Restore requires a restore origin");
      return move(patch, origin);
    },
    read: () => state,
    subscribe(listener) {
      if (closed) return () => {};
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    close() {
      closed = true;
      attempts.clear();
      listeners.clear();
      state = null;
    },
  };
}
