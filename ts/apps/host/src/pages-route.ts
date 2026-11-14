import { stateScope } from "@pe/host-contracts/service-identity";
import { targetHomes } from "./call-route.ts";
import { readSessionScope } from "./sdk-session.ts";
import {
  peRoutes,
  servePeRoute,
  peClientScript,
  matchPeRoute,
  peRouteUrl,
} from "@pe/agent-contracts/pe-api";
/** Scratch Pages and admitted Pod Pages share serving, binding and event state. See pe.js for the author API. */
import { readFileSync, watch } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { Effect, Option } from "effect";
import { HttpEffect, HttpRouter, HttpServer } from "effect/http";
import {
  HOST_CONTEXT_HEADER,
  HOST_RPC_BRIDGE_SESSION_HEADER,
  HOST_RPC_DOCUMENT_HEADER,
  HOST_RPC_ORIGIN_HEADER,
  HOST_RUNTIME_SERVICE_HEADER,
  HOST_RUNTIME_SERVICE_QUERY,
} from "@pe/host-contracts/contracts";
import {
  routeAddress,
  oneName,
  addressSchema,
  pageBindingSchema,
  parseContributionKey,
  pageKeyOf,
  pageChoiceSchema,
  resolveCallTarget,
  headRequests,
  emptyThreadHead,
  resolvePinned,
  unboundPage,
  readingKey,
  type ReadingFrame,
  type ReadingRequest,
  type Caller,
  type DocumentRef,
  type PageBinding,
  type PageChoice,
  type PageTargetReading,
  type PageWrite,
  type Refusal,
  type TargetInventory,
  type TargetResolution,
  type ActionAdmission,
} from "@pe/agent-contracts";
import { z } from "zod";
import { resourceSnapshot, type OwnerValue } from "@pe/runtime";
import { RevitBridge } from "./bridge.ts";
import { hostOwnership, hostState } from "./host-ownership.ts";
import {
  admitPage,
  currentCaller,
  mintPageDoor,
  pageActDoor,
  readsOnly,
  Refused,
  refusalHeaders,
  documentAcquisition,
  threadHead,
  subscribeHeads,
} from "./control.ts";
import { capturePackage, listPackages, productPodsRoots, type PodsRoots } from "./packages.ts";
import { activePackages, requirePackageEnabled } from "./package-lifecycle.ts";
import {
  pageDescriptors,
  PAGE_LIBRARY_SOURCES,
  productPagesRoots,
  scratchPageDirectory,
  type PagesRoots,
} from "./page-libraries.ts";
import { exportPage } from "./page-export.ts";
import { escapeHtml, withPageKey } from "./page-publication.ts";
import type { ActionJournal } from "./action-journal.ts";
import { ActionJournalService } from "./receipt-services.ts";
import { PAGE_MEDIA } from "./page-artifacts.ts";
import {
  appendLine,
  read as readStoredFile,
  readLines,
  writeState,
  stateKind,
  stateLog,
  type StateDirectory,
} from "@pe/host-contracts/kinds";
import { stateDirectory } from "@pe/host-contracts/service-identity";

/**
 * Each library file beside its source on the dev lane, so an edit is live on the next request;
 * staged under `<exeDir>/pages` when installed (`scripts/stage-web.mjs`).
 */
const assetPath = (name: string) => {
  const source = Object.entries(PAGE_LIBRARY_SOURCES).find(([file]) => file === name)?.[1];
  if (!source) throw Error(`Unknown Page library ${name}`);
  return hostOwnership.lane === "installed"
    ? join(dirname(process.execPath), "pages", name)
    : fileURLToPath(new URL(source, import.meta.url));
};

/**
 * The facsimile is an ES module for the web app; pages load classic scripts (their inline handlers
 * need globals), so its one closing `export { … }` line becomes `globalThis.rv = { … }` and the
 * whole file runs inside one function scope.
 */
const classicRevit = () => {
  const source = asset("revit.js");
  const exports = /^export \{([^}]*)\};?\s*$/m;
  if (!exports.test(source)) throw Error("revit.js must end with one `export { … }` line");
  // One function scope, so the module's helpers (esc, set, …) never collide with a page's globals.
  return `(() => {
${source.replace(exports, "globalThis.rv = {$1};")}
})();
`;
};
const asset = (name: string) => {
  try {
    return readFileSync(assetPath(name), "utf8");
  } catch (error) {
    if (isMissing(error)) throw Error(`Page library ${name} is missing; build @pe/kit first`);
    throw error;
  }
};

/**
 * The doors carry the runtime that served them: the request identity gate refuses a browser API
 * request that does not name its runtime, so this host writes its own service name into pe.js,
 * as the web app's build freezes it into its module graph.
 */
const RUNTIME_SLOT = "/*pe:runtime*/ null";
const servedPe = () => {
  const source = asset("pe.js");
  if (!source.includes(RUNTIME_SLOT)) throw Error(`pe.js must hold one \`${RUNTIME_SLOT}\` slot`);
  const rendered = source.replace("/*pe:client*/ null", peClientScript()).replace(
    RUNTIME_SLOT,
    JSON.stringify({
      header: HOST_RUNTIME_SERVICE_HEADER,
      query: HOST_RUNTIME_SERVICE_QUERY,
      service: hostOwnership.serviceName,
    }),
  );
  const unfilled = rendered.match(/\/\*pe:[^*]+\*\/\s*null\b/);
  if (unfilled) throw Error(`Unfilled pe.js slot: ${unfilled[0]}`);
  return rendered;
};

/** A host library by URL, or null: serving, export and publication preview read the same bytes. */
export const pageLibrary = (path: string): string | null => {
  if (path === "/pages/pe.js") return servedPe();
  if (path === "/pages/pe.css") return `${asset("base.css")}\n${asset("pe.css")}`;
  if (path === "/pages/revit.js") return classicRevit();
  const file = path.slice("/pages/".length);
  return Object.hasOwn(PAGE_LIBRARY_SOURCES, file) ? asset(file) : null;
};

/** One file segment: a leading dot is refused, so editor droppings stay private. */
const SEGMENT = /^[a-z0-9_-][a-z0-9_.-]*$/i;
const HEARTBEAT_MS = 15_000;
const isMissing = (error: unknown) => (error as { code?: string } | null)?.code === "ENOENT";

const pageEventRowSchema = z.object({
  seq: z.number(),
  at: z.string(),
  origin: z.string(),
  event: z.unknown(),
});
export type PageEventRow = z.infer<typeof pageEventRowSchema>;
const lastSeq = (rows: readonly PageEventRow[]) => rows.at(-1)?.seq ?? 0;
/** One `GET /pages` row; `pod` is the package id when an admitted package contributes the page. */
export type PageRow = {
  slug: string;
  /** The Page key: `page:@pages/<slug>`, or the package's `page:@<id>/pages/<page>`; null when the folder has none. */
  key: string | null;
  title: string;
  /** Null when the folder has no key (an unsafe or case-colliding name). */
  url: string | null;
  /** Null for a packaged Page. */
  modifiedAt: string | null;
  pod: string | null;
};
type Listener = (row: PageEventRow) => void;
/** A named push on a page's stream that is not a log row: `binding`, `file`. */
type Signal = (event: "binding" | "file", data: unknown) => void;

/** One open document as the bridge lists it. */
type LiveDocument = {
  openId: string;
  title: string;
  address?: string | null;
  isFamilyDocument: boolean;
  isActive: boolean;
};
/** A connected Revit; `documents` is null while its state has not arrived. */
export type LiveSession = { session: string; documents: readonly LiveDocument[] | null };
/** What the page doors need from the running host; tests hand in their own. */
export type PageLive = {
  sessions(): Promise<readonly LiveSession[]>;
  /** One POST into this host's own `/call` or `/actions`, carrying the minted page-door context. */
  forward(
    path: "/call" | "/actions",
    headers: Record<string, string>,
    body: unknown,
  ): Promise<Response>;
};
const noLive: PageLive = {
  sessions: async () => [],
  forward: async () => problem(503, "this host has no Revit composition"),
};

const callBodySchema = peRoutes["page.call"].body;
const actBodySchema = peRoutes["page.act"].body;

const inventoryOf = (sessions: readonly LiveSession[]): TargetInventory => ({
  kind: "ready",
  sessions: Object.fromEntries(
    sessions.map(({ session, documents }) => [
      session,
      documents === null
        ? { kind: "checking" as const }
        : {
            kind: "ready" as const,
            values: documents.map((doc) => ({
              openId: doc.openId,
              address: addressSchema.safeParse(doc.address).data ?? null,
              kind: doc.isFamilyDocument ? ("family" as const) : ("project" as const),
            })),
          },
    ]),
  ),
});

/**
 * A slot against the live sessions. `none` names nothing: it is `choose`, with one Revit or two,
 * never the active document (K15, ADR 0017 D10).
 */
function resolveSlot(slot: PageChoice, sessions: readonly LiveSession[]): TargetResolution {
  if (slot.kind === "thread")
    return resolveCallTarget(
      { needs: "document" },
      headRequests(threadHead(slot.thread) ?? emptyThreadHead),
      inventoryOf(sessions),
    );
  if (slot.kind === "pinned") return resolvePinned(slot.address, inventoryOf(sessions));
  return { kind: "choose", reason: "missing" };
}

/** The host-stamped origin of a row; never a header. */
const originOf = (caller: Caller) =>
  caller.kind === "page" ? "page" : caller.kind === "human" ? "person" : "agent";

const unboundRefusal = (door: string): Refusal => ({
  code: "page.unbound",
  door,
  reason: `Refused at ${door}: this Page has no target. Bind it to a thread or pin a document from the chip.`,
});

/**
 * One Page's log, text projection and binding. They are machine state (ADR 0037 rule 6): `dir` is the
 * Page's folder under the state root, never the Page's own folder in a home. Appends are serial
 * per page. Page state is discard class (ADR 0039): a text projection or binding that does not decode is
 * deleted with one notice and reads as absent. The event log is append-only and decodes per line:
 * a bad line is left out with one notice, and a read never rewrites the file.
 */
const pageFileKind = <T>(schema: z.ZodType<T>, name: "binding.json" | "text.json", slug: string) =>
  stateKind({
    schema,
    place: () => `Page ${slug}`,
    segments: () => [name],
  });
const pageEventsKind = stateLog({
  schema: pageEventRowSchema,
  place: (slug: string) => `Page ${slug}`,
  segments: (_slug: string) => ["events.jsonl"],
});
class PageState {
  private readonly listeners = new Set<Listener>();
  private readonly signals = new Set<Signal>();
  private unwatch: (() => void) | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(
    private readonly pageDir: string,
    private readonly storage: StateDirectory,
  ) {}
  private get dir() {
    return this.storage.path;
  }
  private stored<T>(file: "text.json" | "binding.json", schema: z.ZodType<T>, missing: T) {
    const read = readStoredFile(pageFileKind(schema, file, basename(this.dir)).in(this.storage));
    return read.kind === "ok" ? read.value : missing;
  }
  async rows(): Promise<PageEventRow[]> {
    const read = readLines(pageEventsKind.in(this.storage, basename(this.dir)));
    return read.kind === "ok" ? read.values : [];
  }
  append(event: unknown, origin: string): Promise<PageEventRow> {
    const job = this.queue.then(async () => {
      // After the last row that reads, not a count: a line left out must not hand its number out twice.
      const seq = lastSeq(await this.rows()) + 1;
      const row: PageEventRow = { seq, at: new Date().toISOString(), origin, event };
      appendLine(pageEventsKind.in(this.storage, basename(this.dir)), row);
      for (const listen of this.listeners) listen(row);
      return row;
    });
    this.queue = job.catch((error) => {
      console.error("pages-route: asynchronous operation failed", error);
      return undefined;
    });
    return job;
  }
  /** A binding names a thread or a document as data in the file, never in its path. */
  binding(): PageBinding {
    return this.stored("binding.json", pageBindingSchema, unboundPage);
  }
  writeBinding(value: PageBinding) {
    writeState(
      pageFileKind(pageBindingSchema, "binding.json", basename(this.dir)).in(this.storage),
      JSON.stringify(value, null, 2),
    );
    this.signal("binding", {});
  }
  projection() {
    return this.stored("text.json", peRoutes["page.text"].body.nullable(), null);
  }
  async writeText(value: z.infer<(typeof peRoutes)["page.text"]["body"]>) {
    const seq = lastSeq(await this.rows());
    if (value.seq > seq || value.seq < (this.projection()?.seq ?? 0)) return false;
    writeState(
      pageFileKind(peRoutes["page.text"].body, "text.json", basename(this.dir)).in(this.storage),
      JSON.stringify(value),
    );
    return true;
  }
  follow(listen: Listener) {
    this.listeners.add(listen);
    return () => this.listeners.delete(listen);
  }
  signal: Signal = (event, data) => {
    for (const hear of this.signals) hear(event, data);
  };
  /**
   * Named pushes while a stream is open. The page folder is watched only then: a change to any
   * file outside a dot-folder is `file`, so a stale tab reloads without polling its own file.
   */
  hear(signal: Signal) {
    this.signals.add(signal);
    if (!this.unwatch) this.unwatch = this.watch();
    return () => {
      this.signals.delete(signal);
      if (this.signals.size || !this.unwatch) return;
      this.unwatch();
      this.unwatch = null;
    };
  }
  private watch() {
    const pending = new Map<string, ReturnType<typeof setTimeout>>();
    try {
      const watcher = watch(this.pageDir, { recursive: true }, (_kind, name) => {
        const path = name?.toString().replaceAll("\\", "/");
        if (!path || path.split("/").some((segment) => segment.startsWith("."))) return;
        // One write is several OS events; one push per path settles them.
        clearTimeout(pending.get(path));
        pending.set(
          path,
          setTimeout(() => (pending.delete(path), this.signal("file", { path })), 50),
        );
      });
      watcher.on("error", () => watcher.close());
      return () => {
        for (const timer of pending.values()) clearTimeout(timer);
        watcher.close();
      };
    } catch (error) {
      if (isMissing(error)) return () => {};
      throw error;
    }
  }
}

const json = (body: unknown, status = 200) => Response.json(body, { status });
const problem = (status: number, message: string) => json({ error: message, message }, status);
/** A door refusal, the shape `/actions` answers: 403, named, never dispatched. */
const refused = (refusal: Refusal) =>
  Response.json(
    { error: refusal.reason, message: refusal.reason, refusal, notDispatched: true },
    { status: 403, headers: refusalHeaders(refusal.code) },
  );
/** A slot that names no one document (or not yet): 409 with the resolver's own words. */
const unresolved = (door: string, resolution: Exclude<TargetResolution, { kind: "resolved" }>) => {
  const why =
    resolution.kind === "choose"
      ? `choose: ${resolution.reason}`
      : resolution.kind === "failed"
        ? `failed: ${resolution.message}`
        : "checking";
  const message = `Refused at ${door}: the binding names no one document (${why}). Bind it from the chip.`;
  return json({ error: message, message, resolution, notDispatched: true }, 409);
};

/** A catalog row's `op:<key>` (what `pe.find` answers) names the operation `<key>`. */
const bareOp = (key: string) => key.replace(/^op:/, "");

/**
 * The pages handler over the Pages root and the Pods root: a plain web handler, so tests need no
 * server and SSE is a ReadableStream. No pods root means no pod pages.
 */
export function createPagesHandler(
  root: PagesRoots,
  pods?: PodsRoots,
  live: PageLive = noLive,
  journal?: ActionJournal,
  /** Where Page state lives: one folder per slug under the machine state root, never in a home. */
  stored: StateDirectory = stateScope(hostState(), hostState().pages),
) {
  /**
   * Where a slug's folder is: `<root>/<slug>`, or for `<id>--<page>` the folder of the one admitted
   * package with that id that contributes `pages/<page>` (a duplicated id contributes nothing).
   * ponytail: a pod page's request lists the packages once; cache by snapshot if pods get large.
   * `state` is the Page's state folder, named by its slug alone: a Page id is unique across homes,
   * so no key names a home. A scratch slug matches its folder in any casing, so the folder's own
   * name is the one spelling.
   */
  const dirOf = async (slug: string) => {
    const [id, page, ...more] = slug.split("--");
    if (page === undefined) {
      const found = await scratchPageDirectory(slug, root);
      return found && { ...found, pod: null, state: join(stored.path, basename(found.dir)) };
    }
    if (more.length || !pods) return null;
    for (const pod of await activePackages((await listPackages(pods)).packages, pods)) {
      const row = pod.contributions.find(
        (one) => one.kind === "page" && one.path === `pages/${page}`,
      );
      if (pod.id === id && row)
        return {
          dir: join(pod.directory, row.path),
          pod: pod.id,
          key: row.key,
          state: join(stored.path, slug),
        };
    }
    return null;
  };
  const states = new Map<string, PageState>();
  /** By folder: a renamed pod's page keeps its slug and opens its state where it lives now. */
  const stateOf = (where: { dir: string; state: string }) => {
    let state = states.get(where.dir);
    if (!state) {
      states.set(
        where.dir,
        (state = new PageState(where.dir, stateDirectory(stored, basename(where.state)))),
      );
    }
    return state;
  };

  /** `GET /pages`: the one Page projection, as rows: scratch newest first, then packaged by key. */
  const list = async (): Promise<PageRow[]> =>
    (
      await pageDescriptors(
        pods ? await activePackages((await listPackages(pods)).packages, pods) : [],
        root,
      )
    ).map((page) => ({
      slug: page.slug,
      key: page.key,
      title: page.title,
      url: page.openUrl,
      modifiedAt: page.modifiedAt,
      pod: page.pod,
    }));

  function listPage(pages: PageRow[]) {
    const rows = pages.length
      ? pages
          .map(
            (p) =>
              `<li>${p.url ? `<a href="${p.url}">${escapeHtml(p.title)}</a>` : `${escapeHtml(p.title)} <small>not a Page until its folder is renamed</small>`} <code>${escapeHtml(p.slug)}</code>${p.pod ? ` <small>pod ${escapeHtml(p.pod)}</small>` : ""} ${p.modifiedAt ? ` <small>${escapeHtml(p.modifiedAt.slice(0, 16).replace("T", " "))}</small>` : ""}</li>`,
          )
          .join("\n")
      : `<li><em>none yet</em></li>`;
    return new Response(
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Pages</title><link rel="stylesheet" href="/pages/pe.css"></head>
<body style="padding:24px;max-width:720px"><h1>Pages</h1>
<p>Every folder under <code>${escapeHtml([root].flat().join(", "))}</code> with an <code>index.html</code>, newest first${pods ? `, and every <code>pages/&lt;page&gt;</code> inside a pod under <code>${escapeHtml([pods].flat().join(", "))}</code> as <code>&lt;pod&gt;--&lt;page&gt;</code>` : ""}. Doors: <a href="/pages/pe.js">pe.js</a> · <a href="/pages/pe.css">pe.css</a> · <a href="/pages/revit.js">revit.js</a>.</p>
<ul>${rows}</ul>
<h2>Make one</h2>
<p>A page is a folder with an <code>index.html</code>; a pod carries pages in its <code>pages/</code> folder. Three lines give it Revit and a shared log:</p>
<pre>&lt;link rel="stylesheet" href="/pages/pe.css"&gt;
&lt;script src="/pages/pe.js"&gt;&lt;/script&gt;
&lt;script&gt;
  const k = await pe.state({ reduce, base: {}, render, describe, agent: {} });
  await pe.do("revit.context.show-elements", { elementIds: [1234] });   // pe.find, pe.read, pe.do: Pea's doors
  await pe.script("checks/census.csx");                        // C# beside the page; pe.picture, pe.diff, pe.reading
&lt;/script&gt;</pre>
<p>Agents reach the same log at <code>GET /pages/&lt;slug&gt;/state</code> (<code>events</code>, <code>text</code>, <code>textSeq</code> and <code>agent</code>) and <code>POST /pages/&lt;slug&gt;/events</code>. The header of <a href="/pages/pe.js">pe.js</a> is the whole reference.</p>
</body></html>`,
      { headers: { "content-type": "text/html; charset=utf-8" } },
    );
  }

  async function file(slug: string, dir: string, page: string, segments: string[]) {
    if (!segments.every((s) => SEGMENT.test(s)))
      return problem(400, "that is not a page file path");
    const path = join(dir, ...segments);
    try {
      const raw = await readFile(path);
      const bytes =
        segments.length === 1 && segments[0] === "index.html"
          ? withPageKey(raw.toString("utf8"), page)
          : raw;
      return new Response(bytes, {
        headers: {
          "content-type": PAGE_MEDIA[extname(path).toLowerCase()] ?? "application/octet-stream",
          "cache-control": "no-cache",
        },
      });
    } catch (error) {
      if (isMissing(error) || (error as { code?: string }).code === "EISDIR")
        return problem(
          404,
          segments.length === 1 && segments[0] === "index.html"
            ? `no page ${slug}: a page is a folder ${dir} holding an index.html`
            : `no ${segments.join("/")} in page ${slug}`,
        );
      throw error;
    }
  }

  function sse(request: Request, state: PageState, after: number) {
    const encoder = new TextEncoder();
    const frame = (row: PageEventRow) =>
      encoder.encode(`id: ${row.seq}\ndata: ${JSON.stringify(row)}\n\n`);
    let stop = () => {};
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(encoder.encode(": open\n\n"));
        let last = after;
        const send = (row: PageEventRow) => {
          if (row.seq <= last) return;
          last = row.seq;
          controller.enqueue(frame(row));
        };
        // Buffer live rows until replay finishes: a newer row must not skip an unseen prefix.
        const pending: PageEventRow[] = [];
        let replayed = false;
        const unfollow = state.follow((row) => (replayed ? send(row) : pending.push(row)));
        const unhear = state.hear((event, data) => {
          if (event === "file")
            controller.enqueue(encoder.encode(`event: file\ndata: ${JSON.stringify(data)}\n\n`));
        });
        // A named heartbeat, so pe.js can tell a quiet stream from a dead one (a browser's own
        // EventSource retry was seen to never fire after a dev host restart, 2026-10-04).
        const beat = setInterval(
          () => controller.enqueue(encoder.encode("event: ping\ndata: {}\n\n")),
          HEARTBEAT_MS,
        );
        stop = () => {
          last = Infinity;
          request.signal.removeEventListener("abort", stop);
          clearInterval(beat);
          unfollow();
          unhear();
          try {
            controller.close();
          } catch (error) {
            console.warn("ts/apps/host/src/pages-route.ts: fallback after failure", error);
            /* already closed by the consumer */
          }
        };
        // Listen before the replay's await: an abort during it still closes the folder watcher.
        request.signal.addEventListener("abort", stop);
        if (request.signal.aborted) stop();
        for (const row of await state.rows()) send(row);
        for (const row of pending.sort((a, b) => a.seq - b.seq)) send(row);
        replayed = true;
      },
      cancel() {
        stop();
      },
    });
    return new Response(body, {
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      },
    });
  }

  async function target(page: string, state: PageState): Promise<PageTargetReading> {
    const actDoor = pageActDoor(page);
    const slot = state.binding().slots.default;
    const sessions = await live.sessions();
    const resolution = resolveSlot(slot, sessions);
    const ref =
      resolution.kind === "resolved" && resolution.target.kind === "document"
        ? resolution.target.ref
        : null;
    const title = ref
      ? (sessions
          .find((s) => s.session === ref.session)
          ?.documents?.find((d) => d.openId === ref.openId)?.title ?? "")
      : "";
    let write: PageWrite | null =
      slot.kind === "none" ? { kind: "read", refusal: unboundRefusal(actDoor) } : null;
    if (resolution.kind === "resolved")
      try {
        const basis = admitPage(slot, resolution.target, actDoor);
        write =
          basis?.kind === "grant" ? { kind: "thread", thread: basis.thread } : { kind: "pea" };
      } catch (error) {
        if (!(error instanceof Refused)) throw error;
        write = { kind: "read", refusal: error.refusal };
      }
    return {
      page,
      slot: "default",
      binding: slot,
      resolution,
      document: ref ? { ...ref, title } : null,
      write,
    };
  }

  /**
   * Only the page itself (its own browser) or a person drives its doors. Pea reaches a page
   * through its shelf; a Pea or MCP context here would borrow a binding that is not its own.
   */
  function doorRefusal(door: string, caller: Caller): Refusal | null {
    if (caller.kind === "page" || caller.kind === "human") return null;
    return caller.kind === "anonymous"
      ? {
          code: "context.missing",
          door,
          reason: `Refused at ${door}: no caller context. A Page's doors answer its own browser.`,
        }
      : {
          code: "page.binding-not-yours",
          door,
          reason: `Refused at ${door}: a Page's doors answer its own browser; a ${caller.kind} call would borrow a binding that is not its own.`,
        };
  }

  /** One crossing as the page, under a context minted for this request and retired after it. */
  async function cross(
    page: string,
    slot: PageChoice,
    humanBound: boolean,
    target: DocumentRef | null,
    door: string,
    path: "/call" | "/actions",
    headers: Record<string, string>,
    body: unknown,
  ) {
    const minted = mintPageDoor(page, slot, door, humanBound, target);
    try {
      return await live.forward(
        path,
        { ...headers, [HOST_CONTEXT_HEADER]: minted.token, [HOST_RPC_ORIGIN_HEADER]: page },
        body,
      );
    } finally {
      minted.retire();
    }
  }

  async function door(
    verb: "call" | "act",
    slug: string,
    state: PageState,
    page: string,
    request: Request,
    caller: Caller,
  ) {
    const at = `/pages/${slug}/${verb}`;
    const who = doorRefusal(at, caller);
    if (who) return refused(who);
    const raw: unknown = await request.json().catch((error) => {
      console.error("pages-route: asynchronous operation failed", error);
      return undefined;
    });
    const binding = state.binding();
    const slot = binding.slots.default;
    // Only a person's pin consents to ReadOnly on its resolved document; thread bindings need a human-added target.
    const humanBound = binding.boundBy.default === "human" && slot.kind === "pinned";
    try {
      if (verb === "call") {
        const body = callBodySchema.safeParse(raw);
        if (!body.success) return problem(400, "a page call is { key, request? }");
        const resolution = resolveSlot(slot, await live.sessions());
        if (resolution.kind !== "resolved") return unresolved(at, resolution);
        const ref = resolution.target.kind === "document" ? resolution.target.ref : null;
        return await cross(
          page,
          slot,
          humanBound,
          ref,
          at,
          "/call",
          ref
            ? {
                [HOST_RPC_BRIDGE_SESSION_HEADER]: ref.session,
                [HOST_RPC_DOCUMENT_HEADER]: ref.openId,
              }
            : {},
          {
            key: bareOp(body.data.key),
            ...(body.data.request === undefined ? {} : { request: body.data.request }),
          },
        );
      }
      const body = actBodySchema.safeParse(raw);
      if (!body.success) return problem(400, "a page act is { key, input? }");
      if (slot.kind === "none") return refused(unboundRefusal(at));
      const resolution = resolveSlot(slot, await live.sessions());
      if (resolution.kind !== "resolved") return unresolved(at, resolution);
      const action = await operationOf(body.data.key, body.data.input);
      if ("problem" in action) return problem(400, action.problem);
      // Decided here first, so a refusal names this door; `/actions` decides again under the same slot.
      admitPage(slot, resolution.target, at, humanBound && readsOnly(action.key, action.input));
      return await cross(
        page,
        slot,
        humanBound,
        resolution.target.kind === "document" ? resolution.target.ref : null,
        at,
        "/actions",
        {},
        { id: randomUUID(), target: resolution.target, ...action } satisfies ActionAdmission,
      );
    } catch (error) {
      if (error instanceof Refused) return refused(error.refusal);
      throw error;
    }
  }

  /**
   * The operation a page's act names. A host op runs as sent. A contribution key runs only as a
   * declared script of an admitted package: `scripting.execute` over that package's captured bytes,
   * the same frozen input Pea's dispatch sends. The target is the binding's, so a page-sent
   * selector, bundle or source path is dropped; only the run's mode and timeout pass.
   */
  async function operationOf(
    key: string,
    input: unknown,
  ): Promise<{ key: string; input: Record<string, unknown> } | { problem: string }> {
    const ref = parseContributionKey(key);
    const sent = (input ?? {}) as Record<string, unknown>;
    if (!ref) return { key: bareOp(key), input: sent };
    if (ref.kind !== "script")
      return { problem: `${key} is a ${ref.kind}: it reads and mentions, it never runs.` };
    await requirePackageEnabled(ref.packageId, pods);
    const pod = pods
      ? (await listPackages(pods)).packages.find((one) => one.id === ref.packageId)
      : undefined;
    if (!pod?.contributions.some((row) => row.kind === "script" && row.key === key))
      return { problem: `${key} is no declared script of an admitted package.` };
    const { sourceBundle } = await capturePackage(pod);
    const run = Object.fromEntries(
      (["permissionMode", "timeoutSeconds"] as const)
        .filter((name) => sent[name] !== undefined)
        .map((name) => [name, sent[name]]),
    );
    return { key: "scripting.execute", input: { ...run, sourcePath: ref.path, sourceBundle } };
  }

  /**
   * `page.bind`: a person binds anything; Pea (or an MCP client) only pins a
   * document open in one of Pea's own Revits.
   */
  async function bind(
    slug: string,
    state: PageState,
    page: string,
    request: Request,
    caller: Caller,
  ) {
    const at = peRouteUrl("page.bind", { params: { slug } });
    const parsed = pageChoiceSchema.safeParse(
      await request.json().catch((error) => {
        console.error("pages-route: asynchronous operation failed", error);
        return undefined;
      }),
    );
    if (!parsed.success)
      return problem(
        400,
        "a binding is { kind: thread, thread } | { kind: pinned, address } | { kind: none }",
      );
    const slot = parsed.data;
    if (caller.kind === "anonymous")
      return refused({
        code: "context.missing",
        door: at,
        reason: `Refused at ${at}: no caller context; binding a Page is a person's act, or Pea pinning its own document.`,
      });
    if (caller.kind === "page")
      return refused({
        code: "human.only",
        door: at,
        reason: `Refused at ${at}: a Page cannot bind itself; Bind… opens the picker.`,
      });
    if (caller.kind !== "human") {
      const resolution =
        slot.kind === "pinned"
          ? resolvePinned(slot.address, inventoryOf(await live.sessions()))
          : null;
      const lifetime =
        resolution?.kind === "resolved" && resolution.target.kind === "document"
          ? resolution.target.ref
          : null;
      if (!lifetime || documentAcquisition(lifetime) === null)
        return refused({
          code: "page.binding-not-yours",
          door: at,
          reason: "Pea may pin a Page only to a document it acquired.",
        });
    }
    const current = state.binding();
    state.writeBinding({
      slots: { ...current.slots, default: slot },
      boundBy: { ...current.boundBy, default: caller.kind === "human" ? "human" : "agent" },
    });
    return json(await target(page, state));
  }

  /**
   * The `page-target` Reading: this Page's target now, and again when a thread head or its binding
   * moves. The SPA's chip follows it on its one Readings stream, never on a stream of its own.
   */
  const observeTarget = (
    slug: string,
    publish: (result: OwnerValue<PageTargetReading>) => void,
  ) => {
    let closed = false;
    let turn = 0;
    let stops: (() => void)[] = [];
    const fail = (error: unknown) => {
      if (!closed) publish({ error: error instanceof Error ? error.message : String(error) });
    };
    void (async () => {
      const where = pageKeyOf(slug) ? await dirOf(slug) : null;
      if (closed) return;
      if (!where) return fail(`no page ${slug}`);
      const send = () => {
        const mine = ++turn;
        void target(where.key, stateOf(where)).then((value) => {
          if (!closed && mine === turn) publish({ value });
        }, fail);
      };
      stops = [
        subscribeHeads(send),
        stateOf(where).hear((event) => {
          if (event === "binding") send();
        }),
      ];
      send();
    })().catch(fail);
    return () => {
      closed = true;
      for (const stop of stops) stop();
    };
  };

  return Object.assign(handle, { observeTarget });
  async function handle(request: Request): Promise<Response> {
    const caller = currentCaller();
    const url = new URL(request.url);
    if (url.pathname === peRoutes["page.publish"].path && request.method === "POST") {
      if (caller.kind !== "human" && caller.kind !== "pea")
        return problem(403, "Page publication requires a human or Pea caller");
      const input = peRoutes["page.publish"].body.safeParse(await request.json());
      if (!input.success) return problem(400, input.error.message);
      try {
        if (!journal) throw Error("Page publication requires ActionJournalService.");
        const owner = journal;
        // This door mints its own id, so it cannot re-send one. A caller that retries (Pea) goes
        // through `actions.admit`, where the replay guard sees the re-send.
        const id = randomUUID();
        await owner.invoke(
          { id, key: "page.publish", target: { kind: "host" }, input: input.data },
          { caller, basis: null },
        );
        const row = await owner.wait(id);
        if (row.state !== "succeeded")
          return json(
            { error: "Page publication did not complete", action: row },
            row.state === "cancelled" ? 409 : 422,
          );
        return json(row.result, 201);
      } catch (error) {
        return problem(422, error instanceof Error ? error.message : String(error));
      }
    }
    const parts = url.pathname.split("/").filter(Boolean); // ["pages", slug?, ...rest]
    if (parts[0] === "pe") {
      const [, , slug = "", verb, ...more] = parts;
      const where = await dirOf(slug);
      if (!where || verb !== "binding" || more.length || request.method !== "PUT")
        return problem(
          404,
          `the binding door is ${peRoutes["page.bind"].method} ${peRoutes["page.bind"].path}`,
        );
      return bind(slug, stateOf(where), where.key, request, caller);
    }
    const wantsHtml = (request.headers.get("accept") ?? "").includes("text/html");
    if (parts.length === 1)
      return wantsHtml
        ? listPage(await list())
        : json({ root: [root].flat(), pages: await list() });
    const [, slug = "", ...rest] = parts;
    const library = request.method === "GET" ? pageLibrary(url.pathname) : null;
    if (library !== null)
      return new Response(library, {
        headers: {
          "content-type": PAGE_MEDIA[extname(url.pathname)]!,
          "cache-control": "no-cache",
        },
      });
    if (!pageKeyOf(slug))
      return problem(
        400,
        "a page slug is its folder name (letters, digits, '.', '_', single '-'); a pod's page is <id>--<page>",
      );
    const where = await dirOf(slug);
    if (!where) return problem(404, `no page ${slug}: no admitted package contributes it`);
    if (rest.length === 0 && !url.pathname.endsWith("/"))
      return Response.redirect(`${url.origin}/pages/${slug}/${url.search}`, 308); // relative links need the slash
    const state = stateOf(where);
    const verb = rest.length === 1 ? rest[0] : undefined;
    if (verb === "export" && (request.method === "GET" || request.method === "POST")) {
      const sent: unknown =
        request.method === "POST"
          ? await request.json().catch((error) => {
              console.error("pages-route: asynchronous operation failed", error);
              return undefined;
            })
          : {};
      const parsed = peRoutes["page.export"].body.safeParse(sent);
      if (!parsed.success)
        return problem(400, "a Page export is {}; destination paths are host-owned");
      try {
        const result = await exportPage({
          directory: where.dir,
          exports: stateDirectory(stored, basename(where.state), "exports"),
          page: where.key,
          exportedAt: new Date().toISOString(),
          document: (await target(where.key, state)).document,
          events: await state.rows(),
          library: async (path) => {
            const text = pageLibrary(path);
            if (text === null) throw Error(`Page export has an unsupported host library: ${path}`);
            return text;
          },
        });
        return new Response(result.html, {
          headers: {
            "content-type": PAGE_MEDIA[".html"]!,
            "content-disposition": `attachment; filename="${slug}.html"`,
            "x-pe-export-sha256": result.sha256,
            "cache-control": "no-store",
          },
        });
      } catch (error) {
        return problem(422, error instanceof Error ? error.message : "Page export failed");
      }
    }
    if (verb === "state" && request.method === "GET") {
      const rows = await state.rows();
      const cursor = url.searchParams.has("after") ? Number(url.searchParams.get("after")) : null;
      if (cursor !== null && (!Number.isSafeInteger(cursor) || cursor < 0))
        return problem(400, "after is a nonnegative integer event sequence");
      const projection = state.projection();
      return json({
        seq: lastSeq(rows),
        events: cursor === null ? rows.slice(-50) : rows.filter((row) => row.seq > cursor),
        text: projection?.text ?? null,
        textSeq: projection?.seq ?? null,
        agent: projection?.agent ?? {},
      });
    }
    if (verb === "text" && request.method === "PUT") {
      if (originOf(caller) === "agent")
        return problem(403, "only a Page or person publishes its text and agent declaration");
      const parsed = peRoutes["page.text"].body.safeParse(await request.json().catch(() => null));
      if (!parsed.success) return problem(400, parsed.error.message);
      if (!(await state.writeText(parsed.data)))
        return problem(409, "text seq is ahead of the log or older than the saved text");
      return new Response(null, { status: 204 });
    }
    if (verb === "events" && request.method === "POST") {
      const event: unknown = await request.json().catch((error) => {
        console.error("pages-route: asynchronous operation failed", error);
        return undefined;
      });
      if (typeof event !== "object" || event === null || Array.isArray(event))
        return problem(400, "an event is one JSON object");
      if (originOf(caller) === "agent") {
        const agent = state.projection()?.agent ?? {};
        const declared = Object.keys(agent);
        const type = Reflect.get(event, "type");
        if (typeof type !== "string" || !Object.hasOwn(agent, type))
          return problem(
            422,
            `undeclared agent event type; declared types: ${declared.join(", ") || "(none)"}`,
          );
      }
      return json(await state.append(event, originOf(caller)), 201);
    }
    if (verb === "target" && request.method === "GET") return json(await target(where.key, state));
    if ((verb === "call" || verb === "act") && request.method === "POST")
      return door(verb, slug, state, where.key, request, caller);
    if (verb === "events" && request.method === "GET") {
      const after = Number(
        url.searchParams.get("after") ?? request.headers.get("last-event-id") ?? 0,
      );
      return sse(request, state, Number.isFinite(after) ? after : 0);
    }
    if (request.method !== "GET")
      return problem(405, `${request.method} has no meaning on a page file`);
    if (
      request.method === "GET" &&
      request.headers.get("sec-fetch-dest") === "document" &&
      (rest.length === 0 || (rest.length === 1 && rest[0] === "index.html"))
    )
      return new Response(null, {
        status: 302,
        headers: {
          location: routeAddress("bind").link(
            { page: oneName(slug), view: true },
            routeAddress("bind").read(Object.fromEntries(url.searchParams)).carry,
          ),
        },
      });
    return file(slug, where.dir, where.key, rest.length ? rest : ["index.html"]);
  }
}

/**
 * The served pages handler's `page-target` Reading. Module state, as `control.ts` holds its
 * sources: the pages route and the Readings stream compose in separate layers of one host.
 */
let served: ReturnType<typeof createPagesHandler>["observeTarget"] | undefined;
/** Serves `{ kind: "page-target" }`; any other request is not this Reading's (undefined). */
export const observePageTarget = (
  request: ReadingRequest,
  publish: (frame: ReadingFrame) => void,
): (() => void) | undefined => {
  if (request.kind !== "page-target") return undefined;
  const key = readingKey(request);
  if (served) return served(request.slug, (result) => publish(resourceSnapshot(key, result)));
  publish({ kind: "failure", key, error: "Pages are unavailable on this host" });
  return () => {};
};

export const pagesRoute = (
  root: (pointer?: string | null) => PagesRoots = productPagesRoots,
  pods: (pointer?: string | null) => PodsRoots = productPodsRoots,
) =>
  HttpRouter.use((router) =>
    Effect.gen(function* () {
      const { address } = yield* HttpServer.HttpServer;
      const base = `http://127.0.0.1:${address._tag === "UnixPathAddress" ? 0 : address.port}`;
      const bridge = Option.getOrUndefined(yield* Effect.serviceOption(RevitBridge));
      const live: PageLive = {
        sessions: async () =>
          bridge
            ? // effect-edge: island, phase 5
              (await Effect.runPromise(bridge.list)).flatMap((s) =>
                s.connected && s.sessionId
                  ? [{ session: s.sessionId, documents: s.state?.openDocuments ?? null }]
                  : [],
              )
            : [],
        // Back through this host's own front door, so `/call` and `/actions` decide as for anyone.
        forward: (path, headers, body) =>
          fetch(`${base}${path}`, {
            method: "POST",
            headers: { "content-type": "application/json", ...headers },
            body: JSON.stringify(body),
          }),
      };
      const journal = yield* ActionJournalService;
      const handlers = new Map<string, ReturnType<typeof createPagesHandler>>();
      const handler = HttpEffect.fromWebHandler(async (request) => {
        const scope = readSessionScope(Object.fromEntries(request.headers));
        const { pointer } = bridge ? await Effect.runPromise(targetHomes(bridge, scope)) : {};
        const roots = root(pointer),
          podRoots = pods(pointer);
        const key = JSON.stringify([roots, podRoots]);
        let pages = handlers.get(key);
        if (!pages) {
          pages = createPagesHandler(roots, podRoots, live, journal);
          handlers.set(key, pages);
        }
        served = pages.observeTarget;
        return matchPeRoute(request.method, new URL(request.url).pathname)
          ? servePeRoute(request, pages)
          : pages(request);
      });
      // One registration claims the bare `/pages` too (a second `add` is refused at boot; see captures).
      yield* router.add("*", "/pages/*", handler);
      yield* router.add(peRoutes["page.bind"].method, peRoutes["page.bind"].path, handler);
      yield* router.add(peRoutes["page.publish"].method, peRoutes["page.publish"].path, handler);
    }),
  );
