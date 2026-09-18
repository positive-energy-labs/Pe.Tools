import {
  instancesReading,
  scheduleReads,
  type ScheduleReadKey,
  actionControls,
  type ActionControlKey,
  semanticActions,
  familyReads,
  workKeySchema,
  type FamilyReadKey,
  actionBasesSchema,
  type SemanticActionKey,
} from "@pe/agent-contracts";
import {
  runSemanticAction,
  submitAction,
  readAction,
  readFamilyCapture,
  controlAction,
} from "../shared/takeoff-action-client.ts";
import { readScheduleCapture } from "../shared/schedule-client.ts";
/**
 * The three doors plus the one Scope door.
 *
 * `pe_find` ranks the one capability catalog (no query → the map plus the connected sessions).
 * `pe_read` runs any row with `mutates: false`. `pe_do` runs any row. Two runners rather than one
 * because approval is per tool category: `pe_read` is `read` and never prompts under the `ask`
 * access level, `pe_do` is `execute` and does. Op calls may override their target without changing
 * the Scope frozen into the turn at admission (`turnOf`), and every
 * result carries `revision` (the Scope revision it ran under) and `target` (what the host actually
 * resolved to), so the transcript card shows what was touched, not what was typed.
 */
import { createTool } from "@mastra/core/tools";
import z from "zod";
import {
  capabilityCatalogSchema,
  capabilityKindSchema,
  capabilityMap,
  capabilityNeedsSchema,
  documentRequestSchema,
  resolveCallTarget,
  addressSchema,
  findCapabilities,
  message,
  parsePodKey,
  parseRouteKey,
  scheduleGridRouteState,
  settingsRouteState,
  putTargetResultSchema,
  putTargetSchema,
  turnOf,
  type Capability,
  type CapabilityCatalog,
  type DocumentRequest,
  type TargetInventory,
  type DocumentRef,
} from "@pe/agent-contracts";
import { HostRpcCaller, type ResolvedTarget } from "../shared/host-rpc-caller.ts";
import { coerceJsonObject } from "../shared/coerce.ts";
import { resolveHostBaseUrl } from "../shared/host-config.ts";
import { bundledPeaSkills } from "./skills.ts";
import { ownedTurnDocuments } from "./owned-documents.ts";
export { ownedTurnDocuments } from "./owned-documents.ts";

type PeaProductToolContext = { hostBaseUrl?: string; workspaceKey?: string };
let productContext: PeaProductToolContext = {};
export function configurePeaProductToolContext(next: PeaProductToolContext): void {
  productContext = next;
}
function base(): string {
  return resolveHostBaseUrl(productContext.hostBaseUrl).replace(/\/$/, "");
}
export const peaHostBaseUrl = base;

/** The thread head's default Target request; null when the thread names no document. */
type Target = DocumentRequest | null;

/** The Address a Target names, or null for an exact open lifetime, which carries no Address. */
const targetAddress = (target: Target): string | null =>
  target?.kind === "named" ? target.address : null;

/**
 * The fallback when a receipt carries no resolved target: the document the Target names, and no
 * session, because a request is what was typed, never what answered.
 */
const namedTarget = (target: Target): ResolvedTarget => ({
  session: null,
  document: targetAddress(target),
});

/** The session a Target names, whichever shape it wears. */
const targetSession = (target: Target): string | undefined =>
  target ? (target.kind === "open" ? target.ref.session : target.session) : undefined;

/** The exact open lifetime a Target already names; a named request resolves per call instead. */
const targetDocument = (target: Target): DocumentRef | null =>
  target?.kind === "open" ? target.ref : null;

/** The turn's frozen default Target; a call outside a chat turn (CLI, MCP) runs with none. */
function targetOf(context: unknown): { target: Target; revision: number } {
  const turn = turnOf(context);
  return turn
    ? { target: turn.defaultTarget, revision: turn.revision }
    : { target: null, revision: 0 };
}

/** The Work key query a route or capability read runs under: `?target=<address>`, or none. */
const targetQuery = (target: Target): string => {
  const address = targetAddress(target);
  return address ? new URLSearchParams({ target: address }).toString() : "";
};

export const peFind = createTool({
  id: "pe_find",
  description:
    "Find a capability. No query returns the map: connected Revit sessions with their active document and custody, counts per kind, top rows per kind, and which sources answered. A query ranks rows across host operations (op:), the collaborative route documents you co-edit with the user and their commands (route:), pod buttons the user presses in Revit's Do palette (pod:), and skills (skill:). Filter with kind, needs, mutates. Every row is visible; nothing is tiered or hidden. Then pe_read a non-mutating row or pe_do any row.",
  inputSchema: z.object({
    query: z.string().optional().describe("Keywords describing what you need."),
    kind: capabilityKindSchema.optional(),
    needs: capabilityNeedsSchema.optional(),
    mutates: z.boolean().optional(),
    limit: z.number().int().min(1).max(50).default(8),
  }),
  execute: async (input, context) => {
    const { target, revision } = targetOf(context);
    const catalog = await readCatalog(
      target,
      undefined,
      target?.kind === "open" ? target.ref.session : undefined,
    );
    if ("isError" in catalog) return catalog;
    const filtered = input.query || input.kind || input.needs || input.mutates !== undefined;
    if (!filtered)
      return {
        at: catalog.at,
        target,
        revision,
        bridgeSessionId: catalog.bridgeSessionId,
        sessions: catalog.sessions,
        defaultDocument: targetDocument(target),
        sources: catalog.sources,
        map: capabilityMap(catalog.capabilities),
        hint: "Query pe_find for rows. pe_read runs a row that does not mutate; pe_do runs any row and is approval-gated. A session's custody says what the SDK will allow (observed = reads only). defaultDocument is the exact lifetime frozen for this turn. Op target overrides affect one call only. Session work requires an exact session ID; host work needs no document. target_set changes later turns.",
      };
    const rows = findCapabilities(catalog.capabilities, input);
    return {
      at: catalog.at,
      sources: catalog.sources,
      matches: rows.map((row) => ({
        key: row.key,
        kind: row.kind,
        title: row.title,
        description: row.description,
        needs: row.needs,
        mutates: row.mutates,
        actor: row.actor,
        input: row.input,
      })),
    };
  },
});

const runInputSchema = z.object({
  workspaceId: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe(
      "Work address: Pods uses the member's Work key; Schedules takes workspaceId from its schedule reading; Instances defaults to the shared instances workspace.",
    ),
  key: z.string().min(1).describe("A capability key from pe_find."),
  input: z.unknown().optional().describe("Matches the row's input schema."),
  target: z
    .union([z.string().min(1), documentRequestSchema])
    .optional()
    .describe(
      "Op calls only: exact session ID for session work, or an exact open/named document request. Overrides only this call; omission keeps the frozen turn default.",
    ),
  expectedRevision: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe(
      "Route rows only: the revision from the route read. Required for route:<name>.propose; a command omits it to run against the current revision.",
    ),
  timeoutSeconds: z.number().min(5).max(900).default(300),
});
type RunInput = z.infer<typeof runInputSchema>;

export const peRead = createTool({
  id: "pe_read",
  description:
    "Run one capability that does not mutate: an op: row with mutates false, a route: document read, or a skill: body. Refuses mutating rows with a hint to use pe_do. Split from pe_do so reads never wait on an approval prompt. Runs under this thread's Scope; the result names the revision and the resolved target.",
  inputSchema: runInputSchema,
  execute: (input, context) =>
    runCapability(input, context, (row) =>
      row.mutates ? `'${row.key}' mutates; run it with pe_do (approval-gated).` : null,
    ),
});

export const peDo = createTool({
  id: "pe_do",
  description:
    "Do one capability by key from pe_find. Approval-gated because it may mutate; use pe_read for rows that do not. Human-only rows refuse. Op calls accept an exact per-call target override; omission uses the frozen turn default. The result separately names Scope revision and actual target. For Takeoffs actions, retain input.actionId from the admitted result to recover the same attempt; never mint another ID after an uncertain outcome.",
  inputSchema: runInputSchema,
  execute: (input, context) => runCapability(input, context, () => null, true),
});

async function runCapability(
  input: RunInput,
  context: unknown,
  gate: (row: Capability) => string | null,
  replayOperations = false,
): Promise<Record<string, unknown>> {
  const admittedTurn = turnOf(context);
  if (admittedTurn) ownedTurnDocuments.startCall(admittedTurn.id);
  const { target: defaultTarget, revision } = targetOf(context);
  // A known operation attempt replays before catalog or target discovery.
  if (
    replayOperations &&
    (input.key.startsWith("op:") || input.key.startsWith("pod:")) &&
    !Object.hasOwn(actionControls, input.key.slice(3))
  ) {
    const id = requestIdentity(context);
    const original = await readAction(id, base()).catch(() => undefined);
    if (original) {
      let key = input.key.slice(3);
      let payload = coerceJsonObject(input.input) ?? {};
      if (input.key.startsWith("pod:")) {
        const pod = parsePodKey(input.key);
        const preparation =
          original.preparation.state === "ready"
            ? (original.preparation.value as {
                script?: { sourceBundle?: { files?: { path: string; bytesBase64: string }[] } };
              })
            : undefined;
        const encoded = preparation?.script?.sourceBundle?.files?.find(
          (file) => file.path === "pod.json",
        )?.bytesBase64;
        if (
          !pod ||
          !encoded ||
          original.kind !== "operation" ||
          original.key !== "scripting.execute"
        )
          throw Error("Original Pod admission cannot be identified");
        const manifest = JSON.parse(decodeCapturedManifest(encoded)) as {
          entrypoints: { id: string; sourcePath: string }[];
        };
        const source = manifest.entrypoints.find(
          (entry) => entry.id === pod.entrypoint,
        )?.sourcePath;
        if (
          pod.workspace !== original.request.workspaceKey ||
          source?.replaceAll("\\", "/").trim().toLowerCase() !==
            String(original.request.sourcePath).replaceAll("\\", "/").trim().toLowerCase()
        )
          throw Error("Original Pod entrypoint conflicts");
        key = "scripting.execute";
        payload = {
          ...payload,
          workspaceKey: pod.workspace,
          sourcePath: original.request.sourcePath,
        };
      }
      const requested = input.target;
      const target =
        typeof requested === "object" && requested?.kind === "open" ? requested.ref : undefined;
      const caller = new HostRpcCaller({
        hostBaseUrl: base(),
        actor: "agent",
        requestId: id,
        bridgeSessionId: target?.session ?? (typeof requested === "string" ? requested : undefined),
        openDocumentId: target?.openId,
        timeoutMs: input.timeoutSeconds * 1000,
      });
      const result = await caller.callOperation(key, payload);
      return { ok: result.ok, key: input.key, target: defaultTarget, revision, result };
    }
  }
  const overrideSession =
    typeof input.target === "string"
      ? input.target
      : input.target?.kind === "open"
        ? input.target.ref.session
        : input.target?.session;
  const catalog = await readCatalog(
    defaultTarget,
    undefined,
    overrideSession ?? targetSession(defaultTarget),
  );
  if ("isError" in catalog) return catalog;
  const row = catalog.capabilities.find((candidate) => candidate.key === input.key);
  if (!row)
    return refuse(
      input.key,
      defaultTarget,
      revision,
      `Unknown capability '${input.key}'. Find keys with pe_find.`,
    );
  if (row.actor === "human")
    return refuse(
      row.key,
      defaultTarget,
      revision,
      `'${row.key}' is human-only. Ask the user to press it in the ${row.title.split(":")[0]} workspace.`,
    );
  const refusal = gate(row);
  if (refusal) return refuse(row.key, defaultTarget, revision, refusal);
  if (input.target !== undefined && row.kind !== "op" && row.kind !== "pod")
    return refuse(
      row.key,
      defaultTarget,
      revision,
      "Target overrides are supported by op: capabilities only.",
    );
  try {
    const outcome = await dispatch(
      row,
      input,
      defaultTarget,
      requestIdentity(context),
      turnOf(context)?.id,
    );
    const turn = turnOf(context);
    const cleanup = !outcome.ok && turn ? await ownedTurnDocuments.releaseCurrent(turn.id) : [];
    return {
      key: row.key,
      kind: row.kind,
      revision,
      ...outcome,
      ...(cleanup.length ? { cleanup } : {}),
    };
  } catch (error) {
    const turn = turnOf(context);
    const cleanup = turn ? await ownedTurnDocuments.releaseCurrent(turn.id) : [];
    return { ...refuse(row.key, defaultTarget, revision, message(error)), cleanup };
  }
}

type Outcome = { ok: boolean; target: ResolvedTarget; result: unknown; elapsedMs?: number };

async function dispatch(
  row: Capability,
  input: RunInput,
  defaultTarget: Target,
  requestId: string,
  turnId?: string,
): Promise<Outcome> {
  const coerced = coerceJsonObject(input.input);
  const payload: Record<string, unknown> =
    coerced && typeof coerced === "object" ? (coerced as Record<string, unknown>) : {};
  const scopeTarget = namedTarget(defaultTarget);
  switch (row.kind) {
    case "op": {
      const target = await operationTarget(row, input.target, defaultTarget);
      const caller = new HostRpcCaller({
        hostBaseUrl: base(),
        ...target,
        requestId: row.mutates ? requestId : undefined,
        actor: "agent",
        timeoutMs: input.timeoutSeconds * 1000,
      });
      const key = row.key.replace(/^(op|workflow):/, "");
      if (key === "instances.read") {
        const reading = instancesReading.input.parse(payload);
        const query = new URLSearchParams(
          Object.entries(reading)
            .filter(([, value]) => value !== undefined)
            .map(([key, value]) => [key, String(value)]),
        );
        const response = await fetch(`${base()}/instances/readings?${query}`, {
          signal: AbortSignal.timeout(input.timeoutSeconds * 1000),
        });
        if (!response.ok) throw Error(await response.text());
        return {
          ok: true,
          target: { session: null, document: null },
          result: await response.json(),
        };
      }
      if (Object.hasOwn(actionControls, key)) {
        if (key === "action.resume") {
          const original = await controlAction("action.read", payload, base());
          if (
            original.kind === "workflow" &&
            Object.hasOwn(semanticActions, original.key) &&
            semanticActions[original.key as SemanticActionKey].actor === "human"
          )
            throw Error("This original action requires human approval to resume");
        }
        const result = await controlAction(key as ActionControlKey, payload, base(), "agent");
        return { ok: true, target: { session: null, document: null }, result };
      }
      if (row.key.startsWith("workflow:")) {
        if (
          semanticActions[key as SemanticActionKey].needs !== "nothing" &&
          (!target.bridgeSessionId || !target.openDocumentId)
        )
          throw Error("Semantic action requires the exact selected lifetime");
        const { bases, actionId, ...intent } = payload;
        const row = await runSemanticAction(
          key as SemanticActionKey,
          intent,
          target.bridgeSessionId && target.openDocumentId
            ? { session: target.bridgeSessionId, openId: target.openDocumentId }
            : undefined,
          actionBasesSchema.parse(bases ?? {}),
          "agent",
          base(),
          typeof actionId === "string" ? actionId : requestId,
          input.timeoutSeconds * 1000,
        );
        return {
          ok: row.state === "succeeded" || row.state === "detached",
          target: { session: target.bridgeSessionId ?? null, document: null },
          result: row,
        };
      }
      if (Object.hasOwn(scheduleReads, key)) {
        const { scope: _scope, ...input } = payload;
        const result = await readScheduleCapture(
          key as ScheduleReadKey,
          input,
          target.bridgeSessionId && target.openDocumentId
            ? { session: target.bridgeSessionId, openId: target.openDocumentId }
            : undefined,
          base(),
        );
        return {
          ok: true,
          target: { session: target.bridgeSessionId ?? null, document: null },
          result,
        };
      }
      if (Object.hasOwn(familyReads, key)) {
        const { scope: readScope, ...input } = payload;
        const result = await readFamilyCapture(
          key as FamilyReadKey,
          input,
          workKeySchema.parse(readScope),
          target.bridgeSessionId && target.openDocumentId
            ? { session: target.bridgeSessionId, openId: target.openDocumentId }
            : undefined,
          base(),
        );
        return {
          ok: true,
          target: { session: target.bridgeSessionId ?? null, document: null },
          result,
        };
      }
      const call = () => caller.callOperation(key, payload, "compact");
      let result: Awaited<ReturnType<typeof call>>;
      if (key === "family.temporary.acquire") {
        if (!turnId) throw new Error("Adaptive temporary acquisition requires an admitted turn.");
        const acquisitionId = z.uuid().parse(payload.acquisitionId);
        const releaseId = crypto.randomUUID();
        result = (await ownedTurnDocuments.acquire(
          turnId,
          acquisitionId,
          call,
          async () => {
            if (!target.bridgeSessionId)
              throw Error("Original temporary-document session is unavailable");
            const released = await submitAction(
              {
                id: releaseId,
                kind: "operation",
                key: "document.temporary.release",
                actor: "agent",
                input: { acquisitionId, releaseId },
                bases: {},
                destination: { kind: "session", session: target.bridgeSessionId },
              },
              base(),
              30_000,
            );
            return released.state === "succeeded"
              ? released.result
              : { status: "recovery-required", receipt: released };
          },
          JSON.stringify([target, payload]),
          { session: target.bridgeSessionId, releaseId },
        )) as Awaited<ReturnType<typeof call>>;
      } else result = await call();
      return {
        ok: result.ok,
        target:
          result.ok && result.resolvedTarget
            ? result.resolvedTarget
            : {
                session: target.bridgeSessionId ?? null,
                document: null,
              },
        result: result.action ? result : result.ok ? result.response : result,
        elapsedMs: result.elapsedMs,
      };
    }
    case "skill": {
      const skill = bundledPeaSkills.find((entry) => `skill:${entry.name}` === row.key);
      return { ok: true, target: scopeTarget, result: skill?.content ?? "" };
    }
    case "pod": {
      const pod = parsePodKey(row.key);
      if (!pod) throw new Error(`Malformed pod key '${row.key}'.`);
      const selector =
        typeof input.target === "string"
          ? input.target
          : input.target?.kind === "open"
            ? input.target.ref.session
            : (input.target?.session ?? targetSession(defaultTarget));
      const definition = await new HostRpcCaller({
        hostBaseUrl: base(),
        bridgeSessionId: selector,
      }).getOperation("scripting.execute");
      if (!definition) throw Error("Public scripting operation metadata unavailable");
      const target = await operationTarget(
        { ...row, needs: definition.needs === "nothing" ? "session" : definition.needs! },
        input.target,
        defaultTarget,
      );
      const caller = new HostRpcCaller({
        hostBaseUrl: base(),
        ...target,
        requestId: row.mutates ? requestId : undefined,
        actor: "agent",
        timeoutMs: input.timeoutSeconds * 1000,
      });
      const pods = await caller.call("pod.list");
      const sourcePath = pods.pods
        .find((value) => value.folder === pod.workspace)
        ?.entrypoints.find((entry) => entry.id === pod.entrypoint)?.sourcePath;
      if (!sourcePath) throw Error("Declared Pod entrypoint unavailable");
      const result = await caller.callOperation("scripting.execute", {
        ...payload,
        workspaceKey: pod.workspace,
        sourcePath,
      });
      return {
        ok: result.ok,
        target: { session: target.bridgeSessionId ?? null, document: null },
        result,
      };
    }
    case "route-doc":
    case "route-command": {
      const parsed = parseRouteKey(row.key);
      if (!parsed) throw new Error(`Malformed route key '${row.key}'.`);
      if (parsed.route === scheduleGridRouteState.route && !input.workspaceId)
        throw new Error(
          "Read op:schedule.grid.snapshot and pass its workspaceId for subject Work.",
        );
      if (parsed.route === settingsRouteState.route && !input.workspaceId)
        throw new Error(
          "Supply workspaceId for the member's Work, then open it with { member: { pod, path } }.",
        );
      if (
        input.workspaceId &&
        ![settingsRouteState.route, scheduleGridRouteState.route, "instances"].includes(
          parsed.route,
        )
      )
        throw new Error("workspaceId targets Pods, Schedules, or Instances Work only.");
      const workspaceId =
        parsed.route === "instances" ? (input.workspaceId ?? "instances") : input.workspaceId;
      if (parsed.member === undefined) {
        const result = await routeFetch(
          `/pe/route-state/${encodeURIComponent(parsed.route)}?${workspaceId ? new URLSearchParams({ work: workspaceId }).toString() : targetQuery(defaultTarget)}`,
        );
        return {
          ok: !("isError" in result),
          target: workspaceId ? { session: null, document: null } : scopeTarget,
          result,
        };
      }
      if (row.kind === "route-doc") {
        if (input.expectedRevision === undefined)
          throw new Error(`Read route:${parsed.route} first and pass its expectedRevision.`);
        return routeWrite(
          parsed.route,
          "apply",
          defaultTarget,
          input.expectedRevision,
          {
            patches: payload.patches,
          },
          workspaceId,
        );
      }
      return routeWrite(
        parsed.route,
        "command",
        defaultTarget,
        input.expectedRevision,
        {
          command: parsed.member,
          input: payload,
        },
        parsed.route === "instances" ? (input.workspaceId ?? "instances") : input.workspaceId,
      );
    }
  }
}

async function operationTarget(
  row: Capability,
  override: RunInput["target"],
  defaultTarget: Target,
) {
  if (row.needs === "nothing") {
    if (override !== undefined) throw Error("This capability needs no Revit target.");
    return {};
  }
  const { sessions } = await new HostRpcCaller({ hostBaseUrl: base(), timeoutMs: 30_000 }).call(
    "bridge.sessions.list",
  );
  const inventory: TargetInventory = {
    kind: "ready",
    sessions: Object.fromEntries(
      sessions.map((session) => [
        session.sessionId,
        !session.connected || !session.openDocuments
          ? { kind: "checking" as const }
          : {
              kind: "ready" as const,
              values: session.openDocuments.map((doc) => ({
                openId: doc.openId,
                address: addressSchema.safeParse(doc.address).data ?? null,
                kind: doc.isFamilyDocument ? ("family" as const) : ("project" as const),
              })),
            },
      ]),
    ),
  };
  if (row.needs === "session" && typeof override !== "string")
    throw Error("A session capability requires an explicit exact session ID.");
  if (row.needs !== "session" && typeof override === "string")
    throw Error("A document capability requires an open or named document request.");
  const resolution = resolveCallTarget(
    row.needs === "session"
      ? { needs: "session", target: override as string }
      : { needs: row.needs, target: typeof override === "object" ? override : undefined },
    defaultTarget,
    inventory,
  );
  if (resolution.kind !== "resolved")
    throw Error(
      `Target ${resolution.kind}: ${"reason" in resolution ? resolution.reason : "message" in resolution ? resolution.message : "inventory pending"}`,
    );
  const target = resolution.target;
  return target.kind === "document"
    ? { bridgeSessionId: target.ref.session, openDocumentId: target.ref.openId }
    : target.kind === "session"
      ? { bridgeSessionId: target.session }
      : {};
}

/** A route write under the Target. A command with no expectedRevision runs against the current one. */
async function routeWrite(
  route: string,
  suffix: "apply" | "command",
  defaultTarget: Target,
  expectedRevision: number | undefined,
  body: Record<string, unknown>,
  workspaceId?: string,
): Promise<Outcome> {
  const query = workspaceId
    ? new URLSearchParams({ work: workspaceId }).toString()
    : targetQuery(defaultTarget);
  const encoded = encodeURIComponent(route);
  const revision =
    expectedRevision ??
    (await routeFetch(`/pe/route-state/${encoded}?${query}`).then((view) =>
      typeof view.revision === "number" ? view.revision : 0,
    ));
  const result = await routeFetch(`/pe/agent/route-state/${encoded}/${suffix}?${query}`, {
    ...body,
    expectedRevision: revision,
  });
  // A command whose receipt names the target it resolved to (instances, pods) wins over the Target.
  const receipt = (result.result ?? result) as { target?: unknown };
  const target = receipt && typeof receipt === "object" ? parseTarget(receipt.target) : null;
  return {
    ok: !("isError" in result),
    target: workspaceId
      ? { session: null, document: null }
      : (target ?? namedTarget(defaultTarget)),
    result,
  };
}

function parseTarget(value: unknown): ResolvedTarget | null {
  if (!value || typeof value !== "object") return null;
  const record = value as { session?: unknown; document?: unknown };
  return {
    session: typeof record.session === "string" ? record.session.replace(/^session:/, "") : null,
    document: typeof record.document === "string" ? record.document : null,
  };
}

async function routeFetch(path: string, body?: unknown): Promise<Record<string, unknown>> {
  const response = await fetch(
    `${base()}${path}`,
    body === undefined
      ? undefined
      : {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok || payload.ok === false) {
    const hint = payload.hint ?? payload.error;
    return {
      isError: true,
      content: typeof hint === "string" ? hint : `request failed (${response.status})`,
      ...payload,
    };
  }
  return payload;
}

/** The one capability read: `GET /pe/capabilities`. Shared by the three doors and `pea host operations`. */
export async function readCatalog(
  target: Target = null,
  hostBaseUrl?: string,
  session?: string,
): Promise<CapabilityCatalog | { isError: true; content: string }> {
  let url = hostBaseUrl;
  try {
    url ??= base();
    const query = session ? new URLSearchParams({ session }).toString() : targetQuery(target);
    const response = await fetch(`${url}/pe/capabilities?${query}`);
    const parsed = capabilityCatalogSchema.safeParse(await response.json());
    if (!response.ok || !parsed.success)
      return { isError: true, content: `GET ${url}/pe/capabilities failed (${response.status}).` };
    return parsed.data;
  } catch (error) {
    return {
      isError: true,
      content: `Couldn't reach the host at ${url ?? "(unresolved)"} (${message(error)}). Is the host running?`,
    };
  }
}

/** A refusal still names the revision and the document it refused under, so the head can show it. */
function refuse(key: string, defaultTarget: Target, revision: number, content: string) {
  return { isError: true, ok: false, key, content, revision, target: namedTarget(defaultTarget) };
}

function requestIdentity(context: unknown): string {
  const record = context as {
    agent?: { toolCallId?: string };
    mcp?: { extra?: { requestId?: string | number } };
  };
  const agentId = record.agent?.toolCallId?.trim();
  if (agentId) return agentId;
  const mcpId = record.mcp?.extra?.requestId;
  if (mcpId !== undefined && String(mcpId).trim()) return String(mcpId);
  return crypto.randomUUID();
}

export const targetSet = createTool({
  id: "target_set",
  description:
    "Propose the default Target for later turns. Name an exact open document (kind open, with its session and openId) or a saved document Address plus the session holding it (kind named). null removes the document default. Every call resolves this default against the live inventory, so closing or reopening a document never silently redirects a call. Host work needs no document; session operations take an explicit session target. Use an op target override for a document detour within this turn. The new revision applies on the next turn.",
  inputSchema: z.object({ defaultTarget: documentRequestSchema.nullable() }),
  execute: async (input, context) => {
    const turn = turnOf(context);
    if (!turn) return { isError: true, content: "target_set needs a chat turn; none is admitted." };
    const body = putTargetSchema.parse({
      defaultTarget: input.defaultTarget,
      expectedRevision: turn.revision,
      turn: turn.id,
    });
    const response = await fetch(`${base()}/pe/scope/${encodeURIComponent(turn.thread)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = putTargetResultSchema.safeParse(await response.json().catch(() => null)).data;
    if (!result) return { isError: true, content: `target set failed (${response.status})` };
    if (!result.ok)
      return {
        isError: true,
        content:
          result.why === "stale"
            ? `The thread head is at revision ${result.head.revision}, not ${turn.revision}; it changed under you.`
            : "Another turn holds the thread head; wait for it to end.",
      };
    return {
      head: result.head,
      note: `This turn keeps revision ${turn.revision}; the next turn runs under the new Target.`,
    };
  },
});

// File.ReadAllText/StreamReader BOM rules also apply when identifying a sealed Pod receipt.
function decodeCapturedManifest(encoded: string): string {
  const bytes = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
  const view = new DataView(bytes.buffer);
  const bom = bytes.length >= 4 ? view.getUint32(0) : 0;
  if (bom === 0xfffe0000 || bom === 0x0000feff) {
    if (bytes.length % 4) throw Error("Invalid captured UTF-32 manifest");
    const text: string[] = [];
    for (let i = 4; i < bytes.length; i += 4) {
      const code = view.getUint32(i, bom === 0xfffe0000);
      text.push(
        String.fromCodePoint(
          code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? code : 0xfffd,
        ),
      );
    }
    return text.join("");
  }
  const encoding =
    bytes[0] === 0xff && bytes[1] === 0xfe
      ? "utf-16le"
      : bytes[0] === 0xfe && bytes[1] === 0xff
        ? "utf-16be"
        : "utf-8";
  return new TextDecoder(encoding).decode(bytes);
}
