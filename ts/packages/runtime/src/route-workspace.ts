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
  type WorkAuthor,
  type RouteEnvelope,
  type RouteRefusal,
  type RouteStatePatch,
  type RouteStateWriteResult,
  type WorkWrite,
  type WorkWriteAck,
} from "@pe/agent-contracts";
import type { RouteStateSpec, RouteWriteAdmission } from "@pe/agent-contracts";

export interface RouteWorkspaceRegistration {
  spec: RouteStateSpec<z.ZodType>;
  admit?: RouteWriteAdmission;
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
  setState(input: { targetKey: string; route: string; value: unknown }): Promise<void>;
  /** Enumerates canonical persisted records without materializing absent Work. */
  listState?(): Promise<{
    records: { targetKey: string; route: string; value: unknown }[];
    unindexed: number;
    unreadable: number;
    truncated: boolean;
  }>;
}

export interface RouteWorkspaceOptions {
  registrations: readonly RouteWorkspaceRegistration[];
  store: RouteDocumentStore;
}

const ENVELOPE_VERSION = 1;
// Retired close-sweep metadata contains no authored Work. Keep it out of the census.
const OPEN_REGISTER = { targetKey: "open-work", route: "register" };
/** Store, order, crash barrier, and publication shell around the pure route-document machine. */
export class RouteWorkspace {
  readonly #registry = new Map<string, RouteWorkspaceRegistration>();
  // ponytail: serialize this host workspace; use store transactions if parallel writes become necessary.
  #tail = Promise.resolve();
  readonly #listeners = new Set<(event: RouteWorkspaceEvent) => void>();
  readonly #reads = new OwnerReads();
  readonly #inverses = new Map<
    string,
    { write: WorkWriteAck; after: unknown; recovery?: { doc: unknown } }[]
  >();

  constructor(private readonly options: RouteWorkspaceOptions) {
    for (const registration of options.registrations) {
      this.register(registration);
    }
  }

  /** A trusted plugin's lifetime owns registration, never its saved Work bytes. */
  register(registration: RouteWorkspaceRegistration): () => void {
    const route = registration.spec.route;
    if (route.includes(":")) throw new Error(`route name '${route}' cannot contain ':'`);
    if (this.#registry.has(route)) throw new Error(`duplicate route '${route}'`);
    toJsonSchema(registration.spec.schema);
    this.#registry.set(route, registration);
    return () => {
      if (this.#registry.get(route) === registration) this.#registry.delete(route);
    };
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
          } catch {
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

  async #read(scope: WorkKey, route: string, orEmpty: boolean) {
    const registration = this.#registry.get(route);
    if (!registration) return null;
    const { spec } = registration;
    const envelope = await this.#serialized(() => this.#load(scope, spec, orEmpty));
    if (!envelope) return null;
    return {
      route,
      title: spec.title,
      description: spec.description,
      doc: structuredClone(envelope.doc),
      revision: envelope.revision,
      schema: toJsonSchema(spec.schema),
    };
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
    context: Pick<WorkWrite, "press" | "kind"> = { press: null, kind: "apply" },
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
      const press = by === "human" && kind === "apply" ? context.press : null;
      const records = this.#inverses.get(workKey(scope)) ?? [];
      const recorded =
        kind === "restore"
          ? records.findLast(
              (entry) => canonicalRouteInput(entry.write.inverse) === canonicalRouteInput(patches),
            )
          : undefined;
      if (
        kind === "restore" &&
        (!recorded ||
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

      await this.#persist(scope, route, landed.envelope);
      const write: WorkWriteAck = {
        key: scope,
        kind,
        by,
        press,
        base: envelope.revision,
        revision: landed.envelope.revision,
        patches: routeDocDelta(envelope.doc, landed.envelope.doc),
        inverse: routeDocDelta(landed.envelope.doc, envelope.doc),
        undoable: true,
      };
      this.#remember(write, landed.envelope.doc);
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

  /** Observations and conditional retirement are host facts, never raw client edits. */
  publish(scope: WorkKey, route: string, patches: RouteStatePatch[], expectedRevision: number) {
    return this.apply(scope, route, "human", patches, expectedRevision, true);
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
      let slot = 1;
      while ((await this.options.store.getState({ targetKey, route: aside(route, slot) })) != null)
        slot++;
      await this.options.store.setState({ targetKey, route: aside(route, slot), value: raw });
      const fresh = emptyEnvelope(spec);
      const prior = envelopeSchema.safeParse(raw);
      fresh.revision = (prior.success ? prior.data.revision : 0) + 1;
      await this.#persist(scope, route, fresh);
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
      this.#inverses.delete(workKey(scope));
      if (prior.success) this.#remember(write, fresh.doc, { doc: prior.data.doc });
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
    const raw = await this.options.store.getState({ targetKey, route });
    if (raw != null && !readable(raw, spec))
      return { from: "unreadable", value: spec.salvage(docOf(raw)) };
    let newest: { slot: number; raw: unknown } | null = null;
    for (let slot = 1; ; slot++) {
      const found = await this.options.store.getState({ targetKey, route: aside(route, slot) });
      if (found == null) break;
      newest = { slot, raw: found };
    }
    return newest && { from: `aside:${newest.slot}`, value: spec.salvage(docOf(newest.raw)) };
  }

  observe(
    scope: WorkKey,
    route: string,
    listener: (value: OwnerValue<Awaited<ReturnType<RouteWorkspace["read"]>>>) => void,
  ): () => void {
    const key = `${workKey(scope)}\0${route}`;
    return this.#reads.observe(
      key,
      () => this.read(scope, route),
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
    if (raw == null) return create ? emptyEnvelope(spec) : null;
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

  async #persist(scope: WorkKey, route: string, envelope: RouteEnvelope<unknown>): Promise<void> {
    // Closing a native lifetime changes availability, never the user's authored Work.
    await this.options.store.setState({
      targetKey: workKey(scope),
      route,
      value: envelope,
    });
  }

  async #publish(event: RouteWorkspaceEvent): Promise<void> {
    for (const listener of this.#listeners) listener(structuredClone(event));
  }

  #remember(write: WorkWriteAck, after: unknown, recovery?: { doc: unknown }) {
    const key = workKey(write.key);
    const records = this.#inverses.get(key) ?? [];
    // Foreign writes are barriers even if a later write happens to put the same values back.
    const kept =
      write.by === "pea" || write.kind === "publish"
        ? records.filter(
            (entry) =>
              !entry.write.inverse.some((inverse) =>
                [...write.patches, ...write.inverse].some((patch) =>
                  overlaps(inverse.path, patch.path),
                ),
              ),
          )
        : records;
    kept.push(structuredClone({ write, after, ...(recovery !== undefined ? { recovery } : {}) }));
    // shortcut: restore receipts cover the last 100 transitions in this host lifetime; persist them for reload survival.
    this.#inverses.set(key, kept.slice(-100));
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
  return { version: ENVELOPE_VERSION, revision: 0, doc: spec.schema.parse({}) };
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
  const parsed = envelopeSchema.safeParse(raw);
  if (!parsed.success) throw new Error(UNREADABLE_WORK);
  const schema = spec.schema instanceof z.ZodObject ? spec.schema.strict() : spec.schema;
  const doc = schema.safeParse(parsed.data.doc);
  if (!doc.success) throw new Error(UNREADABLE_WORK);
  return {
    version: ENVELOPE_VERSION,
    revision: parsed.data.revision,
    doc: doc.data,
  };
}

/** A write over saved Work the schema refuses answers in the one sentence and writes nothing. */
function unreadable(error: unknown): RouteRefusal {
  if (error instanceof Error && error.message === UNREADABLE_WORK)
    return refuse(
      "refused",
      UNREADABLE_WORK,
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
