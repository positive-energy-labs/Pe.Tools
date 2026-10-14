import type { HostSessionScope } from "@pe/host-contracts/operation-types";
import { sdkSessionSelectionSchema } from "@pe/agent-contracts";
import type { MachineShareAdapter } from "./machine.ts";
import { Deferred, Effect, Layer, Option, Stream } from "effect";
import { HttpEffect, HttpRouter, HttpServer } from "effect/unstable/http";
import {
  addressSchema,
  bindWork,
  documentRefSchema,
  documentRows,
  familiesViewAckSchema,
  familiesViewCommandSchema,
  familiesViewSchema,
  readingKey,
  recentRows,
  routeStatePatchSchema,
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
import { productHarnessThreadsPath, productRouteWorkPath } from "./product-paths.ts";
import { hostResourceObserver, markReadings } from "./resource-adapters.ts";
import {
  createMachine,
  machineAcquisition,
  machineSessionAcquisition,
  machineSources,
  useHostMachine,
} from "./machine.ts";
import { bindControl, currentCaller, routeActorOf, writeTerminalContext } from "./control.ts";
import { bindRevoke } from "./revoke.ts";
import { hostActionJournal } from "./gateway-owner.ts";
import { UpdateReader } from "./update-reader.ts";
import { makeInstalledUpdateReader } from "./update-route.ts";
import { HostLifecycle } from "./host-lifecycle.ts";
import { bindActionWorkspace } from "./takeoff-actions.ts";
import { familySpecAsset, familySpecHandlers } from "./family-spec.ts";
import { fileRouteDocumentStore } from "./route-document-store.ts";
import { readNavigation, type NavigationSources } from "./navigation.ts";
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
  PAGE_LIBRARIES,
  type PageDescriptor,
} from "./page-libraries.ts";
import { join } from "node:path";
import { importShippedPods } from "./installed-pods.ts";
import { receiptQuerySchema } from "@pe/agent-contracts";
import {
  feedbackSchema,
  diagnosticsSchema,
  hostReceiptExport,
  createThreadReceiptAdapter,
  type ReceiptExport,
} from "./receipt-export.ts";
import { createNotices } from "./notices.ts";
export { fileRouteDocumentStore } from "./route-document-store.ts";

export interface PeRoutesOptions {
  registrations: readonly RouteWorkspaceRegistration[];
  store: RouteDocumentStore;
  heads: ThreadHeadSource;
  navigation?: NavigationSources;
  capabilityCatalog?: { read(scope?: HostSessionScope): Promise<CapabilityCatalog> };
  contributionRead?: (key: string, sha256?: string) => unknown;
  observeHostResource?: ResourceObserver;
  /** Wraps every served Reading, Work included, e.g. with the host's document change mark. */
  markReadings?: (observe: ResourceObserver) => ResourceObserver;
  telemetry?: ReceiptExport;
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
    const caller = currentCaller();
    const url = new URL(request.url);
    const method = request.method;
    if (method === "GET" && url.pathname === "/pe/family-spec") return familySpecAsset(url);
    const parts = url.pathname.split("/").slice(2).map(decodeURIComponent); // drop "", "pe"
    const body = () => request.json().catch(() => null);

    if (method === "GET" && url.pathname === "/pe/contributions") {
      const key = url.searchParams.get("key") ?? "";
      if (!parseContributionKey(key))
        return json({ error: "Expected a canonical contribution key" }, 400);
      const value = options.contributionRead?.(key, url.searchParams.get("sha256") ?? undefined);
      return value
        ? json(value)
        : json(
            { error: "Admitted contribution revision unavailable; rediscover before reading." },
            409,
          );
    }
    if (method === "GET" && url.pathname === "/pe/page-libraries") return json(PAGE_LIBRARIES);

    if (method === "GET" && url.pathname === "/pe/navigation") {
      try {
        return json(await readNavigation(work, options.navigation));
      } catch (error) {
        return json({ error: message(error) }, 502);
      }
    }
    if (method === "GET" && url.pathname === "/pe/capabilities") {
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
    if (method === "GET" && url.pathname === "/pe/resources")
      return resourceResponse(request, observe);
    if (
      method === "POST" &&
      (url.pathname === "/pe/feedback" ||
        url.pathname === "/pe/diagnostics" ||
        /^\/pe\/feedback\/[^/]+\/deliver$/.test(url.pathname))
    ) {
      if (caller.kind !== "human")
        return json(
          { error: "human.only: Feedback and browser diagnostics require a human caller." },
          403,
        );
      const telemetry = options.telemetry ?? hostReceiptExport();
      if (url.pathname === "/pe/diagnostics") {
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
    if (method === "GET" && url.pathname === "/pe/receipt-facts") {
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
      if (!url.searchParams.has("stream")) return json(await journal.read(q));
      const encoder = new TextEncoder();
      let release = () => {};
      return new Response(
        new ReadableStream({
          start(controller) {
            let closed = false;
            const seen = new Map<string, number>();
            const push = (r: import("@pe/agent-contracts").Receipt) => {
              if (closed || (seen.get(r.id) ?? 0) >= r.revision) return;
              seen.set(r.id, r.revision);
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(r)}\n\n`));
            };
            const unsubscribe = journal.subscribe(q, push);
            release = () => {
              if (closed) return;
              closed = true;
              unsubscribe();
              request.signal.removeEventListener("abort", release);
              try {
                controller.close();
              } catch {}
            };
            request.signal.addEventListener("abort", release, { once: true });
            controller.enqueue(encoder.encode(": receipts\n\n"));
            void journal
              .read(q)
              .then((rows) => rows.forEach(push))
              .catch((error) => {
                if (!closed) {
                  release();
                  console.warn("Receipt read failed", error);
                }
              });
          },
          cancel() {
            release();
          },
        }),
        { headers: { "content-type": "text/event-stream", "cache-control": "no-cache" } },
      );
    }

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
    const [head, route, verb, extra] = parts;
    if (head === "route-state" && extra === undefined) {
      // Door 9: the author is the host-minted caller, never the path. Reads are free.
      const actor = routeActorOf(caller);
      if (method === "GET" && !route) return json(work.list());
      if (method === "GET" && route && !verb) {
        const scope = workKey(url, route, "read");
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
        const salvaged = await work.salvage(scope, route, actor);
        if (!salvaged) return json({ error: `nothing to salvage on '${route}'` }, 404);
        return "ok" in salvaged ? json(salvaged, 403) : json(salvaged);
      }
      const write = method === "POST" && route && verb ? writes[verb] : undefined;
      if (write && route && (caller.kind === "anonymous" || caller.kind === "page"))
        return json(
          {
            ok: false,
            kind: "error",
            error:
              caller.kind === "page"
                ? `page.use-page-door: Pages act through /pages/<slug>/act, not /pe/route-state.`
                : "context.missing: Refused at /pe/route-state: no caller context. Anonymous loopback calls are read-only; run this from Pea, the web app, or a bound Page.",
            refusal: {
              code: caller.kind === "page" ? "page.use-page-door" : "context.missing",
              door: `/pe/route-state/${route}/${verb}`,
              reason:
                caller.kind === "page"
                  ? "Pages act through /pages/<slug>/act."
                  : "Anonymous loopback calls are read-only.",
            },
          },
          403,
        );
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
export function createContributionContent(options: {
  worldRoot: string;
  packages?: typeof listPackages;
  pages?: (packages: readonly AdmittedPackage[]) => Promise<readonly PageDescriptor[]>;
  bootstrap?: () => Promise<unknown>;
}) {
  const revisions = new Map<string, Map<string, unknown>>();
  const latest = new Map<string, unknown>();
  let snapshot: Promise<CapabilityContent> | undefined;
  let observedAt = 0;
  let pending = false;
  let initialized: Promise<unknown> | undefined;
  let admitted: readonly AdmittedPackage[] = [];
  const remember = (key: string, value: { sha256: string } & Record<string, unknown>) => {
    let versions = revisions.get(key);
    if (!versions) revisions.set(key, (versions = new Map()));
    versions.set(value.sha256, value);
    if (versions.size > 4) versions.delete(versions.keys().next().value!);
    latest.set(key, value);
  };
  /** Scratch Page rows with their content remembered for member reads. */
  function pageRows(
    descriptors: readonly PageDescriptor[],
    projections: ReadonlyMap<string | null, { openUrl: string; pane: string }>,
  ): Capability[] {
    return descriptors
      .filter((p) => p.key !== null && p.openUrl !== null)
      .filter((p) => parseContributionKey(p.key!)?.packageId === "pages")
      .map((p) => {
        const ref = parseContributionKey(p.key!)!;
        remember(p.key!, {
          content: new TextDecoder().decode(p.entry.bytes),
          bytesBase64: Buffer.from(p.entry.bytes).toString("base64"),
          sha256: p.entry.sha256,
        });
        return {
          key: p.key!,
          kind: "page",
          title: p.title,
          description: "Page shared state and binding.",
          needs: "nothing",
          mutates: false,
          principal: ["human", "pea", "page", "external-mcp"],
          input: {},
          source: "pages",
          rank: 1,
          package: { id: "pages", path: `${ref.path}/index.html`, sha256: p.entry.sha256 },
          projection: projections.get(p.key),
        };
      });
  }
  async function build(): Promise<CapabilityContent> {
    await (initialized ??= options.bootstrap?.() ?? Promise.resolve());
    const listing = await (options.packages ?? listPackages)();
    admitted = listing.packages;
    const allDescriptors = options.pages
      ? await options.pages(listing.packages)
      : [
          ...(await scratchPageDescriptors(join(options.worldRoot, "Pages"))),
          ...packagePageDescriptors(listing.packages),
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
    const packages = listing.packages.map((pod) =>
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
    const packagedSkills = listing.packages.flatMap((pod) =>
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
    );
    latest.clear();
    for (const pod of listing.packages) {
      if (pod.diagnostics.some((d) => d.severity === "error")) continue;
      const frozen = await capturePackage(pod);
      for (const member of pod.members) {
        const value = {
          content: new TextDecoder().decode(member.bytes),
          bytesBase64: Buffer.from(member.bytes).toString("base64"),
          sha256: member.sha256,
        };
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
    const pages = pageRows(descriptors, pageProjections);
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
      ],
    };
  }
  return {
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
      return pageRows(
        descriptors,
        new Map(
          descriptors.flatMap((p) =>
            p.key !== null && p.openUrl !== null
              ? [[p.key, { openUrl: p.openUrl, pane: "page" }] as const]
              : [],
          ),
        ),
      );
    },
    member: (key: string, sha256?: string) =>
      sha256 ? revisions.get(key)?.get(sha256) : latest.get(key),
  };
}

export function makeHostPeRoutes(
  hostBaseUrl: string,
  bridge: RevitBridge["Service"] | undefined,
  registrationsFactory: typeof createRouteRegistrations = createRouteRegistrations,
  update: UpdateReader["Service"] = makeInstalledUpdateReader(),
  share?: MachineShareAdapter,
  updateHandoff?: () => void,
) {
  const sourceRoot = hostOwnership.sourceRoot;
  const worldRoot = resolvePeaProductHomePath();
  const content = createContributionContent({
    worldRoot,
    bootstrap: async () => {
      const imported = await importShippedPods();
      const refused = imported.outcomes.filter((outcome) => outcome.outcome === "refused");
      if (refused.length)
        throw Error(
          `Shipped Pod import refused: ${refused.map((outcome) => outcome.reason).join("; ")}`,
        );
    },
  });
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
  const receiptThreads = createThreadReceiptAdapter(telemetry, () => threads.receiptSnapshot());
  const threads = createHarnessThreads({
    prepare: () => content.read(),
    providers,
    updatePending: update.automaticPending,
    root: productHarnessThreadsPath(),
    worldRoot,
    // The same kernel the Pea MCP server declares, for the harness that cannot read it from there.
    developerInstructions: async () => peaAgentInstructions,
    mcpServer: (context) => peaMcpServer(sourceRoot, hostBaseUrl, context),
    receiptFact: receiptThreads.accept,
  });
  const receiptContextReady = receiptThreads.hydrate();
  const notices = createNotices({
    source: {
      read: async (q) => {
        await receiptContextReady;
        return telemetry.journal.read(q);
      },
      subscribe: (q, consume) => telemetry.journal.subscribe(q, consume),
    },
    context: receiptThreads.context,
    onFault: (error) => console.warn("Notice receipt read failed", error),
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
      hostOwnership.lane === "installed" && updateHandoff
        ? { peaActive: threads.active, handoff: updateHandoff }
        : undefined,
  });
  const registrations = registrationsFactory({ hostBaseUrl });
  for (const registration of registrations) {
    if (registration.spec.route === "family")
      Object.assign(registration.handlers, familySpecHandlers());
  }
  const catalog = createCapabilityCatalogSource({
    hostBaseUrl,
    registrations,
    machine: () => machine.refresh(),
    content: content.read,
    pages: content.pages,
  });
  const routes = createPeRoutes({
    registrations,
    store: fileRouteDocumentStore(productRouteWorkPath()),
    heads: threads.heads,
    navigation: {
      threads: async () => {
        const response = await threads.fetch(new Request(`${hostBaseUrl}/pe/threads`));
        if (!response.ok) throw new Error(`Thread summaries unavailable (${response.status})`);
        return response.json();
      },
      documents: async () => {
        if (!bridge) return [];
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
    contributionRead: content.member,
    observeHostResource: hostResourceObserver(
      bridge,
      undefined,
      undefined,
      hostBaseUrl,
      undefined,
      machine,
    ),
    markReadings: markReadings(documentMarks(bridge)),
    telemetry,
  });
  bindActionWorkspace(routes.workspace);
  sweepClosedDocuments(bridge, routes.workspace);
  return { providers, threads, routes, catalog, machine, notices };
}

/** {@link makeHostPeRoutes} on the host's router. Harness children die when the launch scope closes. */
export const peRoutesLayer = (
  registrationsFactory?: typeof createRouteRegistrations,
  share?: MachineShareAdapter,
) =>
  HttpRouter.use((router) =>
    Effect.gen(function* () {
      const { address } = yield* HttpServer.HttpServer;
      const hostBaseUrl = `http://127.0.0.1:${address._tag === "TcpAddress" ? address.port : 0}`;
      const bridge = Option.getOrUndefined(yield* Effect.serviceOption(RevitBridge));
      const update = yield* UpdateReader;
      const lifecycle = Option.getOrUndefined(yield* Effect.serviceOption(HostLifecycle));
      const { providers, threads, routes, catalog, machine, notices } = makeHostPeRoutes(
        hostBaseUrl,
        bridge,
        registrationsFactory,
        update,
        share,
        lifecycle ? () => Effect.runSync(Deferred.succeed(lifecycle.latch, undefined)) : undefined,
      );
      useHostMachine(machine);
      bindControl({
        heads: threads.heads.read,
        subscribeHeads: threads.heads.subscribe,
        acquired: machineAcquisition,
        acquiredSession: machineSessionAcquisition,
      });
      const unbindRevoke = bridge ? bindRevoke(hostActionJournal(), bridge) : undefined;
      const terminal = writeTerminalContext(hostOwnership.serviceName);
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          unbindRevoke?.();
          terminal.retire();
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
      yield* Effect.addFinalizer(() => Effect.promise(() => threads.close()));
      yield* Layer.build(notices.route);
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
      const harness = HttpEffect.fromWebHandler((request) => threads.fetch(request));
      const pe = HttpEffect.fromWebHandler((request) => routes.fetch(request));
      const provider = HttpEffect.fromWebHandler((request) => providers.fetch(request));
      for (const path of [
        "/pe/providers",
        "/pe/providers/:id",
        "/pe/providers/:id/:verb",
        "/pe/access",
      ] as const)
        yield* router.add("*", path, provider);
      for (const path of [
        "/pe/threads",
        "/pe/threads/:id",
        "/pe/threads/:id/:verb",
        "/pe/scope/:id",
        "/pe/scope/:id/:verb",
      ] as const)
        yield* router.add("*", path, harness);
      for (const path of [
        "/pe/navigation",
        "/pe/capabilities",
        "/pe/contributions",
        "/pe/page-libraries",
        "/pe/family-spec",
        "/pe/feedback",
        "/pe/feedback/:id/deliver",
        "/pe/diagnostics",
        "/pe/receipt-facts",
        "/pe/resources",
        "/pe/route-state",
        "/pe/route-state/:route",
        "/pe/route-state/:route/:verb",
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
