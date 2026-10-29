import { createScheduledTasks } from "./scheduled-tasks.ts";
import { eligibleThreads, threadHistory } from "./thread-history.ts";
import { productRoot } from "@pe/host-contracts/service-identity";
import { normalizePeError } from "@pe/host-contracts/pe-api";
import { hostDescriptor } from "@pe/host-contracts/host-descriptor";
import { peRoutes, peRouteUrl, servePeRoute, matchPeRoute } from "@pe/agent-contracts/pe-api";
import type { HostSessionScope } from "@pe/host-contracts/operation-types";
import { resolveSdkSession } from "./sdk-session.ts";
import {
  createDuctsAnalysis,
  ductsNativeRead,
  type DuctsAnalysisSources,
} from "./ducts-analysis.ts";
import { sdkSessionSelectionSchema } from "@pe/agent-contracts";
import type { MachineShareAdapter } from "./machine.ts";
import { Effect, Option, Stream } from "effect";
import {
  HttpEffect,
  HttpRouter,
  HttpServer,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/unstable/http";
import {
  addressSchema,
  sameAddress,
  bindWork,
  documentRefSchema,
  documentRows,
  routeViewAckSchema,
  routeViewOpenSchema,
  routeViewSetSchema,
  routeViewSchema,
  routeViewRoutes,
  readingKey,
  recentRows,
  START_FRESH,
  contributionKey,
  isCanonicalSlug,
  parseContributionKey,
  packageProjectionSchema,
  capabilityKindSchema,
  capabilityNeedsSchema,
  findCapabilities,
  type Capability,
  type CapabilityCatalog,
  type WorkKey,
  type TurnElementNamesRequest,
  type TurnElementNamesObservation,
  type Caller,
  HOST_LOG_PAGE_MAX,
} from "@pe/agent-contracts";
import {
  createCapabilityCatalogSource,
  createRouteRegistrations,
  resolvePeaProductHomePath,
  publishPeaSkills,
  peaAgentInstructions,
} from "@pe/mcps";
import {
  captureUserShellPath,
  userCodexConfigPath,
  userCodexMcpServers,
  writePeaCodexProjectConfig,
} from "./harness/user-shell.ts";
import {
  observeResources,
  OwnerReads,
  resourceSnapshot,
  resourceResponse,
  RouteViewStore,
  RouteWorkspace,
  type ResourceObserver,
  type RouteDocumentStore,
  type RouteWorkspaceRegistration,
  type ThreadHeadSource,
} from "@pe/runtime";
import { z } from "zod";
import { RevitBridge } from "./bridge.ts";
import { documentMarks } from "./document-marks.ts";
import { createProviders } from "./harness/providers.ts";
import { peaMcpServer } from "./harness/adapter.ts";
import { createHarnessThreads } from "./harness/threads.ts";
import { hostOwnership } from "./host-ownership.ts";
import {
  productDuctsAnalysesPath,
  productHarnessThreadsPath,
  productRouteWorkPath,
} from "./product-paths.ts";
import { hostResourceObserver, markReadings } from "./resource-adapters.ts";
import {
  createMachine,
  machineAcquisition,
  machineSessionAcquisition,
  machineSources,
  useHostMachine,
} from "./machine.ts";
import {
  bindControl,
  callerThread,
  currentCaller,
  refusalHeaders,
  workAuthorOf,
  threadHead,
} from "./control.ts";
import { bindRevoke } from "./revoke.ts";
import { hostActionJournal, hostLog } from "./gateway-owner.ts";
import type { HostLog } from "./host-log.ts";
import { UpdateReader } from "./update-reader.ts";
import { makeInstalledUpdateReader } from "./update-route.ts";
import { resolveHostVersion } from "./host-lifecycle.ts";
import { familySpecAsset } from "./family-spec.ts";
import { fileRouteDocumentStore } from "./route-document-store.ts";
import {
  readNavigation,
  readThreadWork,
  resumeWork,
  type NavigationSources,
} from "./navigation.ts";
import {
  captureDirectory,
  capturePackage,
  listPackages,
  type AdmittedPackage,
} from "./packages.ts";
import { skillSnapshot } from "../../../packages/mcps/src/pea/skill-publication.ts";
import type { CapabilityContent } from "../../../packages/mcps/src/pea/capabilities.ts";
import {
  packagePageDescriptors,
  pageFolderCollisions,
  scratchPageDescriptors,
  type PageDescriptor,
} from "./page-libraries.ts";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createPackageLifecycle, bindPackageLifecycle } from "./package-lifecycle.ts";
import { createPluginsHandler } from "./plugins-handler.ts";
import { createPodRoutes } from "./pod-routes.ts";
import { observePluginOperations } from "./plugin-receipts.ts";
import { importShippedPods } from "./installed-pods.ts";
import { receiptQuerySchema } from "@pe/agent-contracts";
import {
  hostReceiptExport,
  createThreadReceiptAdapter,
  type AgentReportContext,
  type ReceiptExport,
} from "./receipt-export.ts";
import { createNotices } from "./notices.ts";
import { alignBootstrap } from "./bootstrap.ts";
export { fileRouteDocumentStore } from "./route-document-store.ts";

export interface HostWork {
  workspace: RouteWorkspace;
  registrations: readonly RouteWorkspaceRegistration[];
}

export interface PeRoutesOptions {
  workspace?: RouteWorkspace;
  registrations: readonly RouteWorkspaceRegistration[];
  store: RouteDocumentStore;
  heads: ThreadHeadSource;
  navigation?: NavigationSources;
  turnElementNames?: (request: TurnElementNamesRequest) => Promise<TurnElementNamesObservation>;
  capabilityCatalog?: { read(scope?: HostSessionScope): Promise<CapabilityCatalog> };
  contributionRead?: (key: string, sha256?: string) => unknown;
  observeHostResource?: ResourceObserver;
  /** Wraps every served Reading, Work included, e.g. with the host's document change mark. */
  markReadings?: (observe: ResourceObserver) => ResourceObserver;
  telemetry?: ReceiptExport;
  /** The running turn and harness behind a thread, for an agent report's stamps. */
  reportContext?: (thread: string) => AgentReportContext | null;
  /** The host log `log.read` pages; the host's own when absent. */
  log?: HostLog;
  ductsAnalysis?: Omit<DuctsAnalysisSources, "readWork">;
}

const feedbackSchema = peRoutes["feedback.submit"].body;
const diagnosticsSchema = peRoutes["diagnostics.submit"].body;
const agentFeedbackSchema = peRoutes["agent-feedback.submit"].body;
const applyBody = peRoutes["work.apply"].body;

const json = (value: unknown, status = 200) => Response.json(value, { status });
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** The route-document, Reading, capability and Families-view surface, host-owned. */
export function createPeRoutes(options: PeRoutesOptions) {
  const work =
    options.workspace ??
    new RouteWorkspace({ registrations: options.registrations, store: options.store });
  async function routeWorkKey(url: URL, route: string, shape: "read" | "write", caller: Caller) {
    const scope = workKey(url, route, shape);
    if (scope instanceof Response || scope.binding === "workspace" || scope.binding === "host")
      return scope;
    const shared = caller.kind === "human" || caller.kind === "pea" || caller.kind === "anonymous";
    // Saved Addresses remain usable offline. An explicit open/from claim must match real inventory.
    if (shared && scope.binding === "address" && !scope.from) return scope;
    const refused = (error: string) => json({ ok: false, error, hint: error }, 403);
    const thread = callerThread(caller);
    if (!shared && !thread)
      return refused("Document-owned route Work requires this caller's thread targets.");
    let documents;
    try {
      documents = z
        .array(documentRefSchema.extend({ address: addressSchema.nullable() }))
        .parse(await options.navigation?.documents());
    } catch {
      return refused("Current document bindings are unavailable; retained Work has not changed.");
    }
    const head = thread ? threadHead(thread) : null;
    const targeted = (doc: (typeof documents)[number]) =>
      shared ||
      head?.targets.some(({ request }) =>
        request.kind === "open"
          ? request.ref.session === doc.session && request.ref.openId === doc.openId
          : request.session === doc.session &&
            doc.address !== null &&
            sameAddress(request.address, doc.address),
      );
    const ref = scope.binding === "open" ? scope.open : scope.from;
    const matching = documents.filter((doc) =>
      ref
        ? doc.session === ref.session && doc.openId === ref.openId
        : scope.binding === "address" &&
          doc.address !== null &&
          sameAddress(scope.target, doc.address) &&
          targeted(doc),
    );
    // Retained Work makes no native freshness claim. A closed lifetime keeps its authored key.
    if (shared && matching.length === 0) return scope;
    if (matching.length !== 1)
      return refused(
        "Route Work target is closed or ambiguous; name an exact current open document.",
      );
    const doc = matching[0]!;
    if (
      scope.binding === "address" &&
      (doc.address === null || !sameAddress(scope.target, doc.address))
    )
      return refused("Route Work target Address does not match its exact open document.");
    if (!targeted(doc))
      return refused(
        "Route Work target must be one of this thread's documents, even under Full. Retained Work has not changed.",
      );
    // Identity and revision checks govern shared Work; thread targets only constrain trust adapters.
    return bindWork(route, doc.address, undefined, { session: doc.session, openId: doc.openId });
  }
  const analysis = options.ductsAnalysis
    ? createDuctsAnalysis({
        ...options.ductsAnalysis,
        readWork: (key) => work.readRaw(key, "ducts"),
      })
    : null;
  const views = new RouteViewStore();
  const workReads = new OwnerReads();
  const resources = observeResources(work, options.heads, (request, publish, after) => {
    if (request.kind !== "thread-work")
      return options.observeHostResource?.(request, publish, after) ?? (() => {});
    const key = readingKey(request);
    return workReads.observe(
      key,
      () => readThreadWork(work, options.navigation),
      (notify) => {
        const releaseWork = work.subscribe(() => notify());
        const releaseContext = options.navigation?.subscribe?.(notify);
        return () => {
          releaseWork();
          releaseContext?.();
        };
      },
      (result) => publish(resourceSnapshot(key, result)),
    );
  });
  const observeBase = options.markReadings ? options.markReadings(resources) : resources;
  const observe: ResourceObserver = (request, publish, after) => {
    const release = observeBase(request, publish, after);
    if (request.kind !== "world") return release;
    const releaseViews = views.subscribe((intent) =>
      publish({ kind: "event", key: readingKey(request), value: intent }),
    );
    return () => {
      releaseViews();
      release();
    };
  };

  const writes = {
    apply: {
      schema: applyBody,
      hint: "expected { patches, expectedRevision, press, kind? }",
      run: (scope: WorkKey, route: string, by: "pea" | "human", body: unknown) => {
        return work.write(scope, route, by, body as z.infer<typeof applyBody>);
      },
    },
    // Authenticated authors share recovery; the workspace preserves unreadable source bytes.
    [START_FRESH]: {
      schema: z.object({}),
      hint: "expected {}",
      run: (scope: WorkKey, route: string, by: "pea" | "human") =>
        work.startFresh(scope, route, by),
    },
  } as Record<
    string,
    {
      schema: z.ZodType;
      hint: string;
      run: (s: WorkKey, r: string, by: "pea" | "human", b: unknown) => Promise<unknown>;
    }
  >;

  async function handle(request: Request): Promise<Response> {
    const caller = currentCaller();
    const url = new URL(request.url);
    const method = request.method;
    const declared = matchPeRoute(method, url.pathname);
    if (!declared || declared.route.owner !== "pe") return json({ error: "Unknown Pe route" }, 404);
    if (declared.id === "space.scene-artifact") {
      const id = declared.params.id!;
      if (!/^[a-f0-9]{64}$/.test(id)) return json({ error: "Invalid scene id" }, 400);
      try {
        const bytes = await readFile(join(productRoot(), "cache", "space-scenes", `${id}.bin`));
        if (createHash("sha256").update(bytes).digest("hex") !== id)
          return json({ error: "Scene artifact integrity failed" }, 409);
        return new Response(bytes, {
          headers: {
            "content-type": "application/octet-stream",
            "cache-control": "private, max-age=31536000, immutable",
          },
        });
      } catch {
        return json(
          { error: "Scene artifact unavailable; capture it again from its document" },
          404,
        );
      }
    }
    if (declared.id === "ducts.analysis" || declared.id === "ducts.analysis-artifact") {
      if (!analysis) return json({ error: "Ducts analysis is unavailable" }, 503);
      try {
        return declared.id === "ducts.analysis"
          ? json(await analysis.read(peRoutes["ducts.analysis"].body.parse(await request.json())))
          : await analysis.artifact(declared.params.id!);
      } catch (error) {
        const problem = error as { message?: unknown; statusCode?: unknown };
        const status =
          typeof problem?.statusCode === "number" &&
          problem.statusCode >= 400 &&
          problem.statusCode <= 599
            ? problem.statusCode
            : error instanceof z.ZodError
              ? 400
              : 409;
        return json(
          { error: typeof problem?.message === "string" ? problem.message : message(error) },
          status,
        );
      }
    }
    if (declared.id === "features.get") return json(hostDescriptor(resolveHostVersion()));
    if (declared.id === "machine.bootstrap") {
      const receipt = await alignBootstrap(await request.json(), caller, hostActionJournal());
      return json(receipt);
    }
    if (method === "GET" && declared.id === "family.spec") return familySpecAsset(url);
    const parts = url.pathname.split("/").slice(2).map(decodeURIComponent); // drop "", "pe"
    const body = () => request.json().catch(() => null);

    if (method === "GET" && declared.id === "contributions.read") {
      const key = url.searchParams.get("key") ?? "";
      if (!parseContributionKey(key))
        return json({ error: "Expected a canonical contribution key" }, 400);
      const value = await options.contributionRead?.(
        key,
        url.searchParams.get("sha256") ?? undefined,
      );
      return value
        ? json(value)
        : json(
            { error: "Admitted contribution revision unavailable; rediscover before reading." },
            409,
          );
    }

    if (method === "GET" && declared.id === "navigation.get") {
      try {
        return json(await readNavigation(work, options.navigation));
      } catch (error) {
        return json({ error: message(error) }, 502);
      }
    }
    if (method === "GET" && declared.id === "thread-work.get") {
      try {
        return json(await readThreadWork(work, options.navigation));
      } catch (error) {
        return json({ error: message(error) }, 502);
      }
    }
    if (method === "GET" && declared.id === "work.resume") {
      const id = url.searchParams.get("id");
      if (!id || id.length > 16384) return json({ error: "Expected a saved Work id" }, 400);
      try {
        const resumed = await resumeWork(work, id, options.navigation);
        return resumed
          ? json(resumed)
          : json({ error: "Saved Work was not found; nothing was changed" }, 404);
      } catch (error) {
        return json({ error: message(error) }, 502);
      }
    }
    if (declared.id === "turn.element-names") {
      if (!options.turnElementNames)
        return json({ error: "Turn element names are unavailable" }, 503);
      try {
        const input = peRoutes["turn.element-names"].body.parse(await request.json());
        return json(await options.turnElementNames(input));
      } catch (error) {
        return json(
          { error: message(error) },
          error instanceof z.ZodError || error instanceof SyntaxError ? 400 : 409,
        );
      }
    }
    if (method === "GET" && declared.id === "capabilities.find") {
      if (!options.capabilityCatalog) return json({ error: "no capability catalog" }, 503);
      const scope = workKey(url, "", "read");
      if (scope instanceof Response) return scope;
      try {
        const query = url.searchParams;
        const catalog = await options.capabilityCatalog.read({
          bridgeSessionId: query.get("session") ?? undefined,
          session: query.has("sdk")
            ? sdkSessionSelectionSchema.parse(JSON.parse(query.get("sdk")!))
            : undefined,
        });
        // Open and recent documents are rows too, so every door's one search finds them to mention.
        const capabilities = [
          ...catalog.capabilities,
          ...documentRows(catalog),
          ...recentRows(catalog),
        ];
        const filtering = ["query", "kind", "needs", "mutates", "limit"].some((name) =>
          query.has(name),
        );
        const mutates = query.get("mutates");
        if (mutates !== null && mutates !== "true" && mutates !== "false")
          return json({ error: "mutates must be true or false" }, 400);
        const filters = z
          .object({
            query: z.string().optional(),
            kind: capabilityKindSchema.optional(),
            needs: capabilityNeedsSchema.optional(),
            limit: z.coerce.number().int().min(1).max(500).optional(),
          })
          .safeParse({
            query: query.get("query") ?? undefined,
            kind: query.get("kind") ?? undefined,
            needs: query.get("needs") ?? undefined,
            limit: query.get("limit") ?? undefined,
          });
        if (!filters.success)
          return json({ error: "Invalid catalog filters", diagnostics: filters.error.issues }, 400);
        return json({
          ...catalog,
          capabilities: filtering
            ? findCapabilities(capabilities, {
                ...filters.data,
                ...(mutates !== null ? { mutates: mutates === "true" } : {}),
              })
            : capabilities,
        });
      } catch (error) {
        return json({ error: message(error) }, 502);
      }
    }
    if (method === "GET" && declared.id === "resources.stream")
      return resourceResponse(request, observe);
    // Agent feedback (owner ruling 2026-10-14): any admitted caller may file; the host stamps it.
    if (method === "POST" && declared.id === "agent-feedback.submit") {
      const parsed = agentFeedbackSchema.safeParse(await body());
      if (!parsed.success) return json({ error: "invalid agent feedback" }, 400);
      const thread = callerThread(caller);
      try {
        return json(
          await (options.telemetry ?? hostReceiptExport()).submitAgentFeedback(
            parsed.data,
            caller.kind,
            thread,
            thread ? (options.reportContext?.(thread) ?? null) : null,
          ),
        );
      } catch {
        return json({ error: "Agent feedback could not be kept locally" }, 503);
      }
    }
    if (
      method === "POST" &&
      (declared.id === "feedback.submit" ||
        declared.id === "diagnostics.submit" ||
        declared.id === "feedback.deliver")
    ) {
      if (caller.kind !== "human")
        return Response.json(
          { error: "human.only: Feedback and browser diagnostics require a human caller." },
          { status: 403, headers: refusalHeaders("human.only") },
        );
      const telemetry = options.telemetry ?? hostReceiptExport();
      if (declared.id === "diagnostics.submit") {
        const parsed = diagnosticsSchema.safeParse(await body());
        if (!parsed.success) return json({ error: "invalid diagnostics" }, 400);
        try {
          await telemetry.diagnostics(parsed.data, request.headers.get("x-pe-web-build"));
          return json({ accepted: true });
        } catch {
          return json({ error: "Diagnostic receipt persistence failed" }, 503);
        }
      }
      if (parts[2] === "deliver") {
        const id = z.uuid().safeParse(parts[1]);
        if (!id.success) return json({ error: "invalid feedback id" }, 400);
        const result = await telemetry.deliverFeedback(id.data);
        return result ? json(result) : json({ error: "Feedback receipt unavailable" }, 404);
      }
      const parsed = feedbackSchema.safeParse(await body());
      if (!parsed.success) return json({ error: "invalid feedback" }, 400);
      try {
        return json(
          await telemetry.submitFeedback(parsed.data, request.headers.get("x-pe-web-build")),
        );
      } catch {
        return json({ error: "Feedback could not be kept locally" }, 503);
      }
    }

    // Web read of the receipt spine, including turn/permission facts. Local thread ids are mapped
    // by the owner; query joins and the returned envelopes remain opaque.
    if (method === "GET" && declared.id === "receipts.read") {
      const journal = (options.telemetry ?? hostReceiptExport()).journal;
      let query: unknown;
      try {
        query = JSON.parse(url.searchParams.get("query") ?? "{}");
      } catch {
        return json({ error: "invalid receipt query" }, 400);
      }
      const parsed = receiptQuerySchema.safeParse(query);
      if (!parsed.success) return json({ error: "invalid receipt query" }, 400);
      const q = { ...parsed.data };
      if (url.searchParams.has("thread"))
        q.threadId = await journal.opaqueId("thread", url.searchParams.get("thread")!);
      return json(await journal.read(q));
    }

    // The host log after a cursor, one bounded page: the read door for every ordered history.
    if (method === "GET" && declared.id === "log.read") {
      const query = z
        .object({
          after: z.coerce.number().int().nonnegative().default(0),
          kind: z.enum(["thread", "receipt", "notice"]).optional(),
          thread: z.string().min(1).optional(),
          limit: z.coerce.number().int().min(1).max(HOST_LOG_PAGE_MAX).default(500),
        })
        .safeParse(Object.fromEntries(url.searchParams));
      if (!query.success) return json({ error: "invalid log query" }, 400);
      const { after, kind, thread, limit } = query.data;
      const { gap, entries } = (options.log ?? hostLog()).read(after, ({ event }) => {
        const of = event.kind === "oversize" ? event.of : event.kind;
        const owner =
          event.kind === "thread"
            ? event.thread
            : event.kind === "oversize"
              ? event.ref.thread
              : null;
        return (!kind || of === kind) && (!thread || owner === thread);
      });
      const page = entries.slice(0, limit);
      return json({
        entries: page,
        gap,
        next: page.at(-1)?.id ?? after,
        more: entries.length > limit,
      });
    }

    // One channel for every route that leases a view (`routeViewRoutes`); the route is a path segment.
    if (
      parts[0] === "route-view" &&
      parts[1] &&
      (routeViewRoutes as readonly string[]).includes(parts[1])
    ) {
      const route = parts[1];
      const instance = parts[2];
      if (method === "POST" && instance === "open") {
        const parsed = routeViewOpenSchema.safeParse(await body());
        if (!parsed.success)
          return json({ ok: false, error: `invalid ${route} open command` }, 400);
        if (caller.kind === "pea" && caller.thread !== parsed.data.thread)
          return json(
            { ok: false, error: "A Pea context may only open a tool for its own conversation" },
            403,
          );
        const result = views.open(route as Parameters<typeof views.open>[0], parsed.data);
        return json(result, result.ok ? 200 : 400);
      }
      if (method === "PUT" && !instance) {
        const parsed = routeViewSchema.safeParse(await body());
        return parsed.success && parsed.data.route === route
          ? json(views.publish(parsed.data))
          : json({ error: `invalid ${route} view` }, 400);
      }
      if (method === "GET" && !instance) {
        const thread = url.searchParams.get("thread");
        if (!thread) return json({ error: "thread required" }, 400);
        const result = views.select(thread, route, url.searchParams.get("instance") ?? undefined);
        return result && !("ok" in result)
          ? json(result)
          : json(result ?? { ok: false, error: "view unavailable" }, 409);
      }
      if (method === "POST" && instance === "set") {
        const parsed = routeViewSetSchema.safeParse(await body());
        if (!parsed.success)
          return json({ ok: false, error: `invalid ${route} view command` }, 400);
        const { thread, instance: target, revision, patch } = parsed.data;
        if (caller.kind === "pea" && caller.thread !== thread)
          return json(
            { ok: false, error: "A Pea context may only move a view for its own conversation" },
            403,
          );
        const result = await views.set(thread, route, target, revision, patch);
        return json(result, (result as { ok: boolean }).ok ? 200 : 409);
      }
      if (method === "POST" && instance === "ack") {
        const parsed = routeViewAckSchema.safeParse(await body());
        if (!parsed.success) return json({ ok: false, error: `invalid ${route} view ack` }, 400);
        const result = views.ack(parsed.data);
        return json(result, result.ok ? 200 : 409);
      }
      if (method === "DELETE" && instance) {
        views.remove(instance);
        return json({ ok: true });
      }
    }

    // Discovery is unscoped; every document read or write names one Work key.
    const [head, route, verb, extra] = parts;
    if (head === "route-state" && extra === undefined) {
      // Door 9: the author is the host-minted caller, never the path. Reads are free.
      if (method === "GET" && !route) return json(work.list());
      if (method === "GET" && route && !verb) {
        const scope = await routeWorkKey(url, route, "read", caller);
        if (scope instanceof Response) return scope;
        try {
          const view = await work.view(scope, route);
          return view ? json(view) : json({ error: `unknown route '${route}'` }, 404);
        } catch (error) {
          return json({ error: message(error) }, 403);
        }
      }
      // Human-only and read-only; any other caller is refused by name, not 404.
      if (method === "GET" && route && verb === "salvage") {
        const scope = workKey(url, route, "read");
        if (scope instanceof Response) return scope;
        const salvaged = await work.salvage(scope, route);
        if (!salvaged) return json({ error: `nothing to salvage on '${route}'` }, 404);
        return "ok" in salvaged ? json(salvaged, 403) : json(salvaged);
      }
      const write = method === "POST" && route && verb ? writes[verb] : undefined;
      if (write && route && caller.kind !== "human" && caller.kind !== "pea")
        return Response.json(
          {
            ok: false,
            kind: "error",
            error:
              caller.kind === "page"
                ? `page.use-page-door: Pages act through /pages/<slug>/act, not /pe/route-state.`
                : "context.missing: Refused at /pe/route-state: no caller context. Anonymous loopback calls are read-only; run this from Pea, the web app, or a bound Page.",
            refusal: {
              code: caller.kind === "page" ? "page.use-page-door" : "context.missing",
              door: url.pathname,
              reason:
                caller.kind === "page"
                  ? "Pages act through /pages/<slug>/act."
                  : "Anonymous loopback calls are read-only.",
            },
          },
          {
            status: 403,
            headers: refusalHeaders(
              caller.kind === "page" ? "page.use-page-door" : "context.missing",
            ),
          },
        );
      if (write && route) {
        const by = workAuthorOf(caller);
        const scope = await routeWorkKey(url, route, "write", caller);
        if (scope instanceof Response) return scope;
        const parsed = write.schema.safeParse(await body());
        if (!parsed.success) {
          // Name the first failing field and the schema's word for its shape.
          const issue = parsed.error.issues[0]!;
          const field = issue.path
            .map((key) => (typeof key === "number" ? `[${key}]` : `.${String(key)}`))
            .join("")
            .replace(/^\./, "");
          const error = `invalid body at ${field || "the body"}: ${issue.message}`;
          return json({ ok: false, kind: "error", error, hint: write.hint }, 400);
        }
        try {
          return json(await write.run(scope, route, by, parsed.data));
        } catch (error) {
          return json(
            {
              ok: false,
              kind: "error",
              error: message(error),
              hint: "re-read the document before retrying.",
            },
            403,
          );
        }
      }
    }
    return json({ error: `No route ${method} ${url.pathname}` }, 404);
  }

  return {
    workspace: work,
    fetch: handle,
    completedWork: async (threadId: string) => {
      const snapshot = await readThreadWork(work, options.navigation);
      const pending =
        snapshot.threads
          .find((thread) => thread.threadId === threadId)
          ?.works.filter((entry) => entry.unfinished > 0) ?? [];
      return (
        await Promise.all(
          pending.map(async (entry) => {
            const resumed = await resumeWork(work, entry.id, options.navigation);
            return resumed?.url
              ? { title: `${entry.route}: ${entry.intent}`, href: resumed.url }
              : null;
          }),
        )
      ).filter((entry) => entry !== null);
    },
  };
}

/**
 * The WorkKey a request names: `?work=<id>` for a standalone workspace, `?target=<address>` for
 * document-scoped Work, neither for the host-only Work. `open=<session>/<openId>` is the exact
 * document lifetime: alone it keys an unsaved document's retained Work; beside a Target it is what
 * a Save As migration carries over from.
 */
function workKey(url: URL, route: string, shape: "read" | "write"): WorkKey | Response {
  const query = (name: string) => url.searchParams.get(name)?.trim() || undefined;
  const invalid = (error: string) =>
    json(shape === "read" ? { error } : { ok: false, kind: "error", error, hint: error }, 400);
  const work = query("work");
  const target = query("target");
  if (work) {
    if (target || work.length > 200) return invalid("Provide exactly one Work key");
    return bindWork(route, null, work);
  }
  const open = query("open");
  let ref: { session: string; openId: string } | undefined;
  if (open) {
    const cut = open.indexOf("/");
    const parsed = documentRefSchema.safeParse({
      session: open.slice(0, Math.max(cut, 0)),
      openId: open.slice(cut + 1),
    });
    if (cut < 1 || !parsed.success)
      return invalid("invalid open document: expected <session>/<openId>");
    ref = parsed.data;
  }
  if (!target) return bindWork(route, null, undefined, ref);
  const parsed = addressSchema.safeParse(target);
  if (!parsed.success) return invalid("invalid Target: expected a document Address");
  return bindWork(route, parsed.data, undefined, ref);
}

/**
 * The host-owned `/pe/*` surface over one bridge (or none): harness threads with their heads, and
 * route Work, Readings and the capability catalog. Wires the Work into the action owner and the
 * document-close sweep.
 */
export function createContributionContent(options: {
  worldRoot: string;
  packages?: typeof listPackages;
  pages?: (packages: readonly AdmittedPackage[]) => Promise<readonly PageDescriptor[]>;
  bootstrap?: () => Promise<unknown>;
  decisionsPath?: string;
  changed?: () => void;
}) {
  const revisions = new Map<string, Map<string, unknown>>();
  const latest = new Map<string, unknown>();
  let snapshot: Promise<CapabilityContent> | undefined;
  let observedAt = 0;
  let pending = false;
  let initialized: Promise<unknown> | undefined;
  let firstBuild = true;
  let admitted: readonly AdmittedPackage[] = [];
  const lifecycle = createPackageLifecycle({
    decisionsPath: options.decisionsPath,
    packages: async () => {
      await (initialized ??= options.bootstrap?.() ?? Promise.resolve());
      return (options.packages ?? listPackages)();
    },
    changed: () => {
      snapshot = undefined;
      latest.clear();
      options.changed?.();
    },
  });
  const remember = (key: string, value: { sha256: string } & Record<string, unknown>) => {
    let versions = revisions.get(key);
    if (!versions) revisions.set(key, (versions = new Map()));
    versions.set(value.sha256, value);
    if (versions.size > 4) versions.delete(versions.keys().next().value!);
    latest.set(key, value);
  };
  const memberValue = (bytes: Uint8Array, sha256: string) => ({
    content: new TextDecoder().decode(bytes),
    bytesBase64: Buffer.from(bytes).toString("base64"),
    sha256,
  });
  /** Scratch Page rows with their content remembered for member reads. */
  function pageRows(descriptors: readonly PageDescriptor[]): Capability[] {
    return descriptors
      .filter((p) => p.key !== null && p.openUrl !== null)
      .filter((p) => parseContributionKey(p.key!)?.packageId === "pages")
      .map((p) => {
        const ref = parseContributionKey(p.key!)!;
        remember(p.key!, memberValue(p.entry.bytes, p.entry.sha256));
        return {
          key: p.key!,
          kind: "page",
          title: p.title,
          description: "Page shared state and binding.",
          needs: "nothing",
          effect: "query",
          mutates: false,
          principal: ["human", "pea", "page", "external-mcp"],
          input: {},
          source: "pages",
          rank: 1,
          package: { id: "pages", path: `${ref.path}/index.html`, sha256: p.entry.sha256 },
          projection: { openUrl: p.openUrl!, pane: "page" },
        };
      });
  }
  async function build(): Promise<CapabilityContent> {
    await (initialized ??= options.bootstrap?.() ?? Promise.resolve());
    const listing = await lifecycle.refresh(firstBuild);
    firstBuild = false;
    admitted = lifecycle.packages();
    const allDescriptors = options.pages
      ? await options.pages(admitted)
      : [
          ...(await scratchPageDescriptors(join(options.worldRoot, "Pages"))),
          ...packagePageDescriptors(admitted),
        ];
    const descriptors = allDescriptors.filter((p) => p.key !== null && p.openUrl !== null);
    const scratch = allDescriptors.filter((p) => p.pod === null).map((p) => p.slug);
    const collisions = pageFolderCollisions(scratch);
    const diagnostics: CapabilityCatalog["diagnostics"] = [
      ...collisions.map((folders) => ({
        code: "page.folder-collision" as const,
        folders,
        message: `Page folders ${folders.join(", ")} differ only by case; none is a Page until all but one are renamed.`,
      })),
      ...allDescriptors
        .filter(
          (p) => p.pod === null && !isCanonicalSlug(p.slug) && !collisions.flat().includes(p.slug),
        )
        .map((p) => {
          const canonicalSlug =
            p.slug
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, "-")
              .replace(/^-+|-+$/g, "") || "page";
          return {
            code: "page.noncanonical-folder" as const,
            folder: p.slug,
            canonicalSlug,
            message: p.key
              ? `'${p.slug}' works as ${p.key}; '${canonicalSlug}' would be its canonical slug.`
              : `${p.reason} Rename it to '${canonicalSlug}' (or another distinct name).`,
          };
        }),
    ];
    const pageProjections = new Map(
      descriptors.map((p) => [p.key, { openUrl: p.openUrl!, pane: "page" }]),
    );
    const packages = admitted.map((pod) =>
      packageProjectionSchema.parse({
        id: pod.id,
        folder: pod.folder,
        members: pod.members.map((m) => ({
          path: m.path,
          sha256: m.sha256,
          sizeBytes: m.bytes.length,
        })),
        diagnostics: pod.diagnostics.map((d) => ({
          code: d.code,
          message: d.message,
          severity: d.severity,
          path: d.path ?? undefined,
        })),
        contributions: pod.contributions.map((c) => ({
          key: c.key,
          sourcePath: c.memberPath,
          title: `${pod.name}: ${c.name}`,
          description: c.description ?? "",
          projection: pageProjections.get(c.key),
        })),
      }),
    );
    const packagedSkills = admitted.flatMap((pod) =>
      pod.diagnostics.some((d) => d.severity === "error")
        ? []
        : pod.contributions
            .filter((c) => c.kind === "skill")
            .map((c) => {
              const prefix = `${c.path}/`;
              return skillSnapshot(
                pod.id,
                c.path.split("/").at(-1)!,
                pod.members
                  .filter((m) => m.path.startsWith(prefix))
                  .map((m) => ({
                    path: m.path.slice(prefix.length),
                    sha256: m.sha256,
                    bytes: m.bytes,
                  })),
              );
            }),
    );
    const publication = await publishPeaSkills(
      { productHomePath: options.worldRoot, captureDirectory },
      packagedSkills,
      lifecycle.skills(),
    );
    latest.clear();
    for (const pod of admitted) {
      if (pod.diagnostics.some((d) => d.severity === "error")) continue;
      const frozen = await capturePackage(pod);
      for (const member of pod.members) {
        const value = memberValue(member.bytes, member.sha256);
        remember(contributionKey({ kind: "member", packageId: pod.id, path: member.path }), value);
        for (const c of pod.contributions.filter((c) => c.memberPath === member.path))
          remember(c.key, {
            ...value,
            folder: pod.folder,
            ...(c.kind === "script" ? { sourceBundle: frozen.sourceBundle } : {}),
          });
      }
    }
    for (const skill of publication.skills) {
      const entry = skill.files.find((f) => f.path === "SKILL.md")!;
      remember(skill.key, {
        content: skill.content,
        bytesBase64: Buffer.from(entry.bytes).toString("base64"),
        sha256: entry.sha256,
      });
    }
    const pages = pageRows(descriptors);
    return {
      packages,
      skills: publication.skills,
      pages,
      diagnostics,
      sourceDiagnostics: [
        ...publication.notices,
        ...listing.unreadable.map((d) => `${d.folder}: ${d.message}`),
        ...listing.packages.flatMap((p) =>
          p.diagnostics.map((d) => `${p.id}/${d.path}: ${d.message}`),
        ),
        ...lifecycle
          .inventory()
          .filter((p) => p.status !== "active")
          .map((p) => `${p.id}: ${p.status}${p.error ? `: ${p.error}` : ""}`),
      ],
    };
  }
  return {
    lifecycle,
    read: () => {
      if (!snapshot || (!pending && Date.now() - observedAt >= 30_000)) {
        pending = true;
        snapshot = build().finally(() => {
          observedAt = Date.now();
          pending = false;
        });
      }
      return snapshot;
    },
    /** Scratch Pages are files an agent writes at any moment; they are never served from the 30 s snapshot. */
    pages: async () => {
      const descriptors = options.pages
        ? await options.pages(admitted)
        : await scratchPageDescriptors(join(options.worldRoot, "Pages"));
      return pageRows(descriptors);
    },
    member: (key: string, sha256?: string) =>
      latest.has(key) ? (sha256 ? revisions.get(key)?.get(sha256) : latest.get(key)) : undefined,
  };
}

export function makeHostPeRoutes(
  hostBaseUrl: string,
  bridge: RevitBridge["Service"] | undefined,
  registrationsFactory: typeof createRouteRegistrations = createRouteRegistrations,
  update: UpdateReader["Service"] = makeInstalledUpdateReader(),
  share?: MachineShareAdapter,
  hostWork?: HostWork,
) {
  const sourceRoot = hostOwnership.sourceRoot;
  const worldRoot = resolvePeaProductHomePath();
  let invalidateCatalog = () => {};
  const content = createContributionContent({
    worldRoot,
    changed: () => invalidateCatalog(),
    bootstrap: async () => {
      const imported = await importShippedPods();
      const refused = imported.outcomes.filter((outcome) => outcome.outcome === "refused");
      if (refused.length)
        throw Error(
          `Shipped Pod import refused: ${refused.map((outcome) => outcome.reason).join("; ")}`,
        );
    },
  });
  bindPackageLifecycle(content.lifecycle);
  // The user's own Codex MCP servers stay out of Pea threads: a project-level config in the world root.
  void userCodexMcpServers(userCodexConfigPath())
    .then((names) => writePeaCodexProjectConfig(worldRoot, names))
    .catch((error) =>
      Effect.runSync(
        Effect.logWarning(`Pea's Codex project config was not written: ${String(error)}`),
      ),
    );
  const shellPath = () =>
    captureUserShellPath().then((captured) => {
      Effect.runSync(
        captured
          ? Effect.logInfo(`user shell PATH captured (${captured.split(";").length} entries)`)
          : Effect.logWarning(
              "user shell PATH not captured: harness children keep the host's PATH",
            ),
      );
      return captured;
    });
  // Every provider is probed once in the background; the list says `unknown` until then.
  const providers = createProviders({ shellPath });
  const telemetry = hostReceiptExport();
  const stopOperationHooks = observePluginOperations(telemetry.journal, content.lifecycle.emit);
  const receiptThreads = createThreadReceiptAdapter(
    telemetry,
    () => threads.receiptSnapshot(),
    (threadId) => routes.completedWork(threadId),
  );
  const threads = createHarnessThreads({
    prepare: () => content.read(),
    providers,
    updatePending: update.automaticPending,
    root: productHarnessThreadsPath(),
    log: hostLog(),
    worldRoot,
    // The same kernel the Pea MCP server declares, for the harness that cannot read it from there.
    developerInstructions: async () => peaAgentInstructions,
    mcpServer: (context) => peaMcpServer(sourceRoot, hostBaseUrl, context),
    receiptFact: receiptThreads.accept,
    pluginHook: content.lifecycle.emit,
    // Cached bridge metadata only. Remembered labels/addresses never admit a native operation.
    observeDocument: (request) => {
      if (!bridge) return null;
      const matches = Effect.runSync(bridge.list).flatMap((session) =>
        session.connected && session.sessionId
          ? (session.state?.openDocuments ?? []).flatMap((doc) => {
              const address = addressSchema.safeParse(doc.address).data ?? null;
              const matching =
                request.kind === "open"
                  ? session.sessionId === request.ref.session && doc.openId === request.ref.openId
                  : session.sessionId === request.session &&
                    address !== null &&
                    sameAddress(address, request.address);
              return matching
                ? [
                    {
                      ref: { session: session.sessionId!, openId: doc.openId },
                      address,
                      name: doc.title,
                    },
                  ]
                : [];
            })
          : [],
      );
      return matches.length === 1 ? matches[0]! : null;
    },
  });
  const stopWorkContext = bridge?.subscribe(() => threads.refreshWorkContexts());
  const scheduler = createScheduledTasks({
    path: join(productRoot(), "state", hostOwnership.serviceName, "scheduled-tasks.json"),
    receipts: telemetry.journal,
    evidence: (since, before) =>
      new Set(eligibleThreads(threads.historySnapshot(), since, before).map((t) => t.id)),
    launch: threads.launchScheduled,
  });
  const readHistory = threadHistory({
    snapshot: threads.historySnapshot,
    receipts: telemetry.journal,
    threadJoin: (id) => telemetry.journal.opaqueId("thread", id),
  });
  const tasks = {
    fetch: (request: Request) =>
      new URL(request.url).pathname === "/pe/thread-history"
        ? readHistory(request)
        : scheduler.fetch(request),
    close: scheduler.close,
    start: scheduler.start,
  };
  receiptThreads
    .hydrate()
    .catch((error: unknown) => console.warn("Receipt thread context failed to hydrate", error));
  const notices = createNotices({
    source: { subscribe: (q, consume) => telemetry.journal.subscribe(q, consume) },
    context: receiptThreads.context,
    log: hostLog(),
  });
  const machine = createMachine(machineSources(bridge, providers, update, share, threads.heads), {
    fault: (fault) =>
      telemetry.track(
        telemetry.record({
          kind: "diagnostic",
          code: fault.kind === "deadline" ? "reading.timeout" : "reading.failed",
          readingKind: "machine",
          elapsedMs: fault.elapsedMs,
        }),
      ),
    automaticUpdates:
      hostOwnership.lane === "installed" ? { peaActive: threads.active } : undefined,
  });
  const registrations = hostWork?.registrations ?? registrationsFactory({ hostBaseUrl });
  const catalog = createCapabilityCatalogSource({
    hostBaseUrl,
    registrations,
    machine: () => machine.refresh(),
    content: content.read,
    pages: content.pages,
  });
  invalidateCatalog = () => catalog.invalidate();
  const hostObserve = hostResourceObserver(
    bridge,
    undefined,
    undefined,
    hostBaseUrl,
    undefined,
    machine,
  );
  const routes = createPeRoutes({
    workspace: hostWork?.workspace,
    registrations,
    ductsAnalysis: {
      root: productDuctsAnalysesPath(),
      producer: { version: resolveHostVersion(), ...hostOwnership },
      marks: documentMarks(bridge),
      resolve: async (target) => {
        if (!bridge) throw Error("No Revit bridge is available");
        const session = await resolveSdkSession(bridge, {
          bridgeSessionId: target.session,
          openDocumentId: target.openId,
        });
        const document = session.state?.openDocuments.find((doc) => doc.openId === target.openId);
        if (!document || document.isFamilyDocument)
          throw Error("Ducts analysis requires the exact open project document");
        return {
          target,
          address: document.address ?? null,
          title: document.title,
          process: { pid: session.processId, startUtcUnixMs: session.processStartUtcUnixMs },
          provenance: {
            sdk: session.resolved,
            lane: session.lane,
            sourceRoot: session.sourceRoot,
            installedRoot: session.installedRoot,
            buildStamp: session.buildStamp,
            sdkSessionId: session.sdkSessionId,
          },
        };
      },
      call: ductsNativeRead(hostBaseUrl),
    },
    store: fileRouteDocumentStore(productRouteWorkPath()),
    heads: threads.heads,
    turnElementNames: (request) =>
      threads.readTurnElementNames(request, (operation, input, ref) => {
        if (!bridge) return Promise.reject(new Error("No Revit bridge is available"));
        return Effect.runPromise(bridge.invoke(operation, input, ref.session, ref.openId));
      }),
    navigation: {
      contexts: threads.workContexts,
      subscribe: (notify) => {
        const releaseThreads = threads.observe({ kind: "threads" }, () => notify());
        const releaseBridge = bridge?.subscribe(() => notify());
        return () => {
          releaseThreads?.();
          releaseBridge?.();
        };
      },
      routes: async () =>
        Object.fromEntries(
          (await podRoutes.list())
            .filter((route) => route.trusted)
            .map((route) => [route.workRoute, `/tool/${encodeURIComponent(route.key)}`]),
        ),
      threads: async () => {
        const response = await threads.fetch(
          new Request(peRouteUrl("threads.list", {}, hostBaseUrl)),
        );
        if (!response.ok) throw new Error(`Thread summaries unavailable (${response.status})`);
        return response.json();
      },
      documents: async () => {
        if (!bridge) throw new Error("No Revit bridge metadata is available");
        const sessions = await Effect.runPromise(bridge.list);
        return sessions.flatMap((session) =>
          session.connected && session.sessionId
            ? (session.state?.openDocuments ?? []).map((document) => ({
                session: session.sessionId!,
                openId: document.openId,
                address: document.address ?? null,
              }))
            : [],
        );
      },
    },
    capabilityCatalog: catalog,
    contributionRead: async (key, hash) => {
      await content.read();
      return content.member(key, hash);
    },
    // Thread Readings (the list, and one thread's log) are the thread store's, notices are the
    // notice projection's; the rest the host's.
    observeHostResource: (request, publish, after) =>
      threads.observe(request, publish, after) ??
      notices.observe(request, publish, after) ??
      hostObserve(request, publish, after),
    markReadings: markReadings(documentMarks(bridge)),
    telemetry,
    reportContext: threads.reportContext,
  });
  const podRoutes = createPodRoutes(content.lifecycle, { workspace: routes.workspace });
  const fetchRoute = routes.fetch;
  routes.fetch = async (request) => {
    const declared = matchPeRoute(request.method, new URL(request.url).pathname);
    if (declared?.id === "notices.presence") {
      notices.beat(declared.params.caller!, await request.json());
      return Response.json({ ok: true });
    }
    if (declared?.params.route?.startsWith("pod.")) await podRoutes.list();
    return fetchRoute(request);
  };
  const plugins = {
    close: async () => {
      podRoutes.close();
      stopOperationHooks();
      stopWorkContext?.();
      await content.lifecycle.close();
      bindPackageLifecycle(undefined);
    },
    fetch: createPluginsHandler(content, podRoutes),
  };
  return { providers, threads, routes, catalog, machine, notices, plugins, tasks };
}

/** {@link makeHostPeRoutes} on the host's router. Harness children die when the launch scope closes. */
export const peRoutesLayer = (
  registrationsFactory?: typeof createRouteRegistrations,
  share?: MachineShareAdapter,
  hostWork?: HostWork,
) =>
  HttpRouter.use((router) =>
    Effect.gen(function* () {
      const { address } = yield* HttpServer.HttpServer;
      const hostBaseUrl = `http://127.0.0.1:${address._tag === "TcpAddress" ? address.port : 0}`;
      const bridge = Option.getOrUndefined(yield* Effect.serviceOption(RevitBridge));
      const update = yield* UpdateReader;
      const { providers, threads, routes, catalog, machine, notices, plugins, tasks } =
        makeHostPeRoutes(hostBaseUrl, bridge, registrationsFactory, update, share, hostWork);
      useHostMachine(machine);
      bindControl({
        heads: threads.heads.read,
        subscribeHeads: threads.heads.subscribe,
        acquired: machineAcquisition,
        acquiredSession: machineSessionAcquisition,
      });
      const unbindRevoke = bridge ? bindRevoke(hostActionJournal(), bridge) : undefined;
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          unbindRevoke?.();
          bindControl({
            heads: null,
            subscribeHeads: undefined,
            acquired: () => null,
            acquiredSession: () => null,
          });
          useHostMachine(undefined);
          machine.close();
          notices.close();
        }),
      );
      yield* Effect.addFinalizer(() => Effect.promise(() => plugins.close()));
      yield* Effect.addFinalizer(() => Effect.promise(() => providers.close()));
      // Installed policy keeps observing even when every browser and tray drawer is closed.
      if (hostOwnership.lane === "installed") machine.observe(() => {});
      // With Revit present the op and pod rows describe the connected session, so a session
      // arriving or leaving drops the 30 s cache; without Revit there is no bridge to watch.
      if (bridge)
        yield* Effect.forkScoped(
          Stream.fromPubSub(bridge.events).pipe(
            Stream.filter((e) => e.kind === "connected" || e.kind === "disconnected"),
            Stream.runForEach(() => Effect.sync(() => catalog.invalidate())),
          ),
        );
      tasks.start();
      yield* Effect.addFinalizer(() =>
        Effect.promise(async () => {
          const closing = tasks.close();
          await threads.close();
          await closing;
        }),
      );
      const handlers = {
        tasks: tasks.fetch,
        threads: threads.fetch,
        pe: routes.fetch,
        providers: providers.fetch,
        plugins: plugins.fetch,
      };
      for (const route of Object.values(peRoutes)) {
        if (!(route.owner in handlers)) continue;
        const handle = handlers[route.owner as keyof typeof handlers];
        yield* router.add(
          route.method,
          route.path,
          HttpEffect.fromWebHandler((request) => servePeRoute(request, handle)),
        );
      }
    }),
  );

/** Outside request admission too: every declared HTTP door has the same refusal envelope. */
export const peApiErrorsLayer = HttpRouter.middleware(
  (handler) =>
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const response = yield* handler;
      const path = new URL(request.originalUrl, "http://host").pathname;
      if (response.status < 400 || !matchPeRoute(request.method, path)) return response;
      return HttpServerResponse.fromWeb(
        yield* Effect.promise(() => normalizePeError(HttpServerResponse.toWeb(response))),
      );
    }),
  { global: true },
);
