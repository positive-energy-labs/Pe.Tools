import { Script } from "node:vm";
import { parse, parseFragment, type DefaultTreeAdapterMap } from "parse5";
export { artifactRelative, writeArtifact } from "@pe/host-internal/write-artifact";
export { sha256Hex } from "@pe/host-contracts/kinds";

/** Served Page files and exported data URLs name media the same way. */
export const PAGE_MEDIA: Record<string, string> = {
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
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".mp4": "video/mp4",
  ".mp3": "audio/mpeg",
};

/** Validate without executing or reserializing authored bytes. Modules remain browser-checked. */
export function validatePageHtml(html: string, fragment = false) {
  const errors: string[] = [];
  const document = (fragment ? parseFragment : parse)(html, {
    onParseError: (error) => errors.push(error.code),
  });
  if (errors.length) throw Error(`Invalid HTML: ${errors.join(", ")}`);
  if (/\/\*pe:[^*]+\*\/\s*null\b/.test(html)) throw Error("Unfilled pe.js slot in Page HTML");
  const javascript = (source: string, what: string) => {
    try {
      new Script(source);
    } catch (error) {
      throw Error(`Invalid ${what} JavaScript: ${(error as Error).message}`);
    }
  };
  const visit = (node: DefaultTreeAdapterMap["node"]) => {
    if ("tagName" in node) {
      const type = node.attrs.find((attribute) => attribute.name === "type")?.value ?? "";
      if (
        node.tagName === "script" &&
        !node.attrs.some((a) => a.name === "src") &&
        ["", "text/javascript", "application/javascript"].includes(type)
      )
        javascript(
          node.childNodes.map((child) => ("value" in child ? child.value : "")).join(""),
          "inline",
        );
      for (const attribute of node.attrs.filter((a) => a.name.startsWith("on")))
        javascript(`(function(event){${attribute.value}\n})`, "handler");
    }
    if ("childNodes" in node) for (const child of node.childNodes) visit(child);
  };
  visit(document);
}
