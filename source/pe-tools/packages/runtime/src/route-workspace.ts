import { z } from "zod";
import {
  applyPatches,
  canonicalRouteInput,
  checkRevision,
  commitDoc,
  guardCommand,
  isRecord,
  message,
  refuse,
  type CommandReceipt,
  type Address,
  type RouteActor,
  type RouteEnvelope,
  type RoutePatch,
  type RouteRefusal,
  type RouteStateWriteResult,
} from "@pe/agent-contracts";
import type { RouteStateCommandHandlers, RouteStateSpec } from "@pe/agent-contracts";

export type RouteWorkspaceScope = { documentAddress: Address };
export type RouteWorkspaceActor = RouteActor;
export type RouteWorkspacePatch = RoutePatch;

export interface RouteWorkspaceRegistration {
  spec: RouteStateSpec<z.ZodType>;
  // biome-ignore lint/suspicious/noExplicitAny: the schema/handler pairing is checked where registrations are built.
  handlers: RouteStateCommandHandlers<any>;
}

export interface RouteWorkspaceEvent {
  type: "route_workspace";
  scope: RouteWorkspaceScope;
  actor: RouteWorkspaceActor;
  route: string;
  action: "apply" | "command";
  revision: number;
  command?: string;
  patchCount?: number;
  ok: boolean;
  error?: string;
}

export interface RouteDocumentStore {
  getState(input: { documentAddress: string; route: string }): Promise<unknown>;
  setState(input: { documentAddress: string; route: string; value: unknown }): Promise<void>;
}

export interface RouteWorkspaceOptions {
  registrations: readonly RouteWorkspaceRegistration[];
  store: RouteDocumentStore;
}

export type RouteWorkspaceApplyResult = RouteStateWriteResult;
export type RouteWorkspaceCommandResult = RouteStateWriteResult;

const ENVELOPE_VERSION = 1;
// ponytail: fixed cap keeps every envelope read small; revisit only when a real command needs larger replay results.
export const RECEIPT_RESULT_MAX_BYTES = 8 * 1024;
/** Store, order, crash barrier, and publication shell around the pure route-document machine. */
export class RouteWorkspace {
  readonly #registry = new Map<string, RouteWorkspaceRegistration>();
  readonly #tails = new Map<string, Promise<void>>();
  readonly #listeners = new Set<(event: RouteWorkspaceEvent) => void>();

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

  async read(scope: RouteWorkspaceScope, route: string) {
    const registration = this.#registry.get(route);
    if (!registration) return null;
    const { spec } = registration;
    const envelope = await this.#serialized(scope, route, () => this.#load(scope, spec));
    return {
      route,
      title: spec.title,
      description: spec.description,
      doc: structuredClone(envelope.doc),
      revision: envelope.revision,
      status: envelope.outcomeUnknown ? "outcomeUnknown" : "ready",
      outcomeUnknown: envelope.outcomeUnknown,
      schema: toJsonSchema(spec.schema),
      agentWriteMask: spec.agentWriteMask,
      commands: describeCommands(spec),
    };
  }

  async apply(
    scope: RouteWorkspaceScope,
    route: string,
    actor: RouteWorkspaceActor,
    patches: RouteWorkspacePatch[],
    expectedRevision: number,
  ): Promise<RouteWorkspaceApplyResult> {
    const registration = this.#registry.get(route);
    if (!registration) return unknownRoute(route);

    return this.#serialized(scope, route, async () => {
      const emit = (event: Omit<RouteWorkspaceEvent, "type" | "scope" | "route" | "actor">) =>
        this.#publish({ type: "route_workspace", scope, route, actor, ...event });
      const envelope = await this.#load(scope, registration.spec);
      const landed = applyPatches(registration.spec, envelope, actor, patches, expectedRevision);
      if (!landed.ok) {
        await emit({
          action: "apply",
          revision: envelope.revision,
          patchCount: patches.length,
          ok: false,
          error: landed.error,
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
      return { ok: true, revision: landed.envelope.revision };
    });
  }

  async command(
    scope: RouteWorkspaceScope,
    route: string,
    actor: RouteWorkspaceActor,
    command: string,
    input: unknown,
    expectedRevision: number,
    requestId?: string,
  ): Promise<RouteWorkspaceCommandResult> {
    const registration = this.#registry.get(route);
    if (!registration) return unknownRoute(route);
    const { spec, handlers } = registration;

    return this.#serialized(scope, route, async () => {
      let envelope = await this.#load(scope, spec);
      const emit = (event: Omit<RouteWorkspaceEvent, "type" | "scope" | "route" | "actor">) =>
        this.#publish({ type: "route_workspace", scope, route, actor, ...event });
      const fail = async (refusal: RouteRefusal): Promise<RouteWorkspaceCommandResult> => {
        await emit({
          action: "command",
          command,
          revision: envelope.revision,
          ok: false,
          error: refusal.error,
        });
        return refusal;
      };
      let inputDigest: string | undefined;
      if (requestId) {
        try {
          inputDigest = canonicalRouteInput(input);
        } catch (error) {
          return fail(refuse("error", message(error), "command input must be JSON."));
        }
        const receipt = envelope.receipts?.[requestId];
        if (receipt) {
          if (receipt.command !== command || receipt.inputDigest !== inputDigest)
            return fail(
              refuse(
                "refused",
                `request id '${requestId}' was already used for another command or input`,
                "mint a new request id for a different command request.",
                "request_id_conflict",
              ),
            );
          if (!receipt.replayable)
            return fail(
              refuse(
                "refused",
                `request id '${requestId}' completed but its result is unavailable for replay`,
                "re-read the document before continuing.",
                "replay_unavailable",
              ),
            );
          return {
            ok: true,
            revision: receipt.revision,
            result: structuredClone(receipt.result),
          };
        }
      }
      const stale = checkRevision(envelope, expectedRevision);
      if (stale) return fail(stale);
      const guarded = guardCommand(spec, envelope, actor, command, input);
      if (!guarded.ok) return fail(guarded);
      if (guarded.command.mutatesExternal && !requestId)
        return fail(
          refuse(
            "error",
            `command '${command}' requires a request id`,
            "retry with one stable client request id.",
          ),
        );
      const handler = handlers[command];
      if (!handler)
        return fail(
          refuse(
            "error",
            `command '${command}' has no registered handler`,
            "this is a wiring bug in the route registration.",
          ),
        );

      const priorUnknown = envelope.outcomeUnknown;
      if (guarded.command.mutatesExternal) {
        envelope.inFlight = { command, startedAt: new Date().toISOString() };
        await this.#persist(scope, route, envelope);
      }

      let committed: RouteEnvelope<unknown> | null = null;
      try {
        const result = await handler(guarded.input, {
          documentAddress: scope.documentAddress,
          getDoc: () => structuredClone(committed?.doc ?? envelope.doc),
          setDoc: async (candidate) => {
            const landed = commitDoc(spec, envelope, candidate);
            if (!landed.ok) throw new Error(`${landed.error}: ${landed.hint}`);
            committed = landed.envelope;
          },
        });

        if (committed) envelope = committed;
        delete envelope.inFlight;
        if (guarded.command.recoversExternal) delete envelope.outcomeUnknown;
        let returned = result;
        if (guarded.command.mutatesExternal) {
          const normalized = normalizeReceiptResult(result);
          returned = normalized.returned;
          // ponytail: receipts never evict; revisit only if a high-frequency external command ships.
          envelope.receipts = {
            ...envelope.receipts,
            [requestId!]: {
              command,
              inputDigest: inputDigest!,
              completedAt: new Date().toISOString(),
              revision: envelope.revision,
              ...normalized.receipt,
            },
          };
        }
        if (committed || guarded.command.mutatesExternal || guarded.command.recoversExternal)
          await this.#persist(scope, route, envelope);

        await emit({
          action: "command",
          command,
          revision: envelope.revision,
          ok: true,
        });
        return {
          ok: true,
          revision: envelope.revision,
          ...(returned === undefined ? {} : { result: returned }),
        };
      } catch (error) {
        // A thrown handler rolls back any setDoc candidate because only successful handlers commit it.
        const errorMessage = message(error);
        if (guarded.command.mutatesExternal) {
          envelope.outcomeUnknown = priorUnknown ?? envelope.inFlight;
          delete envelope.inFlight;
          await this.#persist(scope, route, envelope);
        }
        return fail(
          refuse(
            "error",
            errorMessage,
            guarded.command.mutatesExternal
              ? "the external outcome is unknown; recover before another external mutation."
              : "the command handler threw.",
          ),
        );
      }
    });
  }

  subscribe(listener: (event: RouteWorkspaceEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async #load(
    scope: RouteWorkspaceScope,
    spec: RouteStateSpec<z.ZodType>,
  ): Promise<RouteEnvelope<unknown>> {
    const raw = await this.options.store.getState({
      documentAddress: scope.documentAddress,
      route: spec.route,
    });
    if (raw == null)
      return {
        version: ENVELOPE_VERSION,
        revision: 0,
        doc: spec.schema.parse({}),
      };
    const envelope = parseEnvelope(raw, spec);
    if (envelope.inFlight) {
      envelope.outcomeUnknown ??= envelope.inFlight;
      delete envelope.inFlight;
      await this.options.store.setState({
        documentAddress: scope.documentAddress,
        route: spec.route,
        value: envelope,
      });
    }
    return envelope;
  }

  async #persist(
    scope: RouteWorkspaceScope,
    route: string,
    envelope: RouteEnvelope<unknown>,
  ): Promise<void> {
    await this.options.store.setState({
      documentAddress: scope.documentAddress,
      route,
      value: envelope,
    });
  }

  async #publish(event: RouteWorkspaceEvent): Promise<void> {
    for (const listener of this.#listeners) listener(event);
  }

  #serialized<T>(scope: RouteWorkspaceScope, route: string, work: () => Promise<T>): Promise<T> {
    const key = `${scope.documentAddress}\0${route}`;
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

const externalOperationSchema = z.object({ command: z.string(), startedAt: z.string() });
const commandReceiptSchema = z
  .object({
    command: z.string(),
    inputDigest: z.string(),
    completedAt: z.string(),
    revision: z.number().int(),
    replayable: z.boolean(),
    result: z.unknown().optional(),
  })
  .refine((receipt) => !receipt.replayable || "result" in receipt);
const envelopeSchema = z.object({
  version: z.literal(ENVELOPE_VERSION),
  revision: z.number().int(),
  doc: z.unknown(),
  inFlight: z.unknown().optional(),
  outcomeUnknown: z.unknown().optional(),
  receipts: z.unknown().optional(),
});

function parseEnvelope(raw: unknown, spec: RouteStateSpec<z.ZodType>): RouteEnvelope<unknown> {
  const parsed = envelopeSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`invalid persisted envelope for route '${spec.route}'`);
  const doc = spec.schema.safeParse(parsed.data.doc);
  if (!doc.success) throw new Error(`invalid persisted document for route '${spec.route}'`);
  return {
    version: ENVELOPE_VERSION,
    revision: parsed.data.revision,
    doc: doc.data,
    inFlight: externalOperationSchema.safeParse(parsed.data.inFlight).data,
    outcomeUnknown: externalOperationSchema.safeParse(parsed.data.outcomeUnknown).data,
    receipts: parseReceipts(parsed.data.receipts, spec.route),
  };
}

function parseReceipts(value: unknown, route: string): Record<string, CommandReceipt> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new Error(`invalid persisted receipts for route '${route}'`);
  const receipts: Record<string, CommandReceipt> = {};
  for (const [requestId, raw] of Object.entries(value)) {
    const parsed = commandReceiptSchema.safeParse(raw);
    if (!parsed.success)
      throw new Error(`invalid persisted receipt '${requestId}' for route '${route}'`);
    receipts[requestId] = parsed.data.replayable
      ? { ...parsed.data, result: structuredClone(parsed.data.result) }
      : parsed.data;
  }
  return receipts;
}

function normalizeReceiptResult(result: unknown): {
  returned?: unknown;
  receipt: Pick<CommandReceipt, "replayable" | "result">;
} {
  try {
    const serialized = JSON.stringify(result);
    if (serialized === undefined) return { receipt: { replayable: false } };
    const returned = JSON.parse(serialized);
    return new TextEncoder().encode(serialized).byteLength > RECEIPT_RESULT_MAX_BYTES
      ? { returned, receipt: { replayable: false } }
      : { returned, receipt: { replayable: true, result: returned } };
  } catch {
    return { receipt: { replayable: false } };
  }
}

function describeCommands(spec: RouteStateSpec<z.ZodType>) {
  return Object.entries(spec.commands).map(([name, command]) => ({
    name,
    description: command.description,
    actor: command.actor,
    mutatesExternal: command.mutatesExternal === true,
    recoversExternal: command.recoversExternal === true,
    input: toJsonSchema(command.input),
  }));
}

function toJsonSchema(schema: z.ZodType): unknown {
  return z.toJSONSchema(schema);
}

function unknownRoute(route: string): RouteWorkspaceApplyResult {
  return {
    ok: false,
    kind: "error",
    error: `unknown route '${route}'`,
    hint: "list the registered routes before addressing one.",
  };
}
