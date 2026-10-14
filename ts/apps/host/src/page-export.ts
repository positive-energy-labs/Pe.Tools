import { readFile, realpath } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import {
  artifactRelative,
  PAGE_MEDIA,
  sha256Hex as sha,
  validatePageHtml,
  writeArtifact,
} from "./page-artifacts.ts";

export type PageExportInput = {
  directory: string;
  page: string;
  exportedAt: string;
  document: unknown;
  snapshot: unknown;
  events: readonly unknown[];
  /** Only host-owned presentation libraries; never the live pe.js doors. */
  library(path: string): Promise<string>;
};
type PinnedFile = { path: string; sha256: string };
const safeScript = (value: string) => value.replace(/<\/script/gi, "<\\/script");
const safeJson = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c");
const attributes = (tag: string) =>
  Object.fromEntries(
    [...tag.matchAll(/([^\s=<>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)].map((m) => [
      m[1]!.toLowerCase(),
      m[2] ?? m[3] ?? m[4] ?? "",
    ]),
  );
const replaceAsync = async (
  source: string,
  pattern: RegExp,
  replace: (match: RegExpMatchArray) => Promise<string>,
) => {
  const matches = [...source.matchAll(pattern)];
  let result = "",
    at = 0;
  for (const match of matches) {
    result += source.slice(at, match.index) + (await replace(match));
    at = match.index! + match[0].length;
  }
  return result + source.slice(at);
};

/** Pin the source graph and a host-stamped snapshot into one network-independent presentation. */
export async function exportPage(input: PageExportInput) {
  const root = await realpath(input.directory);
  const files = new Map<string, PinnedFile>();
  const inside = (path: string) => artifactRelative(root, path);
  const pin = (path: string, bytes: string | Uint8Array) => {
    files.set(path, { path, sha256: sha(bytes) });
    return bytes;
  };
  const local = async (url: string, from: string) => {
    if (/^(?:[a-z][a-z\d+.-]*:|\/\/|\/)/i.test(url))
      throw Error(`Page export has an unsupported external dependency: ${url}`);
    const path = resolve(dirname(from), decodeURIComponent(url.split(/[?#]/)[0]!));
    const name = inside(path);
    if (name.split("/").some((part) => part.startsWith(".")))
      throw Error(`Page export refuses a private dependency: ${url}`);
    const actual = await realpath(path);
    const actualName = inside(actual); // A local symlink does not authorize bytes outside the Page.
    if (actualName.split("/").some((part) => part.startsWith(".")))
      throw Error(`Page export refuses a private dependency: ${url}`);
    const bytes = await readFile(actual);
    pin(name, bytes);
    return { path, bytes };
  };
  const hostLibrary = async (url: string) => {
    const text = await input.library(url);
    pin(url, text);
    return text;
  };
  const data = async (url: string, from: string) => {
    if (/^(?:data:|#)/i.test(url)) return url;
    const { path, bytes } = await local(url, from);
    return `data:${PAGE_MEDIA[extname(path).toLowerCase()]?.split(";")[0] ?? "application/octet-stream"};base64,${bytes.toString("base64")}`;
  };
  const css = async (source: string, from: string, chain: string[] = []): Promise<string> => {
    if (chain.includes(from))
      throw Error(`Page export has an unsupported CSS import cycle: ${from}`);
    let text = await replaceAsync(
      source,
      /@import\s+(?:url\(\s*)?["']([^"']+)["']\s*\)?\s*([^;]*);/gi,
      async (m) => {
        const dependency = await local(m[1]!, from);
        const imported = await css(dependency.bytes.toString("utf8"), dependency.path, [
          ...chain,
          from,
        ]);
        return m[2]!.trim() ? `@media ${m[2]}{${imported}}` : imported;
      },
    );
    if (/@import\b/i.test(text)) throw Error("Page export has an unsupported CSS @import form");
    text = await replaceAsync(
      text,
      /url\(\s*(?:"([^"]*)"|'([^']*)'|([^\s)]+))\s*\)/gi,
      async (m) => `url("${await data(m[1] ?? m[2] ?? m[3]!, from)}")`,
    );
    return text;
  };
  const modules = new Map<string, string>();
  const javascript = async (
    source: string,
    from: string,
    chain: string[] = [],
  ): Promise<string> => {
    if (chain.includes(from))
      throw Error(`Page export has an unsupported module import cycle: ${from}`);
    const dependency = async (url: string) => {
      const file = await local(url, from);
      let encoded = modules.get(file.path);
      if (!encoded) {
        encoded = `data:text/javascript;base64,${Buffer.from(await javascript(file.bytes.toString("utf8"), file.path, [...chain, from])).toString("base64")}`;
        modules.set(file.path, encoded);
      }
      return encoded;
    };
    let text = await replaceAsync(
      source,
      /\b(import|export)\s+((?:[^;\n]*?\s+from\s*)?)["']([^"']+)["']/g,
      async (m) => `${m[1]} ${m[2]}${JSON.stringify(await dependency(m[3]!))}`,
    );
    text = await replaceAsync(
      text,
      /\bimport\(\s*["']([^"']+)["']\s*\)/g,
      async (m) => `import(${JSON.stringify(await dependency(m[1]!))})`,
    );
    if (/\bimport\s*\((?!\s*["'])/.test(text) || /\bimport\.meta\b/.test(text))
      throw Error("Page export has an unsupported computed import or import.meta dependency");
    return text;
  };
  const entry = join(root, "index.html");
  const entryPath = await realpath(entry);
  inside(entryPath);
  const entryBytes = await readFile(entryPath);
  const original = entryBytes.toString("utf8");
  validatePageHtml(original, true);
  pin("index.html", entryBytes);
  if (/<(?:base|iframe|object|embed)\b/i.test(original))
    throw Error("Page export has an unsupported base, iframe, object or embed element");
  const needsPe = /<script\b[^>]*\bsrc=["']\/pages\/pe\.js["']/i.test(original);
  const kernelSource = needsPe
    ? /  pe\.kernel = [\s\S]*?\n  };/m.exec(await hostLibrary("/pages/pe.js"))?.[0]
    : "";
  if (needsPe && !kernelSource)
    throw Error("pe.js must expose its presentation kernel for Page export");
  const offline = `(() => {
const exported = JSON.parse(document.getElementById("pe-export").textContent);
const pe = { exported, page: exported.page, doc: exported.document, kitReady: null };
pe.describe = () => {};
pe.target = async (...selector) => {
  if (selector.length) throw Error("An exported snapshot cannot select another document");
  if (!pe.doc) throw Error("This snapshot has no document reading");
  return pe.doc;
};
${kernelSource}
pe.state = async (k) => { k.replay(exported.snapshot === null ? exported.events.map(row => row.event) : [], exported.snapshot ?? k.base); return k; };
window.pe = pe;
})();`;
  let hasKit = false;
  let html = await replaceAsync(
    original,
    /<!--[\s\S]*?-->|<script\b[^>]*>[\s\S]*?<\/script\s*>|<style\b[^>]*>[\s\S]*?<\/style\s*>|<[a-z][^>]*>/gi,
    async (m) => {
      const tag = m[0];
      if (tag.startsWith("<!--")) return tag;
      const attrs = attributes(tag.slice(0, tag.indexOf(">") + 1));
      if (/^<script\b/i.test(tag)) {
        if (Object.hasOwn(attrs, "async") || Object.hasOwn(attrs, "defer"))
          throw Error(
            "Page export has an unsupported async or defer script; execution order must be explicit",
          );
        if (attrs.src === "/pages/pe.js") return `<script>${offline}</script>`;
        const type = attrs.type;
        if (type === "importmap") throw Error("Page export has an unsupported importmap");
        if (type && type !== "module" && !/(?:java|ecma)script/i.test(type)) return tag;
        if (attrs.src?.startsWith("/pages/kit/")) {
          if (attrs.src !== "/pages/kit/pe-kit.js")
            throw Error(`Unsupported kit script: ${attrs.src}`);
          hasKit = true;
          return `<script>${safeScript(await hostLibrary(attrs.src))}</script>`;
        }
        if (attrs.src === "/pages/revit.js")
          return `<script>${safeScript(await hostLibrary(attrs.src))}</script>`;
        const file = attrs.src ? await local(attrs.src, entry) : null;
        const source = file
          ? file.bytes.toString("utf8")
          : tag.slice(tag.indexOf(">") + 1, tag.lastIndexOf("<"));
        return `<script${type === "module" ? ' type="module"' : ""}>${safeScript(await javascript(source, file?.path ?? entry))}</script>`;
      }
      if (/^<style\b/i.test(tag))
        return `<style>${(await css(tag.slice(tag.indexOf(">") + 1, tag.lastIndexOf("<")), entry)).replace(/<\/style/gi, "<\\/style")}</style>`;
      if (/^<link\b/i.test(tag)) {
        if (attrs.rel === "stylesheet" && attrs.href) {
          if (attrs.href.startsWith("/pages/"))
            return `<style>${await hostLibrary(attrs.href)}</style>`;
          const file = await local(attrs.href, entry);
          return `<style>${await css(file.bytes.toString("utf8"), file.path)}</style>`;
        }
        if (attrs.rel === "icon" && attrs.href)
          return tag.replace(attrs.href, await data(attrs.href, entry));
        if (
          ["preload", "modulepreload", "prefetch", "preconnect", "dns-prefetch"].includes(
            attrs.rel ?? "",
          )
        )
          return "";
        throw Error(`Page export has an unsupported link element: ${tag}`);
      }
      if (attrs.srcset)
        throw Error("Page export has an unsupported srcset; use explicit local src assets");
      let result = tag;
      for (const name of ["src", "poster"])
        if (attrs[name]) result = result.replace(attrs[name], await data(attrs[name], entry));
      if (attrs.style) result = result.replace(attrs.style, await css(attrs.style, entry));
      return result;
    },
  );
  // pe.js owns hosted kit loading; the export keeps exactly the same kit bytes inline.
  if (needsPe && !hasKit) {
    const script = await hostLibrary("/pages/kit/pe-kit.js");
    const style = await hostLibrary("/pages/kit/pe-kit.css");
    html = html.replace(
      `<script>${offline}</script>`,
      () =>
        `<script>${offline}</script><style>${style}</style><script>${safeScript(script)}</script>`,
    );
  }
  const provenance = {
    page: input.page,
    exportedAt: input.exportedAt,
    document: input.document,
    snapshot: input.snapshot,
    snapshotSha256: sha(JSON.stringify(input.snapshot)),
    events: input.events,
    files: [...files.values()].sort((a, b) => a.path.localeCompare(b.path)),
  };
  const pinned = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' data:; style-src 'unsafe-inline' data:; img-src data:; font-src data:; media-src data:; connect-src 'none'; form-action 'none'"><script id="pe-export" type="application/json">${safeJson(provenance)}</script>`;
  html = /<head\b[^>]*>/i.test(html)
    ? html.replace(/<head\b[^>]*>/i, (head) => head + pinned)
    : pinned + html;
  const sha256 = sha(html);
  const path = await writeArtifact(root, join(root, ".state", "exports", `${sha256}.html`), html);
  return { html, sha256, path, provenance };
}
