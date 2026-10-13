import type { HostSessionScope } from "@pe/host-contracts/operation-types";
import { contextFetch as fetch } from "#invocation-context";
import {
  instancesReading,
  scheduleReads,
  actionControls,
  semanticActions,
  familyReads,
  actionBasesSchema,
  settingsRouteState,
} from "@pe/agent-contracts";
/** One discovery projection and ranker: native availability is contextual; installed content
 * comes from one admitted snapshot, independent of the native catalog. Session/document readings
 * remain fresh; missing sources report their diagnostic instead of hiding the answering ones. */
import { z } from "zod";
import type { HostOperationDefinition } from "@pe/host-contracts/contracts";
import {
  HOST_RPC_SDK_SESSION_HEADER,
  HOST_RPC_BRIDGE_SESSION_HEADER,
  isTsOnlyOperationKey,
  tsOnlyOperationCatalog,
} from "@pe/host-contracts/operation-types";
import {
  capabilityRecentSchema,
  type Machine,
  type Capability,
  type CapabilityCatalog,
  type CapabilityRecent,
  type RouteStateSpec,
  type PackageProjection,
  parseContributionKey,
} from "@pe/agent-contracts";
import type { SkillSnapshot } from "./skill-publication.ts";
import type { RouteRegistration } from "./routes.ts";

type OpsCatalogEntry = HostOperationDefinition & {
  requestSchemaJson?: string;
  responseSchemaJson?: string;
};

export interface CapabilitySources {
  ops: readonly OpsCatalogEntry[];
  routes: readonly RouteStateSpec<z.ZodType>[];
  packages: readonly PackageProjection[];
  skills: readonly SkillSnapshot[];
  pages?: readonly Capability[];
}

/** Pure projection, ordered by compiled operations/routes, packaged content and scratch Pages. */
export function buildCapabilities(sources: CapabilitySources): Capability[] {
  return [
    ...sources.ops.map(opRow),
    {
      key: "op:instances.read",
      kind: "op",
      title: "Instances readings",
      // Named, not spread: an action row also carries `says`/`dirties`, which a Capability is not.
      description: instancesReading.says,
      needs: instancesReading.needs,
      actor: instancesReading.actor,
      mutates: instancesReading.mutates,
      input: z.toJSONSchema(instancesReading.input),
      source: "SDK reading",
      rank: 2,
    },
    ...Object.entries(semanticActions).map(
      ([key, action]): Capability => ({
        key: `workflow:${key}`,
        kind: "op",
        title: key,
        description: action.says,
        needs: action.needs,
        actor: action.actor,
        mutates: true,
        input: z.toJSONSchema(
          action.input.extend({
            bases: actionBasesSchema.optional(),
            actionId: z.string().optional(),
          }),
        ) as Record<string, unknown>,
        source: "semantic action",
        rank: 2,
      }),
    ),
    ...Object.entries({ ...familyReads, ...scheduleReads }).map(
      ([key, reading]): Capability => ({
        key: `op:${key}`,
        kind: "op",
        title: key,
        description: reading.says,
        needs: reading.needs,
        actor: reading.actor,
        mutates: false,
        input: z.toJSONSchema(
          reading.input.extend({ scope: z.record(z.string(), z.unknown()) }),
        ) as Record<string, unknown>,
        source: "Family reading",
        rank: 2,
      }),
    ),
    ...Object.entries(actionControls).map(
      ([key, action]): Capability => ({
        key: `op:${key}`,
        kind: "op",
        title: key,
        description: action.says,
        needs: action.needs,
        actor: action.actor,
        mutates: action.mutates,
        input: z.toJSONSchema(action.input) as Record<string, unknown>,
        source: "semantic action",
        rank: 2,
      }),
    ),
    ...sources.routes.flatMap(routeRows),
    {
      key: "route:families.view",
      kind: "route-command",
      title: "Families visible view",
      description:
        "Read the currently mounted Families pane in this thread: its stage, rule line, exact visible reading id, and visible counts. If two panes are open, pass an instance from the ambiguity result. No Revit read.",
      finds: ["families", "visible", "archive", "rules"],
      needs: "nothing",
      mutates: false,
      actor: "any",
      input: z.toJSONSchema(z.object({ instance: z.uuid().optional() })) as Record<string, unknown>,
      source: "browser Page",
      rank: 2,
    },
    {
      key: "route:families.set-query",
      kind: "route-command",
      title: "Set Families visible query",
      description:
        "Change the query line in one mounted Families view. Read route:families.view first, then pass its instance and revision. The browser acknowledges the rendered query and counts. No Work or Revit read.",
      finds: ["families", "filter", "rules", "visible"],
      needs: "nothing",
      mutates: true,
      actor: "any",
      input: z.toJSONSchema(
        z.object({
          instance: z.uuid(),
          revision: z.number().int().nonnegative(),
          query: z.string().max(4096),
        }),
      ) as Record<string, unknown>,
      source: "browser Page",
      rank: 2,
    },
    ...sources.packages.flatMap(packageRows),
    ...sources.skills.map(skillRow),
    ...(sources.pages ?? []),
  ];
}

/** DefaultVisible outranks EscalationVisible outranks ExpertOnly. A rank, never a filter. */
const visibilityRank: Record<string, number> = {
  DefaultVisible: 2,
  EscalationVisible: 1,
  ExpertOnly: 0,
};

function opRow(op: OpsCatalogEntry): Capability {
  return {
    key: `op:${op.key}`,
    kind: "op",
    title: op.displayName ?? op.key,
    description: [op.description ?? "", ...(op.callGuidance ?? [])].filter(Boolean).join(" "),
    // [Op(Finds = ...)] is the op's search vocabulary; without it "point at" or "highlight" never reach the op.
    ...(op.searchTerms?.length ? { finds: [...op.searchTerms] } : {}),
    needs: op.needs === "nothing" && !isTsOnlyOperationKey(op.key) ? "session" : op.needs,
    mutates: op.intent !== "Read",
    actor: (op as { actor?: "any" | "human" | "agent" }).actor ?? "any",
    input: parseSchema(op.requestSchemaJson),
    output: op.responseSchemaJson ? parseSchema(op.responseSchemaJson) : undefined,
    source: "catalog",
    rank: visibilityRank[op.visibility ?? "DefaultVisible"] ?? 0,
  };
}

function routeRows(spec: RouteStateSpec<z.ZodType>): Capability[] {
  const scopeHint =
    spec.route === settingsRouteState.route
      ? "Use op:pod.list to enumerate members. Supply workspaceId for the member's Work opened by the editor; propose fields against its adopted basis. This is shared file Work independent of Revit."
      : "Runs under this thread's Scope; no target input.";
  const read: Capability = {
    key: `route:${spec.route}`,
    kind: "route-doc",
    title: spec.title,
    description: `Read the ${spec.title} document you co-edit with the user: current doc, revision, JSON Schema, agent write mask, and commands. ${spec.description} ${spec.route === "families" ? "For the currently visible matrix or archived reading, use route:families.view first. Work scope can differ from the visible reading. This does not start a matrix read." : ""} ${scopeHint}`,
    needs: "nothing",
    mutates: false,
    actor: "any",
    input: {},
    source: "route registry",
    rank: 1,
  };
  const propose: Capability = {
    key: `route:${spec.route}.propose`,
    kind: "route-doc",
    title: `${spec.title}: propose`,
    description: `Patch paths inside the ${spec.title} agent write mask (${spec.agentWriteMask.map((path) => path.join("/")).join(", ")}); everything else is human-only. Omit value to delete a key. Needs expectedRevision from the read. ${spec.finds?.join(" ") ?? ""} ${scopeHint}`,
    finds: spec.finds ? [...spec.finds] : undefined,
    needs: "nothing",
    mutates: true,
    actor: "any",
    input: z.toJSONSchema(
      z.object({
        patches: z
          .array(z.object({ path: z.array(z.union([z.string(), z.number()])), value: z.unknown() }))
          .min(1),
      }),
    ) as Record<string, unknown>,
    source: "route registry",
    rank: 0,
  };
  const commands = Object.entries(spec.commands).map(
    ([name, command]): Capability => ({
      key: `route:${spec.route}.${name}`,
      kind: "route-command",
      title: `${spec.title}: ${name}`,
      description: `${command.description} ${scopeHint}`,
      needs: "nothing",
      mutates: false,
      actor: command.actor,
      input: z.toJSONSchema(command.input) as Record<string, unknown>,
      source: "route registry",
      rank: 0,
    }),
  );
  // A route Pea may not write offers no propose door.
  return [read, ...(spec.agentWriteMask.length ? [propose] : []), ...commands];
}

function packageRows(pod: PackageProjection): Capability[] {
  if (pod.diagnostics.some((d) => d.severity === "error")) return [];
  return pod.contributions
    .filter((c) => parseContributionKey(c.key)?.kind !== "skill")
    .map((entry) => {
      const reference = parseContributionKey(entry.key)!;
      const member = pod.members.find((m) => m.path === entry.sourcePath)!;
      return {
        key: entry.key,
        kind: reference.kind,
        title: entry.title,
        description:
          entry.description ||
          (reference.kind === "script"
            ? "Runs the admitted source through scripting.execute; ReadOnly rolls back changes."
            : reference.kind === "member"
              ? "Read or mention this member. It cannot execute."
              : "Read this Page's shared state and binding; append events or request your own binding through pe_do."),
        needs: reference.kind === "script" ? "document" : "nothing",
        mutates: reference.kind === "script",
        actor: "any",
        input: reference.kind === "script" ? podInputSchema : {},
        package: { id: pod.id, path: member.path, sha256: member.sha256 },
        projection: entry.projection,
        source: "packages",
        rank: 1,
      };
    });
}

const podInputSchema = z.toJSONSchema(
  z.object({
    permissionMode: z.enum(["ReadOnly", "WriteTransaction", "NoTransaction"]).optional(),
    timeoutSeconds: z.number().int().min(1).max(3600).optional(),
  }),
) as Record<string, unknown>;

function skillRow(skill: SkillSnapshot): Capability {
  return {
    key: skill.key,
    kind: "skill",
    title: skill.name,
    description: /^description:\s*(.+)$/m.exec(skill.content)?.[1]?.trim() ?? "",
    needs: "nothing",
    mutates: false,
    actor: "any",
    input: {},
    source: "skills",
    package: skill.package,
    rank: 0,
  };
}

function parseSchema(json: string | undefined): Record<string, unknown> {
  if (!json) return {};
  try {
    const parsed: unknown = JSON.parse(json);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/* ── live source ─────────────────────────────────────────────────────────── */

const CATALOG_TTL_MS = 30_000;
// SDK resolution allows 30 s before native catalog dispatch; host-only sources keep their 2 s budget.
const NATIVE_CATALOG_BUDGET_MS = 60_000;

export interface CapabilityCatalogSource {
  /** The catalog for an SDK selection or an exact private attachment. */
  read(scope?: HostSessionScope): Promise<CapabilityCatalog>;
  /** Drop every cached catalog; the host calls this when a Revit session connects or leaves. */
  invalidate(): void;
}

export type CapabilityContent = Pick<CapabilitySources, "packages" | "skills" | "pages"> & {
  diagnostics: CapabilityCatalog["diagnostics"];
  sourceDiagnostics?: string[];
};

/** Native metadata is scoped; every scope shares the same admitted content snapshot. */
export function createCapabilityCatalogSource(options: {
  hostBaseUrl: string;
  registrations: readonly RouteRegistration[];
  machine: () => Promise<Machine>;
  content?: () => Promise<CapabilityContent>;
}): CapabilityCatalogSource {
  const base = options.hostBaseUrl.replace(/\/$/, "");
  const routes = options.registrations.map((registration) => registration.spec);
  const cache = new Map<string, { at: number; catalog: Omit<CapabilityCatalog, "machine"> }>();
  const recents = recentsSource(base);
  return {
    invalidate: () => cache.clear(),
    // Recents are the machine's, not the scope's: one source, its own cache and budget.
    read: async (scope = {}) => {
      const [catalog, recent, machine] = await Promise.all([
        readScoped(scope),
        recents(),
        options.machine(),
      ]);
      return {
        ...catalog,
        machine,
        recents: recent.recents,
        sources: { ...catalog.sources, recents: recent.status },
      };
    },
  };

  async function readScoped(scope: HostSessionScope): Promise<Omit<CapabilityCatalog, "machine">> {
    const cacheKey = JSON.stringify(scope);
    const hit = cache.get(cacheKey);
    if (hit && Date.now() - hit.at < CATALOG_TTL_MS) return hit.catalog;

    const sources: Record<string, string> = { "route registry": "ok", skills: "ok" };
    const [ops, admitted] = await Promise.allSettled([
      fetchOps(base, scope),
      options.content?.() ??
        Promise.resolve<CapabilityContent>({ packages: [], skills: [], diagnostics: [] }),
    ]);
    const opsValue =
      ops.status === "fulfilled"
        ? ops.value
        : { operations: [...tsOnlyOperationCatalog] as OpsCatalogEntry[] };
    sources.catalog =
      ops.status === "rejected"
        ? `did not answer: ${message(ops.reason)}`
        : opsValue.bridgeCatalogError
          ? `bridge catalog unavailable: ${opsValue.bridgeCatalogError}`
          : "ok";
    sources.packages = sources.skills =
      admitted.status === "rejected"
        ? `did not answer: ${message(admitted.reason)}`
        : admitted.value.sourceDiagnostics?.join("; ") || "ok";
    const catalog: Omit<CapabilityCatalog, "machine"> = {
      at: new Date().toISOString(),
      bridgeSessionId: opsValue.bridgeSessionId,
      sources,
      diagnostics: admitted.status === "fulfilled" ? admitted.value.diagnostics : [],
      capabilities: buildCapabilities({
        ops: opsValue.operations ?? [],
        routes,
        ...(admitted.status === "fulfilled" ? admitted.value : { packages: [], skills: [] }),
      }),
    };
    cache.set(cacheKey, { at: Date.now(), catalog });
    return catalog;
  }
}

// Recents change when a person opens a file in Revit: minutes, not seconds.
const RECENTS_TTL_MS = 5 * 60_000;
// The catalog waits this long for them, then answers without; the read finishes for the next one.
const RECENTS_BUDGET_MS = 2_000;
// The host relays `pe-revit doc list --recent` (about 1 s; it reads each file's saved year).
const RECENTS_READ_MS = 65_000;

type Recents = { recents: CapabilityRecent[]; status: string };

/** Revit's recent documents through the host's own SDK reading. A failure is a `sources` entry. */
function recentsSource(base: string): () => Promise<Recents> {
  let entry: { until: number; answer: Promise<Recents> } | undefined;
  return () => {
    if (!entry || Date.now() > entry.until) {
      const answer: Promise<Recents> = fetchRecents(base).then(
        (recents) => ({ recents, status: "ok" }),
        (error) => {
          // A failed read retries on the catalog's cadence, not the recents'.
          if (entry?.answer === answer) entry.until = Date.now() + CATALOG_TTL_MS;
          return { recents: [], status: `did not answer: ${message(error)}` };
        },
      );
      entry = { until: Date.now() + RECENTS_TTL_MS, answer };
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<Recents>((resolve) => {
      timer = setTimeout(
        () => resolve({ recents: [], status: `still reading after ${RECENTS_BUDGET_MS} ms` }),
        RECENTS_BUDGET_MS,
      );
    });
    return Promise.race([entry.answer, late]).finally(() => clearTimeout(timer));
  };
}

async function fetchRecents(base: string): Promise<CapabilityRecent[]> {
  const response = await fetch(`${base}/instances/readings?read=recents`, {
    signal: AbortSignal.timeout(RECENTS_READ_MS),
  });
  if (!response.ok) throw new Error(`GET ${base}/instances/readings answered ${response.status}`);
  // The SDK envelope; `result.recents` is absent when no Revit year has a recent list.
  const envelope = (await response.json()) as { result?: { recents?: unknown } };
  return z.array(capabilityRecentSchema).parse(envelope.result?.recents ?? []);
}

async function fetchOps(base: string, scope: HostSessionScope) {
  const headers: Record<string, string> = {};
  if (scope.bridgeSessionId) headers[HOST_RPC_BRIDGE_SESSION_HEADER] = scope.bridgeSessionId;
  if (scope.session) headers[HOST_RPC_SDK_SESSION_HEADER] = JSON.stringify(scope.session);
  const response = await fetch(`${base}/ops`, {
    headers,
    signal: AbortSignal.timeout(NATIVE_CATALOG_BUDGET_MS),
  });
  if (!response.ok) throw new Error(`GET ${base}/ops answered ${response.status}`);
  return (await response.json()) as {
    operations?: OpsCatalogEntry[];
    bridgeSessionId?: string;
    bridgeCatalogError?: string;
  };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
