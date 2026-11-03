import {
  captureAdmittedHostBindings,
  type AdmittedRoute,
} from "../../agent-contracts/src/route-module.ts";
import type {
  HostAdmittedRoute,
  HostWorkRegistration,
} from "../../agent-contracts/src/host-route-admission.ts";
import type { RouteFingerprint } from "../../agent-contracts/src/route-kernel-admission.ts";
import type {
  WorkAdmission,
  WorkFeedFailure,
} from "../../agent-contracts/src/work-journal-door.ts";
import { WorkMigrationFailure } from "./work-migration-failure.ts";
import { createWorkJournal } from "./work-journal.ts";
import { bindWork, workCounts, workKey, workKeySchema, type WorkKey } from "@pe/agent-contracts";
import { z } from "zod";
import { OwnerReads, type OwnerValue } from "./owner-read.ts";
import {
  applyPatches,
  checkRevision,
  routeDocDelta,
  canonicalRouteInput,
  refuse,
  refusalText,
  START_FRESH_ASIDE,
  UNREADABLE_WORK,
  OLDER_WORK,
  workSchemaAge,
  type WorkAuthor,
  type RouteEnvelope,
  type RouteRefusal,
  type RouteStatePatch,
  type RouteStateWriteResult,
  type WorkWrite,
  type WorkWriteAck,
  workWriteAckSchema,
} from "@pe/agent-contracts";
import type { RouteStateSpec } from "@pe/agent-contracts";

export interface RouteWorkspaceRegistration extends HostWorkRegistration {}

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
  setState(input: { targetKey: string; route: string; value: unknown }): Promise<void>;
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
export interface RouteWorkspaceOptions {
  registrations: readonly RouteWorkspaceRegistration[];
  store: RouteDocumentStore;
  workHistoryLimits?: { readonly maxCount: number; readonly maxBytes: number };
}

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
    { write: WorkWriteAck; after: unknown; recovery?: { doc: unknown; schemaVersion: number } }[]
  >();

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
    const age = registration.spec.schemaVersion ?? 1;
    if (!Number.isSafeInteger(age) || age < 1) throw new Error("Invalid Work schema version");
    if (route.includes(":")) throw new Error(`route name '${route}' cannot contain ':'`);
    if (this.#registry.has(route)) throw new Error(`duplicate route '${route}'`);
    toJsonSchema(registration.spec.schema);
    this.#registry.set(route, registration);
    return () => {
      if (this.#registry.get(route) === registration) this.#registry.delete(route);
    };
  }

  /** Host admission owns migration and recovery bodies. No browser body or schema crosses the wire. */
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
    // Presenters never install a second registry or run the owner's migrations.
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
    const migrations = Object.fromEntries(
      Object.entries(work.migrations).map(([age, id]) => {
        const body = bindings.bodies[id];
        if (!body || body.kind !== "migration") throw Error(`Missing admitted migration: ${id}`);
        return [Number(age), (doc: unknown) => body.run(doc)];
      }),
    );
    const spec: RouteStateSpec<z.ZodType> =
      "workState" in bindings && bindings.workState
        ? bindings.workState
        : {
            route: work.route,
            title: route.data.name,
            description: route.data.directory.summary,
            schema: bindings.schemas[work.schema]!,
            schemaVersion: work.version,
            migrations,
            // A web salvage body consumes recovery data and must never read persisted Work here.
            salvage:
              route.data.salvage && bindings.bodies[route.data.salvage]?.kind === "recovery"
                ? bindings.bodies[route.data.salvage]!.run
                : undefined,
          };
    let remove: () => void;
    try {
      remove = this.register({
        spec,
        ...("admit" in bindings ? { admit: bindings.admit } : {}),
      });
    } catch (error) {
      receipt.deactivate();
      throw error;
    }
    // Migrations run ONCE per admitted (route key, fingerprint), installed in this persistent
    // RouteWorkspace before any feed opens, never per browser open. Persisted version prevents
    // reapplication after host restart. The promise also retains a failed admission's outcome.
    const ready = this.#serialized(async (): Promise<WorkFeedFailure | null> => {
      try {
        if (Object.keys(migrations).length) {
          if (!this.options.store.listState)
            throw Error("Migration requires an indexed Work store");
          const saved = await this.options.store.listState();
          if (saved.truncated || saved.unreadable || saved.unindexed)
            throw Error("Work census is incomplete; migration admission cannot open feeds");
          // A replacement may arrive while the census awaits disk. Never execute newer
          // bindings through the older admission's barrier, or migrate after retirement.
          if (this.#admissions.get(route.data.key) !== record)
            return {
              kind: "failed",
              code: "WorkRegistrationRetired",
              message: "Host route admission retired",
            };
          for (const savedRecord of saved.records) {
            if (savedRecord.route !== work.route) continue;
            const key = storedWorkKey(savedRecord.targetKey, savedRecord.route);
            if (!key) throw Error("Stored Work has an invalid identity");
            await this.#load(key, spec, false);
          }
        }
        return null;
      } catch (error) {
        if (error instanceof WorkMigrationFailure)
          return { ...error.failure, routeKey: route.data.key };
        return { kind: "failed", code: "WorkRegistrationFailed", message: String(error) };
      }
    });
    const record = {
      fingerprint: route.workFingerprint,
      workRoute: work.route,
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
    if (key.route !== registered.workRoute)
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
      if (!this.options.store.listState)
        return { works: [], unindexed: 0, unreadable: 0, truncated: false, available: false };
      const census = await this.options.store.listState();
      let invalidIdentities = 0;
      const works = census.records.flatMap((record) => {
        if (
          record.route.includes(START_FRESH_ASIDE) ||
          (record.route === OPEN_REGISTER.route && record.targetKey === OPEN_REGISTER.targetKey)
        )
          return [];
        const scope = storedWorkKey(record.targetKey, record.route);
        if (!scope) {
          invalidIdentities++;
          return [];
        }
        const spec = this.#registry.get(record.route)?.spec;
        let revision: number | null = null;
        let proposals = 0;
        let unfinished = 0;
        let state: "ready" | "unreadable" | "unregistered" = spec ? "unreadable" : "unregistered";
        if (spec) {
          try {
            const envelope = parseEnvelope(record.value, spec);
            revision = envelope.revision;
            ({ proposals, unfinished } = workCounts(envelope.doc, spec.editable ?? []));
            state = "ready";
          } catch (error) {
            console.warn(
              "ts/packages/runtime/src/route-workspace.ts: fallback after failure",
              error,
            );
            // Keep the address discoverable without exposing the unreadable document.
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
            proposals,
            unfinished,
          },
        ];
      });
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
  async read(scope: WorkKey, route: string) {
    return this.#read(scope, route, false);
  }

  /**
   * The saved document exactly as stored, not validated against the route's schema: for a reader
   * that salvages what still parses instead of refusing. Null when no Work exists; `doc` is null
   * when even the envelope is unreadable.
   */
  async readRaw(scope: WorkKey, route: string): Promise<{ doc: unknown; revision: number } | null> {
    if (!this.#registry.has(route)) return null;
    const raw = await this.#serialized(() => this.#carryOver(scope, route));
    if (raw == null) return null;
    const envelope = envelopeSchema.safeParse(raw);
    return envelope.success
      ? { doc: envelope.data.doc, revision: envelope.data.revision }
      : { doc: null, revision: 0 };
  }

  /**
   * A reader's view of the route: absent Work reads as the empty document at r0, the one `apply`
   * starts from. Null only for an unregistered route, so a registered route never reads unknown.
   */
  async view(scope: WorkKey, route: string) {
    return this.#read(scope, route, true);
  }

  async #read(scope: WorkKey, route: string, orEmpty: boolean, withHistory = false) {
    const registration = this.#registry.get(route);
    if (!registration) return null;
    const { spec } = registration;
    return this.#serialized(async () => {
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
        schemaVersion: envelope.schemaVersion ?? null,
        schema: toJsonSchema(spec.schema),
      };
    });
  }

  /** The untrusted write envelope has no authorship field. `by` is the host caller's principal. */
  write(scope: WorkKey, route: string, by: WorkAuthor, input: WorkWrite) {
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
    context: Pick<WorkWrite, "press" | "kind" | "restoreOf" | "label"> & { receiptId?: string } = {
      press: null,
      kind: "apply",
    },
  ): Promise<RouteStateWriteResult> {
    if (scope.route !== route)
      return refuse(
        "refused",
        "Work identity does not match the route",
        "Use the Work key for this route.",
      );
    const registration = this.#registry.get(route);
    if (!registration) return unknownRoute(route);

    return this.#serialized(async () => {
      const envelope = await this.#load(scope, registration.spec).catch(unreadable);
      if ("ok" in envelope) return envelope;
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
      if (recorded?.recovery !== undefined) {
        const stale = checkRevision(envelope, expectedRevision);
        if (stale) return stale;
      }
      const applied =
        recorded?.recovery !== undefined
          ? {
              ok: true as const,
              changed: true,
              envelope: {
                ...envelope,
                revision: envelope.revision + 1,
                doc: structuredClone(recorded.recovery.doc),
              },
            }
          : applyPatches(
              registration.spec,
              envelope,
              by,
              recorded?.write.inverse ?? patches,
              expectedRevision,
              trusted || kind === "restore",
              kind === "restore",
            );
      const landed =
        (applied.ok &&
          recorded?.recovery === undefined &&
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
        key: scope,
        kind,
        by,
        press,
        ...(kind === "apply" && context.label ? { label: context.label } : {}),
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
          ...(recorded?.recovery
            ? {
                recovery: {
                  doc: envelope.doc,
                  schemaVersion: registration.spec.schemaVersion ?? 1,
                },
              }
            : {}),
        },
      ];
      await this.#persist(
        scope,
        route,
        {
          ...landed.envelope,
          schemaVersion: recorded?.recovery?.schemaVersion ?? registration.spec.schemaVersion ?? 1,
        },
        history,
      );
      this.#inverses.set(workKey(scope), history);
      this.#accept(write);
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
      // The write's own evidence: the doc the patches landed on, so a caller that only sees the
      // outcome (a chat card reading a `pe_do` result) shows what is staged without a second read.
      return {
        ok: true,
        revision: landed.envelope.revision,
        doc: structuredClone(landed.envelope.doc),
        write,
      };
    });
  }

  /**
   * Undo or redo the last step of this Work's one journal, whoever wrote it (ADR 0028 noun 4).
   * The restore is the same write a person's Undo sends: one `restore` revision whose inverse is
   * the redo. It refuses, writing nothing, when the step's paths changed elsewhere.
   */
  async step(
    scope: WorkKey,
    route: string,
    by: WorkAuthor,
    direction: "undo" | "redo",
    expectedRevision: number,
  ): Promise<RouteStateWriteResult> {
    const snapshot = await this.view(scope, route);
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
    });
    return result.ok && accepted
      ? accepted
      : refuse("refused", result.ok ? "Nothing restored" : result.message, "Re-read Work history.");
  }

  /** Observations and conditional retirement are host facts, never raw client edits. */
  publish(
    scope: WorkKey,
    route: string,
    patches: RouteStatePatch[],
    expectedRevision: number,
    receiptId?: string,
  ) {
    return this.apply(scope, route, "human", patches, expectedRevision, true, {
      kind: "apply",
      press: null,
      receiptId,
    });
  }

  /**
   * Either author moves unreadable Work aside, byte-for-byte and never parsed, to the first free
   * `<route>:aside:<n>`, and starts an empty Work at the same address. Readable Work is refused.
   */
  async startFresh(scope: WorkKey, route: string, by: WorkAuthor): Promise<RouteStateWriteResult> {
    if (scope.route !== route)
      return refuse(
        "refused",
        "Work identity does not match the route",
        "Use the Work key for this route.",
      );
    const registration = this.#registry.get(route);
    if (!registration) return unknownRoute(route);
    const { spec } = registration;
    const targetKey = workKey(scope);
    return this.#serialized(async () => {
      const raw = await this.options.store.getState({ targetKey, route });
      if (raw == null || readable(raw, spec))
        return refuse("refused", "this route's Work is readable", "Nothing to set aside.");
      // Recovery also covers unreadable values at the current schema (U8rv). The
      // older-schema-only rule would strand these bytes; newer/unknown schemas stay closed.
      const age = workSchemaAge(raw, spec);
      if (age !== "older" && age !== "current")
        return refuse(
          "refused",
          UNREADABLE_WORK,
          "Only a known current or older schema permits Start fresh.",
        );
      let slot = 1;
      while ((await this.options.store.getState({ targetKey, route: aside(route, slot) })) != null)
        slot++;
      await this.options.store.setState({ targetKey, route: aside(route, slot), value: raw });
      const fresh = emptyEnvelope(spec);
      const prior = envelopeSchema.safeParse(raw);
      fresh.revision = (prior.success ? prior.data.revision : 0) + 1;
      // Recovery is the explicit exception to schema-valid restore: only these host-held bytes return.
      const write: WorkWriteAck = {
        key: scope,
        kind: "start-fresh",
        by,
        press: null,
        base: prior.success ? prior.data.revision : 0,
        revision: fresh.revision,
        patches: [{ path: [], value: structuredClone(fresh.doc) }],
        inverse: prior.success ? [{ path: [], value: structuredClone(prior.data.doc) }] : [],
        undoable: prior.success,
        aside: aside(route, slot),
      };
      const history = [
        ...historySchema.parse((raw as { history?: unknown }).history ?? []),
        {
          write,
          after: fresh.doc,
          ...(prior.success
            ? {
                recovery: {
                  doc: prior.data.doc,
                  schemaVersion: (raw as { schemaVersion: number }).schemaVersion,
                },
              }
            : {}),
        },
      ];
      await this.#persist(scope, route, fresh, history);
      this.#inverses.set(targetKey, history);
      this.#accept(write);
      await this.#publish({
        ...write,
        type: "route_workspace",
        scope,
        route,
        by,
        action: "start-fresh",
        revision: fresh.revision,
        ok: true,
      });
      return { ok: true, revision: fresh.revision, write };
    });
  }

  /**
   * Read-only: what the route's `salvage` carries over from Work it can no longer
   * read, the unreadable document before start fresh, else the newest aside. Null when the route
   * declares no salvage or there is nothing to salvage.
   */
  async salvage(
    scope: WorkKey,
    route: string,
  ): Promise<{ from: string; value: unknown } | RouteRefusal | null> {
    const spec = this.#registry.get(route)?.spec;
    if (!spec?.salvage) return null;
    const targetKey = workKey(scope);
    const docOf = (raw: unknown) => (raw as { doc?: unknown } | null)?.doc;
    const extract = (from: string, raw: unknown) => {
      try {
        return { from, value: spec.salvage!(docOf(raw)) };
      } catch (error) {
        return refuse(
          "error",
          `Work salvage failed: ${String(error)}`,
          "Saved Work was left untouched.",
        );
      }
    };
    const raw = await this.options.store.getState({ targetKey, route });
    if (raw != null && !readable(raw, spec)) return extract("unreadable", raw);
    let newest: { slot: number; raw: unknown } | null = null;
    for (let slot = 1; ; slot++) {
      const found = await this.options.store.getState({ targetKey, route: aside(route, slot) });
      if (found == null) break;
      newest = { slot, raw: found };
    }
    return newest && extract(`aside:${newest.slot}`, newest.raw);
  }

  observe(
    scope: WorkKey,
    route: string,
    listener: (value: OwnerValue<Awaited<ReturnType<RouteWorkspace["read"]>>>) => void,
    orEmpty = false,
    withHistory = false,
  ): () => void {
    const key = `${workKey(scope)}\0${route}\0${orEmpty}\0${withHistory}`;
    return this.#reads.observe(
      key,
      () => this.#read(scope, route, orEmpty, withHistory),
      (notify) =>
        this.subscribe((event) => {
          if (event.route === route && workKey(event.scope) === workKey(scope)) notify();
        }),
      listener,
    );
  }

  subscribe(listener: (event: RouteWorkspaceEvent) => void): () => void {
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
    const key = workKey(scope);
    let disposed = false;
    void this.#serialized(async () => {
      const spec = this.#registry.get(scope.route)?.spec;
      if (!spec || disposed) return;
      const raw = await this.#carryOver(scope, spec.route);
      this.#inverses.set(
        key,
        this.#retain(
          historySchema
            .parse((raw as { history?: unknown } | null)?.history ?? [])
            .map((record) => ({ ...record, write: { ...record.write, key: scope } })),
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

  #accept(write: WorkWriteAck) {
    for (const listener of this.#acceptedListeners.get(workKey(write.key)) ?? [])
      listener(structuredClone(write));
  }

  #load(scope: WorkKey, spec: RouteStateSpec<z.ZodType>): Promise<RouteEnvelope<unknown>>;
  #load(
    scope: WorkKey,
    spec: RouteStateSpec<z.ZodType>,
    create: boolean,
  ): Promise<RouteEnvelope<unknown> | null>;
  async #load(
    scope: WorkKey,
    spec: RouteStateSpec<z.ZodType>,
    create = true,
  ): Promise<RouteEnvelope<unknown> | null> {
    const raw = await this.#carryOver(scope, spec.route);
    if (raw == null) {
      this.#inverses.delete(workKey(scope));
      return create ? emptyEnvelope(spec) : null;
    }
    this.#inverses.set(
      workKey(scope),
      this.#retain(
        historySchema
          .parse((raw as { history?: unknown }).history ?? [])
          .map((record) => ({ ...record, write: { ...record.write, key: scope } })),
        (raw as { revision: number }).revision,
      ),
    );
    let age = (raw as { schemaVersion?: number }).schemaVersion;
    const current = spec.schemaVersion ?? 1;
    if (age !== undefined && age < current && spec.migrations) {
      const saved = envelopeSchema.parse(raw);
      let doc = structuredClone(saved.doc);
      const fromVersion = age;
      let migrated: RouteEnvelope<unknown>;
      try {
        while (age < current) {
          const migrate = spec.migrations[age];
          if (!migrate) throw Error(OLDER_WORK);
          doc = migrate(doc);
          age++;
        }
        migrated = parseEnvelope(
          { ...saved, doc, schemaVersion: age, revision: saved.revision + 1 },
          spec,
        );
      } catch (error) {
        throw new WorkMigrationFailure({
          kind: "migration-failed",
          routeKey: spec.route,
          fromVersion,
          toVersion: current,
          step: Math.min(age, current - 1),
          message: error instanceof Error ? error.message : String(error),
        });
      }
      await this.#persist(scope, spec.route, migrated, []);
      this.#inverses.set(workKey(scope), []);
      return migrated;
    }
    return parseEnvelope(raw, spec);
  }

  /**
   * The document's Work, and the one silent migration: Save As gave an unsaved document an
   * Address, so the Work it staged while addressless moves to the Address key, byte-for-byte and
   * exactly once. Nothing is migrated onto Work the Address already has.
   */
  async #carryOver(scope: WorkKey, route: string): Promise<unknown> {
    const { store } = this.options;
    const targetKey = workKey(scope);
    const raw = await store.getState({ targetKey, route });
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
    await this.options.store.setState({
      targetKey: workKey(scope),
      route,
      value: { ...envelope, history },
    });
  }

  #retain(records: z.infer<typeof historySchema>, revision: number) {
    const boundary = records.findLastIndex(({ write }) => write.kind === "start-fresh");
    const suffix = records.slice(Math.max(0, boundary));
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
    for (const listener of this.#listeners) listener(structuredClone(event));
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
    recovery: z.object({ doc: z.unknown(), schemaVersion: z.number().int().positive() }).optional(),
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

function emptyEnvelope(spec: RouteStateSpec<z.ZodType>): RouteEnvelope<unknown> {
  return {
    version: ENVELOPE_VERSION,
    schemaVersion: spec.schemaVersion ?? 1,
    revision: 0,
    doc: spec.schema.parse({}),
  };
}

function readable(raw: unknown, spec: RouteStateSpec<z.ZodType>): boolean {
  try {
    parseEnvelope(raw, spec);
    return true;
  } catch {
    return false;
  }
}

const aside = (route: string, slot: number) => `${route}${START_FRESH_ASIDE}${slot}`;

function parseEnvelope(raw: unknown, spec: RouteStateSpec<z.ZodType>): RouteEnvelope<unknown> {
  const age = workSchemaAge(raw, spec);
  if (age === "newer") throw new Error(UNREADABLE_WORK);
  const refusal = age === "older" ? OLDER_WORK : UNREADABLE_WORK;
  const parsed = envelopeSchema.safeParse(raw);
  if (!parsed.success) throw new Error(refusal);
  const schema = spec.schema instanceof z.ZodObject ? spec.schema.strict() : spec.schema;
  const doc = schema.safeParse(parsed.data.doc);
  if (!doc.success) throw new Error(refusal);
  return {
    version: ENVELOPE_VERSION,
    ...(age !== "unknown" && { schemaVersion: (raw as { schemaVersion: number }).schemaVersion }),
    revision: parsed.data.revision,
    doc: doc.data,
  };
}

/** A write over saved Work the schema refuses answers in the one sentence and writes nothing. */
function unreadable(error: unknown): RouteRefusal {
  if (error instanceof Error && [UNREADABLE_WORK, OLDER_WORK].includes(error.message))
    return refuse(
      "refused",
      error.message,
      "Nothing was written; the saved Work is kept as it was.",
    );
  throw error;
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
