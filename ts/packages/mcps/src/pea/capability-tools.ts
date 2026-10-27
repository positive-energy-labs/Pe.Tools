import { createPeClient, peRoutes } from "@pe/agent-contracts/pe-api";
import { pagePublicationSchema, pagePublicationResultSchema } from "@pe/host-contracts/pe-api";
import type { HostSessionScope } from "@pe/host-contracts/operation-types";
import {
  carriesCallerContext,
  contextFetch as fetch,
  invocationContext,
} from "@pe/runtime/context";
import {
  sdkSessionSelectionSchema,
  instancesReading,
  scheduleReads,
  type ScheduleReadKey,
  actionControls,
  semanticActions,
  familyReads,
  familiesRouteState,
  routeAddress,
  routeViewRoutes,
  type RouteViewRoute,
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
 * so reads run freely and writes cross the host's write admission. Op calls may override their target without
 * changing the thread's targets, and every result carries `revision` (the Scope revision it ran under) and `target` (what the host actually
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
  parseContributionKey,
  parseRouteKey,
  scheduleGridRouteState,
  settingsRouteState,
  putTargetResultSchema,
  putTargetSchema,
  threadHeadSchema,
  headRequests,
  targetKey,
  pageChoiceSchema,
  type Capability,
  type CapabilityCatalog,
  type DocumentRequest,
  type TargetInventory,
  type DocumentRef,
  type ThreadHead,
  transitionPatches,
} from "@pe/agent-contracts";
import { parseLoadPreview } from "@pe/ducts-domain/load-preview";
import { HostRpcCaller, type ResolvedTarget } from "../shared/host-rpc-caller.ts";
import type { RevitCatalogLoadedFamilies } from "@pe/host-contracts/generated";
import { coerceJsonObject } from "../shared/coerce.ts";
import { resolveHostBaseUrl } from "../shared/host-config.ts";
import { peSourceTree } from "./source-tree.ts";
import { ductsGuideInputSchema, ductsGuideReading, presentDuctCases } from "./ducts-skill.ts";

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
  const caller = invocationContext()?.caller;
  if (caller?.kind === "external-mcp" && !caller.device) return null;
  if (!carriesCallerContext()) return null;
  const response = await createPeClient(base(), fetch).response("scope.get", {
    params: { id: "self" },
  });
  if (response.status === 404) return null;
  const body = (await response.json()) as { thread?: unknown };
  if (typeof body.thread !== "string") return null;
  return { thread: body.thread, ...threadHeadSchema.parse(body) };
}

/** Explicitly ask the browser showing this conversation to open a tool, then acquire that render. */
async function openToolTab(
  client: ReturnType<typeof createPeClient>,
  thread: string,
  route: RouteViewRoute,
  read: (instance: unknown) => Promise<Response>,
  target: Target,
): Promise<
  | { mounted: true; instance: string; revision: number }
  | { mounted: false; outcome: "unmounted"; applied: false; note: string }
> {
  const title = routeAddress(route).title;
  const link = routeAddress(route).link(
    {},
    { target: target ? JSON.stringify(target) : undefined },
  );
  const opened = await client.response("view.open", {
    params: { route },
    body: { thread, link },
  });
  if (!opened.ok) throw Error(`Could not open ${title}: ${await opened.text()}`);
  const { commandId } = (await opened.json()) as { commandId: string };
  // Bound the acquisition wait. A background/unrelated browser never counts as a rendered open.
  for (let i = 0; i < 12; i++) {
    const response = await read(undefined);
    if (response.ok) {
      const view = (await response.json()) as {
        instance?: unknown;
        revision?: unknown;
        openCommandId?: unknown;
      };
      if (
        view.openCommandId === commandId &&
        typeof view.instance === "string" &&
        typeof view.revision === "number"
      )
        return { mounted: true, instance: view.instance, revision: view.revision };
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return {
    mounted: false,
    outcome: "unmounted",
    applied: false,
    note: `The browser showing this conversation did not render ${title}. Nothing was applied. Select this conversation in Pea, choose the tool's document, then set-view again.`,
  };
}

/** The one Target a call runs under with no override: the thread's only target, else none. */
export const soleTarget = (targets: readonly DocumentRequest[]): Target =>
  targets.length === 1 ? targets[0]! : null;

/** The Scope's sole Target; a call with no Scope, or a thread with several targets, runs with none. */
async function targetOf(): Promise<{
  target: Target;
  targets: DocumentRequest[];
  revision: number;
}> {
  const turn = await scopeOf();
  const targets = turn ? headRequests(turn) : [];
  return { target: soleTarget(targets), targets, revision: turn?.revision ?? 0 };
}

/** The Work key query a route or capability read runs under: `?target=<address>`, or none. */
const targetQuery = (target: Target): string => {
  const address = targetAddress(target);
  return address ? new URLSearchParams({ target: address }).toString() : "";
};

/**
 * Resolve route Work like the browser: Address when saved, exact open lifetime when unsaved.
 * Carry the lifetime beside an Address for Save As migration; a closed lifetime refuses (E2E-J1).
 */
async function routeWorkScope(target: Target): Promise<{ query: string; target: ResolvedTarget }> {
  if (target?.kind !== "open") return { query: targetQuery(target), target: namedTarget(target) };
  const { sessions } = await new HostRpcCaller({ hostBaseUrl: base(), timeoutMs: 30_000 }).call(
    "bridge.sessions.list",
  );
  const session = sessions.find((session) => session.sessionId === target.ref.session);
  if (session && !session.connected)
    throw Error(
      "The document's session is disconnected; its open document inventory is unavailable.",
    );
  const document = session?.openDocuments?.find((doc) => doc.openId === target.ref.openId);
  if (!document)
    throw Error(
      "The Chat's document is no longer open in its session; ask the person to pick an open document again.",
    );
  const address = addressSchema.safeParse(document.address).data ?? null;
  const query = new URLSearchParams({ open: `${target.ref.session}/${target.ref.openId}` });
  if (address) query.set("target", address);
  return {
    query: query.toString(),
    target: { session: target.ref.session, document: address },
  };
}

export const peFind = createTool({
  id: "pe_find",
  description:
    "Find a capability. No query returns the map: connected Revit sessions with their active document and custody, counts per kind, top rows per kind, and which sources answered. A query ranks rows across host operations (op:), the collaborative route documents you co-edit with the user and their commands (route:), packaged scripts (script:@), Pages (page:@), skills (skill:@), and read-only members (member:@), documents open in Revit (doc:<session>/<openId>, the same pointer the user @-mentions), and Revit's recent documents, not open (recent:<path> or recent:cloud:<region>/<project>/<model>). Filter with kind, needs, mutates. Every row you may run is visible; nothing is tiered, and human and Pea share semantic commands. Each row declares effect query or command; pe_read runs queries and pe_do runs either.",
  inputSchema: z.object({
    query: z.string().optional().describe("Keywords describing what you need."),
    kind: capabilityKindSchema.optional(),
    needs: capabilityNeedsSchema
      .optional()
      .describe(
        "document includes project-document and family-document capabilities. Other needs match exactly. This filters requirements, not current availability.",
      ),
    mutates: z.boolean().optional(),
    limit: z.number().int().min(1).max(50).default(8),
  }),
  execute: async (input) => {
    const { target, targets, revision } = await targetOf();
    const catalog = await readCatalog(target, undefined, {
      bridgeSessionId: targetSession(target),
    });
    if ("isError" in catalog) return catalog;
    // A human-only row is the person's press, never Pea's move: it is not offered at all.
    const principal = invocationContext()?.caller?.kind ?? "pea";
    const offered = catalog.capabilities.filter(
      (row) => principal !== "anonymous" && row.principal.includes(principal),
    );
    const filtered = input.query || input.kind || input.needs || input.mutates !== undefined;
    if (!filtered)
      return {
        at: catalog.at,
        target,
        targets,
        revision,
        bridgeSessionId: catalog.bridgeSessionId,
        machine: catalog.machine,
        defaultDocument: targetDocument(target),
        sources: catalog.sources,
        source: peSourceTree(),
        diagnostics: catalog.diagnostics,
        map: capabilityMap(offered),
        hint: "Query pe_find for rows. pe_read runs queries; pe_do runs commands and queries. Thread targets are defaults, never write authority. Pass an exact open target for document-owned Work or commands. The first consequential write in a root turn opens one 60-second intervention countdown covering later writes and delegated descendants. Draft edits and receipts remain immediate. Human presses supply consent directly. External MCP and Page callers retain their separate trust boundaries. Unknown effects refuse. Scripts can reach sibling documents and must declare their complete footprint.",
      };
    const rows = findCapabilities(offered, input);
    return {
      at: catalog.at,
      sources: catalog.sources,
      diagnostics: catalog.diagnostics,
      matches: rows.map((row) => ({
        key: row.key,
        kind: row.kind,
        title: row.title,
        description: row.description,
        needs: row.needs,
        mutates: row.mutates,
        principal: row.principal,
        input: row.input,
        package: row.package,
        projection: row.projection,
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
      "Op calls take SDK selection {id: name} or {pid: number} for session work, or {kind: open, ref: {session, openId}} for an exact product document. Document-owned Work accepts any exact open target. Overrides affect this call; omitted target uses the thread default and refuses ambiguity. Consequential writes use the root turn countdown, independent of thread targets.",
    ),
  expectedRevision: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe(
      "Route rows only: expectedRevision from the route read is required for route:<name>.edit; commands use their declared revision contract.",
    ),
  timeoutSeconds: z.number().min(5).max(900).default(300),
});
type RunInput = z.infer<typeof runInputSchema>;

// MCP tools require an object at the top level; the two strict arms still validate separately.
const peDoInputSchema = z
  .strictObject({
    ...runInputSchema.shape,
    key: runInputSchema.shape.key.optional(),
    timeoutSeconds: z.number().min(5).max(900).optional(),
    kind: z.literal("page").optional(),
    slug: pagePublicationSchema.shape.slug.optional(),
    title: pagePublicationSchema.shape.title.optional(),
    html: pagePublicationSchema.shape.html.optional(),
    width: pagePublicationSchema.shape.width,
  })
  .superRefine((input, context) => {
    const parsed =
      input.kind === "page"
        ? pagePublicationSchema.safeParse(input)
        : runInputSchema.strict().safeParse(input);
    if (!parsed.success)
      for (const issue of parsed.error.issues)
        context.addIssue({ code: "custom", path: issue.path, message: issue.message });
  });

export const peRead = createTool({
  id: "pe_read",
  description:
    "Run one capability that does not mutate: an op: row with mutates false, a route: document read, a skill: body, or a doc: row's mention (its session, openId, address and custody, read now), or a recent: row's mention (its path, year and the openWith source that opens it). Refuses mutating rows with a hint to use pe_do. Split from pe_do so reads never wait on an approval prompt. Runs under this thread's Scope; the result names the revision and the resolved target.",
  inputSchema: runInputSchema,
  execute: (input, context) =>
    executeTool(input, context, (row) =>
      row.effect === "command"
        ? `'${row.key}' mutates; run it with pe_do under the host's write admission.`
        : null,
    ),
});

export const peDo = createTool({
  id: "pe_do",
  description:
    "Publish a Page with {kind: 'page', slug, title, html, width?}, or run a capability from pe_find. Human and Pea share editable Work and semantic commands. The first consequential write in this root turn opens one host countdown; Allow now or its 60-second deadline permits remaining writes, including delegated descendants. Stop writes ends the root's remaining unstarted writes. Work edits and internal receipts stay immediate. Target overrides select any exact open document; thread targets supply defaults only. Publication and user file writes use the same turn consent. External devices and Pages retain separate admission. For retries retain the original actionId and read its receipt; never mint a replacement for an uncertain native outcome.",
  inputSchema: peDoInputSchema,
  toModelOutput: (output) => {
    const parsed = pagePublicationResultSchema.safeParse(output);
    if (!parsed.success) return undefined;
    const { capture, ...result } = parsed.data;
    return {
      type: "content",
      value: [
        {
          type: "text",
          text: JSON.stringify({
            ...result,
            capture: {
              mimeType: capture.mimeType,
              url: capture.url,
              sha256: capture.sha256,
              width: capture.width,
              height: capture.height,
            },
          }),
        },
        { type: "media", mediaType: capture.mimeType, data: capture.data },
      ],
    };
  },
  execute: async (input, context) => {
    if (input.kind === "page")
      return createPeClient(base(), fetch).call(
        "page.publish",
        {
          body: pagePublicationSchema.parse(input),
        },
        { headers: { "x-pe-command-id": requestIdentity(context) } },
      );
    return executeTool(
      runInputSchema.parse(input),
      context,
      (row) =>
        row.kind === "document"
          ? `'${row.key}' is a document, a pointer and not an action; pass its session and openId to an op as target {kind: open, ref: {session, openId}}.`
          : row.kind === "recent"
            ? `'${row.key}' is a recent document, a pointer and not an action; open it first: pe_read it for openWith, then open it with pe_do workflow:instances.open, input {source: <openWith>, into: {session: {id}} or {start: {year, owner: pea, addins: on}}}.`
            : row.kind === "member"
              ? `'${row.key}' is a read/mention-only member and cannot execute.`
              : null,
      true,
    );
  },
});

async function executeTool(
  input: RunInput,
  context: unknown,
  gate: (row: Capability) => string | null,
  replayOperations = false,
): Promise<Record<string, unknown>> {
  const scope = await scopeOf();
  const targets = scope ? headRequests(scope) : [];
  const defaultTarget = soleTarget(targets);
  const revision = scope?.revision ?? 0;
  const contribution = parseContributionKey(input.key);
  if (/^(pod|script|page|skill|member):/.test(input.key) && !contribution)
    return refuse(
      input.key,
      defaultTarget,
      revision,
      "Legacy or malformed contribution key; obtain a canonical key with pe_find.",
    );
  if (contribution?.kind === "member" && replayOperations)
    return refuse(
      input.key,
      defaultTarget,
      revision,
      "Members are read/mention-only and cannot execute.",
    );
  // A known operation attempt replays before catalog or target discovery.
  if (
    replayOperations &&
    (input.key.startsWith("op:") || contribution?.kind === "script") &&
    !Object.hasOwn(actionControls, input.key.slice(3))
  ) {
    const id = requestIdentity(context);
    const original = await readAction(id, base()).catch(() => undefined);
    if (original) {
      let key = input.key.slice(3);
      let payload = coerceJsonObject(input.input) ?? {};
      if (contribution?.kind === "script") {
        const preparation =
          original.preparation.state === "ready"
            ? (original.preparation.value as {
                script?: { sourceBundle?: { files?: { path: string; bytesBase64: string }[] } };
              })
            : undefined;
        const bundle =
          (original.request.sourceBundle as
            | { files?: { path: string; bytesBase64: string }[] }
            | undefined) ?? preparation?.script?.sourceBundle;
        const encoded = bundle?.files?.find((file) => file.path === "pod.json")?.bytesBase64;
        if (!encoded || original.kind !== "operation" || original.key !== "scripting.execute")
          throw Error("Original script admission cannot be identified");
        const manifest = JSON.parse(decodeCapturedManifest(encoded)) as { id: string };
        if (
          manifest.id !== contribution.packageId ||
          original.request.sourcePath !== contribution.path
        )
          throw Error("Original script contribution conflicts");
        key = "scripting.execute";
        payload = {
          ...payload,
          workspaceKey: original.request.workspaceKey,
          sourcePath: original.request.sourcePath,
          ...(original.request.sourceBundle ? { sourceBundle: original.request.sourceBundle } : {}),
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
  if (!row && contribution?.kind === "member" && !replayOperations && !input.target) {
    const response = await createPeClient(base(), fetch).response("contributions.read", {
      query: { key: input.key },
    });
    const result = await response.json();
    return {
      ok: response.ok,
      key: input.key,
      revision,
      target: namedTarget(defaultTarget),
      result,
    };
  }
  // TODO: with no Target, a row that needs a document is absent from the catalog and refuses as
  // "Unknown capability" instead of "no document" (ACP spike 2026-09-26, REPORT2.md reduced run).
  if (!row)
    return refuse(
      input.key,
      defaultTarget,
      revision,
      `Unknown capability '${input.key}'. Find keys with pe_find.`,
    );
  const principal = invocationContext()?.caller?.kind ?? "pea";
  const caller = invocationContext()?.caller;
  const pairedOperation =
    caller?.kind === "external-mcp" &&
    caller.device &&
    (row.kind === "op" || row.kind === "script") &&
    row.principal.includes("pea");
  if (principal === "anonymous" || (!row.principal.includes(principal) && !pairedOperation))
    return refuse(
      row.key,
      defaultTarget,
      revision,
      principal === "external-mcp"
        ? "grant.context-cannot-hold: external MCP cannot run this capability until human pairing exists, including ReadOnly scripts."
        : `'${row.key}' is human-only. Ask the user to press it in the ${row.title.split(":")[0]} workspace.`,
    );
  if (row.kind === "page" && !replayOperations && input.input)
    return refuse(
      row.key,
      defaultTarget,
      revision,
      "pe_read reads a Page; use pe_do for an event or binding.",
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
  if (
    input.target !== undefined &&
    row.kind !== "op" &&
    row.kind !== "script" &&
    !documentWork(row)
  )
    return refuse(
      row.key,
      defaultTarget,
      revision,
      "Target overrides are supported by op: capabilities and document-owned route Work only.",
    );
  try {
    const outcome = await dispatch(
      row,
      input,
      targets,
      requestIdentity(context),
      scope?.thread,
      catalog,
    );
    return {
      key: row.key,
      kind: row.kind,
      revision,
      package: row.package,
      projection: row.projection,
      ...outcome,
    };
  } catch (error) {
    const refusal = refusalSchema.safeParse((error as { refusal?: unknown } | null)?.refusal).data;
    if (refusal)
      return { ...refuse(row.key, defaultTarget, revision, JSON.stringify({ refusal })), refusal };
    return refuse(row.key, defaultTarget, revision, message(error));
  }
}

type Outcome = {
  ok: boolean;
  target: ResolvedTarget;
  result: unknown;
  elapsedMs?: number;
  source?: Capability["package"];
  bytesBase64?: string;
};

async function dispatch(
  row: Capability,
  input: RunInput,
  targets: readonly DocumentRequest[],
  requestId: string,
  viewThread?: string,
  catalog?: CapabilityCatalog,
): Promise<Outcome> {
  const defaultTarget = soleTarget(targets);
  const coerced = coerceJsonObject(input.input);
  const payload: Record<string, unknown> =
    coerced && typeof coerced === "object" ? (coerced as Record<string, unknown>) : {};
  const scopeTarget = namedTarget(defaultTarget);
  switch (row.kind) {
    case "op": {
      const target = await operationTarget(row, input.target, targets);
      const caller = new HostRpcCaller({
        hostBaseUrl: base(),
        ...target,
        requestId: row.effect === "command" ? requestId : undefined,
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
            mutates: semanticActions[key as SemanticActionKey].effect === "command",
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
    case "page": {
      if (input.target) throw Error("A Page shelf takes no Revit target override.");
      if (!row.projection?.openUrl)
        throw Error("Page open URL unavailable from its host descriptor.");
      const open = new URL(row.projection.openUrl, base());
      if (open.origin !== new URL(base()).origin)
        throw Error("Page descriptor has a foreign origin.");
      const client = createPeClient(base(), fetch);
      const params = { slug: decodeURIComponent(open.pathname.split("/")[2]!) };
      const read = async (response: Response) => ({
        ok: response.ok,
        result: await response.json(),
      });
      // pe_do is the Page shelf's event/binding door; these cross their original host checks.
      if (!input.input) {
        const [state, target] = await Promise.all([
          client.response("page.state", { params }).then(read),
          client.response("page.target", { params }).then(read),
        ]);
        return {
          ok: state.ok && target.ok,
          target: scopeTarget,
          result: { state: state.result, target: target.result },
        };
      }
      const action = z
        .union([
          z.strictObject({ binding: pageChoiceSchema }),
          z.strictObject({ event: z.record(z.string(), z.unknown()) }),
        ])
        .parse(coerceJsonObject(input.input));
      const answer = await read(
        "binding" in action
          ? await client.response("page.bind", { params, body: action.binding })
          : await client.response("page.append", { params, body: action.event }),
      );
      return { ...answer, target: scopeTarget };
    }
    case "route":
    case "skill":
    case "member": {
      const answer = await contributionRead(row);
      return {
        ok: true,
        target: scopeTarget,
        result: answer.content,
        source: row.package,
        bytesBase64: answer.bytesBase64,
      };
    }
    case "script": {
      const reference = parseContributionKey(row.key);
      if (!reference || reference.kind !== "script")
        throw Error(`Malformed script key '${row.key}'.`);
      const admitted = await contributionRead(row);
      if (!admitted.sourceBundle || !admitted.folder)
        throw Error("Frozen admitted script input unavailable");
      const definition = await new HostRpcCaller({
        hostBaseUrl: base(),
        ...transportScope(input.target, defaultTarget),
      }).getOperation("scripting.execute");
      if (!definition) throw Error("Public scripting operation metadata unavailable");
      const target = await operationTarget(
        { ...row, needs: definition.needs === "nothing" ? "session" : definition.needs! },
        input.target,
        targets,
      );
      const caller = new HostRpcCaller({
        hostBaseUrl: base(),
        ...target,
        requestId,
        timeoutMs: input.timeoutSeconds * 1000,
      });
      const result = await caller.callOperation("scripting.execute", {
        ...payload,
        workspaceKey: admitted.folder,
        sourcePath: reference.path,
        sourceBundle: admitted.sourceBundle,
      });
      return {
        ok: result.ok,
        target: { session: target.bridgeSessionId ?? null, document: null },
        result,
      };
    }
    case "route-doc":
    case "route-command": {
      if (row.key === "route:threads.history") {
        const response = await createPeClient(base(), fetch).response("threads.history", {
          query: { query: JSON.stringify(payload) },
        });
        return {
          ok: response.ok,
          target: { session: null, document: null },
          result: await response.json(),
        };
      }
      if (row.key === "route:ducts.analysis") {
        const response = await createPeClient(base(), fetch).response("ducts.analysis", {
          body: peRoutes["ducts.analysis"].body.parse(payload),
        });
        const result = await response.json();
        if (response.ok) result.artifact.url = new URL(result.artifact.url, base()).toString();
        return {
          ok: response.ok,
          target: response.ok
            ? { session: result.target.session, document: result.target.openId }
            : { session: null, document: null },
          result,
        };
      }
      if (row.key === "route:ducts.guide") {
        const { document, section } = ductsGuideInputSchema.parse(payload);
        const guide = ductsGuideReading(section);
        if (!document)
          return { ok: true, target: { session: null, document: null }, result: { guide } };
        // The same fresh document read route:ducts.analysis runs; the guide stands without it.
        try {
          const response = await createPeClient(base(), fetch).response("ducts.analysis", {
            body: peRoutes["ducts.analysis"].body.parse({
              source: { kind: "fresh", target: document },
              selector: { kind: "document" },
              projection: "summary",
              // One row: the guide wants the counts and the findings, not the page.
              limit: 1,
            }),
          });
          if (!response.ok)
            return {
              ok: true,
              target: { session: null, document: null },
              result: { guide, present: null, presentError: await response.text() },
            };
          const result = await response.json();
          return {
            ok: true,
            target: { session: result.target.session, document: result.target.openId },
            result: {
              guide,
              present: presentDuctCases(result.findingCounts.byKindAndGrade, result.findings),
            },
          };
        } catch (error) {
          return {
            ok: true,
            target: { session: null, document: null },
            result: { guide, present: null, presentError: message(error) },
          };
        }
      }
      const view = /^route:([a-z-]+)\.(view|set-view)$/.exec(row.key);
      const route = view && routeViewRoutes.find((key) => key === view[1]);
      if (view && route) {
        // One channel for every route that leases a view (`routeViewRoutes`): read the leased view, or patch its Page keys.
        if (!viewThread) throw Error("This MCP server has no thread (no harness context).");
        const client = createPeClient(base(), fetch);
        const read = (instance: unknown) =>
          client.response("view.get", {
            params: { route },
            query: {
              thread: viewThread,
              ...(typeof instance === "string" ? { instance } : {}),
            },
          });
        let response: Response;
        if (view[2] === "view") response = await read(payload.instance);
        else {
          let { instance, revision, ...rest } = payload;
          if ((instance === undefined) !== (revision === undefined))
            throw Error(
              "Pass both instance and revision for a mounted view, or omit both to open the tool.",
            );
          if (instance === undefined) {
            // An explicit open is delivered only to a browser showing this conversation.
            // Acquisition names that command, so an older mounted document cannot satisfy it.
            const opened = await openToolTab(client, viewThread, route, read, defaultTarget);
            if (!opened.mounted)
              return { ok: true, target: { session: null, document: null }, result: opened };
            ({ instance, revision } = opened);
          }
          const spec = routeAddress(route).agent;
          let patch = rest as Record<string, string>;
          let refused: string | null = null;
          if (spec.resolve) {
            // The view's own facts say which ids exist; a name resolves against them or not at all.
            const lease = (await (await read(instance)).json()) as {
              facts?: Record<string, unknown>;
            };
            const resolved = spec.resolve(rest, lease.facts ?? {});
            if (resolved.ok) patch = resolved.patch;
            else refused = resolved.error;
          }
          response = refused
            ? Response.json({ ok: false, error: refused }, { status: 409 })
            : await client.response("view.set", {
                params: { route },
                body: peRoutes["view.set"].body.parse({
                  thread: viewThread,
                  instance,
                  revision,
                  patch,
                }),
              });
        }
        const result = (await response.json()) as Record<string, unknown>;
        const context = (result.context ?? {}) as Record<string, unknown>;
        if (route === "families" && response.ok && typeof context.readingId === "string") {
          const reference = await fetch(
            `${base()}/families/readings?id=${encodeURIComponent(context.readingId)}&format=reference`,
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
        const observed = context.document as { session?: unknown } | undefined;
        const work = context.work as { binding?: unknown; target?: unknown } | undefined;
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
      let workTarget = defaultTarget;
      if (documentWork(row)) {
        if (input.target !== undefined) {
          if (!("kind" in input.target))
            throw Error(
              "Route Work requires an exact open document target, not an SDK session selector.",
            );
          await routeWorkScope(input.target);
          workTarget = input.target;
        } else if (targets.length > 1) {
          throw Error(
            "Target choose: several-targets. Name one of this thread's documents with an exact per-call target {kind: open, ref: {session, openId}}.",
          );
        }
      }
      if (parsed.member === undefined) {
        const scope = workspaceId
          ? {
              query: new URLSearchParams({ work: workspaceId }).toString(),
              target: { session: null, document: null },
            }
          : await routeWorkScope(workTarget);
        const result = await routeFetch(parsed.route, scope.query);
        if (parsed.route === familiesRouteState.route && !("isError" in result))
          result.hint =
            "This is authored Work. Read route:families.view for the currently visible matrix or past reading; no matrix read is started.";
        // ponytail: families is the only route keyed by loaded Revit types; generalize when a second route needs it
        if (parsed.route !== familiesRouteState.route || "isError" in result)
          return { ok: !("isError" in result), target: scope.target, result };
        const document = familiesRouteState.schema.safeParse(result.doc).data;
        const familyScope = document?.scope.edit?.value ?? document?.scope.suggestion?.value;
        if (!familyScope)
          return {
            ok: true,
            target: scope.target,
            result: { ...result, hint: "Set scope.edit first." },
          };
        try {
          const catalogRow = catalog?.capabilities.find(
            (candidate) => candidate.key === "op:revit.catalog.loaded-families",
          );
          if (!catalogRow) throw Error("Loaded-families catalog capability unavailable.");
          const target = await operationTarget(catalogRow, input.target, targets);
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
        // Ducts Work is keyed by document: an unbound write lands in Work no page reads (wave 3, 2026-10-19).
        if (parsed.route === "ducts" && !workspaceId && !workTarget)
          throw new Error(
            "route:ducts.edit needs an exact document. Pass target {kind: open, ref: {session, openId}} or set a thread default, then read its Work revision before editing.",
          );
        // Ducts: a raw Load Preview paste is parsed here and proposed as loads/preview.
        const loads =
          parsed.route === "ducts" && typeof payload.loadsText === "string"
            ? transitionPatches(
                ["loads"],
                "preview",
                {},
                {
                  kind: "set",
                  rung: { value: { systems: parseLoadPreview(payload.loadsText).systems } },
                },
              )
            : [];
        return routeWrite(
          parsed.route,
          "apply",
          workTarget,
          input.expectedRevision,
          {
            patches: [...(Array.isArray(payload.patches) ? payload.patches : []), ...loads],
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

/** Workspace Work and browser leases keep their own addressing contracts. */
function documentWork(row: Capability): boolean {
  const route = parseRouteKey(row.key);
  return (
    row.kind === "route-doc" &&
    row.source === "route registry" &&
    !!route &&
    route.route !== settingsRouteState.route &&
    route.route !== scheduleGridRouteState.route
  );
}

async function contributionRead(row: Capability) {
  if (!row.package) throw Error("Contribution has no admitted source");
  const query = new URLSearchParams({ key: row.key, sha256: row.package.sha256 });
  const response = await createPeClient(base(), fetch).response("contributions.read", {
    query: Object.fromEntries(query),
  });
  const answer = (await response.json()) as {
    content: string;
    bytesBase64: string;
    sha256: string;
    folder?: string;
    sourceBundle?: { files: { path: string; bytesBase64: string }[] };
    error?: string;
  };
  if (!response.ok || answer.sha256 !== row.package.sha256)
    throw Error(answer.error ?? "Admitted contribution revision unavailable");
  return answer;
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
  targets: readonly DocumentRequest[],
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
  const resolution = resolveCallTarget({ needs: row.needs, target: override }, targets, inventory);
  if (resolution.kind === "choose" && resolution.reason === "several-targets")
    throw Error(
      "Target choose: several-targets. This thread targets several documents; name one with an exact per-call target {kind: open, ref: {session, openId}}.",
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
  const revision =
    expectedRevision ??
    (await routeFetch(route, query).then((view) =>
      typeof view.revision === "number" ? view.revision : 0,
    ));
  const result = await routeFetch(route, query, suffix, {
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

async function routeFetch(
  route: string,
  queryString: string,
  verb?: "apply" | "command",
  body?: unknown,
): Promise<Record<string, unknown>> {
  const client = createPeClient(base(), fetch);
  const params = { route };
  const query = Object.fromEntries(new URLSearchParams(queryString));
  const response =
    verb === "apply"
      ? await client.response("work.apply", {
          params,
          query,
          body: peRoutes["work.apply"].body.parse(body),
        })
      : verb === "command"
        ? await client.response("work.command", {
            params,
            query,
            body: peRoutes["work.command"].body.parse(body),
          })
        : await client.response("work.get", { params, query });
  const wire = (await response.json()) as Record<string, unknown>;
  const payload = response.ok
    ? wire
    : ((wire.error as { details?: Record<string, unknown> })?.details ?? wire);
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
    const response = await createPeClient(url, fetch).response("capabilities.find", {
      query: Object.fromEntries(query),
    });
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
  const record = (context ?? {}) as {
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
    "Add or remove one of Pea's own documents in this thread's targets. Name an exact open lifetime Pea acquired (pe_find access kind pea names its acquisition), or a saved Address in a Revit Pea's acquisition started. Only the user adds or removes their own documents, from the composer. With exactly one target, later calls use it; with several, a call names one by exact per-call target. Calls resolve against the live inventory; a close or reopen never silently redirects. Without a bound thread, use exact per-call op targets. The new revision applies to the next call.",
  inputSchema: z.object({
    add: documentRequestSchema.optional(),
    remove: documentRequestSchema.optional(),
  }),
  execute: async (input) => {
    const turn = await scopeOf();
    if (!turn)
      return {
        isError: true,
        content:
          "grant.required: target_set needs a bound thread to change its targets. External MCP clients write only Pea's own documents in this release; use an exact per-call target.",
      };
    const drop = new Set([input.add, input.remove].flatMap((t) => (t ? [targetKey(t)] : [])));
    const body = putTargetSchema.parse({
      targets: [
        ...turn.targets
          .filter((held) => !drop.has(targetKey(held.request)))
          .map(({ request, label }) => ({ request, ...(label ? { label } : {}) })),
        ...(input.add ? [{ request: input.add }] : []),
      ],
      expectedRevision: turn.revision,
    });
    const response = await createPeClient(base(), fetch).response("scope.set", {
      params: { id: "self" },
      body,
    });
    const wire = await response.json().catch(() => null);
    const answer: unknown = response.ok ? wire : wire?.error?.details;
    const result = putTargetResultSchema.safeParse(answer).data;
    // A host refusal (`grant.required`, `human.only`, `context.foreign-thread`) is returned in its own words.
    if (!result)
      return {
        isError: true,
        content:
          (answer as { error?: string } | null)?.error ?? `target set failed (${response.status})`,
      };
    if (!result.ok)
      return {
        isError: true,
        content: `The thread's targets are at revision ${result.head.revision}, not ${turn.revision}; they changed under you.`,
      };
    return {
      head: result.head,
      note: `The new targets (revision ${result.head.revision}) apply to the next call.`,
    };
  },
});

/**
 * A direct tool, not a catalog row: it mutates nothing in Revit, so it crosses no document grant
 * and no principal filter. The host stamps commit, install, thread and turn (owner ruling
 * 2026-10-14: agent feedback leaves the machine automatically while users are coworkers).
 */
export const peFeedback = createTool({
  id: "pe_feedback",
  description:
    "Report a defect or gap in Pea's own tooling to the Pe.Tools maintainers: a tool that returned something false, a failure whose error did not explain itself, a description or doc that misled you, a capability you needed and could not find, a slow or flaky path, or a workaround you had to invent. File it the moment you notice, then keep working; it never blocks the turn and never reaches the user as a question. Name the surface exactly (tool name, op key, route, skill, or repo path:line from the shipped source tree), say what you expected and what happened, and attach any receipt or request ids you hold. The host stamps commit, install, thread and turn; never fill those. Never include personal information (names, emails, usernames, machine names) or model, document or project content; describe the tooling, not the work. Not for the user's model, drawing or design problems, and not for asking the user anything: the reply owns those. Not a substitute for reading a failure before retrying. Returns a feedbackId. One report per distinct defect per thread.",
  inputSchema: peRoutes["agent-feedback.submit"].body,
  execute: async (input) => {
    try {
      const response = await createPeClient(base(), fetch).response("agent-feedback.submit", {
        body: input,
      });
      const answer = (await response.json()) as { feedbackId?: unknown };
      if (response.ok && typeof answer.feedbackId === "string")
        return { feedbackId: answer.feedbackId };
      return {
        isError: true,
        content: `Feedback was not kept (${response.status}); keep working.`,
      };
    } catch (error) {
      return { isError: true, content: `Feedback was not kept (${message(error)}); keep working.` };
    }
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
