import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Effect, Option, Stream } from "effect";
import { HttpEffect, HttpRouter, HttpServer } from "effect/unstable/http";
import {
  addressSchema,
  bindWork,
  documentRefSchema,
  familiesViewAckSchema,
  familiesViewCommandSchema,
  familiesViewSchema,
  readingKey,
  routeStatePatchSchema,
  START_FRESH,
  type CapabilityCatalog,
  type WorkKey,
} from "@pe/agent-contracts";
import { hostProcessIdentity } from "@pe/host-contracts/contracts";
import { checkoutLayout } from "@pe/host-contracts/service-identity";
import {
  createCapabilityCatalogSource,
  createRouteRegistrations,
  resolvePeaProductHomePath,
  peaAgentInstructionsFor,
} from "@pe/mcps";
import {
  observeResources,
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
import { createHarnessThreads } from "./harness/threads.ts";
import { hostOwnership } from "./host-ownership.ts";
import { productHarnessThreadsPath, productRouteWorkPath } from "./product-paths.ts";
import { hostResourceObserver, markReadings } from "./resource-adapters.ts";
import { bindActionWorkspace } from "./takeoff-actions.ts";

/**
 * Route Work as one JSON file per (route, Work key), named by hash: Addresses are Windows paths. The
 * workspace serializes its own writes; tmp + rename keeps each file whole.
 */
export function fileRouteDocumentStore(dir: string): RouteDocumentStore {
  mkdirSync(dir, { recursive: true });
  const file = (targetKey: string, route: string) =>
    join(dir, `${createHash("sha256").update(`${route}:${targetKey}`).digest("hex")}.json`);
  return {
    getState: async ({ targetKey, route }) => {
      const path = file(targetKey, route);
      return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
    },
    setState: async ({ targetKey, route, value }) => {
      const path = file(targetKey, route);
      if (value == null) return rmSync(path, { force: true });
      writeFileSync(`${path}.tmp`, JSON.stringify(value));
      renameSync(`${path}.tmp`, path);
    },
  };
}

export interface PeRoutesOptions {
  registrations: readonly RouteWorkspaceRegistration[];
  store: RouteDocumentStore;
  heads: ThreadHeadSource;
  capabilityCatalog?: { read(bridgeSelector?: string): Promise<CapabilityCatalog> };
  observeHostResource?: ResourceObserver;
  /** Wraps every served Reading, Work included, e.g. with the host's document change mark. */
  markReadings?: (observe: ResourceObserver) => ResourceObserver;
}

const applyBody = z.object({
  patches: z.array(routeStatePatchSchema),
  expectedRevision: z.number().int().nonnegative(),
});
const commandBody = z.object({
  command: z.string(),
  input: z.unknown().optional(),
  expectedRevision: z.number().int().nonnegative(),
});

const json = (value: unknown, status = 200) => Response.json(value, { status });
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** The route-document, Reading, capability and Families-view surface, host-owned. */
export function createPeRoutes(options: PeRoutesOptions) {
  const work = new RouteWorkspace({ registrations: options.registrations, store: options.store });
  const views = new RouteViewStore();
  const resources = observeResources(work, options.heads, options.observeHostResource);
  const observeBase = options.markReadings ? options.markReadings(resources) : resources;
  const observe: ResourceObserver = (request, publish) => {
    const release = observeBase(request, publish);
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
      hint: "expected { patches, expectedRevision }",
      run: (scope: WorkKey, route: string, actor: "agent" | "human", body: unknown) => {
        const { patches, expectedRevision } = body as z.infer<typeof applyBody>;
        return work.apply(scope, route, actor, patches, expectedRevision);
      },
    },
    command: {
      schema: commandBody,
      hint: "expected { command, input?, expectedRevision }",
      run: (scope: WorkKey, route: string, actor: "agent" | "human", body: unknown) => {
        const { command, input, expectedRevision } = body as z.infer<typeof commandBody>;
        return work.command(scope, route, actor, command, input, expectedRevision);
      },
    },
    // The agent door is refused by startFresh itself.
    [START_FRESH]: {
      schema: z.object({}),
      hint: "expected {}",
      run: (scope: WorkKey, route: string, actor: "agent" | "human") =>
        work.startFresh(scope, route, actor),
    },
  } as Record<
    string,
    {
      schema: z.ZodType;
      hint: string;
      run: (s: WorkKey, r: string, a: "agent" | "human", b: unknown) => Promise<unknown>;
    }
  >;

  async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const method = request.method;
    const parts = url.pathname.split("/").slice(2).map(decodeURIComponent); // drop "", "pe"
    const body = () => request.json().catch(() => null);

    if (method === "GET" && url.pathname === "/pe/capabilities") {
      if (!options.capabilityCatalog) return json({ error: "no capability catalog" }, 503);
      const scope = workKey(url, "", "read");
      if (scope instanceof Response) return scope;
      try {
        const selector =
          url.searchParams.get("session") ??
          (scope.target !== null ? `doc:${scope.target}` : undefined);
        return json(await options.capabilityCatalog.read(selector));
      } catch (error) {
        return json({ error: message(error) }, 502);
      }
    }
    if (method === "GET" && url.pathname === "/pe/resources")
      return resourceResponse(request, observe);

    if (parts[0] === "route-view" && parts[1] === "families") {
      const [, , instance] = parts;
      if (method === "PUT" && !instance) {
        const parsed = familiesViewSchema.safeParse(await body());
        return parsed.success
          ? json(views.publish(parsed.data))
          : json({ error: "invalid Families view" }, 400);
      }
      if (method === "GET" && !instance) {
        const thread = url.searchParams.get("thread");
        if (!thread) return json({ error: "thread required" }, 400);
        const result = views.select(thread, url.searchParams.get("instance") ?? undefined);
        return result && !("ok" in result)
          ? json(result)
          : json(result ?? { ok: false, error: "view unavailable" }, 409);
      }
      if (method === "POST" && instance === "set-query") {
        const parsed = familiesViewCommandSchema.safeParse(await body());
        if (!parsed.success)
          return json({ ok: false, error: "invalid Families query command" }, 400);
        const { thread, instance: target, revision, query } = parsed.data;
        const result = await views.setQuery(thread, target, revision, query);
        return json(result, (result as { ok: boolean }).ok ? 200 : 409);
      }
      if (method === "POST" && instance === "ack") {
        const parsed = familiesViewAckSchema.safeParse(await body());
        if (!parsed.success) return json({ ok: false, error: "invalid Families view ack" }, 400);
        const result = views.ack(parsed.data);
        return json(result, result.ok ? 200 : 409);
      }
      if (method === "DELETE" && instance) {
        views.remove(instance);
        return json({ ok: true });
      }
    }

    // Discovery is unscoped; every document read or write names one Work key.
    const agent = parts[0] === "agent";
    const [head, route, verb, extra] = agent ? parts.slice(1) : parts;
    if (head === "route-state" && extra === undefined) {
      const actor = agent ? "agent" : "human";
      if (method === "GET" && !route && !agent) return json(work.list());
      if (method === "GET" && route && !verb && !agent) {
        const scope = workKey(url, route, "read");
        if (scope instanceof Response) return scope;
        try {
          const view = await work.view(scope, route);
          return view ? json(view) : json({ error: `unknown route '${route}'` }, 404);
        } catch (error) {
          return json({ error: message(error) }, 403);
        }
      }
      // Human-only and read-only; the agent prefix answers so it is refused by name, not 404.
      if (method === "GET" && route && verb === "salvage") {
        const scope = workKey(url, route, "read");
        if (scope instanceof Response) return scope;
        const salvaged = await work.salvage(scope, route, actor);
        if (!salvaged) return json({ error: `nothing to salvage on '${route}'` }, 404);
        return "ok" in salvaged ? json(salvaged, 403) : json(salvaged);
      }
      const write = method === "POST" && route && verb ? writes[verb] : undefined;
      if (write && route) {
        const scope = workKey(url, route, "write");
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
          return json(await write.run(scope, route, actor, parsed.data));
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

  return { workspace: work, fetch: handle };
}

/**
 * The WorkKey a request names: `?work=<id>` for a standalone workspace, `?target=<address>` for
 * document-scoped Work, neither for the host-only Work. `open=<session>/<openId>` is the exact
 * document lifetime: alone it keys an unsaved document's ephemeral Work; beside a Target it is what
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
export function makeHostPeRoutes(
  hostBaseUrl: string,
  bridge: RevitBridge["Service"] | undefined,
  registrationsFactory: typeof createRouteRegistrations = createRouteRegistrations,
) {
  const sourceRoot = hostOwnership.sourceRoot;
  const threads = createHarnessThreads({
    root: productHarnessThreadsPath(),
    worldRoot: resolvePeaProductHomePath(),
    // The same kernel the Pea MCP server declares, for the harness that cannot read it from there.
    developerInstructions: async () => {
      const sessions = bridge ? await Effect.runPromise(bridge.list).catch(() => []) : [];
      return peaAgentInstructionsFor({
        revit: sessions.some((session) => session.connected && Boolean(session.sessionId)),
      });
    },
    // Dev lane: jiti runs the Pea MCP server from source.
    // TODO: installed lane needs a packaged Pea MCP server entry spawned beside Pe.Host.exe.
    mcpServer: sourceRoot
      ? (threadId) => {
          const ts = join(sourceRoot, checkoutLayout.ts);
          return {
            name: "pea",
            command: process.execPath,
            args: [
              join(ts, "node_modules", "jiti", "lib", "jiti-cli.mjs"),
              join(ts, "packages", "mcps", "src", "server.ts"),
              "pea",
            ],
            env: [
              { name: hostProcessIdentity.hostBaseUrlVariable, value: hostBaseUrl },
              { name: "PE_THREAD", value: threadId },
            ],
          };
        }
      : null,
  });
  const registrations = registrationsFactory({ hostBaseUrl });
  const catalog = createCapabilityCatalogSource({ hostBaseUrl, registrations });
  const routes = createPeRoutes({
    registrations,
    store: fileRouteDocumentStore(productRouteWorkPath()),
    heads: threads.heads,
    capabilityCatalog: catalog,
    observeHostResource: hostResourceObserver(bridge, undefined, undefined, hostBaseUrl),
    markReadings: markReadings(documentMarks(bridge)),
  });
  bindActionWorkspace(routes.workspace);
  sweepClosedDocuments(bridge, routes.workspace);
  return { threads, routes, catalog };
}

/** {@link makeHostPeRoutes} on the host's router. Harness children die when the launch scope closes. */
export const peRoutesLayer = (registrationsFactory?: typeof createRouteRegistrations) =>
  HttpRouter.use((router) =>
    Effect.gen(function* () {
      const { address } = yield* HttpServer.HttpServer;
      const hostBaseUrl = `http://127.0.0.1:${address._tag === "TcpAddress" ? address.port : 0}`;
      const bridge = Option.getOrUndefined(yield* Effect.serviceOption(RevitBridge));
      const { threads, routes, catalog } = makeHostPeRoutes(
        hostBaseUrl,
        bridge,
        registrationsFactory,
      );
      yield* Effect.addFinalizer(() => Effect.promise(() => threads.close()));
      // With Revit present the op and pod rows describe the connected session, so a session
      // arriving or leaving drops the 30 s cache; without Revit there is no bridge to watch.
      if (bridge)
        yield* Effect.forkScoped(
          Stream.fromPubSub(bridge.events).pipe(
            Stream.filter((e) => e.kind === "connected" || e.kind === "disconnected"),
            Stream.runForEach(() => Effect.sync(() => catalog.invalidate())),
          ),
        );
      const harness = HttpEffect.fromWebHandler((request) => threads.fetch(request));
      const pe = HttpEffect.fromWebHandler((request) => routes.fetch(request));
      for (const path of [
        "/pe/harnesses",
        "/pe/threads",
        "/pe/threads/:id",
        "/pe/threads/:id/:verb",
        "/pe/scope/:id",
      ] as const)
        yield* router.add("*", path, harness);
      for (const path of [
        "/pe/capabilities",
        "/pe/resources",
        "/pe/route-state",
        "/pe/route-state/:route",
        "/pe/route-state/:route/:verb",
        "/pe/agent/route-state/:route/:verb",
        "/pe/route-view/families",
        "/pe/route-view/families/:instance",
      ] as const)
        yield* router.add("*", path, pe);
    }),
  );

/**
 * The document-close edge, owned where the fact is: every bridge frame restates which open
 * lifetimes the connected sessions hold, so an addressless Work whose lifetime is no longer listed
 * is swept. The first sweep runs at wiring time, for lifetimes that ended while the host was down.
 */
function sweepClosedDocuments(bridge: RevitBridge["Service"] | undefined, work: RouteWorkspace) {
  if (!bridge) return;
  const sweep = () =>
    void Effect.runPromise(bridge.list)
      .then((sessions) =>
        work.sweepOpen(
          sessions.flatMap((session) =>
            session.connected && session.sessionId
              ? (session.state?.openDocuments ?? []).map((document) => ({
                  session: session.sessionId as string,
                  openId: document.openId,
                }))
              : [],
          ),
          sessions.flatMap((session) =>
            session.connected && session.sessionId ? [session.sessionId] : [],
          ),
        ),
      )
      .catch(() => undefined);
  bridge.subscribe(sweep);
  sweep();
}
