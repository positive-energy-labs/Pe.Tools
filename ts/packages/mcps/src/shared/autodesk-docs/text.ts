import { type DefaultTreeAdapterMap, parse } from "parse5";

type Node = DefaultTreeAdapterMap["node"];
type Element = DefaultTreeAdapterMap["element"];

const skipped = new Set(["head", "script", "style", "noscript", "nav", "svg", "iframe", "button"]);
const blocks = new Set([
  "p",
  "div",
  "section",
  "article",
  "ul",
  "ol",
  "table",
  "tr",
  "blockquote",
  "dl",
  "dt",
  "dd",
  "figure",
  "figcaption",
]);

/** Decodes the entities Autodesk snippets and excerpts carry, by round-tripping through the HTML parser. */
export function plainText(html: string): string {
  return htmlToText(`<p>${html}</p>`).replace(/\s+/g, " ").trim();
}

/**
 * HTML to readable text: headings as `#`, list items as `-`, `<pre>` as fenced code (line breaks kept),
 * non-content (head, script, nav) dropped. `root` limits extraction to the first element with that tag.
 */
export function htmlToText(html: string, root: "body" | "article" = "body"): string {
  const document = parse(html);
  const start = findTag(document, root) ?? findTag(document, "body") ?? document;
  const out: string[] = [];
  walk(start, out);
  return out
    .join("")
    .replace(/ /g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function findTag(node: Node, tag: string): Element | null {
  if ("tagName" in node && node.tagName === tag) return node;
  if ("childNodes" in node) {
    for (const child of node.childNodes) {
      const hit = findTag(child, tag);
      if (hit) return hit;
    }
  }
  return null;
}

function rawText(node: Node): string {
  if (node.nodeName === "#text") return (node as DefaultTreeAdapterMap["textNode"]).value;
  if (node.nodeName === "br") return "\n";
  return "childNodes" in node ? node.childNodes.map(rawText).join("") : "";
}

function walk(node: Node, out: string[]): void {
  if (node.nodeName === "#text") {
    out.push((node as DefaultTreeAdapterMap["textNode"]).value.replace(/\s+/g, " "));
    return;
  }
  if (!("tagName" in node)) {
    if ("childNodes" in node) for (const child of node.childNodes) walk(child, out);
    return;
  }
  const tag = node.tagName;
  if (skipped.has(tag)) return;
  if (tag === "pre") {
    const code = rawText(node).replace(/ /g, " ").replace(/\n+$/, "");
    out.push(`\n\n\`\`\`\n${code}\n\`\`\`\n\n`);
    return;
  }
  if (tag === "br") {
    out.push("\n");
    return;
  }
  const heading = /^h([1-6])$/.exec(tag);
  if (heading) out.push(`\n\n${"#".repeat(Number(heading[1]))} `);
  else if (tag === "li") out.push("\n- ");
  else if (tag === "td" || tag === "th") out.push(" | ");
  else if (blocks.has(tag)) out.push("\n\n");
  for (const child of node.childNodes) walk(child, out);
  if (blocks.has(tag) || heading) out.push("\n\n");
}
