import {
  instancesReading,
  scheduleReads,
  actionControls,
  semanticActions,
  familyReads,
  actionBasesSchema,
  settingsRouteState,
} from "@pe/agent-contracts";
/**
 * The one capability catalog. Every door pea has (ops, route documents, route commands, pod
 * buttons, skills) projects into `Capability` rows here; `GET /pe/capabilities` serves it,
 * `pe_find` ranks it, `pe_read`/`pe_do` dispatch by kind, the web `/ops` route renders it.
 *
 * Assembled on request (cached 30 s per bridge selector), not at boot: the op and pod sources
 * describe whichever Revit session is connected right now. Every live source has a 2 s budget
 * and is read with `Promise.allSettled`; a source that did not answer is named in `sources` and
 * contributes zero rows, so a no-Revit host answers in well under 3 s.
 */
import { z } from "zod";
import type { HostOperationDefinition } from "@pe/host-contracts/contracts";
import {
  HOST_RPC_BRIDGE_SESSION_HEADER,
  isTsOnlyOperationKey,
  type HostOpResponse,
  type PodList,
} from "@pe/host-contracts/operation-types";
import type { Capability, CapabilityCatalog, RouteStateSpec } from "@pe/agent-contracts";
import { HostRpcCaller } from "../shared/host-rpc-caller.ts";
import { bundledPeaSkills, type BundledPeaSkill } from "./skills.ts";
import type { RouteRegistration } from "./routes.ts";

type OpsCatalogEntry = HostOperationDefinition & {
  requestSchemaJson?: string;
  responseSchemaJson?: string;
};
export type { PodList };
type Sessions = HostOpResponse<"bridge.sessions.list">["sessions"];

export interface CapabilitySources {
  ops: readonly OpsCatalogEntry[];
  routes: readonly RouteStateSpec<z.ZodType>[];
  pods: PodList | null;
  skills: readonly BundledPeaSkill[];
}

/** Pure projection of every source into rows. Deterministic order: op, route, pod, skill. */
export function buildCapabilities(sources: CapabilitySources): Capability[] {
  return [
    ...sources.ops.map(opRow),
    {
      key: "op:instances.read",
      kind: "op",
      title: "Instances readings",
      // Named, not spread: an action row also carries `says`/`dirties`, which a Capability is not.
      description: instancesReading.description,
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
        description: action.description,
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
        description: reading.description,
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
        description: action.description,
        needs: action.needs,
        actor: action.actor,
        mutates: action.mutates,
        input: z.toJSONSchema(action.input) as Record<string, unknown>,
        source: "semantic action",
        rank: 2,
      }),
    ),
    ...sources.routes.flatMap(routeRows),
    ...(sources.pods?.pods ?? []).flatMap(podRows),
    ...sources.skills.map(skillRow),
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
      ? "Supply workspaceId for the member's Work and open it with { member: { pod, path } }; this is shared file Work independent of Revit."
      : "Runs under this thread's Scope; no target input.";
  const read: Capability = {
    key: `route:${spec.route}`,
    kind: "route-doc",
    title: spec.title,
    description: `Read the ${spec.title} document you co-edit with the user: current doc, revision, JSON Schema, agent write mask, and commands. ${spec.description} ${scopeHint}`,
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

/** Entrypoints only: members are data, reached through route:pods, never executable rows. */
function podRows(pod: PodList["pods"][number]): Capability[] {
  if (pod.diagnostics.length) return [];
  return pod.entrypoints.map((entry) => ({
    key: `pod:${pod.folder}.${entry.id}`,
    kind: "pod",
    title: `${pod.name}: ${entry.name ?? entry.id}`,
    description:
      `${entry.description ?? ""} Pod button the user presses in Revit's Do palette; runs ${entry.sourcePath} in-process through the public scripting.execute operation; its receipt belongs to the host journal. Defaults to ReadOnly (changes rolled back); pass permissionMode WriteTransaction to keep edits.`.trim(),
    needs: "document",
    mutates: true,
    actor: "any",
    input: podInputSchema,
    source: "pod.json",
    rank: 1,
  }));
}

const podInputSchema = z.toJSONSchema(
  z.object({
    permissionMode: z.enum(["ReadOnly", "WriteTransaction", "NoTransaction"]).optional(),
    timeoutSeconds: z.number().int().min(1).max(3600).optional(),
  }),
) as Record<string, unknown>;

function skillRow(skill: BundledPeaSkill): Capability {
  return {
    key: `skill:${skill.name}`,
    kind: "skill",
    title: skill.name,
    description: /^description:\s*(.+)$/m.exec(skill.content)?.[1]?.trim() ?? "",
    needs: "nothing",
    mutates: false,
    actor: "any",
    input: {},
    source: "skills",
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
const SOURCE_BUDGET_MS = 2_000;

export interface CapabilityCatalogSource {
  /** The catalog for one bridge selector (`session:<id>`, `doc:<Address>`, or none). */
  read(bridgeSelector?: string): Promise<CapabilityCatalog>;
  /** Drop every cached catalog; the host calls this when a Revit session connects or leaves. */
  invalidate(): void;
}

/**
 * The host's catalog reader. Routes and skills are static; ops, pods, and sessions come from
 * the host's own port for the selected bridge session.
 */
export function createCapabilityCatalogSource(options: {
  hostBaseUrl: string;
  registrations: readonly RouteRegistration[];
}): CapabilityCatalogSource {
  const base = options.hostBaseUrl.replace(/\/$/, "");
  const routes = options.registrations.map((registration) => registration.spec);
  const cache = new Map<string, { at: number; catalog: CapabilityCatalog }>();
  return {
    invalidate: () => cache.clear(),
    read: async (bridgeSelector) => {
      const cacheKey = bridgeSelector ?? "";
      const hit = cache.get(cacheKey);
      if (hit && Date.now() - hit.at < CATALOG_TTL_MS) return hit.catalog;

      const sources: Record<string, string> = { "route registry": "ok", skills: "ok" };
      const caller = new HostRpcCaller({
        hostBaseUrl: base,
        bridgeSessionId: bridgeSelector,
        timeoutMs: SOURCE_BUDGET_MS,
      });
      const [ops, pods, sessions] = await Promise.allSettled([
        fetchOps(base, bridgeSelector),
        caller.call("pod.list"),
        caller.call("bridge.sessions.list"),
      ]);
      const opsValue =
        ops.status === "fulfilled" ? ops.value : { operations: [] as OpsCatalogEntry[] };
      sources.catalog =
        ops.status === "rejected"
          ? `did not answer: ${message(ops.reason)}`
          : opsValue.bridgeCatalogError
            ? `bridge catalog unavailable: ${opsValue.bridgeCatalogError}`
            : "ok";
      sources["pod.json"] =
        pods.status === "rejected" ? `did not answer: ${message(pods.reason)}` : "ok";
      sources.sessions =
        sessions.status === "rejected" ? `did not answer: ${message(sessions.reason)}` : "ok";
      const sessionList: Sessions = sessions.status === "fulfilled" ? sessions.value.sessions : [];
      const catalog: CapabilityCatalog = {
        at: new Date().toISOString(),
        bridgeSessionId: opsValue.bridgeSessionId,
        sessions: sessionList.map((session) => ({
          sessionId: session.sessionId,
          custody: session.custody ?? undefined,
          sdkSessionId: session.sdkSessionId,
          revitVersion: session.revitVersion,
          activeDocumentTitle: session.activeDocumentTitle,
          activeDocument: session.activeDocumentCloudModelGuid ?? session.activeDocumentPath,
          openDocuments:
            session.openDocuments?.map((doc) => ({ ...doc, address: doc.address ?? null })) ?? null,
        })),
        sources,
        capabilities: buildCapabilities({
          ops: opsValue.operations ?? [],
          routes,
          pods: pods.status === "fulfilled" ? pods.value : null,
          skills: bundledPeaSkills,
        }),
      };
      cache.set(cacheKey, { at: Date.now(), catalog });
      return catalog;
    },
  };
}

async function fetchOps(base: string, bridgeSelector?: string) {
  const headers: Record<string, string> = {};
  if (bridgeSelector) headers[HOST_RPC_BRIDGE_SESSION_HEADER] = bridgeSelector;
  const response = await fetch(`${base}/ops`, {
    headers,
    signal: AbortSignal.timeout(SOURCE_BUDGET_MS),
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
