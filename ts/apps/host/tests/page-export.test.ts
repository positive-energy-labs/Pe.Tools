import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { afterEach, expect, it } from "vite-plus/test";
import { exportPage } from "../src/page-export.ts";
import { createPagesHandler } from "../src/pages-route.ts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture(html: string) {
  const root = await mkdtemp(join(tmpdir(), "pe-export-"));
  roots.push(root);
  const directory = join(root, "page");
  await mkdir(join(directory, "assets"), { recursive: true });
  await writeFile(join(directory, "index.html"), html);
  return { root, directory };
}
const basis = {
  page: "page:@pages/test",
  exportedAt: "2026-10-13T12:00:00.000Z",
  document: { session: "s", openId: "d", title: "Model" },
  snapshot: { volts: 120, text: "</script>$&$1" },
  events: [],
};

it("pins local scripts, imported CSS and relative assets, snapshot, document and exact source hashes", async () => {
  const { directory } = await fixture(
    '<head><link rel="stylesheet" href="assets/main.css"><script src="/pages/pe.js"></script><script src="app.js"></script></head><img src="assets/icon.svg">',
  );
  await writeFile(
    join(directory, "assets", "main.css"),
    '@import "more.css"; body{background:url(icon.svg)}',
  );
  await writeFile(join(directory, "assets", "more.css"), "body{color:red}");
  await writeFile(
    join(directory, "assets", "icon.svg"),
    '<svg xmlns="http://www.w3.org/2000/svg"/>',
  );
  const app = 'window.marker = "$&$1</script>";';
  await writeFile(join(directory, "app.js"), app);
  const result = await exportPage({
    directory,
    ...basis,
    library: async (path) =>
      path === "/pages/pe.js"
        ? readFile(new URL("../src/pages/pe.js", import.meta.url), "utf8")
        : path.endsWith(".js")
          ? "pe.kit = {}; pe.kitReady = Promise.resolve(pe.kit);"
          : "body{margin:0}",
  });
  expect(result.html).toContain("data:image/svg+xml;base64,");
  expect(result.html).toContain("body{color:red}");
  expect(result.html).toContain('window.marker = "$&$1<\\/script>"');
  expect(result.html).not.toContain('src="app.js"');
  expect(result.html).not.toContain("EventSource");
  expect(result.html).not.toContain("pe.read =");
  expect(result.provenance.document).toEqual(basis.document);
  expect(result.provenance.snapshotSha256).toBe(
    createHash("sha256").update(JSON.stringify(basis.snapshot)).digest("hex"),
  );
  expect(result.provenance.files.find((file) => file.path === "app.js")?.sha256).toBe(
    createHash("sha256").update(app).digest("hex"),
  );
  expect(await readFile(result.path, "utf8")).toBe(result.html);
  expect(result.sha256).toBe(createHash("sha256").update(result.html).digest("hex"));
  const snapshot = /<script id="pe-export" type="application\/json">([\s\S]*?)<\/script>/.exec(
    result.html,
  )![1]!;
  const runtime = /<script>(\(\(\) => \{[\s\S]*?)<\/script>/.exec(result.html)![1]!;
  const window: {
    pe?: {
      state(k: unknown): Promise<unknown>;
      kernel(reduce: (s: unknown, e: unknown) => unknown, base: unknown): { state: unknown };
      read?: unknown;
    };
  } = {};
  runInNewContext(runtime, {
    window,
    document: { getElementById: () => ({ textContent: snapshot }) },
  });
  const kernel = window.pe!.kernel((state) => state, {});
  await window.pe!.state(kernel);
  expect(kernel.state).toEqual(basis.snapshot);
  expect(window.pe!.read).toBeUndefined();
});

it("downloads the same host-persisted artifact and rejects destination path injection", async () => {
  const { root, directory } = await fixture(
    "<head><title>Independent Page</title></head><p>presentation</p>",
  );
  const handle = createPagesHandler(root);
  const response = await handle(
    new Request("http://host/pages/page/export", {
      method: "POST",
      body: JSON.stringify({ snapshot: basis.snapshot }),
    }),
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("content-disposition")).toBe('attachment; filename="page.html"');
  const html = await response.text();
  const hash = response.headers.get("x-pe-export-sha256")!;
  expect(await readFile(join(directory, ".state", "exports", `${hash}.html`), "utf8")).toBe(html);
  const manifest = JSON.parse(
    /<script id="pe-export" type="application\/json">([\s\S]*?)<\/script>/.exec(html)![1]!,
  );
  expect(manifest.snapshot).toEqual(basis.snapshot);
  expect(manifest.document).toBeNull();
  const rejected = await handle(
    new Request("http://host/pages/page/export", {
      method: "POST",
      body: JSON.stringify({ path: "elsewhere.html" }),
    }),
  );
  expect(rejected.status).toBe(400);
});

it("refuses an artifact directory junction before creating anything outside the Page", async () => {
  const { root, directory } = await fixture("<p>hello</p>");
  const outside = join(root, "external");
  await mkdir(outside);
  await symlink(outside, join(directory, ".state"), "junction");
  await expect(exportPage({ directory, ...basis, library: async () => "" })).rejects.toThrow(
    /outside/i,
  );
  await expect(readFile(join(outside, "exports"))).rejects.toMatchObject({ code: "ENOENT" });
});

it.each([
  '<script src="https://cdn.test/app.js"></script>',
  '<script type="module">import x from "https://cdn.test/x.js"</script>',
  '<link rel="stylesheet" href="https://cdn.test/a.css">',
  "<script>import(variable)</script>",
])("refuses unsupported executable dependencies: %s", async (html) => {
  const { directory } = await fixture(html);
  await expect(exportPage({ directory, ...basis, library: async () => "" })).rejects.toThrow(
    /unsupported|external/i,
  );
});

it("refuses traversal and symlinks outside the Page", async () => {
  const { root, directory } = await fixture('<script src="../outside.js"></script>');
  await writeFile(join(root, "outside.js"), "secret");
  await expect(exportPage({ directory, ...basis, library: async () => "" })).rejects.toThrow(
    /outside/i,
  );
  const outside = join(root, "external");
  await mkdir(outside);
  await writeFile(join(outside, "outside.js"), "secret");
  await symlink(outside, join(directory, "assets", "linked"), "junction");
  await writeFile(
    join(directory, "index.html"),
    '<script src="assets/linked/outside.js"></script>',
  );
  await expect(exportPage({ directory, ...basis, library: async () => "" })).rejects.toThrow(
    /outside/i,
  );
});

it("embeds local module dependencies as data URLs and preserves dollar expressions", async () => {
  const { directory } = await fixture('<script type="module" src="app.mjs"></script>');
  await writeFile(
    join(directory, "app.mjs"),
    'import { value } from "./value.mjs"; window.value=value;',
  );
  await writeFile(join(directory, "value.mjs"), 'export const value = "$&$1";');
  const result = await exportPage({ directory, ...basis, library: async () => "" });
  expect(result.html).toContain('from "data:text/javascript;base64,');
  expect(result.provenance.files.map((file) => file.path)).toContain("value.mjs");
});

it("keeps the existing host facsimile presentation library offline", async () => {
  const { directory } = await fixture('<script src="/pages/revit.js"></script>');
  const result = await exportPage({
    directory,
    ...basis,
    library: async (path) => {
      expect(path).toBe("/pages/revit.js");
      return "globalThis.rv = { face: true };";
    },
  });
  expect(result.html).toContain("globalThis.rv = { face: true };");
});

it.each(["async", "defer"])(
  "refuses %s scripts rather than changing their execution order",
  async (flag) => {
    const { directory } = await fixture(`<script ${flag} src="app.js"></script>`);
    await writeFile(join(directory, "app.js"), "window.test = true;");
    await expect(exportPage({ directory, ...basis, library: async () => "" })).rejects.toThrow(
      /unsupported.*(?:async|defer)/i,
    );
  },
);

it("resolves pe.kitReady only after the kit script and stylesheet both load", async () => {
  const source = (await readFile(new URL("../src/pages/pe.js", import.meta.url), "utf8")).replace(
    "/*pe:runtime*/ null",
    JSON.stringify({ header: "x-runtime", query: "runtime", service: "test" }),
  );
  const nodes: { onload(): void; src?: string; href?: string }[] = [];
  const window: { pe?: { kitReady: Promise<unknown>; kit?: unknown } } = {};
  runInNewContext(source, {
    window,
    location: new URL("http://host/pages/test/"),
    document: {
      querySelector: () => null,
      createElement: () => ({}),
      head: { append: (...items: typeof nodes) => nodes.push(...items) },
    },
  });
  expect(nodes.map((node) => node.src ?? node.href)).toEqual([
    "/pages/kit/pe-kit.css",
    "/pages/kit/pe-kit.js",
  ]);
  const kit = { React: {} };
  window.pe!.kit = kit;
  let ready = false;
  void window.pe!.kitReady.then(() => {
    ready = true;
  });
  nodes[1]!.onload();
  await Promise.resolve();
  expect(ready).toBe(false);
  nodes[0]!.onload();
  expect(await window.pe!.kitReady).toBe(kit);
});
