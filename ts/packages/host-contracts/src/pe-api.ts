import { z } from "zod";
import { podRouteDescriptorSchema } from "./pod-route.ts";
export * from "./pod-route.ts";
import { hostDescriptorSchema } from "./host-descriptor.ts";
import { deviceListingSchema, deviceSessionSchema, pairingSchema } from "./remote-device.ts";
import type { SessionObservation } from "./vendor/generated/pe-revit-contract.ts";
export * from "./remote-device.ts";

/** An authored scratch Page. Publication needs no document target. */
export const pagePublicationSchema = z.strictObject({
  kind: z.literal("page"),
  slug: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9][a-z0-9_.-]*$/i)
    .refine(
      (slug) =>
        !slug.includes("--") &&
        !slug.endsWith(".") &&
        !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(slug) &&
        !["pe.js", "pe.css", "revit.js", "revit.css", "kit"].includes(slug.toLowerCase()),
      "Invalid Page folder name",
    ),
  title: z.string().trim().min(1).max(200),
  html: z.string().min(1).max(2_000_000),
  width: z.number().int().min(240).max(1600).optional(),
});
export type PagePublication = z.infer<typeof pagePublicationSchema>;
export const pagePublicationResultSchema = z.strictObject({
  ok: z.literal(true),
  kind: z.literal("page"),
  key: z.string().startsWith("page:@pages/"),
  slug: z.string(),
  title: z.string(),
  openUrl: z.url(),
  capture: z.strictObject({
    mimeType: z.literal("image/png"),
    url: z.url(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    data: z.string().min(1),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }),
});

export const peErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
const none = z.undefined();
export const threadPresenceSchema = z.strictObject({
  thread: z.string().min(1),
  visible: z.boolean(),
  focused: z.boolean(),
});
export type ThreadPresence = z.infer<typeof threadPresenceSchema>;
export const bootstrapAlignmentSchema = z.strictObject({
  id: z.string().min(1).max(200),
  year: z.string().regex(/^20\d{2}$/),
  confirmedVersion: z.string().min(1),
});

/** A journal failure is still a running incarnation; only gone and persisted failures are history. */
export function bootstrapBlockers(rows: readonly SessionObservation[]): string[] {
  return rows.flatMap((row) => {
    if (
      row.case === "gone-receipt" ||
      (row.case === "failed-receipt" && row.failure.source === "receipt")
    )
      return [];
    const process =
      "process" in row
        ? row.process
        : row.case === "failed-receipt" && row.failure.source === "journal"
          ? row.failure.process
          : row.case === "controlled-pending" && row.attempt.attempt === "launched"
            ? row.attempt.process
            : null;
    return [
      `Revit ${row.year} ${"id" in row ? row.id : "started from its icon"}${process ? ` pid ${process.pid}` : " (starting)"}`,
    ];
  });
}
const object = z.record(z.string(), z.unknown());
const ok = z.object({ ok: z.boolean() }).passthrough();
type Principal = "read" | "caller" | "human" | "human-or-pea" | "human-or-page";
export type PeRoutePermission = Principal | "admin" | "grant" | "operation" | "pair";
type Owner = "tasks" | "pe" | "threads" | "providers" | "share" | "pages" | "gateway" | "plugins";

function route<const P extends string, B extends z.ZodType, O extends z.ZodType>(
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: P,
  body: B,
  output: O,
  principal: Principal,
  owner: Owner,
  permission: PeRoutePermission,
  format: "json" | "stream" | "asset" = "json",
  encoding: "json" | "text" = "json",
) {
  const params = z.object(
    Object.fromEntries(
      path
        .split("/")
        .filter((p) => p.startsWith(":"))
        .map((p) => [p.slice(1), z.string().min(1)]),
    ),
  );
  return {
    method,
    path,
    input: z.object({ params, query: z.record(z.string(), z.string()), body }),
    body,
    output,
    error: peErrorSchema,
    principal,
    permission,
    // Share is the one door a remote caller may never reach, whatever its principal.
    localOnly: owner === "share",
    owner,
    format,
    encoding,
  };
}

/** The schemas a route table names; each domain owner supplies its own. */
export type PeApiSchemas = Record<
  | "accessSchema"
  | "addProviderRequestSchema"
  | "providerSchema"
  | "createThreadRequestSchema"
  | "updateThreadRequestSchema"
  | "threadPlaceRequestSchema"
  | "harnessThreadSummarySchema"
  | "harnessThreadBodySchema"
  | "harnessEventSchema"
  | "threadExportSchema"
  | "pluginStatusSchema"
  | "promptRequestSchema"
  | "turnStateSchema"
  | "queueRequestSchema"
  | "hostLogPageSchema"
  | "permissionResponseSchema"
  | "questionResponseSchema"
  | "forkThreadRequestSchema"
  | "traitRequestSchema"
  | "threadHeadSchema"
  | "putTargetSchema"
  | "putTargetResultSchema"
  | "capabilityCatalogSchema"
  | "navigationSnapshotSchema"
  | "threadWorkSnapshotSchema"
  | "workResumeSchema"
  | "turnElementNamesRequestSchema"
  | "turnElementNamesObservationSchema"
  | "routeStatePatchSchema"
  | "ductsSheetRequestSchema"
  | "ductsSheetResponseSchema"
  | "ductsRosterRequestSchema"
  | "ductsRosterResponseSchema"
  | "ductsAnalysisRequestSchema"
  | "ductsAnalysisResponseSchema"
  | "routeViewSchema"
  | "routeViewOpenSchema"
  | "routeViewSetSchema"
  | "routeViewAckSchema"
  | "pageChoiceSchema"
  | "diagnosticBodySchema"
  | "actionAdmissionSchema"
  | "actionReceiptSchema"
  | "actionControlInputSchema",
  z.ZodType
>;

/** The one route table: every declared door, built from the domain schemas. */
export function peRouteTable<S extends PeApiSchemas>(schemas: S) {
  const accessSchema = schemas.accessSchema as S["accessSchema"];
  const pluginStatusSchema = schemas.pluginStatusSchema as S["pluginStatusSchema"];
  const addProviderRequestSchema =
    schemas.addProviderRequestSchema as S["addProviderRequestSchema"];
  const providerSchema = schemas.providerSchema as S["providerSchema"];
  const createThreadRequestSchema =
    schemas.createThreadRequestSchema as S["createThreadRequestSchema"];
  const updateThreadRequestSchema =
    schemas.updateThreadRequestSchema as S["updateThreadRequestSchema"];
  const harnessThreadSummarySchema =
    schemas.harnessThreadSummarySchema as S["harnessThreadSummarySchema"];
  const harnessThreadBodySchema = schemas.harnessThreadBodySchema as S["harnessThreadBodySchema"];
  const promptRequestSchema = schemas.promptRequestSchema as S["promptRequestSchema"];
  const turnStateSchema = schemas.turnStateSchema as S["turnStateSchema"];
  const queueRequestSchema = schemas.queueRequestSchema as S["queueRequestSchema"];
  const hostLogPageSchema = schemas.hostLogPageSchema as S["hostLogPageSchema"];
  const permissionResponseSchema =
    schemas.permissionResponseSchema as S["permissionResponseSchema"];
  const questionResponseSchema = schemas.questionResponseSchema as S["questionResponseSchema"];
  const forkThreadRequestSchema = schemas.forkThreadRequestSchema as S["forkThreadRequestSchema"];
  const traitRequestSchema = schemas.traitRequestSchema as S["traitRequestSchema"];
  const threadHeadSchema = schemas.threadHeadSchema as S["threadHeadSchema"];
  const putTargetSchema = schemas.putTargetSchema as S["putTargetSchema"];
  const putTargetResultSchema = schemas.putTargetResultSchema as S["putTargetResultSchema"];
  const capabilityCatalogSchema = schemas.capabilityCatalogSchema as S["capabilityCatalogSchema"];
  const navigationSnapshotSchema =
    schemas.navigationSnapshotSchema as S["navigationSnapshotSchema"];
  const routeStatePatchSchema = schemas.routeStatePatchSchema as S["routeStatePatchSchema"];
  const routeViewSchema = schemas.routeViewSchema as S["routeViewSchema"];
  const routeViewSetSchema = schemas.routeViewSetSchema as S["routeViewSetSchema"];
  const routeViewAckSchema = schemas.routeViewAckSchema as S["routeViewAckSchema"];
  const pageChoiceSchema = schemas.pageChoiceSchema as S["pageChoiceSchema"];
  const feedbackSchema = z.strictObject({
    comment: z.string().trim().min(1).max(8000),
    url: z.string().max(2048),
    selector: z.string().max(2048).nullable(),
    component: z.string().max(200).nullable(),
    components: z.array(z.string().max(200)).max(64),
    html: z.string().max(4000),
    rect: z.strictObject({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }),
    viewport: z.strictObject({ width: z.number(), height: z.number(), dpr: z.number() }),
    picture: z
      .string()
      .startsWith("data:image/")
      .max(256 * 1024)
      .nullable(),
    picture_error: z.string().max(500).nullable(),
  });
  /** Pea's report on its own tooling. No kind field: a later miner owns taxonomy (owner ruling 2026-10-14). */
  const agentFeedbackSchema = z.strictObject({
    surface: z.string().trim().min(1).max(300),
    expected: z.string().trim().min(1).max(2000),
    observed: z.string().trim().min(1).max(4000),
    workaround: z.string().trim().min(1).max(2000).optional(),
    refs: z.array(z.string().trim().min(1).max(300)).max(20).optional(),
  });
  const feedbackReceiptSchema = z.discriminatedUnion("delivery", [
    z.strictObject({ feedbackId: z.uuid(), delivery: z.literal("accepted") }),
    z.strictObject({
      feedbackId: z.uuid(),
      delivery: z.enum(["failed", "uncertain"]),
      error: z.string(),
    }),
  ]);
  const diagnosticsSchema = z.strictObject({
    browserSessionId: z.uuid(),
    dropped: z.number().int().nonnegative(),
    facts: z
      .array(
        z.strictObject({
          at: z.iso.datetime(),
          body: schemas.diagnosticBodySchema as S["diagnosticBodySchema"],
        }),
      )
      .max(64),
  });
  /** Public HTTP transport authority. Domain schemas stay with their domain owners. */
  const peRoutes = {
    "notices.presence": route(
      "POST",
      "/pe/notices/presence/:caller",
      threadPresenceSchema,
      ok,
      "caller",
      "pe",
      "caller",
    ),
    "features.get": route("GET", "/pe/features", none, hostDescriptorSchema, "read", "pe", "read"),
    "machine.bootstrap": route(
      "POST",
      "/pe/machine/bootstrap",
      bootstrapAlignmentSchema,
      schemas.actionReceiptSchema as S["actionReceiptSchema"],
      "human",
      "pe",
      "admin",
    ),
    "operation.call": route(
      "POST",
      "/call",
      z.object({ key: z.string().min(1), request: z.unknown().optional() }),
      z.unknown(),
      "read",
      "gateway",
      "operation",
    ),
    "actions.admit": route(
      "POST",
      "/actions",
      schemas.actionAdmissionSchema as S["actionAdmissionSchema"],
      schemas.actionReceiptSchema as S["actionReceiptSchema"],
      "caller",
      "gateway",
      "caller",
    ),
    "actions.read": route("GET", "/actions", none, z.unknown(), "read", "gateway", "read"),
    "action.cancel": route(
      "POST",
      "/actions/cancel",
      schemas.actionControlInputSchema as S["actionControlInputSchema"],
      schemas.actionReceiptSchema as S["actionReceiptSchema"],
      "caller",
      "gateway",
      "caller",
    ),
    "action.recover": route(
      "POST",
      "/actions/recover",
      schemas.actionControlInputSchema as S["actionControlInputSchema"],
      schemas.actionReceiptSchema as S["actionReceiptSchema"],
      "caller",
      "gateway",
      "caller",
    ),
    "action.resume": route(
      "POST",
      "/actions/resume",
      schemas.actionControlInputSchema as S["actionControlInputSchema"],
      schemas.actionReceiptSchema as S["actionReceiptSchema"],
      "caller",
      "gateway",
      "caller",
    ),
    "providers.list": route(
      "GET",
      "/pe/providers",
      none,
      z.array(providerSchema),
      "read",
      "providers",
      "read",
    ),
    "providers.add": route(
      "POST",
      "/pe/providers",
      addProviderRequestSchema,
      providerSchema,
      "human",
      "providers",
      "admin",
    ),
    "provider.get": route(
      "GET",
      "/pe/providers/:id",
      none,
      providerSchema,
      "read",
      "providers",
      "read",
    ),
    "provider.remove": route(
      "DELETE",
      "/pe/providers/:id",
      none,
      none,
      "human",
      "providers",
      "admin",
    ),
    "provider.probe": route(
      "POST",
      "/pe/providers/:id/probe",
      none,
      providerSchema,
      "human",
      "providers",
      "admin",
    ),
    "provider.login": route(
      "POST",
      "/pe/providers/:id/open-login",
      none,
      z.object({ opened: z.literal(true) }),
      "human",
      "providers",
      "admin",
    ),
    "access.get": route("GET", "/pe/access", none, accessSchema, "read", "providers", "read"),
    "access.set": route(
      "PUT",
      "/pe/access",
      accessSchema,
      accessSchema,
      "human",
      "providers",
      "admin",
    ),
    "plugins.routes": route(
      "GET",
      "/pe/plugin-routes",
      none,
      z.array(podRouteDescriptorSchema),
      "read",
      "plugins",
      "read",
    ),
    "plugins.routeTrust": route(
      "PUT",
      "/pe/plugin-routes/:key/trust",
      z.strictObject({ sha256: z.string().regex(/^[a-f0-9]{64}$/), trusted: z.boolean() }),
      z.array(podRouteDescriptorSchema),
      "human",
      "plugins",
      "admin",
    ),
    "plugins.routeBundle": route(
      "GET",
      "/pe/plugin-routes/:key/bundle/:hash",
      none,
      z.unknown(),
      "read",
      "plugins",
      "read",
      "asset",
    ),
    "plugins.list": route(
      "GET",
      "/pe/plugins",
      none,
      z.array(pluginStatusSchema),
      "read",
      "plugins",
      "read",
    ),
    "plugin.update": route(
      "PUT",
      "/pe/plugins/:id",
      z.strictObject({ enabled: z.boolean() }),
      z.array(pluginStatusSchema),
      "human",
      "plugins",
      "admin",
    ),
    "tasks.list": route("GET", "/pe/tasks", none, z.array(object), "human", "tasks", "admin"),
    "tasks.enabled": route(
      "PUT",
      "/pe/tasks/:id/enabled",
      z.strictObject({ enabled: z.boolean() }),
      object,
      "human",
      "tasks",
      "admin",
    ),
    "tasks.run": route(
      "POST",
      "/pe/tasks/:id/run",
      z.strictObject({ force: z.boolean().default(false) }),
      object,
      "human",
      "tasks",
      "admin",
    ),
    "threads.history": route(
      "GET",
      "/pe/thread-history",
      none,
      object,
      "human-or-pea",
      "tasks",
      "read",
    ),
    "threads.list": route(
      "GET",
      "/pe/threads",
      none,
      z.array(harnessThreadSummarySchema),
      "read",
      "threads",
      "read",
    ),
    "threads.create": route(
      "POST",
      "/pe/threads",
      createThreadRequestSchema,
      harnessThreadSummarySchema,
      "caller",
      "threads",
      "caller",
    ),
    "thread.get": route(
      "GET",
      "/pe/threads/:id",
      none,
      harnessThreadBodySchema,
      "read",
      "threads",
      "read",
    ),
    "thread.export": route(
      "GET",
      "/pe/threads/:id/export",
      none,
      schemas.threadExportSchema,
      "read",
      "threads",
      "read",
      "asset",
    ),
    "thread.update": route(
      "PUT",
      "/pe/threads/:id",
      updateThreadRequestSchema,
      harnessThreadSummarySchema,
      "caller",
      "threads",
      "caller",
    ),
    "thread.place": route(
      "POST",
      "/pe/threads/:id/place",
      schemas.threadPlaceRequestSchema as S["threadPlaceRequestSchema"],
      harnessThreadSummarySchema,
      "caller",
      "threads",
      "caller",
    ),
    "thread.remove": route("DELETE", "/pe/threads/:id", none, none, "caller", "threads", "caller"),
    "thread.prompt": route(
      "POST",
      "/pe/threads/:id/prompt",
      promptRequestSchema,
      turnStateSchema,
      "human-or-pea",
      "threads",
      "human-or-pea",
    ),
    "thread.queue": route(
      "POST",
      "/pe/threads/:id/queue",
      queueRequestSchema,
      turnStateSchema,
      "human",
      "threads",
      "human",
    ),
    /** Query `turn` and `timeoutMs`: answers once the turn settles, or as it stands at the timeout. */
    "thread.wait": route(
      "GET",
      "/pe/threads/:id/wait",
      none,
      turnStateSchema,
      "read",
      "threads",
      "read",
    ),
    "thread.cancel": route(
      "POST",
      "/pe/threads/:id/cancel",
      none,
      z.object({ cancelled: z.boolean() }),
      "caller",
      "threads",
      "caller",
    ),
    "thread.permission": route(
      "POST",
      "/pe/threads/:id/permission",
      permissionResponseSchema,
      ok,
      "human",
      "threads",
      "human",
    ),
    "thread.question": route(
      "POST",
      "/pe/threads/:id/question",
      questionResponseSchema,
      ok,
      "human",
      "threads",
      "human",
    ),
    "thread.fork": route(
      "POST",
      "/pe/threads/:id/fork",
      forkThreadRequestSchema,
      harnessThreadSummarySchema,
      "caller",
      "threads",
      "caller",
    ),
    "thread.model": route(
      "POST",
      "/pe/threads/:id/model",
      z.object({ modelId: z.string() }),
      harnessThreadSummarySchema,
      "caller",
      "threads",
      "caller",
    ),
    "thread.trait": route(
      "POST",
      "/pe/threads/:id/trait",
      traitRequestSchema,
      harnessThreadBodySchema,
      "caller",
      "threads",
      "caller",
    ),
    "scope.get": route(
      "GET",
      "/pe/scope/:id",
      none,
      threadHeadSchema.and(z.object({ thread: z.string().optional() })),
      "read",
      "threads",
      "read",
    ),
    "scope.set": route(
      "PUT",
      "/pe/scope/:id",
      putTargetSchema,
      putTargetResultSchema,
      "human-or-pea",
      "threads",
      "grant",
    ),
    "navigation.get": route(
      "GET",
      "/pe/navigation",
      none,
      navigationSnapshotSchema,
      "read",
      "pe",
      "read",
    ),
    "thread-work.get": route(
      "GET",
      "/pe/thread-work",
      none,
      schemas.threadWorkSnapshotSchema as S["threadWorkSnapshotSchema"],
      "read",
      "pe",
      "read",
    ),
    "work.resume": route(
      "GET",
      "/pe/work-resume",
      none,
      schemas.workResumeSchema as S["workResumeSchema"],
      "read",
      "pe",
      "read",
    ),
    "turn.element-names": route(
      "POST",
      "/pe/turn-element-names",
      schemas.turnElementNamesRequestSchema as S["turnElementNamesRequestSchema"],
      schemas.turnElementNamesObservationSchema as S["turnElementNamesObservationSchema"],
      "read",
      "pe",
      "read",
    ),
    "capabilities.find": route(
      "GET",
      "/pe/capabilities",
      none,
      capabilityCatalogSchema,
      "read",
      "pe",
      "read",
    ),
    "contributions.read": route("GET", "/pe/contributions", none, object, "read", "pe", "read"),
    "family.spec": route(
      "GET",
      "/pe/family-spec",
      none,
      z.unknown(),
      "read",
      "pe",
      "read",
      "asset",
    ),
    "feedback.submit": route(
      "POST",
      "/pe/feedback",
      feedbackSchema,
      feedbackReceiptSchema,
      "human",
      "pe",
      "human",
    ),
    "feedback.deliver": route(
      "POST",
      "/pe/feedback/:id/deliver",
      none,
      feedbackReceiptSchema,
      "human",
      "pe",
      "human",
    ),
    "agent-feedback.submit": route(
      "POST",
      "/pe/agent-feedback",
      agentFeedbackSchema,
      z.strictObject({ feedbackId: z.uuid() }),
      "caller",
      "pe",
      "caller",
    ),
    "diagnostics.submit": route(
      "POST",
      "/pe/diagnostics",
      diagnosticsSchema,
      z.object({ accepted: z.boolean() }),
      "human",
      "pe",
      "human",
    ),
    "receipts.read": route("GET", "/pe/receipt-facts", none, z.array(object), "read", "pe", "read"),
    "resources.stream": route("GET", "/pe/resources", none, object, "read", "pe", "read", "stream"),
    /** Query `after`, `kind`, `thread`, `limit`: one page of the host log after a cursor. */
    "log.read": route("GET", "/pe/log", none, hostLogPageSchema, "read", "pe", "read"),
    "work.list": route("GET", "/pe/route-state", none, z.array(object), "read", "pe", "read"),
    "work.get": route("GET", "/pe/route-state/:route", none, object, "read", "pe", "read"),
    "work.salvage": route(
      "GET",
      "/pe/route-state/:route/salvage",
      none,
      object,
      "human",
      "pe",
      "human",
    ),
    "work.apply": route(
      "POST",
      "/pe/route-state/:route/apply",
      z.object({
        patches: z.array(routeStatePatchSchema),
        expectedRevision: z.number().int().nonnegative(),
        press: z.string().min(1).nullable(),
        kind: z.enum(["apply", "restore"]).default("apply"),
      }),
      object,
      "human-or-pea",
      "pe",
      "human-or-pea",
    ),
    "work.fresh": route(
      "POST",
      "/pe/route-state/:route/start-fresh",
      z.object({}),
      object,
      "human",
      "pe",
      "human",
    ),
    "ducts.sheet": route(
      "POST",
      "/pe/ducts/sheet",
      schemas.ductsSheetRequestSchema as S["ductsSheetRequestSchema"],
      schemas.ductsSheetResponseSchema as S["ductsSheetResponseSchema"],
      "read",
      "pe",
      "read",
    ),
    "ducts.roster": route(
      "POST",
      "/pe/ducts/roster",
      schemas.ductsRosterRequestSchema as S["ductsRosterRequestSchema"],
      schemas.ductsRosterResponseSchema as S["ductsRosterResponseSchema"],
      "read",
      "pe",
      "read",
    ),
    "ducts.analysis": route(
      "POST",
      "/pe/ducts/analysis",
      schemas.ductsAnalysisRequestSchema as S["ductsAnalysisRequestSchema"],
      schemas.ductsAnalysisResponseSchema as S["ductsAnalysisResponseSchema"],
      "read",
      "pe",
      "read",
    ),
    "ducts.analysis-artifact": route(
      "GET",
      "/pe/ducts/analyses/:id/artifact",
      none,
      z.unknown(),
      "read",
      "pe",
      "read",
      "asset",
    ),
    "space.scene-artifact": route(
      "GET",
      "/pe/space/scenes/:id/artifact",
      none,
      z.unknown(),
      "read",
      "pe",
      "read",
      "asset",
    ),
    "view.get": route("GET", "/pe/route-view/:route", none, object, "read", "pe", "read"),
    "view.open": route(
      "POST",
      "/pe/route-view/:route/open",
      schemas.routeViewOpenSchema as S["routeViewOpenSchema"],
      object,
      "caller",
      "pe",
      "caller",
    ),
    "view.publish": route(
      "PUT",
      "/pe/route-view/:route",
      routeViewSchema,
      object,
      "caller",
      "pe",
      "caller",
    ),
    "view.set": route(
      "POST",
      "/pe/route-view/:route/set",
      routeViewSetSchema,
      object,
      "caller",
      "pe",
      "caller",
    ),
    "view.ack": route(
      "POST",
      "/pe/route-view/:route/ack",
      routeViewAckSchema,
      object,
      "caller",
      "pe",
      "caller",
    ),
    "view.remove": route(
      "DELETE",
      "/pe/route-view/:route/:instance",
      none,
      ok,
      "caller",
      "pe",
      "caller",
    ),
    "share.set": route(
      "PUT",
      "/pe/share",
      z.union([
        z.strictObject({ on: z.boolean() }),
        z.strictObject({ allowRemoteAdministration: z.boolean() }),
      ]),
      object,
      "human",
      "share",
      "admin",
    ),
    "device.list": route(
      "GET",
      "/pe/share/devices",
      none,
      deviceListingSchema,
      "human",
      "share",
      "admin",
    ),
    "device.pair": route(
      "POST",
      "/pe/share/pair",
      z.strictObject({ audience: z.enum(["browser", "mcp"]) }),
      pairingSchema,
      "human",
      "share",
      "admin",
    ),
    "device.revoke": route("DELETE", "/pe/share/devices/:id", none, ok, "human", "share", "admin"),
    "device.bind": route(
      "PUT",
      "/pe/share/devices/:id",
      z.strictObject({ thread: z.string().min(1).nullable() }),
      ok,
      "human",
      "share",
      "admin",
    ),
    "device.claim": route(
      "POST",
      "/pe/pair",
      z.strictObject({ code: z.string().min(1).max(80), label: z.string().trim().min(1).max(80) }),
      z.strictObject({
        environmentId: z.uuid(),
        session: deviceSessionSchema,
        token: z.string().optional(),
      }),
      "read",
      "gateway",
      "pair",
    ),
    "device.environment": route(
      "GET",
      "/pe/environment",
      none,
      z.strictObject({ environmentId: z.uuid(), paired: z.boolean(), local: z.boolean() }),
      "read",
      "gateway",
      "read",
    ),
    "page.export": route(
      "POST",
      "/pages/:slug/export",
      z.strictObject({ snapshot: z.unknown().optional() }),
      z.unknown(),
      "human-or-page",
      "pages",
      "human-or-page",
      "asset",
    ),
    "page.publish": route(
      "POST",
      "/pe/pages/publish",
      pagePublicationSchema,
      pagePublicationResultSchema,
      "human-or-pea",
      "pages",
      "human-or-pea",
    ),
    "page.target": route("GET", "/pages/:slug/target", none, object, "read", "pages", "read"),
    "page.call": route(
      "POST",
      "/pages/:slug/call",
      z.strictObject({ key: z.string().min(1), request: z.unknown().optional() }),
      z.unknown(),
      "human-or-page",
      "pages",
      "human-or-page",
    ),
    "page.act": route(
      "POST",
      "/pages/:slug/act",
      z.strictObject({ key: z.string().min(1), input: z.unknown().optional() }),
      object,
      "human-or-page",
      "pages",
      "human-or-page",
    ),
    "page.state": route("GET", "/pages/:slug/state", none, object, "read", "pages", "read"),
    "page.append": route(
      "POST",
      "/pages/:slug/events",
      object,
      object,
      "caller",
      "pages",
      "caller",
    ),
    "page.events": route(
      "GET",
      "/pages/:slug/events",
      none,
      object,
      "read",
      "pages",
      "read",
      "stream",
    ),
    "page.snapshot": route(
      "PUT",
      "/pages/:slug/snapshot",
      z.json(),
      none,
      "caller",
      "pages",
      "caller",
    ),
    "page.text": route(
      "PUT",
      "/pages/:slug/text",
      z.string(),
      none,
      "caller",
      "pages",
      "caller",
      "json",
      "text",
    ),
    "page.bind": route(
      "PUT",
      "/pe/pages/:slug/binding",
      pageChoiceSchema,
      object,
      "human-or-pea",
      "pages",
      "human-or-pea",
    ),
  } as const;
  return peRoutes;
}
/** The route table `definePeApi` serves, for a schema set. */
export type PeRouteTable<S extends PeApiSchemas> = ReturnType<typeof peRouteTable<S>>;
/** What any table entry carries for typing a call. */
type PeRouteLike = { path: string; body: z.ZodType; output: z.ZodType };
type ParamNames<P extends string> = P extends `${string}:${infer N}/${infer Tail}`
  ? N | ParamNames<Tail>
  : P extends `${string}:${infer N}`
    ? N
    : never;
export type PeRouteInput<T extends Record<string, PeRouteLike>, K extends keyof T> = ([
  ParamNames<T[K]["path"]>,
] extends [never]
  ? { params?: never }
  : { params: Record<ParamNames<T[K]["path"]>, string> }) &
  (undefined extends z.input<T[K]["body"]>
    ? { body?: z.input<T[K]["body"]> }
    : { body: z.input<T[K]["body"]> }) & {
    query?: Record<string, string | number | boolean | undefined>;
  };
export type PeRouteOutput<T extends Record<string, PeRouteLike>, K extends keyof T> = z.output<
  T[K]["output"]
>;
export interface PeClient<T extends Record<string, PeRouteLike>> {
  call<K extends keyof T & string>(
    id: K,
    input: PeRouteInput<T, K>,
    init?: RequestInit,
  ): Promise<PeRouteOutput<T, K>>;
  /** An untyped caller (a Page script, an agent): the id and raw input are checked at runtime. */
  invoke(id: string, raw: unknown): Promise<unknown>;
  response<K extends keyof T & string>(
    id: K,
    input: PeRouteInput<T, K>,
    init?: RequestInit,
  ): Promise<Response>;
  url<K extends keyof T & string>(id: K, input: PeRouteInput<T, K>): string;
}
/**
 * The served API over one route table. Named, so a declaration names it instead of inlining the
 * whole table into every export.
 */
export interface PeApi<T extends Record<string, PeRouteLike>> {
  peRoutes: T;
  isPeRouteId(id: string): id is keyof T & string;
  peRouteUrl<K extends keyof T & string>(
    id: K,
    input: Omit<PeRouteInput<T, K>, "body">,
    base?: string,
  ): string;
  matchPeRoute(
    method: string,
    path: string,
  ): { id: keyof T & string; route: T[keyof T]; params: Record<string, string> } | undefined;
  servePeRoute(
    request: Request,
    handle: (request: Request) => Promise<Response>,
  ): Promise<Response>;
  createPeClient(
    base?: string,
    transport?: (url: string, init?: RequestInit) => Promise<Response>,
  ): PeClient<T>;
  peClientScript(): string;
}

export function definePeApi<S extends PeApiSchemas>(schemas: S): PeApi<PeRouteTable<S>> {
  const peRoutes = peRouteTable(schemas);
  type PeRouteId = keyof typeof peRoutes;
  type PeInput<K extends PeRouteId> = PeRouteInput<typeof peRoutes, K>;
  type PeOutput<K extends PeRouteId> = PeRouteOutput<typeof peRoutes, K>;
  const isPeRouteId = (id: string): id is PeRouteId => Object.hasOwn(peRoutes, id);

  function peRouteUrl<K extends PeRouteId>(
    id: K,
    input: Omit<PeInput<K>, "body">,
    base = "",
  ): string {
    return createPeWire(peRoutes, base, globalThis.fetch).url(id, input);
  }

  function matchPeRoute(method: string, path: string) {
    for (const [id, route] of Object.entries(peRoutes)) {
      if (route.method !== method) continue;
      const names: string[] = [];
      const pattern = route.path.replace(/:([\w]+)/g, (_, name: string) => {
        names.push(name);
        return "([^/]+)";
      });
      const match = new RegExp(`^${pattern}$`).exec(path);
      if (match)
        return {
          id: id as PeRouteId,
          route,
          params: Object.fromEntries(names.map((n, i) => [n, decodeURIComponent(match[i + 1]!)])),
        };
    }
    return undefined;
  }

  function peProblem(status: number, code: string, message: string, details?: unknown) {
    return Response.json(
      { error: { code, message, ...(details === undefined ? {} : { details }) } },
      { status },
    );
  }

  /** The transport boundary preserves domain refusal evidence in the one error envelope. */
  async function servePeRoute(
    request: Request,
    handle: (request: Request) => Promise<Response>,
  ): Promise<Response> {
    const url = new URL(request.url);
    let match;
    try {
      match = matchPeRoute(request.method, url.pathname);
    } catch {
      return peProblem(400, "route.input", "Invalid route parameter encoding");
    }
    if (!match)
      return peProblem(404, "route.not-found", `No route ${request.method} ${url.pathname}`);
    const { route, params } = match;
    let body: unknown;
    if (request.method !== "GET" && request.method !== "DELETE") {
      const text = await request.clone().text();
      if (text || route.encoding === "text") {
        try {
          body = route.encoding === "text" ? text : JSON.parse(text);
        } catch {
          return peProblem(400, "route.input", "Expected a JSON body");
        }
      }
    }
    const parsed = route.input.safeParse({
      params,
      query: Object.fromEntries(url.searchParams),
      body,
    });
    if (!parsed.success)
      return peProblem(
        400,
        "route.input",
        parsed.error.issues[0]?.message ?? "Invalid route input",
        parsed.error.issues,
      );
    try {
      const response = await handle(request);
      if (!response.ok) return normalizePeError(response);
      if (
        response.status !== 204 &&
        route.format === "json" &&
        response.headers.get("content-type")?.includes("application/json")
      ) {
        const result = route.output.safeParse(await response.clone().json());
        if (!result.success)
          return peProblem(
            500,
            "route.output",
            `Invalid response for ${match.id}`,
            result.error.issues,
          );
      }
      return response;
    } catch (error) {
      return peProblem(500, "route.failed", error instanceof Error ? error.message : String(error));
    }
  }

  function createPeClient(
    base = "",
    transport: (url: string, init?: RequestInit) => Promise<Response> = globalThis.fetch,
  ) {
    const wire = createPeWire(peRoutes, base, transport);
    async function response<K extends PeRouteId>(
      id: K,
      input: PeInput<K>,
      init?: RequestInit,
    ): Promise<Response> {
      peRoutes[id].body.parse(input.body);
      return wire.response(id, input, init);
    }
    async function call<K extends PeRouteId>(
      id: K,
      input: PeInput<K>,
      init?: RequestInit,
    ): Promise<PeOutput<K>> {
      peRoutes[id].body.parse(input.body);
      const parsed = peRoutes[id].output.safeParse(await wire.call(id, input, init));
      if (!parsed.success) throw Error(`Invalid response for ${id}`, { cause: parsed.error });
      return parsed.data as PeOutput<K>;
    }

    return {
      call,
      invoke: async (id: string, raw: unknown) => {
        if (!isPeRouteId(id)) throw Error(`Unknown declared route ${id}`);
        const input = peRoutes[id].input.parse({
          params: {},
          query: {},
          ...(raw && typeof raw === "object" ? raw : {}),
        });
        const result = await wire.response(id, input);
        if (
          result.ok &&
          !result.headers.get("content-type")?.includes("application/json") &&
          result.status !== 204
        )
          return result;
        return peRoutes[id].output.parse(await wire.read(id, result));
      },
      response,
      url: <K extends PeRouteId>(id: K, input: PeInput<K>) => peRouteUrl(id, input, base),
    };
  }

  const peClientScript = () =>
    `(${createPeWire.toString()})(${JSON.stringify(Object.fromEntries(Object.entries(peRoutes).map(([id, r]) => [id, { method: r.method, path: r.path, encoding: r.encoding }])))}, "", pe.fetch)`;
  return {
    peRoutes,
    isPeRouteId,
    peRouteUrl,
    matchPeRoute,
    servePeRoute,
    createPeClient,
    peClientScript,
  };
}

/** Serialized into Pages and used by the typed client. Keep this function closure-free. */
function createPeWire(
  routes: Record<string, { method: string; path: string; encoding: string }>,
  base: string,
  transport: (url: string, init?: RequestInit) => Promise<Response>,
) {
  type Input = {
    params?: Record<string, string>;
    query?: Record<string, string | number | boolean | undefined>;
    body?: unknown;
  };
  function declared(id: string) {
    if (!Object.hasOwn(routes, id)) throw Error(`Unknown declared route ${id}`);
    return routes[id]!;
  }
  function url(id: string, input: Input) {
    const path = declared(id).path.replace(/:([\w]+)/g, (_, name: string) => {
      const value = input.params?.[name];
      if (!value) throw Error(`Missing route parameter ${name}`);
      return encodeURIComponent(value);
    });
    const query = new URLSearchParams(
      Object.entries(input.query ?? {}).flatMap(([k, v]) =>
        v === undefined ? [] : [[k, String(v)]],
      ),
    );
    return `${base}${path}${query.size ? `?${query.toString()}` : ""}`;
  }
  async function response(id: string, input: Input, init?: RequestInit) {
    const route = declared(id);
    const headers = new Headers(init?.headers);
    if (route.method !== "GET")
      headers.set("content-type", route.encoding === "text" ? "text/markdown" : "application/json");
    return transport(url(id, input), {
      ...init,
      method: route.method,
      headers,
      ...(input.body === undefined
        ? {}
        : {
            body: route.encoding === "text" ? (input.body as string) : JSON.stringify(input.body),
          }),
    });
  }
  async function call(id: string, input: Input, init?: RequestInit): Promise<unknown> {
    const result = await response(id, input, init);
    return read(id, result);
  }
  async function read(id: string, result: Response): Promise<unknown> {
    const text = result.status === 204 ? "" : await result.text();
    let value;
    try {
      value = text ? JSON.parse(text) : undefined;
    } catch {
      throw Object.assign(Error(`Invalid JSON response for ${id} (${result.status})`), {
        status: result.status,
      });
    }
    if (!result.ok) {
      const problem = value?.error;
      throw Object.assign(
        Error(
          typeof problem?.message === "string"
            ? problem.message
            : `Route ${id} failed (${result.status})`,
        ),
        {
          status: result.status,
          problem: value,
          failure: problem?.details?.failure,
        },
      );
    }
    return value;
  }
  return { url, response, call, read };
}

export async function normalizePeError(response: Response): Promise<Response> {
  if (response.ok) return response;
  const text = await response.text();
  let details: unknown;
  try {
    details = JSON.parse(text);
  } catch {
    details = text;
  }
  if (peErrorSchema.safeParse(details).success)
    return new Response(text, { status: response.status, headers: response.headers });
  const old = details && typeof details === "object" ? (details as Record<string, unknown>) : {};
  const refusal =
    old.refusal && typeof old.refusal === "object" ? (old.refusal as Record<string, unknown>) : {};
  const code =
    [old.code, refusal.code, old.kind].find((v) => typeof v === "string") ?? "route.refused";
  const message =
    [old.message, old.error, old.reason, refusal.message, refusal.reason, refusal.detail].find(
      (v) => typeof v === "string",
    ) ??
    (text || response.statusText);
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.set("content-type", "application/json");
  return new Response(JSON.stringify({ error: { code, message, details } }), {
    status: response.status,
    headers,
  });
}

/** One error decoder for clients that retain a richer domain error type. */
export async function readPeError(response: Response) {
  const text = await response.text();
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw Error(`Invalid host error (${response.status}): ${text}`);
  }
  const parsed = peErrorSchema.safeParse(value);
  if (!parsed.success) throw Error(`Invalid host error (${response.status}): ${text}`);
  return parsed.data.error;
}
