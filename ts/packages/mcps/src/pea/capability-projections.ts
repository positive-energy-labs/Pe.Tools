import { z } from "zod";
import {
  capabilityPrincipals,
  nativePrincipals,
  admittedRouteEntries,
  routeAddress,
  viewRoutes,
  agentFields,
  parseContributionKey,
  type Capability,
  type RouteStateSpec,
  type PackageProjection,
  type ViewRoute,
} from "@pe/agent-contracts";
import { isTsOnlyOperationKey } from "@pe/host-contracts/operation-types";
import type { HostOperationDefinition } from "@pe/host-contracts/contracts";
import type { SkillSnapshot } from "./skill-publication.ts";
import type { CapabilitySources } from "./capabilities.ts";
export type OpsCatalogEntry = HostOperationDefinition & {
  principal?: readonly import("@pe/agent-contracts").Principal[];
};
export function podCapabilities(): Capability[] {
  return [...admittedRouteEntries.values()]
    .filter((row) => row.available())
    .flatMap(({ entries }) =>
      Object.entries(entries).map(
        ([key, entry]): Capability => ({
          key: `op:${key}`,
          kind: "op",
          title: entry.says,
          description: entry.says,
          needs: entry.needs,
          effect: entry.effect,
          mutates: entry.effect === "command",
          principal: capabilityPrincipals(entry.effect === "command", entry.principal),
          input: z.toJSONSchema(entry.input) as Record<string, unknown>,
          source: "catalog",
          rank: 2,
        }),
      ),
    );
}

/** The runtime provider for packages, skills, Pages, route Work docs and leased views. */
export function dynamicCapabilityProvider(sources: CapabilitySources): Capability[] {
  return [
    ...podCapabilities(),
    ...sources.routes.flatMap(routeRows),
    ...viewRoutes(sources.admittedRoutes?.() ?? []).flatMap(routeViewRows),
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

export function opRow(op: OpsCatalogEntry): Capability {
  return {
    key: `op:${op.key}`,
    kind: "op",
    title: op.displayName ?? op.key,
    description: [op.description ?? "", ...(op.callGuidance ?? [])].filter(Boolean).join(" "),
    // [Op(Finds = ...)] is the op's search vocabulary; without it "point at" or "highlight" never reach the op.
    ...(op.searchTerms?.length ? { finds: [...op.searchTerms] } : {}),
    needs: op.needs === "nothing" && !isTsOnlyOperationKey(op.key) ? "session" : op.needs,
    effect: op.intent !== "Read" ? "command" : "query",
    mutates: op.intent !== "Read",
    principal: capabilityPrincipals(
      op.intent !== "Read",
      op.principal ?? nativePrincipals(op.actor),
    ),
    input: parseSchema(op.requestSchemaJson),
    output: op.responseSchemaJson ? parseSchema(op.responseSchemaJson) : undefined,
    source: "catalog",
    rank: visibilityRank[op.visibility ?? "DefaultVisible"] ?? 0,
  };
}

/** A route that leases its view (`viewRoute`) gets one read and one set, both over the person's open page. */
function routeViewRows({ key: route, title, fields: admitted, builtin }: ViewRoute): Capability[] {
  const spec = builtin && routeAddress(builtin).agent;
  // An admitted route projects its keys from the admitted graph's agent policy; the browser owner
  // holds the codecs, so each settable key is the text the view shows (ADR 0030 rule 10).
  const settable = admitted && agentFields(admitted, "set").map(([key]) => key);
  const { policy, words, keys, fields, finds = [] } = settable
    ? {
        policy: "Read the view, then patch a key in the form the view shows it.",
        words: undefined,
        keys: agentFields(admitted!).map(([key]) => key),
        fields: z.object(Object.fromEntries(settable.map((key) => [key, z.string()]))),
        finds: spec ? spec.finds : [],
      }
    : spec!; // `viewRoute` gives a route without admitted fields only for a builtin address.
  const sets = Object.keys(fields.shape);
  const lower = title.toLowerCase();
  return [
    {
      key: `route:${route}.view`,
      kind: "route-command",
      title: `${title} visible view`,
      description: `Read the ${title} page associated with this conversation in the person's browser: its keys (${keys.join(", ")}; settable: ${sets.join(", ")}) with their current values, the identity of what is shown, and the facts it derives. ${policy} Returns instance and revision for ${`route:${route}.set-view`}. If two panes are open, pass an instance from the ambiguity result. No Revit read.`,
      finds: [lower, "visible", "page", ...finds],
      needs: "nothing",
      effect: "query",
      mutates: false,
      principal: capabilityPrincipals(false),
      input: z.toJSONSchema(z.object({ instance: z.uuid().optional() })) as Record<string, unknown>,
      source: "browser Page",
      rank: 2,
    },
    {
      key: `route:${route}.set-view`,
      kind: "route-command",
      title: `Set ${title} visible view`,
      description: `${policy} For a mounted view, read route:${route}.view first, then pass its instance and revision. To explicitly open this tool in the browser showing this conversation, omit both instance and revision; the call waits for that command's rendered view and uses its revision, or returns applied: false if none mounts. Browser Places and saved Work remain independent of the conversation. Pass a nonempty subset of ${sets.join(", ")}${words ? ` or ${Object.keys(words.shape).join(", ")}` : ""}. The browser acknowledges an applied render before this returns.`,
      finds: [lower, "filter", "visible", "page", ...finds],
      needs: "nothing",
      effect: "command",
      mutates: true,
      principal: capabilityPrincipals(true),
      input: z.toJSONSchema(
        z.union([
          z.object({
            instance: z.uuid(),
            revision: z.number().int().nonnegative(),
            ...fields.partial().shape,
            ...words?.partial().shape,
          }),
          z.object({
            instance: z.never().optional(),
            revision: z.never().optional(),
            ...fields.partial().shape,
            ...words?.partial().shape,
          }),
        ]),
      ) as Record<string, unknown>,
      source: "browser Page",
      rank: 2,
    },
  ];
}

function routeRows(spec: RouteStateSpec<z.ZodType>): Capability[] {
  const scopeHint = "Read the current Work before editing it with its revision.";
  const read: Capability = {
    key: `route:${spec.route}`,
    kind: "route-doc",
    title: spec.title,
    description: `Read the ${spec.title} document you co-edit with the user: current doc, revision and handle. Pass input {schema: true} only when you need its JSON Schema. ${spec.description} ${scopeHint}`,
    needs: "nothing",
    effect: "query",
    mutates: false,
    principal: capabilityPrincipals(false),
    input: z.toJSONSchema(z.object({ schema: z.boolean().optional() })) as Record<string, unknown>,
    source: "route registry",
    rank: 1,
  };
  const edit: Capability = {
    key: `route:${spec.route}.edit`,
    kind: "route-doc",
    title: `${spec.title}: edit`,
    description: `Edit shared Work with expectedRevision from the read. Each cell holds one staged edit; either author may replace it and the last writer wins, shown with its author. Attribution and host evidence are host-owned. Omit value to delete an authored key. To take back an edit, use route:${spec.route}.history, never a null or cleared value. ${spec.finds?.join(" ") ?? ""} ${scopeHint}`,
    finds:
      spec.route === "ducts"
        ? ["duct network", "network work"]
        : spec.finds
          ? [...spec.finds]
          : undefined,
    needs: "nothing",
    effect: "command",
    mutates: true,
    principal: capabilityPrincipals(true),
    input: z.toJSONSchema(
      z.object({
        patches: z
          .array(z.object({ path: z.array(z.union([z.string(), z.number()])), value: z.unknown() }))
          .min(1)
          .optional(),
      }),
    ) as Record<string, unknown>,
    source: "route registry",
    rank: 0,
  };
  const history: Capability = {
    key: `route:${spec.route}.history`,
    kind: "route-doc",
    title: `${spec.title}: undo or redo`,
    description: `Undo or redo the last step of this Work's one journal, the same step the user's Undo takes: undo restores the Work exactly as it was before the step (no null placeholders) as one new revision, and redo puts it back. The step may be yours or the user's; the result's write names who made it. Refuses, writing nothing, when the step's values changed elsewhere or nothing is left to undo. ${scopeHint}`,
    finds: ["undo", "redo", "revert", "take back", "roll back edit"],
    needs: "nothing",
    effect: "command",
    mutates: true,
    principal: capabilityPrincipals(true),
    input: z.toJSONSchema(z.object({ direction: z.enum(["undo", "redo"]) })) as Record<
      string,
      unknown
    >,
    source: "route registry",
    rank: 0,
  };
  return [read, edit, history];
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
        effect: reference.kind === "script" ? "command" : "query",
        mutates: reference.kind === "script",
        principal: capabilityPrincipals(reference.kind === "script"),
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
    effect: "query",
    mutates: false,
    principal: capabilityPrincipals(false),
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
