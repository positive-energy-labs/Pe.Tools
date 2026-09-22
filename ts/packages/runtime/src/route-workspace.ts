import { ephemeralWorkKey, workKey, type WorkKey } from "@pe/agent-contracts";
import { z } from "zod";
import { OwnerReads, type OwnerValue } from "./owner-read.ts";
import {
  applyPatches,
  checkRevision,
  commitDoc,
  guardCommand,
  message,
  refuse,
  refusalText,
  START_FRESH_ASIDE,
  UNREADABLE_WORK,
  type RouteActor,
  type RouteEnvelope,
  type RouteRefusal,
  type RouteStatePatch,
  type RouteStateWriteResult,
} from "@pe/agent-contracts";
import type {
  RouteStateCommandHandlers,
  RouteStateSpec,
  RouteWriteAdmission,
} from "@pe/agent-contracts";

export interface RouteWorkspaceRegistration {
  spec: RouteStateSpec<z.ZodType>;
  // biome-ignore lint/suspicious/noExplicitAny: the schema/handler pairing is checked where registrations are built.
  handlers: RouteStateCommandHandlers<any>;
  admit?: RouteWriteAdmission;
}

export interface RouteWorkspaceEvent {
  type: "route_workspace";
  scope: WorkKey;
  actor: RouteActor;
  route: string;
  action: "apply" | "command" | "start-fresh" | "discard";
  revision: number;
  command?: string;
  patchCount?: number;
  ok: boolean;
  error?: string;
  /** `discard` only: how many Work documents that sweep removed for the closed lifetime. */
  removed?: number;
}

export interface RouteDocumentStore {
  getState(input: { targetKey: string; route: string }): Promise<unknown>;
  setState(input: { targetKey: string; route: string; value: unknown }): Promise<void>;
}

export interface RouteWorkspaceOptions {
  registrations: readonly RouteWorkspaceRegistration[];
  store: RouteDocumentStore;
}

const ENVELOPE_VERSION = 1;
// ponytail: fixed cap keeps every envelope read small; revisit only when a real command needs larger replay results.
/** Store, order, crash barrier, and publication shell around the pure route-document machine. */
export class RouteWorkspace {
  readonly #registry = new Map<string, RouteWorkspaceRegistration>();
  readonly #tails = new Map<string, Promise<void>>();
  readonly #listeners = new Set<(event: RouteWorkspaceEvent) => void>();
  readonly #reads = new OwnerReads();
  /** Every `open:`-keyed Work this workspace wrote: lifetime id -> route -> the key it wrote. */
  readonly #openWork = new Map<string, { open: OpenRef; routes: Map<string, WorkKey> }>();

  constructor(private readonly options: RouteWorkspaceOptions) {
    for (const registration of options.registrations) {
      const route = registration.spec.route;
      if (route.includes(":")) throw new Error(`route name '${route}' cannot contain ':'`);
      if (this.#registry.has(route)) throw new Error(`duplicate route '${route}'`);
      toJsonSchema(registration.spec.schema);
      for (const command of Object.values(registration.spec.commands)) toJsonSchema(command.input);
      this.#registry.set(route, registration);
    }
  }

  list() {
    return [...this.#registry.values()].map(({ spec }) => ({
      route: spec.route,
      title: spec.title,
      description: spec.description,
    }));
  }

  /** The route's Work at the scope; null when the route is unregistered or no Work exists yet. */
  async read(scope: WorkKey, route: string) {
    return this.#read(scope, route, false);
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
    const envelope = await this.#serialized(scope, route, () => this.#load(scope, spec, orEmpty));
    if (!envelope) return null;
    return {
      route,
      title: spec.title,
      description: spec.description,
      doc: structuredClone(envelope.doc),
      revision: envelope.revision,
      schema: toJsonSchema(spec.schema),
      agentWriteMask: spec.agentWriteMask,
      commands: describeCommands(spec),
    };
  }

  async apply(
    scope: WorkKey,
    route: string,
    actor: RouteActor,
    patches: RouteStatePatch[],
    expectedRevision: number,
  ): Promise<RouteStateWriteResult> {
    const registration = this.#registry.get(route);
    if (!registration) return unknownRoute(route);

    return this.#serialized(scope, route, async () => {
      const emit = (event: Omit<RouteWorkspaceEvent, "type" | "scope" | "route" | "actor">) =>
        this.#publish({ type: "route_workspace", scope, route, actor, ...event });
      const envelope = await this.#load(scope, registration.spec).catch(unreadable);
      if ("ok" in envelope) return envelope;
      const applied = applyPatches(registration.spec, envelope, actor, patches, expectedRevision);
      const landed =
        (applied.ok &&
          (await registration.admit?.(applied.envelope.doc, patches, {
            scope,
            actor,
            prior: envelope.doc,
          }))) ||
        applied;
      if (!landed.ok) {
        await emit({
          action: "apply",
          revision: envelope.revision,
          patchCount: patches.length,
          ok: false,
          error: refusalText(landed),
        });
        return landed;
      }

      await this.#persist(scope, route, landed.envelope);
      await emit({
        action: "apply",
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
      };
    });
  }

  async command(
    scope: WorkKey,
    route: string,
    actor: RouteActor,
    command: string,
    input: unknown,
    expectedRevision: number,
  ): Promise<RouteStateWriteResult> {
    const registration = this.#registry.get(route);
    if (!registration) return unknownRoute(route);
    const { spec, handlers } = registration;
    return this.#serialized(scope, route, async () => {
      const envelope = await this.#load(scope, spec).catch(unreadable);
      if ("ok" in envelope) return envelope;
      const reject = async (result: RouteStateWriteResult) => {
        if (!result.ok)
          await this.#publish({
            type: "route_workspace",
            scope,
            route,
            actor,
            action: "command",
            command,
            revision: envelope.revision,
            ok: false,
            error: refusalText(result),
          });
        return result;
      };
      const stale = checkRevision(envelope, expectedRevision);
      if (stale) return reject(stale);
      const guarded = guardCommand(spec, envelope, actor, command, input);
      if (!guarded.ok) return reject(guarded);
      const handler = handlers[command];
      if (!handler)
        return reject(
          refuse(
            "error",
            `command '${command}' has no registered handler`,
            "Route port unavailable.",
          ),
        );
      let committed: RouteEnvelope<unknown> | null = null;
      try {
        const result = await handler(guarded.input, {
          target: scope.target,
          work: scope.work,
          getDoc: () => structuredClone(committed?.doc ?? envelope.doc),
          setDoc: async (candidate) => {
            const landed = commitDoc(spec, envelope, candidate);
            if (!landed.ok) throw Error(`${landed.error}: ${landed.hint}`);
            committed = landed.envelope;
          },
        });
        const next = committed ?? envelope;
        if (committed) await this.#persist(scope, route, next);
        await this.#publish({
          type: "route_workspace",
          scope,
          route,
          actor,
          action: "command",
          command,
          revision: next.revision,
          ok: true,
        });
        return { ok: true, revision: next.revision, ...(result === undefined ? {} : { result }) };
      } catch (error) {
        return reject(
          refuse(
            "error",
            message(error),
            "The read/local handler failed; prior uncertainty remains unresolved.",
          ),
        );
      }
    });
  }

  /**
   * Human-only: moves unreadable Work aside, byte-for-byte and never parsed, to the first free
   * `<route>:aside:<n>`, and starts an empty Work at the same address. Readable Work is refused.
   */
  async startFresh(
    scope: WorkKey,
    route: string,
    actor: RouteActor,
  ): Promise<RouteStateWriteResult> {
    const registration = this.#registry.get(route);
    if (!registration) return unknownRoute(route);
    if (actor !== "human")
      return refuse("refused", "start fresh is human-only", "Ask the user to start fresh.");
    const { spec } = registration;
    const targetKey = workKey(scope);
    return this.#serialized(scope, route, async () => {
      const raw = await this.options.store.getState({ targetKey, route });
      if (raw == null || readable(raw, spec))
        return refuse("refused", "this route's Work is readable", "Nothing to set aside.");
      let slot = 1;
      while ((await this.options.store.getState({ targetKey, route: aside(route, slot) })) != null)
        slot++;
      await this.options.store.setState({ targetKey, route: aside(route, slot), value: raw });
      const fresh = emptyEnvelope(spec);
      await this.#persist(scope, route, fresh);
      await this.#publish({
        type: "route_workspace",
        scope,
        route,
        actor,
        action: "start-fresh",
        revision: fresh.revision,
        ok: true,
      });
      return { ok: true, revision: fresh.revision };
    });
  }

  /**
   * Human-only, read-only: what the route's `salvage` carries over from Work it can no longer
   * read, the unreadable document before start fresh, else the newest aside. Null when the route
   * declares no salvage or there is nothing to salvage.
   */
  async salvage(
    scope: WorkKey,
    route: string,
    actor: RouteActor,
  ): Promise<{ from: string; value: unknown } | RouteRefusal | null> {
    const spec = this.#registry.get(route)?.spec;
    if (actor !== "human")
      return refuse("refused", "salvage is human-only", "Ask the user to carry old Work over.");
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
    const ephemeral = ephemeralWorkKey(scope);
    if (raw != null || !ephemeral) return raw;
    const carried = await store.getState({ targetKey: workKey(ephemeral), route });
    if (carried == null) return null;
    await store.setState({ targetKey, route, value: carried });
    await store.setState({ targetKey: workKey(ephemeral), route, value: null });
    return carried;
  }

  /**
   * The open document lifetimes the connected sessions still hold. Every addressless Work this
   * workspace wrote for a lifetime its own session no longer lists ended with its document, so it
   * is removed and its `discard` published with the count the sweep removed. A session missing
   * from `live` is left alone: a detached bridge is not a closed document.
   */
  async sweepOpen(live: readonly OpenRef[]): Promise<number> {
    const sessions = new Set(live.map((open) => open.session));
    const alive = new Set(live.map(lifetime));
    let removed = 0;
    for (const [id, held] of this.#openWork) {
      if (alive.has(id) || !sessions.has(held.open.session)) continue;
      this.#openWork.delete(id);
      const entries = [...held.routes];
      for (const [route, scope] of entries) {
        await this.#serialized(scope, route, () =>
          this.options.store.setState({ targetKey: workKey(scope), route, value: null }),
        );
        await this.#publish({
          type: "route_workspace",
          scope,
          route,
          actor: "human",
          action: "discard",
          revision: 0,
          ok: true,
          removed: entries.length,
        });
      }
      removed += entries.length;
    }
    return removed;
  }

  async #persist(scope: WorkKey, route: string, envelope: RouteEnvelope<unknown>): Promise<void> {
    if (scope.work === undefined && scope.target === null && scope.open !== undefined) {
      const id = lifetime(scope.open);
      const held = this.#openWork.get(id) ?? {
        open: scope.open,
        routes: new Map<string, WorkKey>(),
      };
      held.routes.set(route, scope);
      this.#openWork.set(id, held);
    }
    await this.options.store.setState({
      targetKey: workKey(scope),
      route,
      value: envelope,
    });
  }

  async #publish(event: RouteWorkspaceEvent): Promise<void> {
    for (const listener of this.#listeners) listener(event);
  }

  #serialized<T>(scope: WorkKey, route: string, work: () => Promise<T>): Promise<T> {
    const key = `${workKey(scope)}\0${route}`;
    const previous = this.#tails.get(key) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(work);
    const tail = run.then(
      () => undefined,
      () => undefined,
    );
    this.#tails.set(key, tail);
    return run.finally(() => {
      if (this.#tails.get(key) === tail) this.#tails.delete(key);
    });
  }
}

const envelopeSchema = z.object({
  version: z.literal(ENVELOPE_VERSION),
  revision: z.number().int(),
  doc: z.unknown(),
});

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

/** One open document lifetime, the scope an addressless Work is keyed by. */
type OpenRef = { readonly session: string; readonly openId: string };

const lifetime = (open: OpenRef) => `${open.session}/${open.openId}`;

const aside = (route: string, slot: number) => `${route}${START_FRESH_ASIDE}${slot}`;

function parseEnvelope(raw: unknown, spec: RouteStateSpec<z.ZodType>): RouteEnvelope<unknown> {
  const parsed = envelopeSchema.safeParse(raw);
  if (!parsed.success) throw new Error(UNREADABLE_WORK);
  const doc = spec.schema.safeParse(parsed.data.doc);
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

function describeCommands(spec: RouteStateSpec<z.ZodType>) {
  return Object.entries(spec.commands).map(([name, command]) => ({
    name,
    description: command.description,
    actor: command.actor,
    input: toJsonSchema(command.input),
  }));
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
