/**
 * PAGES — disposable HTML as a working surface between an agent and a person (pages ledger,
 * 2026-10-04). A page is a folder `Documents/Pe.Tools/Pages/<slug>/` holding an `index.html`,
 * served at `/pages/<slug>/` with no registration: a dropped folder appears. Its doors into Revit
 * are `/pages/pe.js` (`find`, `read`, `do` through the page doors below, the bind chip, and
 * `state`) and `/pages/pe.css` (the house tokens, opt-in).
 *
 * Shared state is one event log per page under `<slug>/.state/`: the page appends, an agent appends
 * over HTTP, the host fans out over SSE, and the page writes its own snapshot and a text projection
 * (`pe.describe`) so an agent reads the state, and what the page says, without running the reducer.
 * The log lives beside the page, so deleting or sharing the folder deletes or shares its state.
 *
 * A Pod may carry pages (pages ledger, ruling 5): `Documents/Pe.Tools/Pods/<pod>/pages/<page>/index.html`
 * lists and serves as the slug `<pod>--<page>`, and its `.state/` sits beside the page inside the pod,
 * so publishing the pod carries it. A pod is a folder holding `pod.json`; nothing in it is read, so a
 * page never depends on its pod (ruling 6). A plain page whose folder name contains `--` is skipped.
 *
 *   GET  /pages                        every page, newest first (JSON, rows carry `pod`; a list page when a browser navigates)
 *   GET  /pages/pe.js | /pages/pe.css  the doors and the house look
 *   GET  /pages/<slug>/[file]          the folder's files (`index.html` by default; dot-files are private)
 *   GET  /pages/<slug>/state           { seq, events, snapshot, text }
 *   POST /pages/<slug>/events          append one event (the body); answers the stored row
 *   GET  /pages/<slug>/events?after=N  SSE: rows after N (or Last-Event-ID), then live
 *   PUT  /pages/<slug>/snapshot        the page's current state, as the page computed it
 *   PUT  /pages/<slug>/text            the page's current state as markdown, as the page describes it
 *
 * The page doors (ADR 0017 D9/D10). Identity is the path: the host mints the page key into
 * `<meta name="pe-page">` and stamps it on every row and crossing; a header a page sends never
 * names it. What a page targets is its binding, `<page>/.state/binding.json`, written only here.
 *
 *   GET  /pages/<slug>/target          the default slot: binding, resolution, document, what a write would do
 *   POST /pages/<slug>/call            { key, request? }: a read on the bound document (host `/call`)
 *   POST /pages/<slug>/act             { key, input? }: a write as the page under its binding (host `/actions`)
 *   PUT  /pe/pages/<slug>/binding      a slot (PageSlot): the human picker, or Pea pinning its own document
 */
import { readFileSync } from "node:fs";
import { appendFile, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { Effect, Option } from "effect";
import { HttpEffect, HttpRouter, HttpServer } from "effect/unstable/http";
import {
  HOST_CONTEXT_HEADER,
  HOST_RPC_BRIDGE_SESSION_HEADER,
  HOST_RPC_DOCUMENT_HEADER,
  HOST_RPC_ORIGIN_HEADER,
  HOST_RUNTIME_SERVICE_HEADER,
  HOST_RUNTIME_SERVICE_QUERY,
} from "@pe/host-contracts/contracts";
import {
  addressSchema,
  pageBindingSchema,
  pageSlotSchema,
  resolveCallTarget,
  resolvePinned,
  unboundPage,
  type Caller,
  type PageBinding,
  type PageSlot,
  type PageTargetReading,
  type PageWrite,
  type Refusal,
  type TargetInventory,
  type TargetResolution,
} from "@pe/agent-contracts";
import { z } from "zod";
import { RevitBridge } from "./bridge.ts";
import { hostOwnership } from "./host-ownership.ts";
import {
  admitPage,
  currentCaller,
  mintPageDoor,
  pageActDoor,
  pageKeyOf,
  Refused,
  sessionWhose,
  threadHead,
} from "./control.ts";
import { productPagesRootPath, productPodsRootPath } from "./product-paths.ts";

/** Page assets that live in the web app: the tokens and the Revit facsimile (one source each). */
const WEB_ASSETS: Record<string, string> = {
  "base.css": "../../web/src/base.css",
  "revit.js": "../../web/src/revit/revit.js",
  "revit.css": "../../web/src/revit/revit.css",
};

/**
 * `pe.js`, `pe.css`, the product's `base.css` (the tokens) and the Revit facsimile: read beside
 * their source on the dev lane, so an edit is live on the next request; staged to `<exeDir>/pages`
 * when installed (`scripts/stage-web.mjs`), like the web root.
 */
const assetPath = (name: string) =>
  hostOwnership.lane === "installed"
    ? join(dirname(process.execPath), "pages", name)
    : fileURLToPath(new URL(WEB_ASSETS[name] ?? `./pages/${name}`, import.meta.url));

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
const asset = (name: string) => readFileSync(assetPath(name), "utf8");
/** The tokens also land on `:host`, so the bind chip's shadow root (pe.js) reads them on any page. */
const chipTokens = (base: string) => {
  if (!/^:root \{/m.test(base))
    throw Error("base.css must open its tokens with one `:root {` line");
  return base.replace(/^:root \{/m, ":root, :host {");
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
  return source.replace(
    RUNTIME_SLOT,
    JSON.stringify({
      header: HOST_RUNTIME_SERVICE_HEADER,
      query: HOST_RUNTIME_SERVICE_QUERY,
      service: hostOwnership.serviceName,
    }),
  );
};

/** One folder name: no dots, so no `..` and no file masquerading as a page. */
const SLUG = /^[a-z0-9][a-z0-9_-]*$/i;
/** One file segment: a leading dot is refused, so `.state/` and editor droppings stay private. */
const SEGMENT = /^[a-z0-9_-][a-z0-9_.-]*$/i;
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
};
const HEARTBEAT_MS = 15_000;
const isMissing = (error: unknown) => (error as { code?: string } | null)?.code === "ENOENT";

export type PageEventRow = { seq: number; at: string; origin: string; event: unknown };
/** One `GET /pages` row; `pod` is the pod folder's name when the page lives inside a pod. */
export type PageRow = {
  slug: string;
  title: string;
  url: string;
  modifiedAt: string;
  pod: string | null;
};
type Listener = (row: PageEventRow) => void;

/** One open document as the bridge lists it. */
export type LiveDocument = {
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

const callBodySchema = z.strictObject({ key: z.string().min(1), request: z.unknown().optional() });
const actBodySchema = z.strictObject({ key: z.string().min(1), input: z.unknown().optional() });

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
 * A slot against the live sessions. `none` resolves only the one unambiguous case (one Revit, its
 * active document) so an unbound page can still read; two Revits is `choose`, never a pick.
 */
function resolveSlot(slot: PageSlot, sessions: readonly LiveSession[]): TargetResolution {
  if (slot.kind === "thread")
    return resolveCallTarget(
      { needs: "document" },
      threadHead(slot.thread)?.defaultTarget ?? null,
      inventoryOf(sessions),
    );
  if (slot.kind === "pinned") return resolvePinned(slot.address, inventoryOf(sessions));
  const [only, ...more] = sessions;
  if (!only || more.length) return { kind: "choose", reason: only ? "ambiguous" : "missing" };
  if (only.documents === null) return { kind: "checking" };
  const active = only.documents.find((doc) => doc.isActive);
  return active
    ? {
        kind: "resolved",
        target: { kind: "document", ref: { session: only.session, openId: active.openId } },
      }
    : { kind: "choose", reason: "missing" };
}

/** The host-stamped origin of a row: the page key, `human`, or `agent`; never a header. */
const originOf = (caller: Caller) =>
  caller.kind === "page" ? caller.page : caller.kind === "human" ? "human" : "agent";

const unboundRefusal = (door: string): Refusal => ({
  code: "page.unbound",
  door,
  reason: `Refused at ${door}: this Page has no target. Bind it to a thread or pin a document from the chip.`,
});

/** One page's log and snapshot, under `<page>/.state/`. Appends are serial per page. */
class PageState {
  private readonly dir: string;
  private readonly listeners = new Set<Listener>();
  private queue: Promise<unknown> = Promise.resolve();
  constructor(pageDir: string) {
    this.dir = join(pageDir, ".state");
  }
  async rows(): Promise<PageEventRow[]> {
    const text = await readFile(join(this.dir, "events.jsonl"), "utf8").catch((error) => {
      if (isMissing(error)) return "";
      throw error;
    });
    return text
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as PageEventRow);
  }
  append(event: unknown, origin: string): Promise<PageEventRow> {
    const job = this.queue.then(async () => {
      const seq = (await this.rows()).length + 1;
      const row: PageEventRow = { seq, at: new Date().toISOString(), origin, event };
      await mkdir(this.dir, { recursive: true });
      await appendFile(join(this.dir, "events.jsonl"), JSON.stringify(row) + "\n", "utf8");
      for (const listen of this.listeners) listen(row);
      return row;
    });
    this.queue = job.catch(() => undefined);
    return job;
  }
  async snapshot(): Promise<unknown> {
    return readFile(join(this.dir, "snapshot.json"), "utf8").then(JSON.parse, (error) => {
      if (isMissing(error)) return null;
      throw error;
    });
  }
  async writeSnapshot(value: unknown) {
    await mkdir(this.dir, { recursive: true });
    await writeFile(join(this.dir, "snapshot.json"), JSON.stringify(value, null, 2), "utf8");
  }
  /** The page's text projection (`pe.describe`): markdown an agent reads instead of the snapshot. */
  async text(): Promise<string | null> {
    return readFile(join(this.dir, "snapshot.md"), "utf8").catch((error) => {
      if (isMissing(error)) return null;
      throw error;
    });
  }
  async writeText(text: string) {
    await mkdir(this.dir, { recursive: true });
    await writeFile(join(this.dir, "snapshot.md"), text, "utf8");
  }
  follow(listen: Listener) {
    this.listeners.add(listen);
    return () => this.listeners.delete(listen);
  }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
const problem = (status: number, message: string) => json({ error: message, message }, status);
/** A door refusal, the shape `/actions` answers: 403, named, never dispatched. */
const refused = (refusal: Refusal) =>
  json({ error: refusal.reason, message: refusal.reason, refusal, notDispatched: true }, 403);
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

const escapeHtml = (text: string) =>
  text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/**
 * The pages handler over the Pages root and the Pods root: a plain web handler, so tests need no
 * server and SSE is a ReadableStream. No pods root means no pod pages.
 */
export function createPagesHandler(root: string, pods?: string, live: PageLive = noLive) {
  /** Where a slug's folder is: `<root>/<slug>`, or `<pods>/<pod>/pages/<page>` for `<pod>--<page>`. */
  const dirOf = (slug: string) => {
    const [pod, page, ...more] = slug.split("--");
    if (page === undefined) return { dir: join(root, slug), pod: null };
    if (more.length || !pods) return null;
    return { dir: join(pods, pod!, "pages", page), pod: pod! };
  };
  const states = new Map<string, PageState>();
  const stateOf = (slug: string, dir: string) => {
    let state = states.get(slug);
    if (!state) states.set(slug, (state = new PageState(dir)));
    return state;
  };

  const folders = async (dir: string) =>
    (
      await readdir(dir, { withFileTypes: true }).catch((error) => {
        if (isMissing(error)) return [];
        throw error;
      })
    )
      .filter((entry) => entry.isDirectory() && SLUG.test(entry.name))
      .map((entry) => entry.name);
  const exists = (path: string) =>
    stat(path).then(
      () => true,
      () => false,
    );

  async function list() {
    const pages: PageRow[] = [];
    const add = async (slug: string, dir: string, pod: string | null) => {
      const index = join(dir, "index.html");
      const facts = await stat(index).catch(() => null);
      if (!facts) return;
      const title = /<title>([^<]*)<\/title>/i.exec(await readFile(index, "utf8"))?.[1]?.trim();
      pages.push({
        slug,
        title: title || slug,
        url: `/pages/${slug}/`,
        modifiedAt: facts.mtime.toISOString(),
        pod,
      });
    };
    for (const name of await folders(root))
      if (!name.includes("--")) await add(name, join(root, name), null);
    for (const pod of pods ? await folders(pods) : [])
      if (!pod.includes("--") && (await exists(join(pods!, pod, "pod.json"))))
        for (const page of await folders(join(pods!, pod, "pages")))
          if (!page.includes("--"))
            await add(`${pod}--${page}`, join(pods!, pod, "pages", page), pod);
    return pages.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
  }

  function listPage(pages: PageRow[]) {
    const rows = pages.length
      ? pages
          .map(
            (p) =>
              `<li><a href="${p.url}">${escapeHtml(p.title)}</a> <code>${escapeHtml(p.slug)}</code>${p.pod ? ` <small>pod ${escapeHtml(p.pod)}</small>` : ""} <small>${escapeHtml(p.modifiedAt.slice(0, 16).replace("T", " "))}</small></li>`,
          )
          .join("\n")
      : `<li><em>none yet</em></li>`;
    return new Response(
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Pages</title><link rel="stylesheet" href="/pages/pe.css"></head>
<body style="padding:24px;max-width:720px"><h1>Pages</h1>
<p>Every folder under <code>${escapeHtml(root)}</code> with an <code>index.html</code>, newest first${pods ? `, and every <code>pages/&lt;page&gt;</code> inside a pod under <code>${escapeHtml(pods)}</code> as <code>&lt;pod&gt;--&lt;page&gt;</code>` : ""}. Doors: <a href="/pages/pe.js">pe.js</a> · <a href="/pages/pe.css">pe.css</a> · <a href="/pages/revit.js">revit.js</a>.</p>
<ul>${rows}</ul>
<h2>Make one</h2>
<p>A page is a folder with an <code>index.html</code>; a pod carries pages in its <code>pages/</code> folder. Three lines give it Revit and a shared log:</p>
<pre>&lt;link rel="stylesheet" href="/pages/pe.css"&gt;
&lt;script src="/pages/pe.js"&gt;&lt;/script&gt;
&lt;script&gt;
  const k = pe.kernel((state, event) =&gt; state, {}, render);   // reduce(state, event), base, render
  pe.state(k);                                                 // every copy and every agent share k's log
  pe.describe(() =&gt; \`# \${k.state.title}\`);                     // what the page says, as markdown, for agents
  await pe.do("revit.context.show-elements", { elementIds: [1234] });   // pe.find, pe.read, pe.do: Pea's doors
  await pe.script("checks/census.csx");                        // C# beside the page; pe.picture, pe.diff, pe.reading
&lt;/script&gt;</pre>
<p>Agents reach the same log at <code>GET /pages/&lt;slug&gt;/state</code> (<code>snapshot</code> and <code>text</code>) and <code>POST /pages/&lt;slug&gt;/events</code>. The header of <a href="/pages/pe.js">pe.js</a> is the whole reference.</p>
</body></html>`,
      { headers: { "content-type": "text/html; charset=utf-8" } },
    );
  }

  async function file(slug: string, dir: string, segments: string[]) {
    if (!segments.every((s) => SEGMENT.test(s)))
      return problem(400, "that is not a page file path");
    const path = join(dir, ...segments);
    try {
      const raw = await readFile(path);
      const bytes =
        segments.length === 1 && segments[0] === "index.html"
          ? withPageKey(raw.toString("utf8"), slug)
          : raw;
      return new Response(bytes, {
        headers: {
          "content-type": MIME[extname(path).toLowerCase()] ?? "application/octet-stream",
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
        // Follow first, then replay: a row appended between the two is sent once, by seq.
        const unfollow = state.follow(send);
        for (const row of await state.rows()) send(row);
        // A named heartbeat, so pe.js can tell a quiet stream from a dead one (a browser's own
        // EventSource retry was seen to never fire after a dev host restart, 2026-10-04).
        const beat = setInterval(
          () => controller.enqueue(encoder.encode("event: ping\ndata: {}\n\n")),
          HEARTBEAT_MS,
        );
        stop = () => {
          clearInterval(beat);
          unfollow();
          try {
            controller.close();
          } catch {
            /* already closed by the consumer */
          }
        };
        request.signal.addEventListener("abort", stop);
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

  const bindingFile = (dir: string) => join(dir, ".state", "binding.json");
  const bindingOf = async (dir: string): Promise<PageBinding> =>
    readFile(bindingFile(dir), "utf8").then(
      (text) => pageBindingSchema.parse(JSON.parse(text)),
      (error) => {
        if (isMissing(error)) return unboundPage;
        throw error;
      },
    );

  async function target(slug: string, dir: string): Promise<PageTargetReading> {
    const page = pageKeyOf(slug);
    const actDoor = pageActDoor(page);
    const slot = (await bindingOf(dir)).slots.default;
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
        const grant = basis?.kind === "grant" ? threadHead(basis.thread)?.grant : null;
        write =
          basis?.kind === "grant" && grant
            ? { kind: "rw", thread: basis.thread, expiresAt: grant.expiresAt }
            : { kind: "pea" };
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
      hostNow: new Date().toISOString(),
    };
  }

  /**
   * Only the page itself (its own browser) or a person drives its doors. Pea reaches a page
   * through its shelf; a Pea or MCP context here would borrow a binding that is not its own.
   */
  function doorRefusal(door: string): Refusal | null {
    const caller = currentCaller();
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
    slug: string,
    slot: PageSlot,
    door: string,
    path: "/call" | "/actions",
    headers: Record<string, string>,
    body: unknown,
  ) {
    const page = pageKeyOf(slug);
    const minted = mintPageDoor(page, slot, door);
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

  async function door(verb: "call" | "act", slug: string, dir: string, request: Request) {
    const at = `/pages/${slug}/${verb}`;
    const who = doorRefusal(at);
    if (who) return refused(who);
    const raw: unknown = await request.json().catch(() => undefined);
    const slot = (await bindingOf(dir)).slots.default;
    try {
      if (verb === "call") {
        const body = callBodySchema.safeParse(raw);
        if (!body.success) return problem(400, "a page call is { key, request? }");
        const resolution = resolveSlot(slot, await live.sessions());
        if (resolution.kind !== "resolved") return unresolved(at, resolution);
        const ref = resolution.target.kind === "document" ? resolution.target.ref : null;
        return await cross(
          slug,
          slot,
          at,
          "/call",
          ref
            ? {
                [HOST_RPC_BRIDGE_SESSION_HEADER]: ref.session,
                [HOST_RPC_DOCUMENT_HEADER]: ref.openId,
              }
            : {},
          {
            key: body.data.key,
            ...(body.data.request === undefined ? {} : { request: body.data.request }),
          },
        );
      }
      const body = actBodySchema.safeParse(raw);
      if (!body.success) return problem(400, "a page act is { key, input? }");
      if (slot.kind === "none") return refused(unboundRefusal(at));
      const resolution = resolveSlot(slot, await live.sessions());
      if (resolution.kind !== "resolved") return unresolved(at, resolution);
      // Decided here first, so a refusal names this door; `/actions` decides again under the same slot.
      admitPage(slot, resolution.target, at);
      return await cross(
        slug,
        slot,
        at,
        "/actions",
        {},
        {
          id: randomUUID(),
          kind: "operation",
          key: body.data.key,
          destination: resolution.target,
          input: body.data.input ?? {},
        },
      );
    } catch (error) {
      if (error instanceof Refused) return refused(error.refusal);
      throw error;
    }
  }

  /**
   * `PUT /pe/pages/<slug>/binding`: a person binds anything; Pea (or an MCP client) only pins a
   * document open in one of Pea's own Revits.
   */
  async function bind(slug: string, dir: string, request: Request) {
    const at = `/pe/pages/${slug}/binding`;
    const caller = currentCaller();
    const parsed = pageSlotSchema.safeParse(await request.json().catch(() => undefined));
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
      const session =
        resolution?.kind === "resolved" && resolution.target.kind === "document"
          ? resolution.target.ref.session
          : null;
      if (!session || sessionWhose(session) !== "pea")
        return refused({
          code: "page.binding-not-yours",
          door: at,
          reason: "Pea may pin a Page only to its own documents.",
        });
    }
    const current = await bindingOf(dir);
    await mkdir(join(dir, ".state"), { recursive: true });
    const next: PageBinding = { slots: { ...current.slots, default: slot } };
    await writeFile(bindingFile(dir), JSON.stringify(next, null, 2), "utf8");
    return json(await target(slug, dir));
  }

  /** `index.html` names its page: the host mints the key; the page never claims one. */
  const withPageKey = (html: string, slug: string) => {
    const meta = `<meta name="pe-page" content="${escapeHtml(pageKeyOf(slug))}">`;
    const head = /<head[^>]*>/i.exec(html) ?? /^\s*<!doctype[^>]*>/i.exec(html);
    if (!head) return `${meta}${html}`;
    const end = head.index + head[0].length;
    return `${html.slice(0, end)}${meta}${html.slice(end)}`;
  };

  return async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const parts = url.pathname.split("/").filter(Boolean); // ["pages", slug?, ...rest]
    if (parts[0] === "pe") {
      const [, , slug = "", verb, ...more] = parts;
      const where = SLUG.test(slug) ? dirOf(slug) : null;
      if (!where || verb !== "binding" || more.length || request.method !== "PUT")
        return problem(404, "the binding door is PUT /pe/pages/<slug>/binding");
      return bind(slug, where.dir, request);
    }
    const wantsHtml = (request.headers.get("accept") ?? "").includes("text/html");
    if (parts.length === 1)
      return wantsHtml ? listPage(await list()) : json({ root, pages: await list() });
    const [, slug = "", ...rest] = parts;
    if (slug === "pe.js")
      return new Response(servedPe(), {
        headers: { "content-type": MIME[".js"]!, "cache-control": "no-cache" },
      });
    if (slug === "revit.js")
      return new Response(classicRevit(), {
        headers: { "content-type": MIME[".js"]!, "cache-control": "no-cache" },
      });
    if (slug === "revit.css")
      return new Response(asset("revit.css"), {
        headers: { "content-type": MIME[".css"]!, "cache-control": "no-cache" },
      });
    if (slug === "pe.css")
      return new Response(
        `${chipTokens(asset("base.css"))}
${asset("pe.css")}`,
        {
          headers: { "content-type": MIME[".css"]!, "cache-control": "no-cache" },
        },
      );
    const where = SLUG.test(slug) ? dirOf(slug) : null;
    if (!where)
      return problem(400, "a page slug is letters, digits, - and _; a pod's page is <pod>--<page>");
    if (rest.length === 0 && !url.pathname.endsWith("/"))
      return Response.redirect(`${url.origin}/pages/${slug}/${url.search}`, 308); // relative links need the slash
    const state = stateOf(slug, where.dir);
    const verb = rest.length === 1 ? rest[0] : undefined;
    if (verb === "state" && request.method === "GET") {
      const rows = await state.rows();
      return json({
        seq: rows.length,
        events: rows,
        snapshot: await state.snapshot(),
        text: await state.text(),
      });
    }
    if (verb === "text" && request.method === "PUT") {
      await state.writeText(await request.text());
      return new Response(null, { status: 204 });
    }
    if (verb === "events" && request.method === "POST") {
      const event: unknown = await request.json().catch(() => undefined);
      if (typeof event !== "object" || event === null || Array.isArray(event))
        return problem(400, "an event is one JSON object");
      return json(await state.append(event, originOf(currentCaller())), 201);
    }
    if (verb === "target" && request.method === "GET") return json(await target(slug, where.dir));
    if ((verb === "call" || verb === "act") && request.method === "POST")
      return door(verb, slug, where.dir, request);
    if (verb === "events" && request.method === "GET") {
      const after = Number(
        url.searchParams.get("after") ?? request.headers.get("last-event-id") ?? 0,
      );
      return sse(request, state, Number.isFinite(after) ? after : 0);
    }
    if (verb === "snapshot" && request.method === "PUT") {
      const value: unknown = await request.json().catch(() => undefined);
      if (value === undefined) return problem(400, "a snapshot is JSON");
      await state.writeSnapshot(value);
      return new Response(null, { status: 204 });
    }
    if (request.method !== "GET")
      return problem(405, `${request.method} has no meaning on a page file`);
    return file(slug, where.dir, rest.length ? rest : ["index.html"]);
  };
}

export const pagesRoute = (root = productPagesRootPath, pods = productPodsRootPath) =>
  HttpRouter.use((router) =>
    Effect.gen(function* () {
      const { address } = yield* HttpServer.HttpServer;
      const base = `http://127.0.0.1:${address._tag === "TcpAddress" ? address.port : 0}`;
      const bridge = Option.getOrUndefined(yield* Effect.serviceOption(RevitBridge));
      const live: PageLive = {
        sessions: async () =>
          bridge
            ? (await Effect.runPromise(bridge.list)).flatMap((s) =>
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
      const handler = HttpEffect.fromWebHandler(createPagesHandler(root(), pods(), live));
      // One registration claims the bare `/pages` too (a second `add` is refused at boot; see captures).
      yield* router.add("*", "/pages/*", handler);
      yield* router.add("PUT", "/pe/pages/:slug/binding", handler);
    }),
  );
