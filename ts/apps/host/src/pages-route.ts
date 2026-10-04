/**
 * PAGES — disposable HTML as a working surface between an agent and a person (pages ledger,
 * 2026-10-04). A page is a folder `Documents/Pe.Tools/Pages/<slug>/` holding an `index.html`,
 * served at `/pages/<slug>/` with no registration: a dropped folder appears. Its doors into Revit
 * are `/pages/pe.js` (`find`, `read`, `do`, the target headers, the read-versus-write door, and
 * `state`) and `/pages/pe.css` (the house tokens, opt-in).
 *
 * Shared state is one event log per page under `<slug>/.state/`: the page appends, an agent appends
 * over HTTP, the host fans out over SSE, and the page writes its own snapshot so an agent reads the
 * state without running the reducer. The log lives beside the page, so deleting or sharing the
 * folder deletes or shares its state.
 *
 *   GET  /pages                        every page, newest first (JSON; a list page when a browser navigates)
 *   GET  /pages/pe.js | /pages/pe.css  the doors and the house look
 *   GET  /pages/<slug>/[file]          the folder's files (`index.html` by default; dot-files are private)
 *   GET  /pages/<slug>/state           { seq, events, snapshot }
 *   POST /pages/<slug>/events          append one event (the body); answers the stored row
 *   GET  /pages/<slug>/events?after=N  SSE: rows after N (or Last-Event-ID), then live
 *   PUT  /pages/<slug>/snapshot        the page's current state, as the page computed it
 */
import { readFileSync } from "node:fs";
import { appendFile, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Effect } from "effect";
import { HttpEffect, HttpRouter } from "effect/unstable/http";
import { HOST_RPC_ORIGIN_HEADER } from "@pe/host-contracts/contracts";
import { hostOwnership } from "./host-ownership.ts";
import { productPagesRootPath } from "./product-paths.ts";

/**
 * `pe.js`, `pe.css` and the product's `base.css` (the tokens): read beside this source on the dev
 * lane, so an edit is live on the next request; staged to `<exeDir>/pages` when installed
 * (`scripts/stage-web.mjs`), like the web root.
 */
const assetPath = (name: string) =>
  hostOwnership.lane === "installed"
    ? join(dirname(process.execPath), "pages", name)
    : fileURLToPath(
        new URL(
          name === "base.css" ? "../../web/src/base.css" : `./pages/${name}`,
          import.meta.url,
        ),
      );
const asset = (name: string) => readFileSync(assetPath(name), "utf8");

const ACTOR_HEADER = "x-pe-action-actor";
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
const isMissing = (error: unknown) => (error as { code?: string } | null)?.code === "ENOENT";

export type PageEventRow = { seq: number; at: string; origin: string; event: unknown };
type Listener = (row: PageEventRow) => void;

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

const escapeHtml = (text: string) =>
  text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** The pages handler over one root: a plain web handler, so tests need no server and SSE is a ReadableStream. */
export function createPagesHandler(root: string) {
  const states = new Map<string, PageState>();
  const stateOf = (slug: string) => {
    let state = states.get(slug);
    if (!state) states.set(slug, (state = new PageState(join(root, slug))));
    return state;
  };

  async function list() {
    const names = await readdir(root, { withFileTypes: true }).catch((error) => {
      if (isMissing(error)) return [];
      throw error;
    });
    const pages = [];
    for (const entry of names) {
      if (!entry.isDirectory() || !SLUG.test(entry.name)) continue;
      const index = join(root, entry.name, "index.html");
      const facts = await stat(index).catch(() => null);
      if (!facts) continue;
      const title = /<title>([^<]*)<\/title>/i.exec(await readFile(index, "utf8"))?.[1]?.trim();
      pages.push({
        slug: entry.name,
        title: title || entry.name,
        url: `/pages/${entry.name}/`,
        modifiedAt: facts.mtime.toISOString(),
      });
    }
    return pages.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
  }

  function listPage(pages: Awaited<ReturnType<typeof list>>) {
    const rows = pages.length
      ? pages
          .map(
            (p) =>
              `<li><a href="${p.url}">${escapeHtml(p.title)}</a> <code>${escapeHtml(p.slug)}</code> <small>${escapeHtml(p.modifiedAt.slice(0, 16).replace("T", " "))}</small></li>`,
          )
          .join("\n")
      : `<li><em>none yet</em></li>`;
    return new Response(
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Pages</title><link rel="stylesheet" href="/pages/pe.css"></head>
<body style="padding:24px;max-width:720px"><h1>Pages</h1>
<p>Every folder under <code>${escapeHtml(root)}</code> with an <code>index.html</code>, newest first. Doors: <a href="/pages/pe.js">pe.js</a> · <a href="/pages/pe.css">pe.css</a>.</p>
<ul>${rows}</ul></body></html>`,
      { headers: { "content-type": "text/html; charset=utf-8" } },
    );
  }

  async function file(slug: string, segments: string[]) {
    if (!segments.every((s) => SEGMENT.test(s)))
      return problem(400, "that is not a page file path");
    const path = join(root, slug, ...segments);
    try {
      const bytes = await readFile(path);
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
            ? `no page ${slug}: a page is a folder ${join(root, slug)} holding an index.html`
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
        stop = () => {
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

  return async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const parts = url.pathname.split("/").filter(Boolean); // ["pages", slug?, ...rest]
    const wantsHtml = (request.headers.get("accept") ?? "").includes("text/html");
    if (parts.length === 1)
      return wantsHtml ? listPage(await list()) : json({ root, pages: await list() });
    const [, slug = "", ...rest] = parts;
    if (slug === "pe.js")
      return new Response(asset("pe.js"), {
        headers: { "content-type": MIME[".js"]!, "cache-control": "no-cache" },
      });
    if (slug === "pe.css")
      return new Response(
        `${asset("base.css")}
${asset("pe.css")}`,
        {
          headers: { "content-type": MIME[".css"]!, "cache-control": "no-cache" },
        },
      );
    if (!SLUG.test(slug)) return problem(400, "a page slug is letters, digits, - and _");
    if (rest.length === 0 && !url.pathname.endsWith("/"))
      return Response.redirect(`${url.origin}/pages/${slug}/${url.search}`, 308); // relative links need the slash
    const state = stateOf(slug);
    const verb = rest.length === 1 ? rest[0] : undefined;
    if (verb === "state" && request.method === "GET") {
      const rows = await state.rows();
      return json({ seq: rows.length, events: rows, snapshot: await state.snapshot() });
    }
    if (verb === "events" && request.method === "POST") {
      const event: unknown = await request.json().catch(() => undefined);
      if (typeof event !== "object" || event === null || Array.isArray(event))
        return problem(400, "an event is one JSON object");
      const actor = request.headers.get(ACTOR_HEADER);
      const origin =
        request.headers.get(HOST_RPC_ORIGIN_HEADER) ?? (actor === "agent" ? "agent" : "human");
      return json(await state.append(event, origin), 201);
    }
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
    return file(slug, rest.length ? rest : ["index.html"]);
  };
}

export const pagesRoute = (root = productPagesRootPath) =>
  HttpRouter.use((router) =>
    Effect.gen(function* () {
      // One registration claims the bare `/pages` too (a second `add` is refused at boot; see captures).
      yield* router.add("*", "/pages/*", HttpEffect.fromWebHandler(createPagesHandler(root())));
    }),
  );
