import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { createPagesHandler } from "../src/pages-route.ts";

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  while (cleanup.length) await cleanup.pop()!();
});

async function pagesRoot() {
  const root = await mkdtemp(join(tmpdir(), "pe-pages-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "todo"), { recursive: true });
  await writeFile(
    join(root, "todo", "index.html"),
    "<!doctype html><title>A todo page</title><p>hi</p>",
  );
  await writeFile(join(root, "todo", "notes.md"), "# notes");
  await mkdir(join(root, "todo", ".state"), { recursive: true });
  await writeFile(join(root, "todo", ".state", "secret.txt"), "private");
  await writeFile(join(root, "loose.html"), "<p>not a page: a file, not a folder</p>");
  const handle = createPagesHandler(root);
  const fetch = (path: string, init?: RequestInit) =>
    handle(new Request(`http://host${path}`, init));
  return { root, fetch };
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
