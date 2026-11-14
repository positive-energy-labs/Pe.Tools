import { stateFixture } from "../../../tests/isolated-home/storage.ts";
import { mkdtemp } from "../../../tests/isolated-home/storage.ts";
import { access, appendFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { HOST_RUNTIME_SERVICE_HEADER } from "@pe/host-contracts/contracts";
import {
  emptyThreadHead,
  pageTargetReadingSchema,
  routeAddress,
  type Caller,
  basisSchema,
  type DocumentRef,
  type PageTargetReading,
  type ThreadHead,
} from "@pe/agent-contracts";
import {
  createPagesHandler,
  PageState,
  type LiveSession,
  type PageLive,
} from "../src/pages-route.ts";
import { readRequestIdentity, type IdentityOptions } from "../src/request-identity.ts";
import { admitCrossing, bindControl, callerOf, currentCaller, live, Refused, onPagePinRevoke } from "../src/control.ts";
import { asCaller, human, pea, serviceHeaders } from "./callers.ts";
import * as packages from "../src/packages.ts";
import * as lifecycle from "../src/package-lifecycle.ts";

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  while (cleanup.length) await cleanup.pop()!();
});

/**
 * A product home (`Pages/` holding the todo page, `Pods/` empty until a test fills it) and, apart
 * from it, the machine's Page state: one folder per slug.
 */
async function pagesRoot(live?: PageLive) {
  const world = await mkdtemp(join(tmpdir(), "pe-pages-"));
  cleanup.push(() => rm(world, { recursive: true, force: true }));
  const home = join(world, "home");
  const state = join(world, "state", "Pages");
  const root = join(home, "Pages");
  const pods = join(home, "Pods");
  await mkdir(join(root, "todo"), { recursive: true });
  await writeFile(
    join(root, "todo", "index.html"),
    "<!doctype html><title>A todo page</title><p>hi</p>",
  );
  await writeFile(join(root, "todo", "notes.md"), "# notes");
  await mkdir(join(root, "todo", ".state"), { recursive: true });
  await writeFile(join(root, "todo", ".state", "secret.txt"), "private");
  await writeFile(join(root, "loose.html"), "<p>not a page: a file, not a folder</p>");
  const handle = createPagesHandler(root, pods, live, undefined, stateFixture(state));
  const fetch = (path: string, init?: RequestInit) =>
    (currentCaller().kind === "anonymous" && init?.method === "POST" && path.endsWith("/events")
      ? asCaller(human, handle)
      : handle)(new Request(`http://host${path}`, init));
  return { root, pods, state, fetch, handle };
}

describe("pages", () => {
  it.each([4000, 6000])("Pod listing taking %i ms shares one five-second Page budget with lifecycle", async (listingMs) => {
    const { pods, fetch } = await pagesRoot();
    const directory = join(pods, "late");
    await mkdir(join(directory, "pages", "tour"), { recursive: true });
    await writeFile(join(directory, "pod.json"), '{"id":"late"}');
    await writeFile(join(directory, "pages", "tour", "index.html"), "<title>Late tour</title>");
    const listing = await packages.listPackages(pods);
    const entered = Promise.withResolvers<void>();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const list = vi.spyOn(packages, "listPackages").mockImplementation(async () => {
      entered.resolve();
      await new Promise((resolve) => setTimeout(resolve, listingMs));
      return listing;
    });
    const active = vi.spyOn(lifecycle, "activePackages").mockImplementation(async (candidates) => {
      await new Promise((resolve) => setTimeout(resolve, 4000));
      return [...candidates];
    });
    const delivery: { answer?: Response } = {};
    const opening = fetch("/pages/late--tour/").then((response) => { delivery.answer = response; return response; });
    await entered.promise;
    try {
      await vi.advanceTimersByTimeAsync(4999);
      expect(delivery.answer).toBeUndefined();
      expect(active).toHaveBeenCalledTimes(listingMs < 5000 ? 1 : 0);
      await vi.advanceTimersByTimeAsync(1);
      expect(delivery.answer?.status).toBe(503);
      expect(await (await opening).text()).toContain("Pod discovery exceeded 5000 ms");
      await vi.advanceTimersByTimeAsync(5000);
      expect(active).toHaveBeenCalledTimes(listingMs < 5000 ? 1 : 0);
    } finally {
      await vi.advanceTimersByTimeAsync(10000);
      await opening;
      list.mockRestore();
      active.mockRestore();
      vi.useRealTimers();
    }
  });

  it("the Bind redirect keeps the Page's whole query in its query field", async () => {
    const { fetch } = await pagesRoot();
    const response = await fetch("/pages/todo/?walk=1&x=2", {
      headers: { "sec-fetch-dest": "document" },
    });
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get("location")!, "http://host");
    expect(location.pathname).toBe("/bind");
    expect(routeAddress("bind").read(Object.fromEntries(location.searchParams)).page).toMatchObject({
      view: true,
      query: { walk: "1", x: "2" },
    });
  });

  it("lists and serves a package's pages as <id>--<page>, keyed by manifest id, state outside the pod", async () => {
    const { root, pods, state: stateRoot, fetch } = await pagesRoot();
    const folder = join(pods, "duct-kit-v1");
    const tour = join(folder, "pages", "tour");
    await mkdir(tour, { recursive: true });
    await writeFile(join(folder, "pod.json"), JSON.stringify({ id: "ductkit", entrypoints: [] }));
    await writeFile(join(tour, "index.html"), "<title>Duct tour</title><p>in a pod</p>");
    await writeFile(join(tour, "census.csx"), "Result(1);");
    // not a pod (no pod.json): skipped; a scratch folder carrying the pod separator lists keyless and unserved
    await mkdir(join(pods, "folder", "pages", "x"), { recursive: true });
    await writeFile(join(pods, "folder", "pages", "x", "index.html"), "<p>no pod.json</p>");
    await mkdir(join(root, "odd--name"), { recursive: true });
    await writeFile(join(root, "odd--name", "index.html"), "<p>skipped</p>");
    type Listed = {
      pages: { slug: string; key: string | null; title: string; pod: string | null }[];
    };
    const listed = async () =>
      ((await (await fetch("/pages")).json()) as Listed).pages
        .map((p) => [p.slug, p.key, p.title, p.pod])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    const expected = [
      ["ductkit--tour", "page:@ductkit/pages/tour", "Duct tour", "ductkit"],
      ["odd--name", null, "odd--name", null],
      ["todo", "page:@pages/todo", "A todo page", null],
    ];
    expect(await listed()).toEqual(expected);
    expect(await (await fetch("/pages/ductkit--tour/")).text()).toContain(
      '<meta name="pe-page" content="page:@ductkit/pages/tour">',
    );
    expect(await (await fetch("/pages/ductkit--tour/census.csx")).text()).toBe("Result(1);");
    // The folder never names the page: its old folder slug is no page.
    expect((await fetch("/pages/duct-kit-v1--tour/")).status).toBe(404);
    expect((await fetch("/pages/a--b--c/")).status).toBe(400);
    const posted = await fetch("/pages/ductkit--tour/events", {
      method: "POST",
      body: JSON.stringify({ type: "note" }),
    });
    expect(posted.status).toBe(201);
    // Page state is machine state, keyed by the slug: the pod's folder holds only what was authored.
    expect(await readFile(join(stateRoot, "ductkit--tour", "events.jsonl"), "utf8")).toContain(
      '"type":"note"',
    );
    await expect(access(join(tour, ".state"))).rejects.toThrow();
    expect(await (await fetch("/pages", { headers: { accept: "text/html" } })).text()).toContain(
      "pod ductkit",
    );
    // A folder rename keeps the slug, the key, and the state, which the slug names.
    await rename(folder, join(pods, "renamed"));
    expect(await listed()).toEqual(expected);
    const state = (await (await fetch("/pages/ductkit--tour/state")).json()) as { seq: number };
    expect(state.seq).toBe(1);
    // Two folders claiming one id contribute no page at all.
    await mkdir(join(pods, "twin", "pages", "tour"), { recursive: true });
    await writeFile(join(pods, "twin", "pod.json"), JSON.stringify({ id: "ductkit" }));
    await writeFile(join(pods, "twin", "pages", "tour", "index.html"), "<p>twin</p>");
    expect((await fetch("/pages/ductkit--tour/")).status).toBe(404);
  });

  it("a torn last line in a Page's event log is left out with one notice and the file is not rewritten", async () => {
    const { state, fetch } = await pagesRoot();
    const post = (event: unknown) =>
      fetch("/pages/todo/events", { method: "POST", body: JSON.stringify(event) });
    const read = async () =>
      (await (await fetch("/pages/todo/state")).json()) as {
        seq: number;
        events: { seq: number; event: unknown }[];
      };
    await post({ type: "one" });
    await post({ type: "two" });
    const log = join(state, "todo", "events.jsonl");
    // A crash mid-append: half a row, no newline.
    await appendFile(log, '{"seq":3,"at":"2026-11-11T00:00:00.000Z","orig');
    const torn = await readFile(log);
    const notices = async () =>
      (await readFile(join(state, "..", "stored-notices.jsonl"), "utf8"))
        .split("\n")
        .filter(Boolean);
    for (const _ of [1, 2]) {
      const { seq, events } = await read();
      expect(events.map((row) => row.event)).toEqual([{ type: "one" }, { type: "two" }]);
      expect(seq).toBe(2);
    }
    // Two reads, one notice, and the bytes a person would inspect are still there.
    expect(await notices()).toHaveLength(1);
    expect(JSON.parse((await notices())[0]!)).toMatchObject({ class: "keep", place: "Page todo" });
    expect((await readFile(log)).equals(torn)).toBe(true);
    // The next append closes the torn tail and takes the next number after the last row that reads.
    expect(await (await post({ type: "three" })).json()).toMatchObject({ seq: 3 });
    expect((await read()).events.map((row) => row.event)).toEqual([
      { type: "one" },
      { type: "two" },
      { type: "three" },
    ]);
    expect((await readFile(log)).subarray(0, torn.length).equals(torn)).toBe(true);
    expect(await notices()).toHaveLength(1);
  });

  it("keeps dot-files private and refuses anything that is not a page path", async () => {
    const { fetch } = await pagesRoot();
    expect((await fetch("/pages/todo/.state/secret.txt")).status).toBe(400);
    expect((await fetch("/pages/todo/..%2F..%2Fetc")).status).toBe(400);
    expect((await fetch("/pages/..%2Ftodo/index.html")).status).toBe(400);
    expect((await fetch("/pages/loose.html/")).status).toBe(404); // a file, not a folder
    expect((await fetch("/pages/missing/")).status).toBe(404);
    expect((await fetch("/pages/todo/index.html", { method: "DELETE" })).status).toBe(405);
  });

  it("keeps one event log per page, with origin and seq, and sequence-stamped text instead of a writable snapshot", async () => {
    const { root, fetch } = await pagesRoot();
    await mkdir(join(root, "fresh"));
    await writeFile(join(root, "fresh", "index.html"), "<p>Fresh Page</p>");
    const first = await asCaller({ kind: "page", page: "page:@pages/todo" }, fetch)(
      "/pages/todo/events",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "add", id: "e1", text: "milk" }),
      },
    );
    expect(first.status).toBe(201);
    expect(await first.json()).toMatchObject({
      seq: 1,
      origin: "page",
      event: { type: "add", id: "e1" },
    });
    const second = await fetch("/pages/todo/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "done", id: "e1" }),
    });
    expect(await second.json()).toMatchObject({ seq: 2, origin: "person" });
    expect((await fetch("/pages/todo/events", { method: "POST", body: "[1,2]" })).status).toBe(400);
    const snapshot = await fetch("/pages/todo/snapshot", {
      method: "PUT",
      body: JSON.stringify({ items: [] }),
    });
    expect(snapshot.status).toBe(405);
    const state = (await (await fetch("/pages/todo/state")).json()) as {
      seq: number;
      events: unknown[];
      snapshot: unknown;
    };
    expect(state.seq).toBe(2);
    expect(state.events).toHaveLength(2);
    expect(state).not.toHaveProperty("snapshot");
    expect((await (await fetch("/pages/fresh/state")).json()) as unknown).toEqual({
      seq: 0,
      events: [],
      text: null,
      textSeq: null,
      agent: {},
    });
  });

  it("streams rows after a cursor, then live appends, as SSE", async () => {
    const { fetch } = await pagesRoot();
    const post = (event: unknown) =>
      fetch("/pages/todo/events", { method: "POST", body: JSON.stringify(event) });
    await post({ type: "a" });
    await post({ type: "b" });
    const controller = new AbortController();
    const stream = await fetch("/pages/todo/events?after=1", { signal: controller.signal });
    expect(stream.headers.get("content-type")).toBe("text/event-stream");
    const reader = stream.body!.getReader();
    const decoder = new TextDecoder();
    let text = "";
    const until = async (needle: string) => {
      while (!text.includes(needle)) {
        const { value, done } = await reader.read();
        if (done) throw new Error(`stream ended before ${needle}: ${text}`);
        text += decoder.decode(value);
      }
    };
    await until('"seq":2');
    expect(text).not.toContain('"seq":1');
    await post({ type: "c" });
    await until('"seq":3');
    expect(text).toContain("id: 3\n");
    controller.abort();
    await reader.cancel().catch(() => undefined);
  });

  it.each(["scratch", "pod"])(
    "C2: Pea appends a file-declared verdict to an unopened %s Page",
    async (kind) => {
      const { root, pods, state, handle } = await pagesRoot();
      const directory =
        kind === "scratch" ? join(root, "todo") : join(pods, "kit", "pages", "review");
      const slug = kind === "scratch" ? "todo" : "kit--review";
      await mkdir(directory, { recursive: true });
      if (kind === "pod")
        await writeFile(
          join(pods, "kit", "pod.json"),
          JSON.stringify({ id: "kit", entrypoints: [] }),
        );
      const agent = { verdict: "verdict: passed and explanation" };
      await writeFile(
        join(directory, "index.html"),
        `<script id='pe-agent' type='application/json'>${JSON.stringify(agent)}</script>`,
      );
      const call = (handler: typeof handle) => asCaller(pea(), handler);
      const append = (handler: typeof handle, type: string) =>
        call(handler)(
          new Request(`http://host/pages/${slug}/events`, {
            method: "POST",
            body: JSON.stringify({ type, passed: true }),
          }),
        );
      expect(await (await append(handle, "verdict")).json()).toMatchObject({
        seq: 1,
        origin: "agent",
        event: { type: "verdict", passed: true },
      });
      const read = await call(handle)(new Request(`http://host/pages/${slug}/state`));
      expect(await read.json()).toMatchObject({ seq: 1, agent, text: null, textSeq: null });
      const refused = await append(handle, "erase");
      expect(refused.status).toBe(422);
      expect(await refused.text()).toContain("declared types: verdict");
      // A new host with discarded machine state still reads only the authored file.
      await rm(state, { recursive: true, force: true });
      const reopened = createPagesHandler(root, pods, undefined, undefined, stateFixture(state));
      expect((await append(reopened, "verdict")).status).toBe(201);
      await writeFile(
        join(directory, "index.html"),
        '<script type="application/json" id="pe-agent">{"review":"review text"}</script>',
      );
      expect(await (await append(reopened, "verdict")).text()).toContain("declared types: review");
    },
  );

  it.each(["{", "[]", '{"verdict":42}', '{"verdict":""}', '{"verdict":"line\\nbreak"}'])(
    "C2: malformed file declaration %s preserves replay but refuses agent append",
    async (declaration) => {
      const { root, fetch } = await pagesRoot();
      const file = join(root, "todo", "index.html");
      await writeFile(
        file,
        `<script type="application/json" id="pe-agent">${declaration}</script>`,
      );
      const agent = asCaller(pea(), fetch);
      expect(
        (await fetch("/pages/todo/events", { method: "POST", body: '{"type":"note"}' })).status,
      ).toBe(201);
      const read = await agent("/pages/todo/state");
      expect(read.status).toBe(200);
      expect(await read.json()).toMatchObject({
        seq: 1,
        events: [{ event: { type: "note" } }],
        agent: {},
        agentError: expect.stringContaining(file),
      });
      const response = await agent("/pages/todo/events", { method: "POST", body: '{"type":"verdict"}' });
      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({ message: expect.stringContaining(file) });
    },
  );

  it("C2: two pe-agent blocks preserve replay but refuse agent append in words", async () => {
    const { root, fetch } = await pagesRoot();
    await writeFile(
      join(root, "todo", "index.html"),
      '<script type="application/json" id="pe-agent">{"note":"text"}</script>'.repeat(2),
    );
    const agent = asCaller(pea(), fetch);
    const read = await agent("/pages/todo/state");
    expect(read.status).toBe(200);
    expect(await read.json()).toMatchObject({
      events: [],
      agent: {},
      agentError: expect.stringContaining("expected one"),
    });
    const response = await agent("/pages/todo/events", { method: "POST", body: '{"type":"note"}' });
    expect(response.status).toBe(422);
    expect(await response.text()).toContain("expected one");
  });

  it("C2: buffers live rows while SSE replay is in flight", async () => {
    const { fetch } = await pagesRoot();
    const post = () => fetch("/pages/todo/events", { method: "POST", body: '{"type":"note"}' });
    await post();
    const original = PageState.prototype.rows;
    const prefix = [{ seq: 1, at: "replay", origin: "person", event: { type: "note" } }];
    let release!: (rows: typeof prefix) => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const rows = vi
      .spyOn(PageState.prototype, "rows")
      .mockImplementationOnce(() => {
        entered();
        return new Promise((resolve) => {
          release = resolve;
        });
      })
      .mockImplementation(original);
    const abort = new AbortController();
    try {
      const opening = fetch("/pages/todo/events", { signal: abort.signal });
      await started;
      const response = await opening;
      const reader = response.body!.getReader();
      expect((await post()).status).toBe(201);
      release(prefix);
      const seqs: number[] = [];
      let text = "";
      while (!seqs.includes(2)) {
        const chunk = await reader.read();
        if (chunk.done) throw Error("SSE ended before live row");
        text += new TextDecoder().decode(chunk.value);
        seqs.splice(
          0,
          seqs.length,
          ...Array.from(text.matchAll(/^id: (\d+)$/gm), (match) => Number(match[1])),
        );
      }
      expect(seqs).toEqual([1, 2]);
      await reader.cancel();
    } finally {
      release(prefix);
      abort.abort();
      rows.mockRestore();
    }
  });

  it("C2: stamps text, bounds reads and refuses undeclared agent events", async () => {
    const { root, fetch } = await pagesRoot();
    const agent = asCaller(pea(), fetch);
    const append = (type: string) =>
      agent("/pages/todo/events", {
        method: "POST",
        body: JSON.stringify({ type }),
      });
    expect((await append("note")).status).toBe(422);
    await writeFile(
      join(root, "todo", "index.html"),
      '<script type="application/json" id="pe-agent">{"note":"a note: text"}</script>',
    );
    const put = (seq: number, text: string) =>
      asCaller(human, fetch)("/pages/todo/text", {
        method: "PUT",
        body: JSON.stringify({ seq, text }),
      });
    expect((await put(0, "empty")).status).toBe(204);
    expect(
      (
        await asCaller(human, fetch)("/pages/todo/text", {
          method: "PUT",
          body: JSON.stringify({ seq: 0, text: "forged declaration", agent: { erase: "erase" } }),
        })
      ).status,
    ).toBe(400);
    const refused = await append("erase");
    expect(refused.status).toBe(422);
    expect(await refused.text()).toContain("note");
    expect(
      (
        await agent("/pages/todo/text", {
          method: "PUT",
          body: JSON.stringify({ seq: 0, text: "forged", agent: { erase: "erase" } }),
        })
      ).status,
    ).toBe(403);
    for (let i = 0; i < 52; i++) expect((await append("note")).status).toBe(201);
    const state = (await (await fetch("/pages/todo/state")).json()) as { events: unknown[] };
    expect(state).toMatchObject({
      seq: 52,
      text: "empty",
      textSeq: 0,
      agent: { note: "a note: text" },
    });
    expect(state.events).toHaveLength(50);
    const tail = (await (await fetch("/pages/todo/state?after=51")).json()) as {
      events: unknown[];
    };
    expect(tail.events).toHaveLength(1);
    expect(
      ((await (await fetch("/pages/todo/state?after=0")).json()) as { events: unknown[] }).events,
    ).toHaveLength(52);
    expect((await fetch("/pages/todo/state?after=wrong")).status).toBe(400);
    expect((await put(53, "future")).status).toBe(409);
    expect((await put(52, "current")).status).toBe(204);
    expect((await put(51, "old tab")).status).toBe(409);
    expect(await (await fetch("/pages/todo/state")).json()).toMatchObject({
      textSeq: 52,
      text: "current",
    });
  });

  describe("page doors: identity is the path, the target is the binding", () => {
    const MODEL = "C:\\Jobs\\ProjectA\\Project A MEP.rvt";
    const docA: DocumentRef = { session: "S1", openId: "A" };
    const session = (
      id: string,
      address = MODEL,
      openId = id === "S1" ? "A" : "B",
    ): LiveSession => ({
      session: id,
      documents: [
        { openId, title: "Project A MEP", address, isFamilyDocument: false, isActive: true },
      ],
    });
    let heads: Record<string, ThreadHead> = {};
    /** A head whose one target a human added. */
    const grantedHead = (lifetime: DocumentRef): ThreadHead => ({
      targets: [
        {
          request: { kind: "open", ref: lifetime },
          admission: { revision: 4, at: new Date().toISOString(), via: "local" },
        },
      ],
      revision: 4,
    });
    afterEach(() => {
      heads = {};
      bindControl({ heads: null, acquired: () => null, acquiredSession: () => null, pagePin: undefined });
    });
    /** `peaSession`: every document there is one Pea acquired. */
    const bind = (peaSession?: string) =>
      bindControl({
        heads: (thread) => heads[thread] ?? emptyThreadHead,
        acquired: (ref) => (ref.session === peaSession ? `acq-${peaSession}` : null),
        acquiredSession: (session) => (session === peaSession ? `acq-${peaSession}` : null),
      });

    type Forwarded = {
      path: string;
      headers: Record<string, string>;
      body: Record<string, unknown>;
    };
    /**
     * A host with these Revits. Its `/actions` is the real decision: the minted context goes
     * through `callerOf` and `admitCrossing` at "/actions", as the identity gate and door 2 do.
     */
    async function host(sessions: LiveSession[]) {
      const forwarded: Forwarded[] = [];
      const live: PageLive = {
        sessions: async () => sessions,
        forward: async (path, headers, body) => {
          forwarded.push({ path, headers, body: body as Record<string, unknown> });
          const minted = callerOf({ kind: "local" }, headers);
          if (!("caller" in minted)) return Response.json(minted, { status: 403 });
          if (path === "/call") return Response.json({ caller: minted.caller });
          try {
            const basis = admitCrossing(
              minted.caller,
              (body as { target: Parameters<typeof admitCrossing>[1] }).target,
              "/actions",
            );
            return Response.json(
              { state: "running", caller: minted.caller, basis },
              { status: 202 },
            );
          } catch (error) {
            if (error instanceof Refused)
              return Response.json({ refusal: error.refusal }, { status: 403 });
            throw error;
          }
        },
      };
      const root = await pagesRoot(live);
      const as = (caller: Caller) => ({
        get: (path: string) => asCaller(caller, root.fetch)(path),
        post: (path: string, body: unknown, headers: Record<string, string> = {}) =>
          asCaller(caller, root.fetch)(path, {
            method: "POST",
            headers: { "content-type": "application/json", ...headers },
            body: JSON.stringify(body),
          }),
        put: (path: string, body: unknown) =>
          asCaller(caller, root.fetch)(path, { method: "PUT", body: JSON.stringify(body) }),
      });
      return { ...root, forwarded, as, page: as({ kind: "page", page: "page:@pages/todo" }) };
    }
    const code = async (response: Response) =>
      ((await response.json()) as { refusal?: { code: string; door: string } }).refusal;

    it("mints the D12 page key into index.html and stamps it, never a header", async () => {
      bind();
      const { fetch, page, forwarded, as } = await host([session("S1")]);
      await as(human).put("/pe/pages/todo/binding", { kind: "pinned", ref: docA });
      const html = await (await fetch("/pages/todo/")).text();
      expect(html).toContain('<meta name="pe-page" content="page:@pages/todo">');
      expect(html).toContain('<link rel="icon" href="data:,">');
      expect(html.indexOf("pe-page")).toBeLessThan(html.indexOf("<p>hi</p>"));
      // A forged x-pe-origin names neither the row nor the crossing.
      const row = await page.post("/pages/todo/events", { type: "x" }, { "x-pe-origin": "human" });
      expect(await row.json()).toMatchObject({ origin: "page" });
      const person = await fetch("/pages/todo/events", {
        method: "POST",
        headers: { "x-pe-origin": "page:@pages/other" },
        body: JSON.stringify({ type: "y" }),
      });
      expect(await person.json()).toMatchObject({ origin: "person" });
      const read = await page.post(
        "/pages/todo/call",
        { key: "revit.context.summary" },
        { "x-pe-origin": "human" },
      );
      expect(await read.json()).toEqual({ caller: { kind: "page", page: "page:@pages/todo" } });
      expect(forwarded[0]!.headers).toMatchObject({
        "x-pe-origin": "page:@pages/todo",
        "x-pe-bridge-session-id": "S1",
        "x-pe-open-document-id": "A",
      });
      // The context was minted for that one request and is gone after it.
      expect(callerOf({ kind: "local" }, forwarded[0]!.headers)).toMatchObject({
        refusal: { code: "context.unknown" },
      });
    });

    it("act on an unbound page is page.unbound, and nothing crosses", async () => {
      bind();
      const { page, forwarded } = await host([session("S1")]);
      const response = await page.post("/pages/todo/act", { key: "revit.context.lens", input: {} });
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({
        refusal: { code: "page.unbound", door: "/pages/todo/act" },
        message:
          "Refused at /pages/todo/act: this Page has no target. Bind it to a thread or pin a document from the chip.",
        notDispatched: true,
      });
      expect(forwarded).toEqual([]);
    });

    it("a thread binding writes the documents a human added to that thread, and only those", async () => {
      bind();
      const { page, as, forwarded } = await host([session("S1")]);
      expect(
        (await as(human).put("/pe/pages/todo/binding", { kind: "thread", thread: "t1" })).status,
      ).toBe(200);
      // The thread targets the document with no human admission (a fork copied it).
      heads.t1 = {
        targets: [{ request: { kind: "open", ref: docA }, admission: null }],
        revision: 2,
      };
      const ungranted = await page.post("/pages/todo/act", { key: "revit.context.lens" });
      expect(ungranted.status).toBe(403);
      expect(await code(ungranted)).toEqual(
        expect.objectContaining({ code: "grant.required", door: "/pages/todo/act" }),
      );
      expect(forwarded).toEqual([]);
      heads.t1 = grantedHead(docA);
      const granted = await page.post("/pages/todo/act", { key: "revit.context.lens" });
      expect(granted.status).toBe(202);
      // `/actions` admitted the minted page under the binding: the receipt names the page, the basis the grant.
      expect(await granted.json()).toMatchObject({
        caller: { kind: "page", page: "page:@pages/todo" },
        basis: { kind: "grant", thread: "t1", headRevision: 4, lifetime: docA },
      });
      expect(forwarded[0]!.body).toMatchObject({
        key: "revit.context.lens",
        target: { kind: "document", ref: docA },
      });
      // A catalog row's `op:` key (what pe.find answers) runs as the bare operation.
      await page.post("/pages/todo/act", { key: "op:revit.context.lens" });
      await page.post("/pages/todo/call", { key: "op:revit.context.summary" });
      expect(forwarded.slice(1).map((one) => one.body.key)).toEqual([
        "revit.context.lens",
        "revit.context.summary",
      ]);
      const reading = (await (await page.get("/pages/todo/target")).json()) as PageTargetReading;
      expect(reading).toMatchObject({
        page: "page:@pages/todo",
        binding: { kind: "thread", thread: "t1" },
        document: { session: "S1", openId: "A", title: "Project A MEP" },
        write: { kind: "thread", thread: "t1" },
      });
    });

    it("the page-target Reading serves the target now, and again when the binding or a head moves", async () => {
      let headMoved = () => {};
      bindControl({
        heads: (thread) => heads[thread] ?? emptyThreadHead,
        subscribeHeads: (notify) => ((headMoved = notify), () => (headMoved = () => {})),
        acquired: () => null,
        acquiredSession: () => null,
      });
      const { handle, as } = await host([session("S1")]);
      const seen: unknown[] = [];
      const stop = handle.observeTarget("todo", (result) =>
        seen.push(
          "value" in result ? [result.value.binding.kind, result.value.write?.kind] : result,
        ),
      );
      await expect.poll(() => seen).toEqual([["none", "read"]]);
      await as(human).put("/pe/pages/todo/binding", { kind: "thread", thread: "t1" });
      // The thread has no document yet: the binding is named, and nothing is writable.
      await expect.poll(() => seen.at(-1)).toEqual(["thread", undefined]);
      heads.t1 = grantedHead(docA);
      headMoved();
      await expect.poll(() => seen.at(-1)).toEqual(["thread", "thread"]);
      // Released: nothing more is served, and the head store is no longer followed.
      stop();
      const served = seen.length;
      headMoved();
      await as(human).put("/pe/pages/todo/binding", { kind: "pinned", ref: docA });
      expect(seen).toHaveLength(served);
      const missing: unknown[] = [];
      // A name that is no Page slug is refused, as the HTTP door refuses it.
      handle.observeTarget("not a slug", (result) => missing.push(result));
      await expect.poll(() => missing).toEqual([{ error: "no page not a slug" }]);
    });

    it("a Pod page runs its package's script key on its binding's target, as the page", async () => {
      bind();
      const { pods, as, forwarded } = await host([session("S1")]);
      const pod = join(pods, "kit-folder");
      await mkdir(join(pod, "pages", "tour"), { recursive: true });
      await mkdir(join(pod, "src"), { recursive: true });
      await mkdir(join(pod, "settings"), { recursive: true });
      await writeFile(
        join(pod, "pod.json"),
        JSON.stringify({
          id: "ducts",
          entrypoints: [
            { sourcePath: "src/Census.cs" },
            { sourcePath: "pages/tour/checks/census.csx", mode: "ReadOnly" },
          ],
        }),
      );
      await mkdir(join(pod, "pages", "tour", "checks"), { recursive: true });
      await writeFile(join(pod, "pages", "tour", "checks", "census.csx"), "Result(1);");
      await writeFile(join(pod, "src", "Census.cs"), "// census");
      await writeFile(join(pod, "src", "Helper.cs"), "// helper");
      await writeFile(join(pod, "settings", "checks.json"), "{}");
      await writeFile(join(pod, "pages", "tour", "index.html"), "<title>Tour</title>");
      const tour = as({ kind: "page", page: "page:@ducts/pages/tour" });
      const act = (key: string, input: unknown = {}) =>
        tour.post("/pages/ducts--tour/act", { key, input });
      // No binding: page.unbound, nothing crosses.
      const unbound = await act("script:@ducts/src/Census.cs");
      expect(unbound.status).toBe(403);
      expect(await code(unbound)).toMatchObject({ code: "page.unbound" });
      expect(forwarded).toEqual([]);
      heads.t1 = grantedHead(docA);
      await as(human).put("/pe/pages/ducts--tour/binding", { kind: "thread", thread: "t1" });
      // A page-sent selector or bundle never names the target or the bytes.
      const ran = await act("script:@ducts/src/Census.cs", {
        permissionMode: "ReadOnly",
        target: { kind: "open", ref: { session: "S9", openId: "Z" } },
        sourceBundle: { files: [] },
        sourcePath: "src/Helper.cs",
      });
      expect(ran.status, await ran.clone().text()).toBe(202);
      expect(await ran.json()).toMatchObject({
        caller: { kind: "page", page: "page:@ducts/pages/tour" },
        basis: { kind: "grant", thread: "t1", lifetime: docA },
      });
      const body = forwarded[0]!.body as {
        key: string;
        target: unknown;
        input: {
          sourcePath: string;
          permissionMode: string;
          sourceBundle: { files: { path: string }[] };
        };
      };
      expect(body.key).toBe("scripting.execute");
      expect(body.target).toEqual({ kind: "document", ref: docA });
      expect(Object.keys(body.input).sort()).toEqual([
        "permissionMode",
        "sourceBundle",
        "sourcePath",
      ]);
      expect(body.input.sourcePath).toBe("src/Census.cs");
      expect(body.input.sourceBundle.files.map((file) => file.path).sort()).toEqual([
        "pages/tour/checks/census.csx",
        "pod.json",
        "src/Census.cs",
        "src/Helper.cs",
      ]);
      // Contract C1: an entrypoint beside the Page runs by key, its `input` passes untouched, and
      // its declared mode is the default. Mutants, each run red once: drop `input` from the run
      // `operationOf` builds; default `asked` to `sent.permissionMode` alone; drop the ReadOnly
      // refusal (the write below is forwarded).
      const check = "script:@ducts/pages/tour/checks/census.csx";
      const checked = await act(check, { input: { level: "L2" }, scriptContent: "Result(2);" });
      expect(checked.status, await checked.clone().text()).toBe(202);
      expect((forwarded[1]!.body as { input: Record<string, unknown> }).input).toEqual({
        input: { level: "L2" },
        permissionMode: "ReadOnly",
        sourcePath: "pages/tour/checks/census.csx",
        sourceBundle: body.input.sourceBundle,
      });
      const write = await act(check, { permissionMode: "WriteTransaction" });
      expect(write.status).toBe(400);
      expect(await write.text()).toContain("declared ReadOnly in pod.json");
      const undeclared = await act("script:@ducts/pages/tour/checks/other.csx");
      expect(await undeclared.text()).toContain(
        "declare pages/tour/checks/other.csx in pod.json entrypoints",
      );
      // A member reads, never runs; an undeclared source is no script; another package is not this page's.
      for (const key of [
        "member:@ducts/settings/checks.json",
        "script:@ducts/src/Helper.cs",
        "script:@other/src/Census.cs",
      ]) {
        const refused = await act(key);
        expect(refused.status, key).toBe(400);
      }
      expect(forwarded).toHaveLength(2);
    });

    it("C3 checks every Pod model probe in one read on the bound document", async () => {
      const entries = [{ elementId: 1, elementUniqueId: "one" }, { elementId: 2, elementUniqueId: "wrong" }];
      const reads: unknown[] = [];
      const { pods, fetch } = await pagesRoot({
        sessions: async () => [session("S1")],
        forward: async (_path, headers, body) => {
          reads.push({ headers, body });
          return Response.json({ documentTitle: "Other", entries });
        },
      });
      const pod = join(pods, "tour");
      await mkdir(join(pod, "pages", "tour"), { recursive: true });
      await writeFile(join(pod, "pages", "tour", "index.html"), "<title>Tour</title>");
      await writeFile(join(pod, "pod.json"), JSON.stringify({ id: "tour", for: { title: "Chadds", probes: [
        { elementId: 1, uniqueId: "one" }, { elementId: 2, uniqueId: "two" },
      ] } }));
      await asCaller(human, fetch)("/pe/pages/tour--tour/binding", { method: "PUT", body: JSON.stringify({ kind: "pinned", ref: docA }) });
      reads.length = 0; // Binding itself answers a target reading.
      const target = () => asCaller({ kind: "page", page: "page:@tour/pages/tour" }, fetch)("/pages/tour--tour/target").then(async (r) => pageTargetReadingSchema.parse(await r.json()));
      expect((await target()).resolution).toEqual({ kind: "refused", reason: "wrong-model", message: "this Pod is for Chadds; the bound document is Other" });
      expect(reads).toHaveLength(1);
      expect(reads[0]).toMatchObject({ body: { key: "revit.detail.elements", request: { query: { kind: "ElementReferences", elementIds: [1, 2] } } } });
      entries[1].elementUniqueId = "two";
      expect((await target()).resolution.kind).toBe("resolved");
      expect(reads).toHaveLength(2);
      entries.pop();
      expect((await target()).resolution.kind).toBe("refused");
    });

    it("a pin selects its exact lifetime even with the same Address in two Revits, and refuses a reopen", async () => {
      bind();
      const two = await host([session("S1"), session("S2")]);
      await two.as(human).put("/pe/pages/todo/binding", { kind: "pinned", ref: docA });
      const reading = (await (
        await two.page.get("/pages/todo/target")
      ).json()) as PageTargetReading;
      expect(reading.resolution).toEqual({ kind: "resolved", target: { kind: "document", ref: docA } });
      const none = await host([session("S1", MODEL, "new-opening")]);
      await none.as(human).put("/pe/pages/todo/binding", { kind: "pinned", ref: docA });
      expect(
        ((await (await none.page.get("/pages/todo/target")).json()) as PageTargetReading)
          .resolution,
      ).toEqual({ kind: "choose", reason: "document-closed" });
    });

    it("a person's pin writes its document as that person's act", async () => {
      bind("S2");
      const yours = await host([session("S1")]);
      await yours.as(human).put("/pe/pages/todo/binding", { kind: "pinned", ref: docA });
      expect(await (await yours.page.post("/pages/todo/act", { key: "k" })).json()).toMatchObject({
        caller: { kind: "page", page: "page:@pages/todo" },
        basis: { kind: "person-pin", page: "page:@pages/todo", boundBy: "human", lifetime: docA },
      });
      expect(await (await yours.page.get("/pages/todo/target")).json()).toMatchObject({ write: { kind: "human" } });
      const peas = await host([session("S2")]);
      await peas.as(human).put("/pe/pages/todo/binding", { kind: "pinned", ref: { session: "S2", openId: "B" } });
      expect(await (await peas.page.post("/pages/todo/act", { key: "k" })).json()).toMatchObject({
        basis: { kind: "person-pin", boundBy: "human", lifetime: { session: "S2", openId: "B" } },
      });
    });

    it("a detached document with no Address binds and runs by its exact lifetime", async () => {
      bind();
      const detached = session("S1");
      const f = await host([{ ...detached, documents: detached.documents!.map((doc) => ({ ...doc, address: null })) }]);
      const response = await f.as(human).put("/pe/pages/todo/binding", { kind: "pinned", ref: docA });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ resolution: { kind: "resolved", target: { kind: "document", ref: docA } } });
      expect((await f.page.post("/pages/todo/act", { key: "k" })).status).toBe(202);
    });

    it("a Pea pin cannot consent to a write after its acquisition is released", async () => {
      bind("S1");
      const f = await host([session("S1")]);
      expect((await f.as(pea("t1")).put("/pe/pages/todo/binding", { kind: "pinned", ref: docA })).status).toBe(200);
      // Pinning needs acquisition. Release it before the write so only boundBy distinguishes consent.
      bind();
      const response = await f.page.post("/pages/todo/act", { key: "k" });
      expect(response.status).toBe(403);
      expect(await code(response)).toMatchObject({ code: "grant.required", door: "/pages/todo/act" });
      expect(f.forwarded).toEqual([]);
    });

    it.each(["unpin", "repin", "agent", "reopen"] as const)("a person's pin is rechecked after %s before the next step and resume", async (change) => {
      bind();
      const sessions = [session("S1"), session("S2", "C:/Other.rvt")];
      const f = await host(sessions);
      await f.as(human).put("/pe/pages/todo/binding", { kind: "pinned", ref: docA });
      const response = await f.page.post("/pages/todo/act", { key: "k" });
      expect(response.status).toBe(202);
      const basis = basisSchema.parse((await response.json()).basis);
      expect(await live(basis, "step")).toBeNull();
      const fenced: string[] = [];
      const stop = onPagePinRevoke((page) => fenced.push(page));
      cleanup.push(async () => stop());
      if (change === "reopen") sessions[0] = session("S1", MODEL, "new-opening");
      else {
        if (change === "agent") bind("S1");
        await f.as(change === "agent" ? pea("t1") : human).put("/pe/pages/todo/binding",
          change === "unpin" ? { kind: "none" } : { kind: "pinned", ref: change === "repin" ? { session: "S2", openId: "B" } : docA });
      }
      expect(fenced).toEqual(change === "reopen" ? [] : ["page:@pages/todo"]);
      for (const moment of ["step", "authorize", "native dispatch"])
        expect((await live(basis, moment))?.refusal).toMatchObject({ code: "grant.revoked", door: moment, lifetime: docA });
    });

    it("no binding is choose with one Revit or two, never a guess at the active document", async () => {
      bind();
      const two = await host([session("S1"), session("S2")]);
      const reading = (await (
        await two.page.get("/pages/todo/target")
      ).json()) as PageTargetReading;
      expect(reading.resolution).toEqual({ kind: "choose", reason: "missing" });
      expect(reading.write).toMatchObject({ kind: "read", refusal: { code: "page.unbound" } });
      const read = await two.page.post("/pages/todo/call", { key: "revit.context.summary" });
      expect(read.status).toBe(409);
      expect(two.forwarded).toEqual([]);
      // K15/ADR 0017 D10: one Revit is no binding either; its active document is never read for it.
      const one = await host([session("S1")]);
      const alone = (await (await one.page.get("/pages/todo/target")).json()) as PageTargetReading;
      expect(alone.resolution).toEqual({ kind: "choose", reason: "missing" });
      expect(alone.document).toBeNull();
      const unbound = await one.page.post("/pages/todo/call", { key: "revit.context.summary" });
      expect(unbound.status).toBe(409);
      expect(one.forwarded).toEqual([]);
    });

    it("/actions from a page's own browser is page.use-page-door; only the minted door crosses", async () => {
      bind();
      const fromPage = callerOf(
        { kind: "local" },
        {
          origin: "http://127.0.0.1:5180",
          ...serviceHeaders(),
          referer: "http://127.0.0.1:5180/pages/ductkit--tour/",
        },
      );
      expect(fromPage).toEqual({ caller: { kind: "page", page: "page:@ductkit/pages/tour" } });
      let refusal: Refused | null = null;
      try {
        admitCrossing(
          (fromPage as { caller: Caller }).caller,
          { kind: "document", ref: docA },
          "/actions",
        );
      } catch (error) {
        refusal = error as Refused;
      }
      expect(refusal?.refusal).toEqual({
        code: "page.use-page-door",
        door: "/actions",
        reason: "Pages act through /pages/ductkit--tour/act, not /actions.",
      });
    });

    it("binding: a person binds anything; Pea pins only its own documents; a page cannot bind itself", async () => {
      bind("S2");
      const { as, page, state } = await host([
        session("S1", MODEL),
        session("S2", "C:\\Pea\\Copy.rvt"),
      ]);
      const put = (caller: Caller, body: unknown) => as(caller).put("/pe/pages/todo/binding", body);
      expect(await code(await put(pea("t9"), { kind: "pinned", ref: docA }))).toMatchObject({
        code: "page.binding-not-yours",
      });
      expect(await code(await put(pea("t9"), { kind: "thread", thread: "t9" }))).toMatchObject({
        code: "page.binding-not-yours",
      });
      expect(await code(await page.put("/pe/pages/todo/binding", { kind: "none" }))).toMatchObject({
        code: "human.only",
      });
      expect(await code(await put({ kind: "anonymous" }, { kind: "none" }))).toMatchObject({
        code: "context.missing",
      });
      expect((await put(pea("t9"), { kind: "pinned", ref: { session: "S2", openId: "B" } })).status).toBe(
        200,
      );
      expect(JSON.parse(await readFile(join(state, "todo", "binding.json"), "utf8"))).toEqual({
        slots: { default: { kind: "pinned", ref: { session: "S2", openId: "B" } } },
        // Pea set it, so it is no person's consent to the Page's ReadOnly scripts.
        boundBy: { default: "agent" },
      });
      expect((await put(human, { kind: "thread", thread: "t1" })).status).toBe(200);
      expect((await put(human, { kind: "thread" })).status).toBe(400);
    });

    it("a Pea or MCP context cannot borrow a page's doors", async () => {
      bind();
      const { as, forwarded } = await host([session("S1")]);
      await as(human).put("/pe/pages/todo/binding", { kind: "thread", thread: "t1" });
      heads.t1 = grantedHead(docA);
      expect(await code(await as(pea("t2")).post("/pages/todo/act", { key: "k" }))).toMatchObject({
        code: "page.binding-not-yours",
      });
      expect(
        await code(await as({ kind: "anonymous" }).post("/pages/todo/call", { key: "k" })),
      ).toMatchObject({
        code: "context.missing",
      });
      expect(forwarded).toEqual([]);
    });
  });

  describe("pe.js as a browser runs it", () => {
    type Sent = { url: string; method: string; headers: Record<string, string>; body: unknown };
    const resolved = {
      page: "page:@pages/todo",
      slot: "default",
      binding: { kind: "thread", thread: "t1-abcdef-123" },
      resolution: {
        kind: "resolved",
        target: { kind: "document", ref: { session: "s1", openId: "d1" } },
      },
      document: { session: "s1", openId: "d1", title: "Project A MEP" },
      write: { kind: "thread", thread: "t1-abcdef-123" },
    };
    type Answer = (url: URL, init: RequestInit) => Response | undefined;
    /** The served bytes in a page at `/pages/todo/`, with fetch and EventSource recorded and the host's answers. */
    async function page(
      answer: Answer = () => undefined,
      pageKey = "page:@pages/todo",
      declaration?: string,
    ) {
      const { fetch } = await pagesRoot();
      const source = await (await fetch("/pages/pe.js")).text();
      const sent: Sent[] = [];
      const body: { children: unknown[]; prepend(n: unknown): void } = {
        children: [],
        prepend: (n) => body.children.unshift(n),
      };
      const nodes = new Map<string, Record<string, unknown>>();
      if (declaration !== undefined)
        nodes.set("pe-agent", {
          tagName: "SCRIPT",
          type: "application/json",
          textContent: declaration,
        });
      const location = new URL("http://127.0.0.1:5180/pages/todo/");
      const window: Record<string, unknown> = { addEventListener: () => {} };
      const streams: {
        onmessage?: (message: { data: string }) => void;
        listeners: Map<string, (message: { data: string }) => void>;
      }[] = [];
      runInNewContext(source, {
        window,
        location,
        URL,
        URLSearchParams,
        Headers,
        Request,
        Response,
        console,
        crypto,
        setTimeout,
        clearTimeout,
        setInterval: () => 0,
        clearInterval: () => {},
        document: {
          body,
          querySelector: (selector: string) =>
            selector === 'meta[name="pe-page"]' ? { getAttribute: () => pageKey } : null,
          getElementById: (id: string) => nodes.get(id) ?? null,
          createElement: () => {
            const node: Record<string, unknown> = {
              style: {},
              setAttribute: (k: string, v: string) => (node[k] = v),
            };
            queueMicrotask(() => nodes.set(String(node.id), node));
            return node;
          },
        },
        fetch: async (input: string | URL, init: RequestInit = {}) => {
          const url = new URL(String(input), location);
          sent.push({
            url: url.pathname + url.search,
            method: init.method ?? "GET",
            headers: Object.fromEntries(new Headers(init.headers)),
            body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
          });
          const mine = answer(url, init);
          if (mine) return mine;
          if (url.pathname === "/pages/todo/target") return Response.json(resolved);
          if (url.pathname === "/pages/todo/call") return Response.json({ ok: true });
          if (url.pathname === "/pe/capabilities")
            return Response.json({
              capabilities: [
                {
                  key: "op:b.show",
                  kind: "op",
                  title: "B",
                  description: "second by text",
                  needs: "document",
                },
                { key: "op:a.x", kind: "op", title: "A", description: "x x x", needs: "document" },
              ],
            });
          if (url.pathname.endsWith("/state"))
            return Response.json({ seq: 0, events: [], text: null, textSeq: null, agent: {} });
          if (url.pathname.endsWith("/text")) return new Response(null, { status: 204 });
          return new Response("<p>page</p>");
        },
        EventSource: class {
          listeners = new Map<string, (message: { data: string }) => void>();
          constructor(url: string) {
            streams.push(this);
            sent.push({
              url: new URL(url).pathname + new URL(url).search,
              method: "GET",
              headers: {},
              body: undefined,
            });
          }
          addEventListener(name: string, listener: (message: { data: string }) => void) {
            this.listeners.set(name, listener);
          }
          close() {}
        },
      });
      return {
        pe: window.pe as Record<string, (...a: unknown[]) => Promise<unknown>> & {
          page: string | null;
          doc: unknown;
        },
        sent,
        streams,
        body,
      };
    }
    const options: IdentityOptions = {
      port: () => 5180,
      frontendOrigin: undefined,
      share: {
        read: async () => ({
          allowRemoteAdministration: true,
          desired: "off",
          state: "off",
          url: null,
          refusal: null,
          callers: [],
          refused: [],
        }),
        observe: () => {},
      },
    };
    const browser = {
      host: "127.0.0.1:5180",
      "sec-fetch-site": "same-origin",
      "sec-fetch-mode": "cors",
      "sec-fetch-dest": "empty",
    };

    // Contract C1, the Page's one script door. Mutants, each run red once: make `scriptKey` answer
    // null on a Pod Page (the file is fetched and sent as source); make `pe.do` return the settled
    // row's result for a script key (the answer is the run record, not the Result value); read the
    // failed run from `row.result` alone (the compiler's words are lost).
    it("pe.script and pe.do run a Pod's declared script by key, with one input and one answer", async () => {
      let failing = false;
      const run = { status: "Succeeded", data: { rows: [1] }, diagnostics: [], output: "" };
      const broken = {
        status: "CompilationFailed",
        output: "",
        diagnostics: [{ severity: "Error", message: "CS1002: ; expected\n at census.csx" }],
      };
      const { pe, sent } = await page(
        (url) =>
          url.pathname === "/pages/todo/act"
            ? Response.json(
                failing
                  ? { id: "a1", state: "failed", error: "Script execution CompilationFailed", status: 422, evidence: { result: broken } }
                  : { id: "a1", state: "succeeded", result: run },
              )
            : undefined,
        "page:@ducts/pages/tour",
      );
      const acts = () => sent.filter((one) => one.url === "/pages/todo/act").map((one) => one.body);
      expect(await pe.script!("checks/census.csx", { input: { level: "L2" } })).toEqual({ rows: [1] });
      expect(await pe.do!("script:@ducts/src/Census.cs", { input: { level: "L2" }, mode: "WriteTransaction" })).toEqual({ rows: [1] });
      expect(await pe.script!("/src/Census.cs")).toEqual({ rows: [1] });
      expect(await pe.script!("Result(1);\n")).toEqual({ rows: [1] });
      expect(acts()).toEqual([
        { key: "script:@ducts/pages/tour/checks/census.csx", input: { input: { level: "L2" }, timeoutSeconds: 120 } },
        { key: "script:@ducts/src/Census.cs", input: { input: { level: "L2" }, permissionMode: "WriteTransaction", timeoutSeconds: 120 } },
        { key: "script:@ducts/src/Census.cs", input: { timeoutSeconds: 120 } },
        { key: "scripting.execute", input: { timeoutSeconds: 120, scriptContent: "Result(1);\n", permissionMode: "ReadOnly" } },
      ]);
      // A Pod Page's script is never fetched and sent as anonymous source.
      expect(sent.some((one) => one.url.endsWith(".csx") || one.url.endsWith(".cs"))).toBe(false);
      expect((pe as unknown as { lastRun: unknown }).lastRun).toEqual(run);
      failing = true;
      const error = await pe.script!("checks/census.csx").then(
        () => null,
        (thrown: Error & { run?: unknown }) => thrown,
      );
      expect(error?.message).toBe("script:@ducts/pages/tour/checks/census.csx CompilationFailed: CS1002: ; expected");
      expect(error?.run).toEqual(broken);
      expect((pe as unknown as { lastRun: unknown }).lastRun).toEqual(broken);
    });

    // Slice 6. Mutants, each run red once: read `before` from the real run's ids instead of the dry run's
    // (the deleted element has no row and the modified one no before); drop `mode: "ReadOnly"` from the
    // first run (the script writes twice); compare on the shown value (the 0.004 change is `unchanged`);
    // drop `expect` from the before read (the aimed element is unread); delete the array refusal (an
    // array reaches pe.script and the host is called).
    it("pe.diff dry-runs a script, runs it, and answers rows from the run's own change ids", async () => {
      const ids = (...list: number[]) => ({ ids: list, total: list.length });
      const changes = (kept: boolean) => ({
        added: ids(3), modified: ids(1), deleted: ids(2), transactions: [], kept,
        summary: kept ? "Changed 3 elements" : "ReadOnly run", undo: kept ? "Pe script: heal" : null,
      });
      let wrote = false;
      let dryFails = false;
      const entry = (elementId: number, typeName: string, raw: string, shown: string) => ({
        elementId, name: `Tap ${elementId}`, categoryName: "Duct Fittings", typeName,
        requestedParameters: [{ name: "Loss", rawValue: raw, displayValue: shown }],
      });
      const { pe, sent } = await page((url, init) => {
        const body = JSON.parse(String(init.body ?? "{}"));
        if (url.pathname === "/pages/todo/act") {
          const dry = body.input.permissionMode === "ReadOnly";
          if (dry && dryFails)
            return Response.json({ id: "a", state: "failed", status: 422, evidence: { result: {
              status: "PolicyRejected", output: "", diagnostics: [{ severity: "Error", message: "script-owned transaction" }] } } });
          wrote ||= !dry;
          return Response.json({ id: "a", state: "succeeded", result: {
            status: "Succeeded", data: { healed: 1 }, diagnostics: [], output: "", changes: changes(!dry) } });
        }
        if (url.pathname === "/pages/todo/call")
          return Response.json({ entries: (body.request.query.elementIds as number[]).flatMap((id) =>
            id === 1 ? [entry(1, wrote ? "Tight" : "Loose", wrote ? "0.254" : "0.250", "0.25")]
            : id === 2 && !wrote ? [entry(2, "Loose", "0.1", "0.10")]
            : id === 3 && wrote ? [entry(3, "Tight", "0.3", "0.30")] : []) });
        return undefined;
      }, "page:@ducts/pages/tour");
      const diff = pe.diff as unknown as (run: object, names?: string[]) => Promise<Record<string, unknown>>;

      const answer = await diff({ script: "heals/taps.csx", input: { tight: true } }, ["Loss"]);

      const posts = sent.filter((one) => one.method === "POST" && /\/(act|call)$/.test(one.url)).map((one) => one.body as {
        key: string; input?: { permissionMode?: string }; request?: { query: { elementIds: number[] } } });
      expect(posts.map((one) => one.input?.permissionMode ?? one.request?.query.elementIds ?? "declared")).toEqual([
        "ReadOnly", [1, 2], "declared", [3, 1],
      ]);
      expect(answer).toMatchObject({
        data: { healed: 1 },
        changes: { undo: "Pe script: heal", kept: true },
        dry: { ran: true, why: null },
        elements: [
          { id: 3, change: "added", name: "Tap 3", category: "Duct Fittings" },
          { id: 1, change: "modified", name: "Tap 1", category: "Duct Fittings" },
          { id: 2, change: "deleted", name: "Tap 2", category: "Duct Fittings" },
        ],
        unchanged: 0,
        truncated: false,
      });
      expect(answer.rows).toEqual([
        { id: 3, change: "added", parameter: "Type", before: null, after: "Tight" },
        { id: 3, change: "added", parameter: "Loss", before: null, after: "0.30" },
        { id: 1, change: "modified", parameter: "Type", before: "Loose", after: "Tight" },
        // The shown value is the same; Revit's raw value changed, so it is a row.
        { id: 1, change: "modified", parameter: "Loss", before: "0.25", after: "0.25" },
        { id: 2, change: "deleted", parameter: "Type", before: "Loose", after: null },
        { id: 2, change: "deleted", parameter: "Loss", before: "0.10", after: null },
      ]);

      // A script that cannot run ReadOnly still runs for real, and `dry` says why. A modified element nobody
      // read before has no rows; one the Page named in `expect` was read before and has them.
      dryFails = true;
      wrote = false;
      const blind = await diff({ script: "heals/taps.csx" }, ["Loss"]);
      expect(blind.dry).toMatchObject({ ran: false, why: expect.stringContaining("script-owned transaction") });
      expect(blind).toMatchObject({ unread: 1, changes: { kept: true } });
      expect((blind.rows as { id: number }[]).map((row) => row.id)).toEqual([3, 3]);
      wrote = false;
      const aimed = await diff({ script: "heals/taps.csx", expect: [1] }, ["Loss"]);
      expect(aimed).toMatchObject({ unread: 0, dry: { ran: false } });
      expect(aimed.rows).toContainEqual({ id: 1, change: "modified", parameter: "Type", before: "Loose", after: "Tight" });

      // The retired (elementIds, parameterNames, run) form is refused in plain words, before anything runs.
      const acts = sent.length;
      await expect(diff([1], ["Loss"])).rejects.toThrow(/pe\.diff takes the run itself.*retired/);
      expect(sent.length).toBe(acts);
    });

    it("C2: one stream reduces replay and live rows with identical metadata, without duplicate echoes", async () => {
      const replay = {
        seq: 1,
        origin: "agent",
        at: "2026-11-14T00:00:00Z",
        event: { type: "add", value: 2 },
      };
      const live = {
        seq: 2,
        origin: "person",
        at: "2026-11-14T00:00:01Z",
        event: { type: "add", value: 3 },
      };
      const own = {
        seq: 3,
        origin: "page",
        at: "2026-11-14T00:00:02Z",
        event: { type: "add", value: 4 },
      };
      let rows = [replay];
      const { pe, streams, sent } = await page(
        (url) => {
          if (url.pathname.endsWith("/state"))
            return Response.json({ seq: rows.at(-1)!.seq, events: rows });
          if (url.pathname.endsWith("/events")) {
            rows = [replay, live, own];
            return Response.json(own);
          }
        },
        undefined,
        JSON.stringify({ add: "add value" }),
      );
      const seen: unknown[] = [];
      const k = (await pe.state!({
        base: 0,
        reduce: (state: number, event: { value: number }, meta: unknown) => {
          seen.push(meta);
          return state + event.value;
        },
        describe: (state: number) => String(state),
      })) as { state: number; fire(event: unknown): Promise<boolean> };
      expect(k.state).toBe(2);
      expect(streams).toHaveLength(1);
      expect(streams[0]!.listeners.has("file")).toBe(true);
      streams[0]!.onmessage!({ data: JSON.stringify(live) });
      expect(k.state).toBe(5);
      await k.fire(own.event);
      streams[0]!.onmessage!({ data: JSON.stringify(own) });
      expect(k.state).toBe(9);
      expect(seen).toEqual([replay, live, own].map(({ seq, origin, at }) => ({ seq, origin, at })));
      expect(sent.filter((row) => row.method === "PUT").at(-1)?.body).toEqual({
        seq: 3,
        text: "9",
      });
      expect(sent.some((row) => row.url.endsWith("/snapshot"))).toBe(false);
    });

    it("C2: a POST reply cannot skip an unseen event before its own seq", async () => {
      const hidden = { seq: 1, origin: "agent", at: "first", event: { value: 2 } };
      const own = { seq: 2, origin: "page", at: "second", event: { value: 3 } };
      let rows: (typeof hidden)[] = [];
      const { pe } = await page((url) => {
        if (url.pathname.endsWith("/state"))
          return Response.json({ seq: rows.at(-1)?.seq ?? 0, events: rows });
        if (url.pathname.endsWith("/events")) {
          rows = [hidden, own];
          return Response.json(own);
        }
      });
      const k = (await pe.state!({
        base: 0,
        reduce: (state: number, event: { value: number }) => state + event.value,
      })) as { state: number; fire(event: unknown): Promise<boolean> };
      await k.fire(own.event);
      expect(k.state).toBe(5);
    });

    it.each(["pe.kernel", "pe.describe", "pe.state"])(
      "D6: an old-form Page sees the %s refusal banner",
      async (name) => {
        const { pe, body, sent } = await page();
        const call = () =>
          name === "pe.state"
            ? pe.state!({ state: {}, fire: () => {} }, { local: [] })
            : pe[name.slice(3)]!();
        const api = name === "pe.state" ? "pe.state(k, {local})" : name;
        const message = `This Page uses ${api}, which Pe removed on 2026-11-14. Its state is now one call, pe.state({ reduce, base, render, describe }). Ask Pea to update this Page.`;
        await expect(Promise.resolve().then(call)).rejects.toThrow(message);
        expect((body.children[0] as { textContent: string }).textContent).toBe(message);
        expect(sent.some((row) => row.url.includes("/state") || row.method === "PUT")).toBe(false);
        if (name === "pe.state")
          await expect(pe.state!({ state: {}, fire: () => {} })).rejects.toThrow(message);
      },
    );

    it.each(["{", "[]", '{"verdict":42}'])(
      "C2: pe.state replays despite malformed DOM declaration %s and shows agentError",
      async (declaration) => {
        const message = "Invalid pe-agent declaration in this Page's index.html";
        const { pe, sent, body } = await page(
          (url) =>
            url.pathname.endsWith("/state")
              ? Response.json({
                  seq: 1,
                  events: [{ seq: 1, origin: "person", at: "now", event: { value: 7 } }],
                  agent: {},
                  agentError: message,
                })
              : undefined,
          undefined,
          declaration,
        );
        const k = await pe.state!({
          base: 0,
          reduce: (_state: unknown, event: { value: number }) => event.value,
        });
        expect(k).toMatchObject({ state: 7 });
        expect((body.children[0] as { textContent: string }).textContent).toBe(message);
        expect(sent.some((row) => row.method === "PUT")).toBe(true);
      },
    );

    it("names the serving runtime on every door and never its own origin or target", async () => {
      const { pe, sent } = await page();
      expect(pe.page).toBe("page:@pages/todo");
      await pe.target!();
      // The host's one ranker answers; the page keeps its order and never ranks again.
      expect(await pe.find!("x")).toEqual([
        { key: "op:b.show", kind: "op", title: "B", description: "second by text" },
        { key: "op:a.x", kind: "op", title: "A", description: "x x x" },
      ]);
      await pe.read!("revit.context.summary");
      await pe.state!({ base: {}, reduce: (state: unknown) => state });
      const paths = sent.map((r) => r.url);
      expect(paths).toEqual(
        expect.arrayContaining([
          "/pages/todo/target",
          "/pe/capabilities?query=x&session=s1",
          "/pages/todo/call",
          "/pages/todo/state?after=0",
        ]),
      );
      expect(paths).not.toContain("/call");
      expect(paths.some((path) => path.startsWith("/ops"))).toBe(false);
      // Nothing polls the page's own file; the host pushes `file` on its stream.
      expect(paths).not.toContain("/pages/todo/");
      expect(paths.some((p) => p.startsWith("/pages/todo/events?after=0&peRuntimeService="))).toBe(
        true,
      );
      for (const request of sent) {
        expect(Object.keys(request.headers)).not.toEqual(expect.arrayContaining(["x-pe-origin"]));
        expect(request.headers["x-pe-bridge-session-id"], request.url).toBeUndefined();
        expect(
          await readRequestIdentity({ ...browser, ...request.headers }, request.url, options),
          request.url,
        ).toHaveProperty("principal");
        const bare = Object.fromEntries(
          Object.entries(request.headers).filter(([k]) => k !== HOST_RUNTIME_SERVICE_HEADER),
        );
        expect(
          await readRequestIdentity(
            { ...browser, ...bare },
            request.url.replace(/[?&]peRuntimeService=[^&]*/, ""),
            options,
          ),
          request.url,
        ).toMatchObject({ refusal: { code: "runtime.owner-missing" } });
      }
    });

    it("pe.target is the host's resolution; a binding that names nothing refuses on the page, never a pick", async () => {
      expect(await (await page()).pe.target!()).toEqual({
        session: "s1",
        openId: "d1",
        title: "Project A MEP",
      });
      // The old selector form names nothing now, so it refuses instead of being ignored.
      await expect((await page()).pe.target!({ session: "s1", doc: "d2" })).rejects.toThrow(
        "pe.target takes no selector",
      );
      for (const reason of ["ambiguous", "document-closed", "session-gone", "missing"]) {
        const { pe, body } = await page((url) =>
          url.pathname === "/pages/todo/target"
            ? Response.json({
                ...resolved,
                resolution: { kind: "choose", reason },
                document: null,
                write: null,
              })
            : undefined,
        );
        const refusal = await pe.target!().then(
          () => null,
          (error: Error & { code: string }) => error,
        );
        expect(refusal, reason).toMatchObject({ name: "PeTargetRefusal", code: reason });
        expect(pe.doc).toBeNull();
        expect((body.children[0] as { textContent: string }).textContent).toBe(refusal!.message);
      }
    });

    it("pe.target throws wrong-model as PeTargetRefusal and displays the host's words", async () => {
      const message = "this Pod is for Chadds; the bound document is Other";
      const { pe, body } = await page((url) => url.pathname.endsWith("/target") ? Response.json({
        ...resolved, resolution: { kind: "refused", reason: "wrong-model", message },
      }) : undefined);
      await expect(pe.target!()).rejects.toMatchObject({ name: "PeTargetRefusal", code: "wrong-model", message });
      expect((body.children[0] as { textContent: string }).textContent).toBe(message);
    });

    it("pe.do acts through the page door and shows the host's refusal word for word", async () => {
      const said =
        "Refused at /pages/todo/act: this Page has no target. Bind it to a thread or pin a document from the chip.";
      const { pe, sent, body } = await page((url) =>
        url.pathname === "/pages/todo/call"
          ? Response.json({ error: "mutation", notDispatched: true }, { status: 409 })
          : url.pathname === "/pages/todo/act"
            ? Response.json(
                {
                  error: said,
                  message: said,
                  refusal: { code: "page.unbound", door: "/pages/todo/act", reason: said },
                  notDispatched: true,
                },
                { status: 403 },
              )
            : undefined,
      );
      const refusal = await pe.do!("revit.context.lens", { elementIds: [1] }).then(
        () => null,
        (error: Error & { code: string }) => error,
      );
      expect(refusal).toMatchObject({ name: "PeRefusal", code: "page.unbound" });
      expect(refusal!.message).toContain(said);
      expect((body.children[0] as { textContent: string }).textContent).toBe(said);
      expect(sent.find((r) => r.url === "/pages/todo/act")!.body).toEqual({
        key: "revit.context.lens",
        input: { elementIds: [1] },
      });
      expect(sent.some((r) => r.url === "/actions")).toBe(false);
    });
  });
});
