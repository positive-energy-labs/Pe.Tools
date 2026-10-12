import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { createPagesHandler } from "../src/pages-route.ts";

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  while (cleanup.length) await cleanup.pop()!();
});

/** A product home: `Pages/` holding the todo page, `Pods/` empty until a test fills it. */
async function pagesRoot() {
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
  const handle = createPagesHandler(root, pods);
  const fetch = (path: string, init?: RequestInit) =>
    handle(new Request(`http://host${path}`, init));
  return { root, pods, fetch };
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
    expect(() => new Function(`const esc = 1; const set = 2;
${source}`)).not.toThrow();
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
    const first = await fetch("/pages/todo/events", {
      method: "POST",
      headers: { "content-type": "application/json", "x-pe-origin": "page:todo" },
      body: JSON.stringify({ type: "add", id: "e1", text: "milk" }),
    });
    expect(first.status).toBe(201);
    expect(await first.json()).toMatchObject({
      seq: 1,
      origin: "page:todo",
      event: { type: "add", id: "e1" },
    });
    const second = await fetch("/pages/todo/events", {
      method: "POST",
      headers: { "content-type": "application/json", "x-pe-action-actor": "agent" },
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
});
