import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { HOST_RUNTIME_SERVICE_HEADER } from "@pe/host-contracts/contracts";
import {
  emptyThreadHead,
  type Caller,
  type DocumentRef,
  type ThreadHead,
} from "@pe/agent-contracts";
import {
  createPagesHandler,
  type LiveSession,
  type PageLive,
  type PageTargetReading,
} from "../src/pages-route.ts";
import { hostOwnership } from "../src/host-ownership.ts";
import { readRequestIdentity, type IdentityOptions } from "../src/request-identity.ts";
import { admitCrossing, bindControl, callerOf, grantExpiry, Refused } from "../src/control.ts";
import { asCaller, human, pea } from "./callers.ts";

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  while (cleanup.length) await cleanup.pop()!();
});

/** A product home: `Pages/` holding the todo page, `Pods/` empty until a test fills it. */
async function pagesRoot(live?: PageLive) {
  const home = await mkdtemp(join(tmpdir(), "pe-pages-"));
  cleanup.push(() => rm(home, { recursive: true, force: true }));
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
  const handle = createPagesHandler(root, pods, live);
  const fetch = (path: string, init?: RequestInit) =>
    handle(new Request(`http://host${path}`, init));
  return { root, pods, fetch, handle };
}

describe("pages", () => {
  it("lists every folder with an index.html, as JSON or as a list page", async () => {
    const { fetch } = await pagesRoot();
    const listing = await fetch("/pages");
    expect(listing.status).toBe(200);
    const body = (await listing.json()) as {
      pages: { slug: string; title: string; url: string }[];
    };
    expect(body.pages.map((p) => [p.slug, p.title, p.url])).toEqual([
      ["todo", "A todo page", "/pages/todo/"],
    ]);
    const html = await fetch("/pages", { headers: { accept: "text/html" } });
    expect(html.headers.get("content-type")).toContain("text/html");
    expect(await html.text()).toContain('href="/pages/todo/"');
  });

  it("lists and serves a pod's pages as <pod>--<page>, with their state inside the pod", async () => {
    const { root, pods, fetch } = await pagesRoot();
    const tour = join(pods, "ductkit", "pages", "tour");
    await mkdir(tour, { recursive: true });
    await writeFile(join(pods, "ductkit", "pod.json"), "{}");
    await writeFile(join(tour, "index.html"), "<title>Duct tour</title><p>in a pod</p>");
    await writeFile(join(tour, "census.csx"), "Result(1);");
    // not a pod (no pod.json), and a plain page whose name carries the pod separator: both skipped
    await mkdir(join(pods, "folder", "pages", "x"), { recursive: true });
    await writeFile(join(pods, "folder", "pages", "x", "index.html"), "<p>no pod.json</p>");
    await mkdir(join(root, "odd--name"), { recursive: true });
    await writeFile(join(root, "odd--name", "index.html"), "<p>skipped</p>");
    const body = (await (await fetch("/pages")).json()) as {
      pages: { slug: string; title: string; pod: string | null }[];
    };
    expect(body.pages.map((p) => [p.slug, p.title, p.pod]).sort()).toEqual([
      ["ductkit--tour", "Duct tour", "ductkit"],
      ["todo", "A todo page", null],
    ]);
    expect(await (await fetch("/pages/ductkit--tour/")).text()).toContain("<p>in a pod</p>");
    expect(await (await fetch("/pages/ductkit--tour/census.csx")).text()).toBe("Result(1);");
    expect((await fetch("/pages/a--b--c/")).status).toBe(400);
    const posted = await fetch("/pages/ductkit--tour/events", {
      method: "POST",
      body: JSON.stringify({ type: "note" }),
    });
    expect(posted.status).toBe(201);
    expect(await readFile(join(tour, ".state", "events.jsonl"), "utf8")).toContain('"type":"note"');
    expect(await (await fetch("/pages", { headers: { accept: "text/html" } })).text()).toContain(
      "pod ductkit",
    );
  });

  it("keeps a text projection beside the snapshot", async () => {
    const { root, fetch } = await pagesRoot();
    const put = await fetch("/pages/todo/text", {
      method: "PUT",
      headers: { "content-type": "text/markdown" },
      body: "# todo\n\n- milk",
    });
    expect(put.status).toBe(204);
    expect(await readFile(join(root, "todo", ".state", "snapshot.md"), "utf8")).toBe(
      "# todo\n\n- milk",
    );
    const state = (await (await fetch("/pages/todo/state")).json()) as { text: string | null };
    expect(state.text).toBe("# todo\n\n- milk");
  });

  it("serves a page's files, defaults to index.html, and fixes the trailing slash", async () => {
    const { fetch } = await pagesRoot();
    const index = await fetch("/pages/todo/");
    expect(index.headers.get("content-type")).toContain("text/html");
    expect(await index.text()).toContain("<p>hi</p>");
    const notes = await fetch("/pages/todo/notes.md");
    expect(notes.headers.get("content-type")).toContain("text/markdown");
    const redirect = await fetch("/pages/todo?x=1");
    expect([redirect.status, redirect.headers.get("location")]).toEqual([
      308,
      "http://host/pages/todo/?x=1",
    ]);
    expect((await fetch("/pages/todo/nope.png")).status).toBe(404);
  });

  it("keeps dot-files private and refuses anything that is not a page path", async () => {
    const { fetch } = await pagesRoot();
    expect((await fetch("/pages/todo/.state/secret.txt")).status).toBe(400);
    expect((await fetch("/pages/todo/..%2F..%2Fetc")).status).toBe(400);
    expect((await fetch("/pages/..%2Ftodo/index.html")).status).toBe(400);
    expect((await fetch("/pages/loose.html")).status).toBe(400);
    expect((await fetch("/pages/missing/")).status).toBe(404);
    expect((await fetch("/pages/todo/index.html", { method: "DELETE" })).status).toBe(405);
  });

  it("serves the doors and the house look", async () => {
    const { fetch } = await pagesRoot();
    const js = await fetch("/pages/pe.js");
    expect(js.headers.get("content-type")).toContain("javascript");
    const text = await js.text();
    for (const door of ["pe.target", "pe.find", "pe.read", "pe.do", "pe.state"])
      expect(text).toContain(door);
    const css = await (await fetch("/pages/pe.css")).text();
    expect(css).toContain("--pe-page:");
    expect(css).toContain("button:hover");
  });

  it("serves the Revit facsimile as a classic script that defines rv", async () => {
    const { fetch } = await pagesRoot();
    const js = await fetch("/pages/revit.js");
    expect(js.headers.get("content-type")).toContain("javascript");
    const source = await js.text();
    expect(source).not.toMatch(/^export /m);
    // helpers stay private: a page that declares its own `esc` or `set` must still run
    expect(
      () =>
        new Function(`const esc = 1; const set = 2;
${source}`),
    ).not.toThrow();
    const scope: {
      rv?: {
        render: (spec: unknown) => string;
        fromElement: (e: unknown) => unknown;
        fromRouting: (rows: unknown[], o?: unknown) => unknown;
        fromWarnings: (rows: unknown[]) => unknown;
      };
    } = {};
    new Function("globalThis", source)(scope);
    const rv = scope.rv!;
    const html = rv.render({
      t: "dialog",
      title: "T",
      body: [],
      buttons: [{ t: "button", text: "OK", disabled: true }],
    });
    expect(html).toContain('data-rv="button:OK"');
    expect(html).toContain("data-disabled");
    expect(await (await fetch("/pages/revit.css")).text()).toContain(".rv-button");
    // projections from facts: a detail entry, prefs.csx rows, warning rows, each renders with addressable ids
    const palette = rv.render(
      rv.fromElement({
        className: "Duct",
        categoryName: "Ducts",
        familyName: "Rectangular Duct",
        typeName: "Mitered Elbows / Taps",
        requestedParameters: [
          {
            name: "Mark",
            displayValue: "D1",
            isReadOnly: false,
            definition: { groupTypeLabel: "Identity Data" },
          },
          {
            name: "Length",
            displayValue: `12' 0"`,
            rawValue: "12",
            isReadOnly: true,
            definition: { groupTypeLabel: "Dimensions" },
          },
          { name: "Flow", rawValue: "200", definition: {} },
        ],
      }),
    );
    expect(palette).toContain('data-rv="Identity Data/Mark"');
    expect(palette).toContain('data-rv="Parameters/Flow"');
    expect(palette).toContain("Ducts (1)");
    const routing = rv.render(
      rv.fromRouting(
        [
          { group: "Elbows", i: 1, part: "Rect Elbow : Mitered", crit: "all" },
          { group: "Elbows", i: 0, part: "Rect Elbow : Radius", crit: "4-12 in" },
          { group: "Junctions", i: 0, part: "Rect Tee : Standard", crit: "all" },
        ],
        { typeName: "Mitered Elbows / Taps", preferred: "Tap" },
      ),
    );
    expect(routing).toContain('data-rv="Elbows/Rect Elbow : Radius"');
    expect(routing).toContain('data-rv="Junctions/Rect Tee : Standard"');
    expect(routing).toContain('data-rv="field:Preferred Junction Type"');
    expect(routing.indexOf("Rect Elbow : Radius")).toBeLessThan(
      routing.indexOf("Rect Elbow : Mitered"),
    );
    const warnings = rv.render(
      rv.fromWarnings([
        { severity: "Warning", description: "Duct is not connected", elementIds: [11, 12] },
        { severity: "Warning", description: "Duct is not connected", elementIds: [13] },
        { severity: "Error", description: "Invalid flow", elementIds: [12] },
      ]),
    );
    expect(warnings).toContain('data-rv="warnings/Duct is not connected"');
    expect(warnings).toContain('data-rv="warnings/Error: Invalid flow"');
    expect(warnings).toContain('data-rv="warnings/Duct is not connected/12"'); // 12 twice: path ids
    expect(warnings).toContain('data-rv="warnings/13"');
  });

  it("keeps one event log per page, with origin and seq, and a snapshot the page writes", async () => {
    const { fetch } = await pagesRoot();
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
      origin: "page:@pages/todo",
      event: { type: "add", id: "e1" },
    });
    const second = await fetch("/pages/todo/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "done", id: "e1" }),
    });
    expect(await second.json()).toMatchObject({ seq: 2, origin: "agent" });
    expect((await fetch("/pages/todo/events", { method: "POST", body: "[1,2]" })).status).toBe(400);
    const snapshot = await fetch("/pages/todo/snapshot", {
      method: "PUT",
      body: JSON.stringify({ items: [] }),
    });
    expect(snapshot.status).toBe(204);
    const state = (await (await fetch("/pages/todo/state")).json()) as {
      seq: number;
      events: unknown[];
      snapshot: unknown;
    };
    expect(state.seq).toBe(2);
    expect(state.events).toHaveLength(2);
    expect(state.snapshot).toEqual({ items: [] });
    expect((await (await fetch("/pages/fresh/state")).json()) as unknown).toEqual({
      seq: 0,
      events: [],
      snapshot: null,
      text: null,
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

  describe("page doors: identity is the path, the target is the binding", () => {
    const MODEL = "C:\\Jobs\\Chadds\\Chadds MEP.rvt";
    const docA: DocumentRef = { session: "S1", openId: "A" };
    const session = (
      id: string,
      address = MODEL,
      openId = id === "S1" ? "A" : "B",
    ): LiveSession => ({
      session: id,
      documents: [
        { openId, title: "Chadds MEP", address, isFamilyDocument: false, isActive: true },
      ],
    });
    let heads: Record<string, ThreadHead> = {};
    const grantedHead = (lifetime: DocumentRef): ThreadHead => ({
      ...emptyThreadHead,
      defaultTarget: { kind: "open", ref: lifetime },
      revision: 4,
      grant: {
        lifetime,
        grantedAt: new Date().toISOString(),
        grantedVia: "local",
        expiresAt: grantExpiry(Date.now()),
        revoked: null,
      },
    });
    afterEach(() => {
      heads = {};
      bindControl({ heads: null, whose: () => "you" });
    });
    const bind = (whose: (session: string) => "you" | "pea" = () => "you") =>
      bindControl({ heads: (thread) => heads[thread] ?? emptyThreadHead, whose });

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
              (body as { destination: Parameters<typeof admitCrossing>[1] }).destination,
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
      const { fetch, page, forwarded } = await host([session("S1")]);
      const html = await (await fetch("/pages/todo/")).text();
      expect(html).toContain('<meta name="pe-page" content="page:@pages/todo">');
      expect(html.indexOf("pe-page")).toBeLessThan(html.indexOf("<p>hi</p>"));
      // A forged x-pe-origin names neither the row nor the crossing.
      const row = await page.post("/pages/todo/events", { type: "x" }, { "x-pe-origin": "human" });
      expect(await row.json()).toMatchObject({ origin: "page:@pages/todo" });
      const anonymous = await fetch("/pages/todo/events", {
        method: "POST",
        headers: { "x-pe-origin": "page:@pages/other" },
        body: JSON.stringify({ type: "y" }),
      });
      expect(await anonymous.json()).toMatchObject({ origin: "agent" });
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

    it("a thread binding writes under that thread's grant, and only while it holds", async () => {
      bind();
      const { page, as, forwarded } = await host([session("S1")]);
      expect(
        (await as(human).put("/pe/pages/todo/binding", { kind: "thread", thread: "t1" })).status,
      ).toBe(200);
      // The head points at the document but holds no grant (Pea set it, or it expired away).
      heads.t1 = { ...emptyThreadHead, defaultTarget: { kind: "open", ref: docA }, revision: 2 };
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
        kind: "operation",
        key: "revit.context.lens",
        destination: { kind: "document", ref: docA },
      });
      const reading = (await (await page.get("/pages/todo/target")).json()) as PageTargetReading;
      expect(reading).toMatchObject({
        page: "page:@pages/todo",
        binding: { kind: "thread", thread: "t1" },
        document: { session: "S1", openId: "A", title: "Chadds MEP" },
        write: { kind: "rw", thread: "t1" },
      });
    });

    it("a pinned Address open in two Revits is choose: ambiguous, closed is document-closed", async () => {
      bind();
      const two = await host([session("S1"), session("S2")]);
      await two.as(human).put("/pe/pages/todo/binding", { kind: "pinned", address: MODEL });
      const reading = (await (
        await two.page.get("/pages/todo/target")
      ).json()) as PageTargetReading;
      expect(reading.resolution).toEqual({ kind: "choose", reason: "ambiguous" });
      expect(reading.document).toBeNull();
      const act = await two.page.post("/pages/todo/act", { key: "revit.context.lens" });
      expect(act.status).toBe(409);
      expect(await act.json()).toMatchObject({
        resolution: { kind: "choose", reason: "ambiguous" },
      });
      expect(two.forwarded).toEqual([]);
      const none = await host([session("S1", "C:\\Jobs\\Other.rvt")]);
      await none.as(human).put("/pe/pages/todo/binding", { kind: "pinned", address: MODEL });
      expect(
        ((await (await none.page.get("/pages/todo/target")).json()) as PageTargetReading)
          .resolution,
      ).toEqual({ kind: "choose", reason: "document-closed" });
    });

    it("a pinned binding writes only Pea's documents", async () => {
      bind((s) => (s === "S2" ? "pea" : "you"));
      const yours = await host([session("S1")]);
      await yours.as(human).put("/pe/pages/todo/binding", { kind: "pinned", address: MODEL });
      expect(await code(await yours.page.post("/pages/todo/act", { key: "k" }))).toMatchObject({
        code: "grant.required",
        door: "/pages/todo/act",
      });
      const peas = await host([session("S2")]);
      await peas.as(human).put("/pe/pages/todo/binding", { kind: "pinned", address: MODEL });
      expect(await (await peas.page.post("/pages/todo/act", { key: "k" })).json()).toMatchObject({
        basis: { kind: "pea-session", session: "S2" },
      });
    });

    it("no binding and two Revits is choose, never a guess; one Revit reads its active document", async () => {
      bind();
      const two = await host([session("S1"), session("S2")]);
      const reading = (await (
        await two.page.get("/pages/todo/target")
      ).json()) as PageTargetReading;
      expect(reading.resolution).toEqual({ kind: "choose", reason: "ambiguous" });
      expect(reading.write).toMatchObject({ kind: "read", refusal: { code: "page.unbound" } });
      const read = await two.page.post("/pages/todo/call", { key: "revit.context.summary" });
      expect(read.status).toBe(409);
      expect(two.forwarded).toEqual([]);
      const one = await host([session("S1")]);
      expect(
        ((await (await one.page.get("/pages/todo/target")).json()) as PageTargetReading).document,
      ).toMatchObject({ session: "S1", openId: "A" });
    });

    it("/actions from a page's own browser is page.use-page-door; only the minted door crosses", async () => {
      bind();
      const fromPage = callerOf(
        { kind: "local" },
        {
          origin: "http://127.0.0.1:5180",
          [HOST_RUNTIME_SERVICE_HEADER]: hostOwnership.serviceName,
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
      bind((s) => (s === "S2" ? "pea" : "you"));
      const { as, page, root } = await host([
        session("S1", MODEL),
        session("S2", "C:\\Pea\\Copy.rvt"),
      ]);
      const put = (caller: Caller, body: unknown) => as(caller).put("/pe/pages/todo/binding", body);
      expect(await code(await put(pea("t9"), { kind: "pinned", address: MODEL }))).toMatchObject({
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
      expect((await put(pea("t9"), { kind: "pinned", address: "C:\\Pea\\Copy.rvt" })).status).toBe(
        200,
      );
      expect(
        JSON.parse(await readFile(join(root, "todo", ".state", "binding.json"), "utf8")),
      ).toEqual({
        slots: { default: { kind: "pinned", address: "C:\\Pea\\Copy.rvt" } },
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
    type Sent = { url: string; headers: Record<string, string> };
    const sessions = [
      {
        sessionId: "s1",
        openDocuments: [
          { openId: "d1", title: "Chadds MEP", isActive: true },
          { openId: "d2", title: "Chadds Arch", isActive: false },
        ],
      },
    ];
    /** The served bytes in a page at `/pages/todo/?<query>`, with fetch and EventSource recorded. */
    async function page(query = "") {
      const { fetch } = await pagesRoot();
      const source = await (await fetch("/pages/pe.js")).text();
      const sent: Sent[] = [];
      const body: { children: unknown[]; prepend(n: unknown): void } = {
        children: [],
        prepend: (n) => body.children.unshift(n),
      };
      const nodes = new Map<string, Record<string, unknown>>();
      const location = new URL(`http://127.0.0.1:5180/pages/todo/${query ? `?${query}` : ""}`);
      const window: Record<string, unknown> = {};
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
            headers: Object.fromEntries(new Headers(init.headers)),
          });
          if (url.pathname === "/call") return Response.json({ sessions });
          if (url.pathname.endsWith("/state"))
            return Response.json({ seq: 0, events: [], snapshot: null, text: null });
          return new Response("<p>page</p>");
        },
        EventSource: class {
          constructor(url: string) {
            sent.push({ url: new URL(url).pathname + new URL(url).search, headers: {} });
          }
          addEventListener() {}
          close() {}
        },
      });
      return { pe: window.pe as Record<string, (...a: unknown[]) => Promise<unknown>>, sent, body };
    }
    const options: IdentityOptions = {
      port: () => 5180,
      frontendOrigin: () => undefined,
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

    it("names the serving runtime on every door, so the identity gate admits the page", async () => {
      const { pe, sent } = await page();
      await pe.target!();
      await pe.find!("x").catch(() => undefined);
      await pe.state!({ base: {}, state: {}, replay() {}, fire() {} });
      const paths = sent.map((r) => r.url);
      expect(paths).toEqual(
        expect.arrayContaining(["/pages/todo/", "/call", "/ops?session=s1", "/pages/todo/state"]),
      );
      expect(paths.some((p) => p.startsWith("/pages/todo/events?after=0&peRuntimeService="))).toBe(
        true,
      );
      for (const request of sent) {
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
      expect(sent.find((r) => r.url === "/call")!.headers[HOST_RUNTIME_SERVICE_HEADER]).toBe(
        hostOwnership.serviceName,
      );
    });

    it("keeps the implicit default, and refuses a pin that names nothing instead of retargeting", async () => {
      expect(await (await page()).pe.target!()).toEqual({
        session: "s1",
        openId: "d1",
        title: "Chadds MEP",
      });
      expect(await (await page("title=arch")).pe.target!()).toMatchObject({ openId: "d2" });
      const cases: [string, string, string][] = [
        ["session=gone", "session-gone", "session=s1"],
        ["doc=closed", "document-closed", "doc=d1 (Chadds MEP), doc=d2 (Chadds Arch)"],
        ["title=hvac", "document-closed", "doc=d1 (Chadds MEP)"],
        ["title=chadds", "ambiguous", "doc=d2 (Chadds Arch)"],
      ];
      for (const [query, code, available] of cases) {
        const { pe, body } = await page(query);
        const refusal = await pe.target!().then(
          () => null,
          (error: Error & { code: string; selector: string }) => error,
        );
        expect(refusal, query).toMatchObject({ name: "PeTargetRefusal", code, selector: query });
        expect(refusal!.message).toContain(available);
        expect(pe.doc).toBeNull();
        expect((body.children[0] as { textContent: string }).textContent).toBe(refusal!.message);
      }
    });
  });
});
