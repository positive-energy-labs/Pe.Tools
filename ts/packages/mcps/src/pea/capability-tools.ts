import type { HostSessionScope } from "@pe/host-contracts/operation-types";
import {
  carriesCallerContext,
  contextFetch as fetch,
  invocationContext,
} from "#invocation-context";
import {
  sdkSessionSelectionSchema,
  instancesReading,
  scheduleReads,
  type ScheduleReadKey,
  actionControls,
  semanticActions,
  familyReads,
  familiesRouteState,
  familyCatalogRequest,
  workKeySchema,
  type FamilyReadKey,
  actionBasesSchema,
  refusalSchema,
  type SemanticActionKey,
  type ActionReceipt,
} from "@pe/agent-contracts";
import {
  type DetachedAction,
  readAction,
  readFamilyCapture,
} from "../shared/takeoff-action-client.ts";
import { runCapability } from "../shared/admission.ts";
import { readScheduleCapture } from "../shared/schedule-client.ts";
/**
 * The three doors plus the one Scope door.
 *
 * `pe_find` ranks the one capability catalog (no query → the map plus the connected sessions).
 * `pe_read` runs any row with `mutates: false`. `pe_do` runs any row. Two runners rather than one
 * so reads run freely and writes cross the host's grant check. Op calls may override their target without changing
 * the thread head's default Target, and every result carries `revision` (the Scope revision it ran under) and `target` (what the host actually
 * resolved to), so the transcript card shows what was touched, not what was typed.
 */
import { createTool } from "../shared/tool.ts";
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
  mentionOf,
  message,
  parsePodKey,
  parseRouteKey,
  scheduleGridRouteState,
  settingsRouteState,
  putTargetResultSchema,
  putTargetSchema,
  threadHeadSchema,
  pageChoiceSchema,
  type Capability,
  type CapabilityCatalog,
  type DocumentRequest,
  type TargetInventory,
  type DocumentRef,
  type ThreadHead,
} from "@pe/agent-contracts";
import { HostRpcCaller, type ResolvedTarget } from "../shared/host-rpc-caller.ts";
import type { RevitCatalogLoadedFamilies } from "@pe/host-contracts/generated";
import { coerceJsonObject } from "../shared/coerce.ts";
import { resolveHostBaseUrl } from "../shared/host-config.ts";
import { bundledPeaSkills } from "./skills.ts";

function base(): string {
  // Hosted tools inherit the authority already admitted by the host middleware.
  return (invocationContext()?.hostBaseUrl ?? resolveHostBaseUrl()).replace(/\/$/, "");
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

/** A thread's head as a tool reads it. */
export type Scope = ThreadHead & { thread: string };

/** The live head of this caller's own thread (`/pe/scope/self`); none outside a harness context. */
export async function scopeOf(): Promise<Scope | null> {
  if (invocationContext()?.caller?.kind === "external-mcp") return null;
  if (!carriesCallerContext()) return null;
  const response = await fetch(`${base()}/pe/scope/self`);
  if (response.status === 404) return null;
  const body = (await response.json()) as { thread?: unknown };
  if (typeof body.thread !== "string") return null;
  return { thread: body.thread, ...threadHeadSchema.parse(body) };
}

/** The Scope's default Target; a call with no Scope runs with none. */
async function targetOf(): Promise<{ target: Target; revision: number }> {
  const turn = await scopeOf();
  return turn
    ? { target: turn.defaultTarget, revision: turn.revision }
    : { target: null, revision: 0 };
}

/** The Work key query a route or capability read runs under: `?target=<address>`, or none. */
const targetQuery = (target: Target): string => {
  const address = targetAddress(target);
  return address ? new URLSearchParams({ target: address }).toString() : "";
};

/**
 * The route Work a Target keys: its document's Address, as the browser resolves it. Work keys by
 * Address, so an exact `open` Target is resolved through the live inventory; dropping it read the
 * Target-less Work instead of the Chat's (E2E-J1). A closed document refuses rather than fall back.
 */
async function routeWorkScope(target: Target): Promise<{ query: string; target: ResolvedTarget }> {
  if (target?.kind !== "open") return { query: targetQuery(target), target: namedTarget(target) };
  const { sessions } = await new HostRpcCaller({ hostBaseUrl: base(), timeoutMs: 30_000 }).call(
    "bridge.sessions.list",
  );
  const document = sessions
    .find((session) => session.sessionId === target.ref.session)
    ?.openDocuments?.find((doc) => doc.openId === target.ref.openId);
  const address = addressSchema.safeParse(document?.address).data;
  if (!address)
    throw Error(
      "The Chat's document is no longer open, so its route Work has no Address to read; ask the person to pick the document again.",
    );
  return {
    query: new URLSearchParams({ target: address }).toString(),
    target: { session: target.ref.session, document: address },
  };
}

export const peFind = createTool({
  id: "pe_find",
  description:
    "Find a capability. No query returns the map: connected Revit sessions with their active document and custody, counts per kind, top rows per kind, and which sources answered. A query ranks rows across host operations (op:), the collaborative route documents you co-edit with the user and their commands (route:), pod buttons the user presses in Revit's Do palette (pod:), skills (skill:), documents open in Revit (doc:<session>/<openId>, the same pointer the user @-mentions), and Revit's recent documents, not open (recent:<path> or recent:cloud:<region>/<project>/<model>). Filter with kind, needs, mutates. Every row you may run is visible; nothing is tiered, and human-only rows (the person's presses) are not offered. Then pe_read a non-mutating row or pe_do any row.",
  inputSchema: z.object({
    query: z.string().optional().describe("Keywords describing what you need."),
    kind: capabilityKindSchema.optional(),
    needs: capabilityNeedsSchema.optional(),
    mutates: z.boolean().optional(),
    limit: z.number().int().min(1).max(50).default(8),
  }),
  execute: async (input) => {
    const { target, revision } = await targetOf();
    const catalog = await readCatalog(target, undefined, {
      bridgeSessionId: targetSession(target),
    });
    if ("isError" in catalog) return catalog;
    // A human-only row is the person's press, never Pea's move: it is not offered at all.
    const offered = catalog.capabilities.filter((row) => row.actor !== "human");
    const filtered = input.query || input.kind || input.needs || input.mutates !== undefined;
    if (!filtered)
      return {
        at: catalog.at,
        target,
        revision,
        bridgeSessionId: catalog.bridgeSessionId,
        machine: catalog.machine,
        defaultDocument: targetDocument(target),
        sources: catalog.sources,
        map: capabilityMap(offered),
        hint: "Query pe_find for rows. pe_read runs a row that does not mutate; pe_do runs authorized actions through the host grant check. Reads need no grant. Writes target Pea's own lifetimes or the granted head; external MCP clients cannot hold rw in this release. defaultDocument is read live per call. Op target overrides affect one call only. Session work accepts SDK id-or-pid selection; host work needs no document. target_set selects only Pea's own documents for later calls.",
      };
    const rows = findCapabilities(offered, input);
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
      "Work address: Pods uses the member's Work key; Schedules takes workspaceId from its schedule reading.",
    ),
  key: z.string().min(1).describe("A capability key from pe_find."),
  input: z.unknown().optional().describe("Matches the row's input schema."),
  target: z
    .union([sdkSessionSelectionSchema, documentRequestSchema.options[0]])
    .optional()
    .describe(
      "Op calls only: SDK selection {id: name} or {pid: number} for session work, or {kind: open, ref: {session, openId}} for an exact product document. Overrides only this call; omission follows the live thread head. Reads need no grant; writes target only Pea's own lifetimes or the granted head.",
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
    "Run one capability that does not mutate: an op: row with mutates false, a route: document read, a skill: body, or a doc: row's mention (its session, openId, address and custody, read now), or a recent: row's mention (its path, year and the openWith source that opens it). Refuses mutating rows with a hint to use pe_do. Split from pe_do so reads never wait on an approval prompt. Runs under this thread's Scope; the result names the revision and the resolved target.",
  inputSchema: runInputSchema,
  execute: (input, context) =>
    executeTool(input, context, (row) =>
      row.mutates ? `'${row.key}' mutates; run it with pe_do under the host grant check.` : null,
    ),
});

export const peDo = createTool({
  id: "pe_do",
  description:
    "Do one authorized capability by key from pe_find. The host admits writes only to Pea's own lifetimes or the granted head; external MCP clients can read any document and write Pea's own, but cannot hold rw in this release. Use pe_read for rows that do not mutate. Human-only rows refuse. Op calls accept an exact per-call target override; omission follows the live thread head. The result separately names Scope revision and actual target. For Takeoffs actions, retain input.actionId from the first result to recover the same attempt; never mint another ID after an uncertain outcome.",
  inputSchema: runInputSchema,
  execute: (input, context) =>
    executeTool(
      input,
      context,
      (row) =>
        row.kind === "document"
          ? `'${row.key}' is a document, a pointer and not an action; pass its session and openId to an op as target {kind: open, ref: {session, openId}}.`
          : row.kind === "recent"
            ? `'${row.key}' is a recent document, a pointer and not an action; open it first: pe_read it for openWith, then open it with pe_do workflow:instances.open, input {source: <openWith>, into: {session: {id}} or {start: {year, owner: pea, addins: on}}}.`
            : null,
      true,
    ),
});

async function executeTool(
  input: RunInput,
  context: unknown,
  gate: (row: Capability) => string | null,
  replayOperations = false,
): Promise<Record<string, unknown>> {
  const scope = await scopeOf();
  const { target: defaultTarget, revision } = scope
    ? { target: scope.defaultTarget, revision: scope.revision }
    : { target: null, revision: 0 };
  if (input.key.startsWith("page:")) {
    const page =
      /^page:@(?:pages\/([a-zA-Z0-9_-]+)|([a-zA-Z0-9_-]+)\/pages\/([a-zA-Z0-9_-]+))$/.exec(
        input.key,
      );
    if (!page || input.target)
      return refuse(
        input.key,
        defaultTarget,
        revision,
        "A Page key is page:@pages/<slug> or page:@<pod>/pages/<page>; its shelf takes no Revit target override.",
      );
    const slug = page[1] ?? `${page[2]}--${page[3]}`;
    const read = async (path: string, init?: RequestInit) => {
      const response = await fetch(`${base()}${path}`, init);
      return { ok: response.ok, result: await response.json() };
    };
    if (!replayOperations) {
      if (input.input)
        return refuse(
          input.key,
          defaultTarget,
          revision,
          "pe_read reads a Page; use pe_do for an event or binding.",
        );
      const [state, target] = await Promise.all([
        read(`/pages/${slug}/state`),
        read(`/pages/${slug}/target`),
      ]);
      return {
        ok: state.ok && target.ok,
        key: input.key,
        revision,
        result: { state: state.result, target: target.result },
      };
    }
    const action = z
      .union([
        z.strictObject({ binding: pageChoiceSchema }),
        z.strictObject({ event: z.record(z.string(), z.unknown()) }),
      ])
      .parse(coerceJsonObject(input.input));
    const binding = "binding" in action;
    const answer = await read(binding ? `/pe/pages/${slug}/binding` : `/pages/${slug}/events`, {
      method: binding ? "PUT" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(binding ? action.binding : action.event),
    });
    return { ...answer, key: input.key, revision };
  }
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
      const caller = new HostRpcCaller({
        hostBaseUrl: base(),
        requestId: id,
        ...transportScope(requested),
        timeoutMs: input.timeoutSeconds * 1000,
      });
      const result = await caller.callOperation(key, payload);
      return { ok: result.ok, key: input.key, target: defaultTarget, revision, result };
    }
  }
  const catalog = await readCatalog(
    defaultTarget,
    undefined,
    transportScope(input.target, defaultTarget),
  );
  if ("isError" in catalog) return catalog;
  const row = catalog.capabilities.find((candidate) => candidate.key === input.key);
  // TODO: with no Target, a row that needs a document is absent from the catalog and refuses as
  // "Unknown capability" instead of "no document" (ACP spike 2026-09-26, REPORT2.md reduced run).
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
  // TODO: a temporary document needs an owner that releases it when the harness turn ends.
  if (row.key === "op:family.temporary.acquire")
    return refuse(
      row.key,
      defaultTarget,
      revision,
      "family.temporary.acquire has no turn-owned release on the harness lane.",
    );
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
      scope?.thread,
      catalog,
    );
    return { key: row.key, kind: row.kind, revision, ...outcome };
  } catch (error) {
    const refusal = refusalSchema.safeParse((error as { refusal?: unknown } | null)?.refusal).data;
    if (refusal)
      return { ...refuse(row.key, defaultTarget, revision, JSON.stringify({ refusal })), refusal };
    return refuse(row.key, defaultTarget, revision, message(error));
  }
}

type Outcome = { ok: boolean; target: ResolvedTarget; result: unknown; elapsedMs?: number };

async function dispatch(
  row: Capability,
  input: RunInput,
  defaultTarget: Target,
  requestId: string,
  viewThread?: string,
  catalog?: CapabilityCatalog,
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
        timeoutMs: input.timeoutSeconds * 1000,
      });
      const key = row.key.replace(/^(op|workflow):/, "");
      if (key === "instances.read") {
        const reading = instancesReading.input.parse(payload);
        const query = new URLSearchParams(
          Object.entries(reading)
            .filter(([, value]) => value !== undefined)
            .map(([key, value]) => [
              key,
              typeof value === "object" ? JSON.stringify(value) : String(value),
            ]),
        );
        const response = await fetch(`${base()}/instances/readings?${query.toString()}`, {
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
        const result = await runCapability(key, payload, { hostBaseUrl: base() });
        return { ok: true, target: { session: null, document: null }, result };
      }
      if (row.key.startsWith("workflow:")) {
        const { bases, actionId, ...intent } = payload;
        const row = (await runCapability(
          key,
          intent,
          {
            hostBaseUrl: base(),
            ...target,
            bases: actionBasesSchema.parse(bases ?? {}),
            actionId: typeof actionId === "string" ? actionId : requestId,
            timeoutMs: input.timeoutSeconds * 1000,
            receipt: true,
          },
          {
            kind: "workflow",
            needs: semanticActions[key as SemanticActionKey].needs,
            mutates: true,
          },
        )) as ActionReceipt | DetachedAction;
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

      const result = await call();
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
    case "document":
    case "recent": {
      // Reading a document pointer is its mention: the facts a first hop needs, read now.
      if (!catalog) throw Error("A document row needs the catalog it was read from.");
      return { ok: true, target: scopeTarget, result: mentionOf(row, catalog) };
    }
    case "skill": {
      const skill = bundledPeaSkills.find((entry) => `skill:${entry.name}` === row.key);
      return { ok: true, target: scopeTarget, result: skill?.content ?? "" };
    }
    case "pod": {
      const pod = parsePodKey(row.key);
      if (!pod) throw new Error(`Malformed pod key '${row.key}'.`);
      const definition = await new HostRpcCaller({
        hostBaseUrl: base(),
        ...transportScope(input.target, defaultTarget),
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
      if (row.key === "route:families.view" || row.key === "route:families.set-query") {
        if (!viewThread) throw Error("This MCP server has no thread (no harness context).");
        const query = new URLSearchParams({ thread: viewThread });
        if (row.key === "route:families.view" && typeof payload.instance === "string")
          query.set("instance", payload.instance);
        const response = await fetch(
          `${base()}/pe/route-view/families${row.key.endsWith(".view") ? `?${query.toString()}` : "/set-query"}`,
          row.key.endsWith(".view")
            ? undefined
            : {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ ...payload, thread: viewThread }),
              },
        );
        const result = (await response.json()) as Record<string, unknown>;
        if (
          row.key === "route:families.view" &&
          response.ok &&
          typeof result.readingId === "string"
        ) {
          const reference = await fetch(
            `${base()}/families/readings?id=${encodeURIComponent(result.readingId)}&format=reference`,
          );
          if (reference.ok) {
            const reading = (await reference.json()) as Record<string, unknown>;
            const absolute = (entry: unknown) => {
              if (
                entry &&
                typeof entry === "object" &&
                typeof (entry as { url?: unknown }).url === "string"
              )
                (entry as { url: string }).url = new URL(
                  (entry as { url: string }).url,
                  base(),
                ).toString();
            };
            absolute(reading.artifact);
            absolute((reading.apsParametersCache as { artifact?: unknown } | undefined)?.artifact);
            result.reading = reading;
          } else
            result.readingError = `Retained reading reference unavailable (${reference.status})`;
        }
        const observed = result.document as { session?: unknown } | undefined;
        const work = result.work as { binding?: unknown; target?: unknown } | undefined;
        return {
          ok: response.ok,
          target: {
            session: typeof observed?.session === "string" ? observed.session : null,
            document:
              work?.binding === "address" && typeof work.target === "string" ? work.target : null,
          },
          result,
        };
      }
      const parsed = parseRouteKey(row.key);
      if (!parsed) throw new Error(`Malformed route key '${row.key}'.`);
      if (parsed.route === scheduleGridRouteState.route && !input.workspaceId)
        throw new Error(
          "Read op:schedule.grid.snapshot and pass its workspaceId for subject Work.",
        );
      if (parsed.route === settingsRouteState.route && !input.workspaceId)
        throw new Error(
          "Use op:pod.list to find members and supply workspaceId for the member's Work opened by the editor.",
        );
      if (
        input.workspaceId &&
        ![settingsRouteState.route, scheduleGridRouteState.route].includes(parsed.route)
      )
        throw new Error("workspaceId targets Pods or Schedules Work only.");
      const workspaceId = input.workspaceId;
      if (parsed.member === undefined) {
        const scope = workspaceId
          ? {
              query: new URLSearchParams({ work: workspaceId }).toString(),
              target: { session: null, document: null },
            }
          : await routeWorkScope(defaultTarget);
        const result = await routeFetch(
          `/pe/route-state/${encodeURIComponent(parsed.route)}?${scope.query}`,
        );
        if (parsed.route === familiesRouteState.route && !("isError" in result))
          result.hint =
            "This is authored Work. Read route:families.view for the currently visible matrix or archived reading; no matrix read is started.";
        // ponytail: families is the only route keyed by loaded Revit types; generalize when a second route needs it
        if (parsed.route !== familiesRouteState.route || "isError" in result)
          return { ok: !("isError" in result), target: scope.target, result };
        const document = familiesRouteState.schema.safeParse(result.doc).data;
        const familyScope = document?.scope.staged?.value ?? document?.scope.proposal?.value;
        if (!familyScope)
          return {
            ok: true,
            target: scope.target,
            result: { ...result, hint: "Propose scope.proposal first." },
          };
        try {
          const catalogRow = catalog?.capabilities.find(
            (candidate) => candidate.key === "op:revit.catalog.loaded-families",
          );
          if (!catalogRow) throw Error("Loaded-families catalog capability unavailable.");
          const target = await operationTarget(catalogRow, undefined, defaultTarget);
          const catalogResult = await new HostRpcCaller({
            hostBaseUrl: base(),
            ...target,
            timeoutMs: input.timeoutSeconds * 1000,
          }).callOperation("revit.catalog.loaded-families", familyCatalogRequest(familyScope));
          if (!catalogResult.ok) throw Error(catalogResult.message);
          const response = catalogResult.response as RevitCatalogLoadedFamilies.Res.Response;
          return {
            ok: true,
            target: scope.target,
            result: {
              ...result,
              scopeTypes: response.families.map((family) => ({
                familyName: family.familyName,
                typeNames: family.types.map((type) => type.typeName),
              })),
            },
          };
        } catch (error) {
          return {
            ok: true,
            target: scope.target,
            result: { ...result, scopeTypesError: message(error) },
          };
        }
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
        workspaceId,
      );
    }
  }
}

/** SDK selection and product document references travel on different fields. */
function transportScope(target: RunInput["target"], fallback: Target = null): HostSessionScope {
  if (target && !("kind" in target)) return { session: target };
  const document = target ?? fallback;
  return document?.kind === "open"
    ? { bridgeSessionId: document.ref.session, openDocumentId: document.ref.openId }
    : document
      ? { bridgeSessionId: document.session }
      : {};
}

async function operationTarget(
  row: Capability,
  override: RunInput["target"],
  defaultTarget: Target,
): Promise<HostSessionScope> {
  if (row.needs === "nothing") {
    if (override !== undefined) throw Error("This capability needs no Revit target.");
    return {};
  }
  if (row.needs === "session") {
    if (override && "kind" in override) throw Error("A session capability takes SDK id or pid");
    return { session: override };
  }
  if (override && !("kind" in override))
    throw Error("A document capability requires an exact open document reference");
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
  const resolution = resolveCallTarget(
    { needs: row.needs, target: override },
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
  const scope = workspaceId
    ? {
        query: new URLSearchParams({ work: workspaceId }).toString(),
        target: { session: null, document: null },
      }
    : await routeWorkScope(defaultTarget);
  const { query } = scope;
  const encoded = encodeURIComponent(route);
  const revision =
    expectedRevision ??
    (await routeFetch(`/pe/route-state/${encoded}?${query}`).then((view) =>
      typeof view.revision === "number" ? view.revision : 0,
    ));
  const result = await routeFetch(`/pe/route-state/${encoded}/${suffix}?${query}`, {
    ...body,
    expectedRevision: revision,
  });
  // A command whose receipt names the target it resolved to (instances, pods) wins over the Target.
  const receipt = (result.result ?? result) as { target?: unknown };
  const target = receipt && typeof receipt === "object" ? parseTarget(receipt.target) : null;
  return {
    ok: !("isError" in result),
    target: workspaceId ? scope.target : (target ?? scope.target),
    result,
  };
}

function parseTarget(value: unknown): ResolvedTarget | null {
  if (!value || typeof value !== "object") return null;
  const record = value as { session?: unknown; document?: unknown };
  return {
    session: typeof record.session === "string" ? record.session : null,
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
    const hint = payload.hint ?? payload.agentHint ?? payload.error;
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
  scope: HostSessionScope = {},
): Promise<CapabilityCatalog | { isError: true; content: string }> {
  let url = hostBaseUrl;
  try {
    url ??= base();
    const query = new URLSearchParams(targetQuery(target));
    if (scope.bridgeSessionId) query.set("session", scope.bridgeSessionId);
    if (scope.session) query.set("sdk", JSON.stringify(scope.session));
    const response = await fetch(`${url}/pe/capabilities?${query.toString()}`);
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
    "Select Pea's own document as this thread's default Target for later calls. Name an exact open lifetime or a saved Address plus its Pea-owned session. Only the human can move the head onto a user document and grant rw. null removes the default. Calls resolve against the live inventory; a close or reopen never silently redirects. Without a bound thread, use exact per-call op targets. The new revision applies to the next call.",
  inputSchema: z.object({ defaultTarget: documentRequestSchema.nullable() }),
  execute: async (input) => {
    const turn = await scopeOf();
    if (!turn)
      return {
        isError: true,
        content:
          "grant.required: target_set needs a bound thread to change its head. External MCP clients cannot hold rw in this release; use an exact per-call target for reads or Pea's own documents.",
      };
    const body = putTargetSchema.parse({
      defaultTarget: input.defaultTarget,
      expectedRevision: turn.revision,
    });
    const response = await fetch(`${base()}/pe/scope/self`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const answer: unknown = await response.json().catch(() => null);
    const result = putTargetResultSchema.safeParse(answer).data;
    // A host refusal (`grant.required`, `context.foreign-thread`) is returned in its own words.
    if (!result)
      return {
        isError: true,
        content:
          (answer as { error?: string } | null)?.error ?? `target set failed (${response.status})`,
      };
    if (!result.ok)
      return {
        isError: true,
        content: `The thread head is at revision ${result.head.revision}, not ${turn.revision}; it changed under you.`,
      };
    return {
      head: result.head,
      note: `The new Target (revision ${result.head.revision}) applies to the next call.`,
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
