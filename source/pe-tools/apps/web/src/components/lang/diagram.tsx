/**
 * DIAGRAM — a `mermaid` fence drawn as an SVG, for `Code` (ledger, 2026-09-16).
 *
 * `beautiful-mermaid` renders without a DOM and takes CSS variable colors (`tokenRef`), so the drawing follows
 * the theme without a re-render. It loads lazily on the first diagram, in its own chunk, and every
 * source is laid out once per page (`cache`). Author `style`/`classDef`/`linkStyle` lines are
 * stripped so a model cannot paint off the house palette. The SVG goes in inline (the `var()`
 * colors need it), so it is sanitized first: no script, no foreignObject, no `on*`, no link that
 * leaves the document.
 *
 * ponytail: renders on the main thread (~45 ms warm for 30-50 nodes, measured). The library is
 * DOM-free, so a Worker is the upgrade if a large MEP graph profiles as jank.
 */
import { useEffect, useState } from "react";
import { tokenRef } from "#/lib/token";

export type DiagramResult = { svg: string } | { error: string };

/** The types `beautiful-mermaid` draws; anything else stays source (`gantt`, `pie`, `mindmap`…). */
const SUPPORTED =
  /^(flowchart|graph|sequenceDiagram|stateDiagram(-v2)?|classDiagram|erDiagram|xychart(-beta)?)\b/;

export function diagramKind(source: string): "supported" | "unsupported" {
  const header = source
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith("%%"));
  return header && SUPPORTED.test(header) ? "supported" : "unsupported";
}

export function stripStyles(source: string): string {
  return source
    .split("\n")
    .filter((line) => !/^\s*(style|classDef|linkStyle)\b/.test(line))
    .join("\n");
}

export function sanitizeSvg(svg: string): string {
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  if (doc.querySelector("parsererror")) throw new Error("The renderer returned invalid SVG");
  for (const element of doc.querySelectorAll("script, foreignObject")) element.remove();
  for (const style of doc.querySelectorAll("style"))
    style.textContent = style.textContent
      ?.replace(/@import url\('https:\/\/fonts\.googleapis\.com\/css2\?family=[^']+'\);\s*/g, "")
      .replace("font-family: 'var(--font-body)',", "font-family: var(--font-body),");
  for (const element of doc.querySelectorAll("*")) {
    // `attributes` is live: copy it, or removing one skips the next.
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      const href = name === "href" || name.endsWith(":href");
      if (name.startsWith("on") || (href && !attribute.value.trim().startsWith("#")))
        element.removeAttribute(attribute.name);
    }
  }
  return new XMLSerializer().serializeToString(doc.documentElement);
}

// Every role is a house token, so light and dark follow the page with no re-render.
export const diagramColors = () => ({
  bg: tokenRef("artifact"),
  fg: tokenRef("ink"),
  line: tokenRef("line-2"),
  accent: tokenRef("pea"),
  muted: tokenRef("ink-2"),
  surface: tokenRef("recess"),
  border: tokenRef("line-2"),
  font: "var(--font-body)",
  transparent: true,
});

const cache = new Map<string, DiagramResult>();
let renderer: Promise<typeof import("beautiful-mermaid")> | undefined;

async function renderDiagram(source: string): Promise<DiagramResult> {
  const hit = cache.get(source);
  if (hit) return hit;
  let result: DiagramResult;
  try {
    const { renderMermaidSVG } = await (renderer ??= import("beautiful-mermaid"));
    result = { svg: sanitizeSvg(renderMermaidSVG(stripStyles(source), diagramColors())) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    result = { error: message.split("\n")[0] || "The diagram could not be drawn" };
  }
  cache.set(source, result);
  return result;
}

/** The drawing for `source`, once `enabled`; undefined while it renders. Never throws. */
export function useDiagram(source: string, enabled: boolean): DiagramResult | undefined {
  const [state, setState] = useState<{ source: string; result: DiagramResult }>();
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    void renderDiagram(source).then((result) => {
      if (live) setState({ source, result });
    });
    return () => {
      live = false;
    };
  }, [source, enabled]);
  if (!enabled) return undefined;
  return state?.source === source ? state.result : cache.get(source);
}
