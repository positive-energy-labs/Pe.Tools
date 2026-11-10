import {
  captureAdmittedHostBindings,
  type AdmittedRoute,
} from "@pe/agent-contracts";
import type {
  HostAdmittedRoute,
  HostWorkRegistration,
} from "@pe/agent-contracts";
import {
  bindWork,
  workCounts,
  workHandle,
  workKey,
  workKeySchema,
  type WorkHandle,
  type WorkKey,
} from "@pe/agent-contracts";
import {
  applyPatches,
  routeDocDelta,
  canonicalRouteInput,
  refuse,
  refusalText,
  type WorkAuthor,
  type RouteEnvelope,
  type RouteStatePatch,
  type RouteStateWriteResult,
  type WorkWrite,
  type WorkWriteAck,
  workWriteAckSchema,
  HISTORY_META_MAX_BYTES,
  type HistoryMetaRefusalCode,
} from "@pe/agent-contracts";
import type { RouteStateSpec } from "@pe/agent-contracts";

import { z } from "zod";
import type { RouteFingerprint } from "../../agent-contracts/src/route-kernel-admission.ts";
import type {
  WorkAdmission,
  WorkFeedFailure,
} from "../../agent-contracts/src/work-journal-door.ts";
import { OwnerReads, type OwnerValue } from "./owner-read.ts";
import { createWorkJournal } from "./work-journal.ts";

export interface RouteWorkspaceRegistration extends HostWorkRegistration {
  /** Captured neutral schema; presentation decoding belongs at the host write boundary. */
  readonly historyDetail?: z.ZodType;
}

export type RouteWorkspaceEvent = {
  type: "route_workspace";
  scope: WorkKey;
  route: string;
  action: WorkWriteAck["kind"];
  patchCount?: number;
} & (
  | (WorkWriteAck & { ok: true })
  | { ok: false; by: WorkAuthor; revision: number; error: string }
);

export interface RouteDocumentStore {
  getState(input: { targetKey: string; route: string }): Promise<unknown>;
  setState(input: { targetKey: string; route: string; value: unknown; reason?: string }): Promise<void>;
  /** Enumerates canonical persisted records without materializing absent Work. */
  listState?(): Promise<{
    records: { targetKey: string; route: string; value: unknown }[];
    unindexed: number;
    unreadable: number;
    truncated: boolean;
  }>;
}

/** Host undo-window configuration: both limits bound the retained suffix. */
export const DEFAULT_WORK_HISTORY_LIMITS = { maxCount: 256, maxBytes: 512 * 1024 } as const;
export type WorkReadView = "read" | "raw" | "view";
/** The admitted feed's two shapes: the view with history (`work`), or the snapshot acks follow (`work-acks`). */
export type WorkFeedShape = "work" | "work-acks";
/** One Work read as it starts: the exact request a host consumer reserves its occurrence for. */
export type WorkReadRequest =
  | { readonly kind: "read"; readonly key: WorkKey; readonly view: WorkReadView }
  | {
      readonly kind: "feed";
      readonly key: WorkKey;
      readonly admission: WorkAdmission;
      readonly shape: WorkFeedShape;
    };
/**
 * An opaque per-attempt token the host mints when a read begins. Runtime never looks inside it; it
 * only carries it through the queue back into that same host's hooks, which validate it by class.
 */
export abstract class WorkCarriage {
  declare private readonly workCarriage: never;
}
export type WorkReadBegin =
  | { readonly ok: true; readonly carriage: WorkCarriage | undefined }
  | { readonly ok: false; readonly error: unknown };
/** A request's explicit Work carriage: begun synchronously at read start, before any queue. */
export interface WorkReadContext {
  begin(request: WorkReadRequest): WorkReadBegin;
}
/** A recorded Work read source (ADR 0031): each canonical read as recorded, or a typed rejection. */
export interface WorkReadSource {
  /** Refuses (`ok: false`) before any access when the read cannot be served historically. */
  begin(request: WorkReadRequest, context: WorkReadContext | undefined): WorkReadBegin;
  read(key: WorkKey, view: WorkReadView, carriage: WorkCarriage | undefined): Promise<unknown>;
  feed(
    key: WorkKey,
    admission: WorkAdmission,
    shape: WorkFeedShape,
    carriage: WorkCarriage | undefined,
  ): Promise<unknown>;
}
/** Live capture of the value about to be delivered. The host adapter truncates on its own capture loss
 * (K4); a rejection here is a port fault: it fails that read and ends an admitted feed. */
export interface WorkReadCapture {
  /** A capture that cannot begin leaves this read uncaptured; the live read is unchanged (K4). */
  begin(request: WorkReadRequest, context: WorkReadContext | undefined): WorkReadBegin;
  read(key: WorkKey, view: WorkReadView, value: unknown, carriage: WorkCarriage | undefined): Promise<void>;
  /** A live body read that failed after admission; the caller still receives the original error. */
  readFailed(key: WorkKey, view: WorkReadView, error: unknown, carriage: WorkCarriage | undefined): Promise<void>;
  feedFailed(
    key: WorkKey,
    admission: WorkAdmission,
    shape: WorkFeedShape,
    error: unknown,
    carriage: WorkCarriage | undefined,
  ): Promise<void>;
  /** Stops capture as truncated now, in memory; the promise is only its best-effort persistence. */
  stop(reason: "backlog"): Promise<void>;
  feed(
    key: WorkKey,
    admission: WorkAdmission,
    shape: WorkFeedShape,
    value: unknown,
    carriage: WorkCarriage | undefined,
  ): Promise<void>;
}
export type RouteWorkspaceOptions = {
  registrations: readonly RouteWorkspaceRegistration[];
  /** Root-fixed source policy, checked before reads or writes at a mutation boundary. */
  authorizeMutation?: (verb: "edit" | "undo" | "redo" | "publish" | "retire") => void;
  workHistoryLimits?: { readonly maxCount: number; readonly maxBytes: number };
} & (
  | { store: RouteDocumentStore; capture?: WorkReadCapture; recorded?: never }
  /** Historical: reads come only from the source; there is no store to migrate, carry over or write. */
  | { recorded: WorkReadSource; store?: never; capture?: never }
);

const ENVELOPE_VERSION = 1;
// Retired close-sweep metadata contains no authored Work. Keep it out of the census.
const OPEN_REGISTER = { targetKey: "open-work", route: "register" };
/** Store, order, crash barrier, and publication shell around the pure route-document machine. */
export class RouteWorkspace {
  readonly #registry = new Map<string, RouteWorkspaceRegistration>();
  readonly #admissionListeners = new Map<string, Set<() => void>>();
  readonly #admissions = new Map<
    string,
    {
      fingerprint: RouteFingerprint;
      workRoute: string;
      readWorks: readonly string[];
      readings: import("@pe/agent-contracts").RouteGraphJson["readings"];
      /** The admitted graph's fields: the host's attention fence reads their agent policy, never a codec. */
      fields: import("@pe/agent-contracts").AdmittedFields;
      title: string;
      address: string;
      ready: Promise<WorkFeedFailure | null>;
      close(): void;
    }
  >();
  // ponytail: serialize this host workspace; use store transactions if parallel writes become necessary.
  #tail = Promise.resolve();
  readonly #listeners = new Set<(event: RouteWorkspaceEvent) => void>();
  readonly #reads = new OwnerReads();
  readonly #acceptedListeners = new Map<string, Set<(ack: WorkWriteAck) => void>>();
  readonly #inverses = new Map<
    string,
    { write: WorkWriteAck; after: unknown }[]
  >();

  #authorize(verb: Parameters<NonNullable<RouteWorkspaceOptions["authorizeMutation"]>>[0]) {
    // The injected policy speaks first, so its typed historical refusal wins; the store-less guard remains.
    this.options.authorizeMutation?.(verb);
    if (this.options.recorded) throw Error(`A recorded workspace refuses Work ${verb}`);
  }
  get #store(): RouteDocumentStore {
    if (!this.options.store) throw Error("A recorded workspace has no Work store");
    return this.options.store;
  }
  /** A recorded value is served only as the Work it was requested for. */
  async #recorded(scope: WorkKey, view: WorkReadView, context: WorkReadContext | undefined) {
    const source = this.options.recorded!;
    const begun = source.begin({ kind: "read", key: scope, view }, context);
    if (!begun.ok) throw begun.error;
    return { value: this.#requested(scope, await source.read(scope, view, begun.carriage)), carriage: begun.carriage };
  }
  #requested<A>(scope: WorkKey, value: A): A {
    const handle = (value as { handle?: { key?: WorkKey } } | null)?.handle;
    if (value !== null && (!handle?.key || workKey(handle.key) !== workKey(scope)))
      throw Error(`Recorded Work belongs to another key than ${workKey(scope)}`);
    return value;
  }

  constructor(private readonly options: RouteWorkspaceOptions) {
    const limits = options.workHistoryLimits ?? DEFAULT_WORK_HISTORY_LIMITS;
    if (![limits.maxCount, limits.maxBytes].every((n) => Number.isSafeInteger(n) && n >= 0))
      throw Error("Invalid Work history limits");
    for (const registration of options.registrations) {
      this.register(registration);
    }
  }

  /** A trusted plugin's lifetime owns registration, never its saved Work bytes. */
  register(registration: RouteWorkspaceRegistration): () => void {
    const route = registration.spec.route;
    const stamp = registration.spec.schemaVersion ?? 1;
    if (!Number.isSafeInteger(stamp) || stamp < 1) throw new Error("Invalid Work schema version");
    if (route.includes(":")) throw new Error(`route name '${route}' cannot contain ':'`);
    if (this.#registry.has(route)) throw new Error(`duplicate route '${route}'`);
    toJsonSchema(registration.spec.schema);
    this.#registry.set(route, registration);
    return () => {
      if (this.#registry.get(route) === registration) this.#registry.delete(route);
    };
  }

  /** Host admission owns Work schemas. No browser body or schema crosses the wire. */
  registerAdmitted(route: AdmittedRoute | HostAdmittedRoute): {
    ready: Promise<WorkFeedFailure | null>;
    close(): void;
  } {
    const receipt = captureAdmittedHostBindings(route);
    const bindings = receipt.bindings;
    const work = route.data.work;
    if (!work) {
      receipt.deactivate();
      throw Error("Route declares no Work");
    }
    // Presenters never install a second registry.
    // Their feeds carry the fingerprint captured in their verified link evidence.
    if (work.route !== route.data.key) {
      receipt.deactivate();
      return { ready: Promise.resolve(null), close() {} };
    }
    if (!work.schema) throw Error("Work owner has no schema");
    const prior = this.#admissions.get(route.data.key);
    if (prior?.fingerprint === route.workFingerprint) {
      receipt.deactivate();
      return { ready: prior.ready, close() {} };
    }
    prior?.close();
    const spec: RouteStateSpec<z.ZodType> =
      "workState" in bindings && bindings.workState
        ? bindings.workState
        : {
            route: work.route,
            title: route.data.name,
            description: route.data.directory.summary,
            schema: bindings.schemas[work.schema]!,
            schemaVersion: work.version,
          };
    let remove: () => void;
    try {
      remove = this.register({
        spec,
        ...(route.data.historyDetail && {
          historyDetail: bindings.schemas[route.data.historyDetail]!,
        }),
        ...("admit" in bindings ? { admit: bindings.admit } : {}),
      });
    } catch (error) {
      receipt.deactivate();
      throw error;
    }
    const ready: Promise<WorkFeedFailure | null> = Promise.resolve(null);
    const record = {
      fingerprint: route.workFingerprint,
      workRoute: work.route,
      readWorks: "readWorks" in bindings ? bindings.readWorks ?? [] : [],
      readings: route.data.readings,
      fields: route.data.fields,
      title: route.data.name,
      address: route.data.address,
      ready,
      close: () => {
        if (this.#admissions.get(route.data.key) !== record) return;
        this.#admissions.delete(route.data.key);
        remove();
        receipt.deactivate();
        this.#admissionChanged(route.data.key);
      },
    };
    this.#admissions.set(route.data.key, record);
    this.#admissionChanged(route.data.key);
    return record;
  }

  #admissionChanged(routeKey: string) {
    // Replacement is synchronous; observers see the replacement, not an intermediate removal.
    queueMicrotask(() => {
      for (const notify of this.#admissionListeners.get(routeKey) ?? []) notify();
    });
  }

  observeAdmission(routeKey: string, notify: () => void): () => void {
    const listeners = this.#admissionListeners.get(routeKey) ?? new Set();
    this.#admissionListeners.set(routeKey, listeners);
    listeners.add(notify);
    return () => {
      listeners.delete(notify);
      if (!listeners.size) this.#admissionListeners.delete(routeKey);
    };
  }

  /**
   * Read-only projection of the live admissions, the one registration owner: identity, name,
   * address and agent policy (ADR 0030 rule 10). Withdrawal removes the row; nothing is cached.
   */
  admittedRoutes(): import("@pe/agent-contracts").AdmittedView[] {
    return [...this.#admissions].map(([key, { title, address, fields }]) => ({ key, title, address, fields }));
  }

  requiresAdmission(workRoute: string): boolean {
    return [...this.#admissions.values()].some((value) => value.workRoute === workRoute);
  }

  /** Check host admission before acquiring either snapshot or ack feed. */
  async admitFeed(key: WorkKey, admission: WorkAdmission): Promise<WorkFeedFailure | null> {
    const registered = this.#admissions.get(admission.routeKey);
    if (!registered)
      return {
        kind: "failed",
        code: "WorkRouteUnregistered",
        message: "Host has not admitted this route",
      };
    // Compare the exact fingerprint envelope, source plus digest. A builtin-closure fingerprint
    // never matches pod-bytes, even when their digest text is identical.
    if (registered.fingerprint !== admission.fingerprint)
      return {
        kind: "registration-mismatch",
        routeKey: admission.routeKey,
        expected: registered.fingerprint,
        received: admission.fingerprint,
      };
    const reading = admission.reading ? registered.readings[admission.reading] : undefined;
    const workRoute = admission.reading
      ? reading?.kind === "work"
        ? reading.route
        : null
      : registered.readWorks.includes(key.route) ? key.route : registered.workRoute;
    if (key.route !== workRoute)
      return {
        kind: "failed",
        code: "WorkRouteMismatch",
        message: "Work belongs to another route",
      };
    const failure = await registered.ready;
    if (this.#admissions.get(admission.routeKey) !== registered)
      return {
        kind: "failed",
        code: "WorkRegistrationRetired",
        message: "Host admission retired during acquisition; reload this tab",
      };
    return failure;
  }

  list() {
    return [...this.#registry.values()].map(({ spec }) => ({
      route: spec.route,
      title: spec.title,
      description: spec.description,
    }));
  }

  /** Persisted instances, not the registration catalogue. Never calls read/view or carry-over. */
  async instances() {
    return this.#serialized(async () => {
      if (this.options.recorded || !this.#store.listState)
        return { works: [], unindexed: 0, unreadable: 0, truncated: false, available: false };
      const census = await this.#store.listState();
      let invalidIdentities = 0;
      const works = (await Promise.all(census.records.map(async (record) => {
        if (record.route === OPEN_REGISTER.route && record.targetKey === OPEN_REGISTER.targetKey)
          return [];
        const scope = storedWorkKey(record.targetKey, record.route);
        if (!scope) {
          invalidIdentities++;
          return [];
        }
        const spec = this.#registry.get(record.route)?.spec;
        let revision: number | null = null;
        let unfinished = 0;
        let state: "ready" | "unreadable" | "unregistered" = spec ? "unreadable" : "unregistered";
        if (spec) {
          try {
            const envelope = parseEnvelope(
              record.value,
              spec,
            );
            revision = envelope.revision;
            ({ unfinished } = workCounts(envelope.doc, spec.editable ?? []));
            state = "ready";
          } catch (error) {
            await this.#store.setState({ targetKey: record.targetKey, route: record.route, value: null,
              reason: error instanceof Error ? error.message : String(error) });
            return [];
          }
        }
        return [
          {
            id: workKey(scope),
            scope,
            route: record.route,
            title: spec?.title ?? record.route,
            revision,
            state,
            unfinished,
          },
        ];
      }))).flat();
      return {
        works,
        unindexed: census.unindexed,
        unreadable: census.unreadable + invalidIdentities,
        truncated: census.truncated,
        available: true,
      };
    });
  }

  /** The route's Work at the scope; null when the route is unregistered or no Work exists yet. */
  async read(scope: WorkKey, route: string, context?: WorkReadContext) {
    return (await this.#captured(scope, "read", context, () => this.#read(scope, route, false, false, context))).value;
  }
  /**
   * Live capture records exactly the value delivered, a null "no Work" included, before it is
   * returned. A failed body read is offered to capture, then its original error is rethrown.
   */
  async #captured<A>(
    scope: WorkKey,
    view: WorkReadView,
    context: WorkReadContext | undefined,
    live: () => Promise<A>,
  ): Promise<{ value: A; carriage: WorkCarriage | undefined }> {
    if (this.options.recorded)
      return this.#recorded(scope, view, context) as Promise<{ value: A; carriage: WorkCarriage | undefined }>;
    const capture = this.options.capture;
    if (!capture) return { value: await live(), carriage: undefined };
    // Begun at read start, before the live thunk is queued; a failed begin reads uncaptured.
    const begun = capture.begin({ kind: "read", key: scope, view }, context);
    const carriage = begun.ok ? begun.carriage : undefined;
    let value: A;
    try {
      value = await live();
    } catch (error) {
      // The original error wins; a capture port fault on this path cannot replace it.
      await capture.readFailed(scope, view, error, carriage).catch(() => undefined);
      throw error;
    }
    await capture.read(scope, view, value, carriage);
    return { value, carriage };
  }

  /**
   * The saved document exactly as stored, not validated against the route's schema.
   * Consumers must validate the whole document before using it. Null when no Work exists;
   * `doc` is null when even the envelope is unreadable. Retained under the C402/K4 fence.
   */
  async readRaw(
    scope: WorkKey,
    route: string,
    context?: WorkReadContext,
  ): Promise<{ doc: unknown; revision: number; handle: WorkHandle } | null> {
    if (!this.#registry.has(route)) return null;
    return (await this.#captured(scope, "raw", context, async () => {
      const raw = await this.#serialized(() => this.#carryOver(scope, route));
      if (raw == null) return null;
      const envelope = envelopeSchema.safeParse(raw);
      const revision = envelope.success ? envelope.data.revision : 0;
      return { doc: envelope.success ? envelope.data.doc : null, revision, handle: workHandle(scope, revision) };
    })).value;
  }

  /** Internal inspection/reconciliation only: never begins a capture or serves a recording. */
  async viewUncaptured(scope: WorkKey, route: string) {
    if (this.options.recorded) throw Error("Uncaptured Work inspection cannot serve a recording");
    return this.#read(scope, route, true);
  }

  /** Legacy inspection only. Semantic command and graph inputs use read with their context. */
  async readUncaptured(scope: WorkKey, route: string) {
    if (this.options.recorded) throw Error("Uncaptured Work inspection cannot serve a recording");
    return this.#read(scope, route, false);
  }

  /**
   * A reader's view of the route: absent Work uses schema defaults at r0 when available.
   * Without defaults it stays absent; no required authored value is invented.
   */
  async view(scope: WorkKey, route: string, context?: WorkReadContext) {
    return (await this.#captured(scope, "view", context, () => this.#read(scope, route, true, false, context))).value;
  }

  async #read(
    scope: WorkKey,
    route: string,
    orEmpty: boolean,
    withHistory = false,
    context?: WorkReadContext,
  ) {
    const registration = this.#registry.get(route);
    if (!registration) return null;
    const { spec } = registration;
    if (this.options.recorded) {
      // A recorded history is the admitted feed's, bound with its admission; never a view plus guesses.
      if (withHistory) throw Error("A recorded Work feed is served only through observeAdmittedFeed");
      return (await this.#recorded(scope, orEmpty ? "view" : "read", context)).value as Awaited<ReturnType<typeof live>>;
    }
    const live = () => this.#serialized(async () => {
      const envelope = await this.#load(scope, spec, orEmpty);
      if (!envelope) return null;
      const records = this.#retain(this.#inverses.get(workKey(scope)) ?? [], envelope.revision);
      return {
        ...(withHistory && {
          history: {
            from: records[0]?.write.revision ?? envelope.revision + 1,
            acks: structuredClone(records.map(({ write }) => write)),
          },
        }),
        route,
        title: spec.title,
        description: spec.description,
        doc: structuredClone(envelope.doc),
        revision: envelope.revision,
        handle: workHandle(scope, envelope.revision),
        schemaVersion: envelope.schemaVersion ?? null,
        schema: toJsonSchema(spec.schema),
      };
    });
    return live();
  }

  /** The untrusted write envelope has no authorship field. `by` is the host caller's principal. */
  write(scope: WorkKey, route: string, by: WorkAuthor, input: WorkWrite) {
    this.#authorize("edit");
    if (by === "human" && input.kind === "apply" && !input.press)
      return Promise.resolve(
        refuse("refused", "a human edit needs a press", "Mint a press before dispatch."),
      );
    return this.apply(scope, route, by, input.patches, input.expectedRevision, false, input);
  }

  async apply(
    scope: WorkKey,
    route: string,
    by: WorkAuthor,
    patches: RouteStatePatch[],
    expectedRevision: number,
    trusted = false,
    context: Pick<WorkWrite, "press" | "kind" | "restoreOf" | "label" | "meta"> & {
      receiptId?: string;
    } = {
      press: null,
      kind: "apply",
    },
  ): Promise<RouteStateWriteResult> {
    this.#authorize("edit");
    if (scope.route !== route)
      return refuse(
        "refused",
        "Work identity does not match the route",
        "Use the Work key for this route.",
      );
    const registration = this.#registry.get(route);
    if (!registration) return unknownRoute(route);

    // Decode untrusted presentation once, before any Work mutation or history retention.
    let meta = context.meta;
    if (meta !== undefined) {
      const invalid = (code: HistoryMetaRefusalCode, error: string): RouteStateWriteResult => ({
        ok: false,
        kind: "refused",
        code,
        error,
        hint: `Submit detail matching the admitted route schema within ${HISTORY_META_MAX_BYTES} bytes.`,
      });
      // `meta` is typed JSON already (workWriteSchema); the door checks size and the route schema.
      if (new TextEncoder().encode(JSON.stringify(meta)).byteLength > HISTORY_META_MAX_BYTES)
        return invalid("meta_too_large", `History detail exceeds ${HISTORY_META_MAX_BYTES} bytes`);
      if (!registration.historyDetail?.safeParse(meta).success)
        return invalid("invalid_meta", "History detail does not match the admitted schema");
      // Capture submitted JSON before waiting on the write tail. Schema transforms never rewrite history.
      meta = structuredClone(meta);
    }
    return this.#serialized(async () => {
      const envelope = await this.#load(scope, registration.spec);
      if (!envelope) return refuse("refused", "Work has no initial value", "Provide Work matching the current schema before editing.");
      const kind = trusted ? "publish" : context.kind;
      const press = kind === "apply" ? context.press : null;
      const records = this.#inverses.get(workKey(scope)) ?? [];
      const recorded =
        kind === "restore"
          ? records.findLast((entry) => entry.write.revision === context.restoreOf)
          : undefined;
      if (
        kind === "restore" &&
        (!recorded ||
          records.some(
            (entry) =>
              entry.write.revision > recorded.write.revision &&
              entry.write.kind === "publish" &&
              entry.write.patches.some((patch) =>
                recorded.write.inverse.some((inverse) => overlaps(patch.path, inverse.path)),
              ),
          ) ||
          canonicalRouteInput(recorded.write.inverse) !== canonicalRouteInput(patches) ||
          !recorded.write.inverse.every(
            (patch) =>
              canonicalRouteInput(valueAt(envelope.doc, patch.path)) ===
              canonicalRouteInput(valueAt(recorded.after, patch.path)),
          ))
      )
        return refuse(
          "refused",
          "this inverse is unknown or its paths changed",
          "Re-read Work and clear conflicting history.",
        );
      const applied = applyPatches(
        registration.spec, envelope, by, recorded?.write.inverse ?? patches,
        expectedRevision, trusted || kind === "restore", kind === "restore",
      );
      const landed =
        (applied.ok &&
          (await registration.admit?.(applied.envelope.doc, patches, {
            scope,
            by,
            prior: envelope.doc,
          }))) ||
        applied;
      if (!landed.ok) {
        await this.#publish({
          type: "route_workspace",
          scope,
          route,
          by,
          action: kind,
          revision: envelope.revision,
          patchCount: patches.length,
          ok: false,
          error: refusalText(landed),
        });
        return landed;
      }

      const write: WorkWriteAck = {
        key: workHandle(scope, 0).key,
        kind,
        by,
        press,
        ...(kind === "apply" && context.label ? { label: context.label } : {}),
        ...(kind === "apply" && meta !== undefined ? { meta } : {}),
        ...(trusted && context.receiptId ? { receiptId: context.receiptId } : {}),
        ...(kind === "apply"
          ? {
              step:
                by === "pea"
                  ? `pea:${press ?? `r${landed.envelope.revision}`}`
                  : `human:${press ?? `r${landed.envelope.revision}`}`,
            }
          : {}),
        ...(recorded ? { step: recorded.write.step, restoreOf: recorded.write.revision } : {}),
        base: envelope.revision,
        revision: landed.envelope.revision,
        patches: routeDocDelta(
          envelope.doc,
          landed.envelope.doc,
          [],
          patches.filter((p) => p.path.length > 1).map((p) => String(p.path[0])),
        ),
        inverse: routeDocDelta(
          landed.envelope.doc,
          envelope.doc,
          [],
          patches.filter((p) => p.path.length > 1).map((p) => String(p.path[0])),
        ),
        undoable: true,
        at: Date.now(),
      };
      const history = [
        ...records,
        {
          write,
          after: landed.envelope.doc,

        },
      ];
      await this.#persist(
        scope,
        route,
        {
          ...landed.envelope,
          schemaVersion: registration.spec.schemaVersion ?? 1,
        },
        history,
      );
      this.#inverses.set(workKey(scope), history);
      // COMMON 24: this Promise island guarantees publication with finally.
      try {
        this.#accept(write);
      } finally {
        await this.#publish({
          type: "route_workspace",
          scope,
          route,
          ...write,
          action: kind,
          revision: landed.envelope.revision,
          patchCount: patches.length,
          ok: true,
        });
      }
      // The write's own evidence: the doc the patches landed on, so a caller that only sees the
      // outcome (a chat card reading a `pe_do` result) shows what is staged without a second read.
      return {
        ok: true,
        revision: landed.envelope.revision,
        handle: workHandle(scope, landed.envelope.revision),
        doc: structuredClone(landed.envelope.doc),
        write,
      };
    });
  }

  /**
   * Undo or redo the last step of this Work's one journal, whoever wrote it (ADR 0028 noun 4), or
   * with `own` the caller's own last step, leaving the other author's (findings, ADR 0035 rule 9).
   * The restore is the same write a person's Undo sends: one `restore` revision whose inverse is
   * the redo. It refuses, writing nothing, when the step's paths changed elsewhere.
   */
  async step(
    scope: WorkKey,
    route: string,
    by: WorkAuthor,
    direction: "undo" | "redo",
    expectedRevision: number,
    own = false,
  ): Promise<RouteStateWriteResult> {
    this.#authorize(direction);
    const snapshot = await this.viewUncaptured(scope, route);
    if (!snapshot || snapshot.revision !== expectedRevision)
      return refuse("refused", "Work changed before restoring", "Re-read Work.", "stale_revision");
    const journal = createWorkJournal(scope);
    for (const { write } of this.#inverses.get(workKey(scope)) ?? [])
      journal.accept({ ...write, replay: true });
    journal.observe(snapshot);
    let accepted: RouteStateWriteResult | undefined;
    const result = await journal[direction](async (write) => {
      accepted = await this.write(scope, route, by, write);
      return accepted;
    }, undefined, own ? by : undefined);
    return result.ok && accepted
      ? accepted
      : refuse("refused", result.ok ? "Nothing restored" : result.message, "Re-read Work history.");
  }

  /** Observations and conditional retirement are host facts, never raw client edits. */
  validateSeed(scope: WorkKey, seed: unknown): unknown {
    const registration=this.#registry.get(scope.route);
    if(!registration) throw Error(`Unknown Work route ${scope.route}`);
    return registration.spec.schema.parse(seed);
  }

  /** The journal calls this only after consent. The write tail makes absence a compare-and-set. */
  async start(scope:WorkKey,seed:unknown,by:WorkAuthor,receiptId?:string):Promise<RouteStateWriteResult> {
    this.#authorize("publish");
    const doc=this.validateSeed(scope,seed);
    const spec=this.#registry.get(scope.route)!.spec;
    return this.#serialized(async()=>{
      if(await this.#store.getState({targetKey:workKey(scope),route:scope.route}) != null)
        return refuse("refused","Work already exists","Open the existing Work.");
      const write:WorkWriteAck={key:workHandle(scope,1).key,kind:"publish",by,press:null,
        base:0,revision:1,patches:[],inverse:[],undoable:false,at:Date.now(),...(receiptId?{receiptId}:{})};
      await this.#persist(scope,scope.route,{version:1,doc,schemaVersion:spec.schemaVersion ?? 1,revision:1},[{write,after:doc}]);
      this.#inverses.set(workKey(scope),[{write,after:doc}]);
      try {this.#accept(write);} finally {
        await this.#publish({type:"route_workspace",scope,route:scope.route,...write,action:"publish",ok:true});
      }
      return {ok:true,revision:1,handle:workHandle(scope,1),doc:structuredClone(doc),write};
    });
  }

  publish(
    scope: WorkKey,
    route: string,
    patches: RouteStatePatch[],
    expectedRevision: number,
    receiptId?: string,
  ) {
    this.#authorize("publish");
    return this.apply(scope, route, "human", patches, expectedRevision, true, {
      kind: "apply",
      press: null,
      receiptId,
    });
  }

  observe(
    scope: WorkKey,
    route: string,
    listener: (value: OwnerValue<Awaited<ReturnType<RouteWorkspace["read"]>>>, carriage?: WorkCarriage) => void,
    orEmpty = false,
    withHistory = false,
    context?: WorkReadContext,
  ): () => void {
    const key = `${workKey(scope)}\0${route}\0${orEmpty}\0${withHistory}`;
    const read = () => this.#read(scope, route, orEmpty, withHistory, context);
    const subscribe = (notify: () => void) => this.subscribeUncaptured((event) => {
      if (event.route === route && workKey(event.scope) === workKey(scope)) notify();
    });
    if (!context || withHistory) return this.#reads.observe(key, read, subscribe, listener);
    // A consumer's acquisition carries its own attempt through capture and mark publication.
    return new OwnerReads().observe(key,
      () => this.#captured(scope, orEmpty ? "view" : "read", context, read), subscribe,
      (result) => "error" in result ? listener(result) : listener({ value: result.value.value }, result.value.carriage));
  }

  /** Invalidation events only: no Work body is acquired and no capture begins. */
  subscribeUncaptured(listener: (event: RouteWorkspaceEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Hydration and subscription share the write tail; restart replay has no arrival gap. */
  observeAccepted(
    scope: WorkKey,
    listener: (ack: WorkWriteAck) => void,
    failed: (error: unknown) => void = (error) => {
      throw error;
    },
    replay = true,
  ): () => void {
    // A recording has no accepted writes after its point: no ack is ever invented.
    if (this.options.recorded) return () => {};
    const key = workKey(scope);
    let disposed = false;
    void this.#serialized(async () => {
      const spec = this.#registry.get(scope.route)?.spec;
      if (!spec || disposed) return;
      const raw = await this.#carryOver(scope, spec.route);
      this.#inverses.set(
        key,
        this.#retain(
          this.#stored((raw as { history?: unknown } | null)?.history, scope),
          (raw as { revision?: number } | null)?.revision ?? 0,
        ),
      );
      if (disposed) return;
      if (replay)
        for (const { write } of this.#inverses.get(key) ?? [])
          listener({ ...structuredClone(write), replay: true });
      const listeners = this.#acceptedListeners.get(key) ?? new Set();
      this.#acceptedListeners.set(key, listeners);
      listeners.add(listener);
    }).catch((error) => {
      if (!disposed) failed(error);
    });
    return () => {
      disposed = true;
      const listeners = this.#acceptedListeners.get(key);
      listeners?.delete(listener);
      if (!listeners?.size) this.#acceptedListeners.delete(key);
    };
  }

  /** Install the live listener and acquire snapshot/history on the same write tail. */
  observeFeed(
    scope: WorkKey,
    snapshot: (value: unknown) => void,
    listener: (ack: WorkWriteAck) => void,
    failed: (error: unknown) => void,
    orEmpty = false,
  ): () => void {
    if (this.options.recorded) {
      failed(Error("A recorded Work feed is served only through observeAdmittedFeed"));
      return () => {};
    }
    const key = workKey(scope);
    let disposed = false;
    let state: "absent" | "hydrating" | "ready" = "absent";
    const acquire = async () => {
      const spec = this.#registry.get(scope.route)?.spec;
      if (disposed) return;
      if (!spec) {
        failed({
          kind: "failed",
          code: "WorkRouteUnregistered",
          message: "route no longer registered",
        } satisfies WorkFeedFailure);
        return;
      }
      const envelope = await this.#load(scope, spec, orEmpty);
      if (disposed) return;
      if (!envelope) { state = "absent"; snapshot(null); return; }
      state = "ready";
      const records = this.#retain(this.#inverses.get(key) ?? [], envelope.revision);
      snapshot({
        doc: structuredClone(envelope.doc),
        revision: envelope.revision,
        handle: workHandle(scope, envelope.revision),
        history: {
          from: records[0]?.write.revision ?? envelope.revision + 1,
          acks: structuredClone(records.map(({ write }) => write)),
        },
      });
    };
    const fail = (error: unknown) => {
      if (!disposed) failed(error);
    };
    const accepted = (ack: WorkWriteAck) => {
      if (disposed) return;
      if (state === "ready") { listener(ack); return; }
      if (state === "hydrating") return; // The queued snapshot includes these accepted writes.
      state = "hydrating";
      void this.#serialized(acquire).catch(fail);
    };
    void this.#serialized(async () => {
      if (disposed) return;
      const listeners = this.#acceptedListeners.get(key) ?? new Set();
      this.#acceptedListeners.set(key, listeners);
      listeners.add(accepted);
      await acquire();
    }).catch(fail);
    return () => {
      disposed = true;
      const listeners = this.#acceptedListeners.get(key);
      listeners?.delete(accepted);
      if (!listeners?.size) this.#acceptedListeners.delete(key);
    };
  }

  /**
   * The admitted Work feed, for a caller that has already admitted it. Its acquisition is admitted
   * again after any asynchronous capture or replay, so a replacement or retirement meanwhile refuses.
   * A recording delivers its bound snapshot once and no acks. Live capture records each delivered
   * value under its exact admission. Past the history limit of frames or acks waiting on it, capture
   * stops as truncated and the same feed continues in order, uncaptured (K4). A capture port fault
   * or an admission failure is terminal: reported once, then detached.
   */
  observeAdmittedFeed(
    scope: WorkKey,
    admission: WorkAdmission,
    shape: WorkFeedShape,
    /** Each delivery carries the exact token its acquisition began with; none once uncaptured. */
    deliver: (value: OwnerValue<unknown>, carriage?: WorkCarriage) => void,
    ack: (ack: WorkWriteAck) => void,
    failed: (error: unknown) => void,
    context?: WorkReadContext,
  ): () => void {
    const { recorded, capture } = this.options;
    // Composed reads share view()'s defaults; the primary Work keeps explicit Start semantics.
    const registered = this.#admissions.get(admission.routeKey);
    const orEmpty = registered?.workRoute !== scope.route && !!registered?.readWorks.includes(scope.route);
    const request = { kind: "feed", key: scope, admission, shape } as const;
    if (!recorded && !capture)
      return shape === "work"
        ? this.observe(scope, scope.route, deliver, orEmpty, true)
        : this.observeFeed(scope, (value) => deliver({ value }), ack, failed, orEmpty);
    let closed = false;
    let stop = () => {};
    const close = () => {
      closed = true;
      stop();
    };
    const end = (error: unknown) => {
      if (closed) return;
      close();
      failed(error);
    };
    const limit = (this.options.workHistoryLimits ?? DEFAULT_WORK_HISTORY_LIMITS).maxCount;
    /** Records (or replays) one value and re-admits it; resolves undefined once the feed has ended. */
    const acquire = async (value: Promise<unknown>) => {
      try {
        const settled = await value;
        const failure = await this.admitFeed(scope, admission);
        if (failure) throw failure;
        return closed ? undefined : { value: settled };
      } catch (error) {
        end(error);
      }
    };
    if (recorded) {
      // Begun before the recorded acquisition is constructed; a refusal touches no source.
      const begun = recorded.begin(request, context);
      void acquire(
        begun.ok
          ? recorded.feed(scope, admission, shape, begun.carriage).then((value) => this.#requested(scope, value))
          : Promise.reject(begun.error),
      ).then((got) => got && deliver(got, begun.ok ? begun.carriage : undefined));
      return close;
    }
    // A failed acquisition is offered to capture first; the original failure is what follows.
    const lost = (error: unknown, carriage: WorkCarriage | undefined) =>
      capture!.feedFailed(scope, admission, shape, error, carriage).catch(() => undefined);
    let capturing = true;
    let pending = 0;
    let fellBack!: () => void;
    const fallback = new Promise<void>((resolve) => (fellBack = resolve));
    // One capture at a time; this chain also owns the backlog marker's persistence.
    let captures: Promise<unknown> = Promise.resolve();
    /** Past the bound (K4), capture stops as truncated and every waiting value proceeds uncaptured. */
    const overflow = () => {
      if (!capturing) return;
      capturing = false;
      const persisted = capture!.stop("backlog").catch(() => undefined);
      captures = captures.then(() => persisted);
      fellBack();
    };
    /**
     * Resolves to this value's begun token once it is recorded, or as soon as capture stops; a late
     * completion loses. A value that never began (uncaptured) resolves to undefined.
     */
    const captured = (
      record: (carriage: WorkCarriage | undefined) => Promise<unknown>,
    ): Promise<WorkCarriage | undefined> => {
      if (!capturing) return Promise.resolve(undefined);
      if (++pending > limit) return Promise.resolve(void overflow());
      // Each owner value begins its own attempt here, before the capture queue; after the
      // fallback nothing is captured, so nothing begins.
      const begun = capture!.begin(request, context);
      const carriage = begun.ok ? begun.carriage : undefined;
      const done = captures.then(() => (capturing ? record(carriage) : undefined)).finally(() => pending--);
      captures = done.catch(() => undefined);
      return Promise.race([done, fallback]).then(() => carriage);
    };
    if (shape === "work") {
      // One delivery chain keeps observation order, captured or not.
      let deliveries = Promise.resolve();
      stop = this.observe(
        scope,
        scope.route,
        (value) => {
          if (closed) return;
          const begun = captured((carriage) =>
            "error" in value
              ? lost(value.error, carriage)
              : capture!.feed(scope, admission, shape, value.value, carriage),
          );
          const ready = "error" in value ? begun.then(() => value) : acquire(begun.then(() => value.value));
          deliveries = deliveries.then(async () => {
            const [got, carriage] = await Promise.all([ready, begun]);
            if (got && !closed) deliver(got, carriage);
          }).catch(end);
        },
        orEmpty,
        true,
      );
    } else {
      let held: WorkWriteAck[] | null = [];
      stop = this.observeFeed(
        scope,
        (snapshot) => {
          const begun = captured((carriage) => capture!.feed(scope, admission, shape, snapshot, carriage));
          void Promise.all([acquire(begun.then(() => snapshot)), begun]).then(
            ([got, carriage]) => {
              if (!got) return;
              deliver(got, carriage);
              for (const write of held ?? []) ack(write);
              held = null;
            },
          ).catch(end);
        },
        (write) => {
          if (closed) return;
          if (!held) return ack(write);
          if (held.push(write) > limit) overflow();
        },
        (error) => void captured((carriage) => lost(error, carriage)).then(() => end(error)),
        orEmpty,
      );
    }
    if (closed) stop(); // a synchronous failure ended the feed before its subscription was known
    return close;
  }

  #accept(write: WorkWriteAck) {
    for (const listener of this.#acceptedListeners.get(workKey(write.key)) ?? []) {
      try {
        listener(structuredClone(write));
      } catch (error) {
        console.error("Work accepted listener failed", error);
      }
    }
  }

  #load(
    scope: WorkKey,
    spec: RouteStateSpec<z.ZodType>,
    create?: boolean,
  ): Promise<RouteEnvelope<unknown> | null>;
  async #load(
    scope: WorkKey,
    spec: RouteStateSpec<z.ZodType>,
    create = true,
  ): Promise<RouteEnvelope<unknown> | null> {
    const raw = await this.#carryOver(scope, spec.route);
    let envelope: RouteEnvelope<unknown> | null = null;
    if (raw != null) {
      try { envelope = parseEnvelope(raw, spec); }
      catch (error) {
        await this.#store.setState({ targetKey: workKey(scope), route: spec.route, value: null,
          reason: error instanceof Error ? error.message : String(error) });
      }
    }
    if (!envelope) {
      this.#inverses.delete(workKey(scope));
      return create ? emptyEnvelope(spec) : null;
    }
    this.#inverses.set(workKey(scope), this.#retain(
      this.#stored((raw as { history?: unknown }).history, scope), envelope.revision,
    ));
    return envelope;
  }

  /**
   * Save As gives an unsaved document an Address. Its staged Work moves to the Address key,
   * byte-for-byte and
   * exactly once. Nothing is copied onto Work the Address already has.
   */
  async #carryOver(scope: WorkKey, route: string): Promise<unknown> {
    const store = this.#store;
    const targetKey = workKey(scope);
    const raw = await this.#store.getState({ targetKey, route });
    const openWork =
      scope.binding === "address" && scope.from
        ? bindWork(scope.route, null, undefined, scope.from)
        : null;
    if (raw != null || !openWork) return raw;
    const carried = await store.getState({ targetKey: workKey(openWork), route });
    if (carried == null) return null;
    await store.setState({ targetKey, route, value: carried });
    await store.setState({ targetKey: workKey(openWork), route, value: null });
    return carried;
  }

  async #persist(
    scope: WorkKey,
    route: string,
    envelope: RouteEnvelope<unknown>,
    history = this.#inverses.get(workKey(scope)) ?? [],
  ): Promise<void> {
    const retained = this.#retain(history, envelope.revision);
    history.splice(0, history.length, ...retained);
    // Closing a native lifetime changes availability, never the user's authored Work.
    await this.#store.setState({
      targetKey: workKey(scope),
      route,
      value: { ...envelope, history },
    });
  }

  /** Persisted history crosses into the host here; its detail is decoded once, under the admitted
   * schema. Stored bytes stay as saved: a step whose detail no longer decodes is marked, not rewritten. */
  #stored(history: unknown, scope: WorkKey): z.infer<typeof historySchema> {
    const schema = this.#registry.get(scope.route)?.historyDetail;
    return historySchema
      .parse(history ?? [])
      .map(({ write: { detail: _, ...write }, ...record }) => ({
        ...record,
        write: {
          ...write,
          key: workHandle(scope, 0).key,
          ...(write.meta !== undefined &&
            !schema?.safeParse(write.meta).success && { detail: "unavailable" as const }),
        },
      }));
  }

  #retain(records: z.infer<typeof historySchema>, revision: number) {
    const suffix = records;
    // Refuse corrupt canonical history inside the host, before any ready can escape.
    if (
      suffix.length &&
      (suffix.at(-1)!.write.revision !== revision ||
        suffix.some(
          ({ write }, i) =>
            write.base !== write.revision - 1 ||
            (i > 0 && write.base !== suffix[i - 1]!.write.revision),
        ))
    )
      throw Error("Work history is not contiguous through its snapshot");
    const limits = this.options.workHistoryLimits ?? DEFAULT_WORK_HISTORY_LIMITS;
    let bytes = 2; // JSON array brackets; records include their after-values.
    let start = suffix.length;
    while (start > 0 && suffix.length - start < limits.maxCount) {
      const size =
        new TextEncoder().encode(JSON.stringify(suffix[start - 1])).byteLength +
        (start < suffix.length ? 1 : 0);
      if (bytes + size > limits.maxBytes) break;
      bytes += size;
      start--;
    }
    return suffix.slice(start);
  }

  async #publish(event: RouteWorkspaceEvent): Promise<void> {
    for (const listener of this.#listeners) {
      try {
        listener(structuredClone(event));
      } catch (error) {
        console.error("Work publication listener failed", error);
      }
    }
  }

  #serialized<T>(work: () => Promise<T>): Promise<T> {
    const run = this.#tail.then(work);
    this.#tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}

const overlaps = (a: RouteStatePatch["path"], b: RouteStatePatch["path"]) =>
  a
    .slice(0, Math.min(a.length, b.length))
    .every((part, index) => String(part) === String(b[index]));
function valueAt(doc: unknown, path: RouteStatePatch["path"]): unknown {
  let value = doc;
  for (const segment of path) {
    if (typeof value !== "object" || value === null || !Object.hasOwn(value, segment))
      return { exists: false };
    value = Reflect.get(value, segment);
  }
  return { exists: true, value };
}

const historySchema = z.array(
  z.object({
    write: workWriteAckSchema,
    after: z.unknown(),
  }),
);

const envelopeSchema = z.object({
  version: z.literal(ENVELOPE_VERSION),
  revision: z.number().int().nonnegative(),
  doc: z.unknown(),
});

/** Decodes the canonical encoder's words, never document content or a filename. */
function storedWorkKey(value: string, route: string): WorkKey | null {
  const prefix = `${route}/`;
  if (!value.startsWith(prefix)) return null;
  const suffix = value.slice(prefix.length);
  let candidate: unknown;
  if (suffix.startsWith("workspace:"))
    candidate = bindWork(route, null, suffix.slice("workspace:".length));
  else if (suffix.startsWith("target:")) {
    const target = suffix.slice("target:".length);
    candidate = { binding: target ? "address" : "host", route, target: target || null };
  } else if (suffix.startsWith("open:")) {
    const parts = suffix.slice("open:".length).split("/");
    if (parts.length !== 2) return null;
    candidate = {
      binding: "open",
      route,
      target: null,
      open: { session: parts[0], openId: parts[1] },
    };
  } else return null;
  const parsed = workKeySchema.safeParse(candidate);
  return parsed.success && workKey(parsed.data) === value ? parsed.data : null;
}

function emptyEnvelope(spec: RouteStateSpec<z.ZodType>): RouteEnvelope<unknown> | null {
  const empty = spec.schema.safeParse({});
  // Absent Work stays absent when its schema supplies no default; never invent required values.
  if (!empty.success) return null;
  return {
    version: ENVELOPE_VERSION,
    schemaVersion: spec.schemaVersion ?? 1,
    revision: 0,
    doc: empty.data,
  };
}

function parseEnvelope(raw: unknown, spec: RouteStateSpec<z.ZodType>): RouteEnvelope<unknown> {
  const envelope = envelopeSchema.extend({ schemaVersion: z.literal(spec.schemaVersion ?? 1) }).parse(raw);
  const schema = spec.schema instanceof z.ZodObject ? spec.schema.strict() : spec.schema;
  return { ...envelope, doc: schema.parse(envelope.doc) };
}

function toJsonSchema(schema: z.ZodType): unknown {
  return z.toJSONSchema(schema);
}

function unknownRoute(route: string): RouteStateWriteResult {
  return {
    ok: false,
    kind: "error",
    error: `unknown route '${route}'`,
    hint: "list the registered routes before addressing one.",
  };
}
