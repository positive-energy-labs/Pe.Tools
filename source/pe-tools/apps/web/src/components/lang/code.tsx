/**
 * CODE — the one read-only highlighted block, and the one editable JSON surface.
 *
 * RULINGS EMBODIED (docs/features/design-system/LEDGER.md, 2026-09-15):
 * - A code block is a MACHINE-OPERATED OBJECT, so it wears `artifactFrameRecipe`: one ground
 *   shift plus one inset hairline, no radius, no shadow. Its head band carries the language on
 *   the left and the machine-measured facts on the right — line count, copy, and "show all".
 * - `Code` owns the height clamp; the container owns show/hide.
 * - `@tanstack/highlight` is the only highlighter. C# is ours because Pods are C# scripts.
 * - One `stringify` lives here, and `Code` takes a string, so the byte count is a fact the
 *   caller can see before it hands the block over.
 *
 * WHY TWO EXPORTS AND NOT ONE `editable` FLAG (ledger line 18): a textarea owns caret,
 * selection, and the native undo stack, and paint is a pure function of a string. One component
 * with a flag would have to own both and would own neither well. `Code` is paint with chrome;
 * `JsonEditor` is paint under a live textarea and nothing else — its callers frame it.
 *
 * ponytail: no virtualization, no folding. Above 64 KB the block stops tokenizing rather than
 * growing a windowing layer; the systemic fix for large tool output is Owed in the ledger.
 */
import { useMemo, useState, type ComponentProps } from "react";
import { useCopy } from "#/lib/use-copy";
import { createHighlighter, type HighlightDecoration } from "@tanstack/highlight/core";
import { css } from "@tanstack/highlight/languages/css";
import { diff } from "@tanstack/highlight/languages/diff";
import { html as htmlLang } from "@tanstack/highlight/languages/html";
import { js } from "@tanstack/highlight/languages/js";
import { json } from "@tanstack/highlight/languages/json";
import { jsx } from "@tanstack/highlight/languages/jsx";
import { markdown } from "@tanstack/highlight/languages/markdown";
import { plaintext } from "@tanstack/highlight/languages/plaintext";
import { python } from "@tanstack/highlight/languages/python";
import { shell } from "@tanstack/highlight/languages/shell";
import { sql } from "@tanstack/highlight/languages/sql";
import { toml } from "@tanstack/highlight/languages/toml";
import { ts } from "@tanstack/highlight/languages/ts";
import { tsx } from "@tanstack/highlight/languages/tsx";
import { yaml } from "@tanstack/highlight/languages/yaml";

import { artifactFrameRecipe } from "#/components/lang/artifact-frame";
import { csharp } from "#/components/lang/csharp-language";
import { Press } from "#/components/lang/press";
import { diagramKind, useDiagram } from "#/components/lang/diagram";

import "./code.css";

export const highlighter = createHighlighter({
  fallbackLanguage: "plaintext",
  languages: [
    json,
    ts,
    tsx,
    js,
    jsx,
    python,
    shell,
    yaml,
    markdown,
    sql,
    htmlLang,
    css,
    diff,
    toml,
    plaintext,
    csharp,
  ],
});

export type { HighlightDecoration };

/** The one pretty-printer. Anything that refuses to serialize still has to render as something. */
export function stringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

/**
 * Does the highlighter hold a grammar for this tag? `normalizeLanguage` is the highlighter's own
 * lookup, but it answers the fallback for anything it does not know, so `rust` and `text` both
 * come back `plaintext`. The fallback's own names settle which of the two was asked for.
 */
const PLAIN_NAMES = new Set([plaintext.name, ...(plaintext.aliases ?? [])]);
function holdsGrammar(tag: string): boolean {
  const name = tag.trim().toLowerCase();
  return highlighter.normalizeLanguage(name) !== plaintext.name || PLAIN_NAMES.has(name);
}

/** Past this many bytes the block shows a slice and never tokenizes; see the header. */
const TOKENIZE_LIMIT = 64 * 1024;

export interface CodeProps {
  code: string;
  /**
   * The payload's own language tag, verbatim — a fence's `csharp` or `text`. The head says it as
   * given. A tag with no grammar renders plain and the head says `no grammar`; no tag at all
   * renders plain and the head says nothing.
   */
  lang?: string;
  /** Head label; falls back to the language. */
  title?: string;
  decorations?: readonly HighlightDecoration[];
  lineNumbers?: boolean;
  /** Default true: cap at 32rem and scroll. `false` lets the block run its full height. */
  clamp?: boolean;
  /**
   * Break long lines instead of scrolling them. Code is `white-space: pre` because a wrapped
   * line lies about where the line ends; prose that happens to be machine output — a stack
   * trace, an error string, a system prompt — has no such structure to protect and reads worse
   * running off the right edge.
   */
  wrap?: boolean;
  tone?: "error";
  /**
   * False while the payload is still arriving (an open markdown fence). A `mermaid` block shows
   * its source until then and never draws a half-written graph.
   */
  complete?: boolean;
}

export function Code({
  code,
  lang,
  title,
  decorations,
  lineNumbers,
  clamp = true,
  wrap,
  tone,
  complete = true,
}: CodeProps) {
  const { copied, copy } = useCopy();
  const [showAll, setShowAll] = useState(false);
  const gated = code.length > TOKENIZE_LIMIT;
  // A `mermaid` block draws once complete, supported, and under the gate; else it is source.
  const mermaid = lang?.trim().toLowerCase() === "mermaid";
  const drawable = mermaid && !gated && diagramKind(code) === "supported";
  const [view, setView] = useState<"diagram" | "source">("diagram");
  const diagram = useDiagram(code, drawable && complete);
  const failed = diagram && "error" in diagram ? diagram.error : undefined;
  const svg = view === "diagram" && diagram && "svg" in diagram ? diagram.svg : undefined;
  const shown = gated && !showAll ? code.slice(0, TOKENIZE_LIMIT) : code;
  const lines = useMemo(() => code.split("\n").length, [code]);

  const html = useMemo(
    () => (gated ? null : highlighter.highlightToHtml(code, { lang, decorations, lineNumbers })),
    [gated, code, lang, decorations, lineNumbers],
  );

  const noGrammar = lang !== undefined && !mermaid && !holdsGrammar(lang);

  const { base, head } = artifactFrameRecipe();
  const body = {
    "data-code-pane": "",
    "data-code-wrap": wrap ? "" : undefined,
    "data-tone": tone === "error" ? "alarm" : undefined,
    className: clamp ? "max-h-[32rem] overflow-auto" : undefined,
  };
  return (
    // A named group: the head's controls and the payload are one object, and the name is what a
    // caller's old `aria-label` said. `title` stays the visible word too — no second label.
    // `not-prose`: a block is often dropped into rendered markdown, and typography's rules —
    // `prose-code:*` above all — would otherwise box the `<code>` inside our `<pre>` as if it
    // were inline code. The frame and `code.css` own every value inside; prose owns none.
    <div className={base({ class: "not-prose" })} role="group" aria-label={title ?? lang ?? "code"}>
      <div className={head()}>
        {(title ?? lang) ? (
          <span className="t-small t-upper text-ink-2">{title ?? lang}</span>
        ) : null}
        {noGrammar ? (
          <span className="t-small face-mono" data-tone="caution">
            no grammar
          </span>
        ) : null}
        {mermaid && complete && !drawable ? (
          <span className="t-small face-mono" data-tone="caution">
            source only
          </span>
        ) : null}
        <span className="ml-auto flex items-baseline gap-2">
          <span className="t-small face-mono tabular-nums text-ink-mute">
            {lines} {lines === 1 ? "line" : "lines"}
          </span>
          {gated && !showAll ? (
            <Press tone="quiet" size="label" onClick={() => setShowAll(true)}>
              show all
            </Press>
          ) : null}
          {failed ? (
            <Press tone="quiet" size="label" title={failed} data-tone="caution" aria-disabled>
              diagram failed
            </Press>
          ) : drawable && complete ? (
            <Press
              tone="quiet"
              size="label"
              onClick={() => setView(view === "diagram" ? "source" : "diagram")}
            >
              {view === "diagram" ? "source" : "diagram"}
            </Press>
          ) : null}
          <Press tone="quiet" size="label" onClick={() => copy(code)}>
            {copied ? "copied" : "copy"}
          </Press>
        </span>
      </div>
      {svg !== undefined ? (
        // eslint-disable-next-line react/no-danger -- sanitized in `diagram.tsx`
        <div {...body} data-diagram="" dangerouslySetInnerHTML={{ __html: svg }} />
      ) : html === null ? (
        <div {...body}>
          <pre className="th-code">{shown}</pre>
        </div>
      ) : (
        // eslint-disable-next-line react/no-danger -- highlighter output, escaped upstream
        <div {...body} dangerouslySetInnerHTML={{ __html: html }} />
      )}
    </div>
  );
}

/**
 * Controlled editor: the highlighted pre is aria-hidden paint and the transparent textarea
 * sits in the same grid cell, sized by the paint. The pane is the one scroller, so the two
 * layers cannot drift. Font metrics MUST match (both inherit the pane's).
 *
 * No head, no frame — see the module header for why this is not `Code` with a flag. A caller
 * that wants the chrome wraps this in `ArtifactFrame` itself.
 */
export function JsonEditor({
  value,
  onChange,
  decorations,
  ...textarea
}: {
  value: string;
  onChange: (next: string) => void;
  decorations?: readonly HighlightDecoration[];
} & Omit<ComponentProps<"textarea">, "value" | "onChange">) {
  const html = useMemo(
    // Trailing newline keeps the pre's height in step while the caret sits on a fresh line.
    () => highlighter.highlightToHtml(value + "\n", { lang: "json", decorations }),
    [value, decorations],
  );

  return (
    <div data-code-pane="" data-code-editor="">
      <div data-code-paint="" aria-hidden dangerouslySetInnerHTML={{ __html: html }} />
      <textarea
        data-code-input=""
        spellCheck={false}
        autoCapitalize="off"
        autoComplete="off"
        wrap="off"
        {...textarea}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          textarea.onKeyDown?.(e);
          if (e.key !== "Tab" || e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;
          e.preventDefault();
          // execCommand keeps the edit on the native undo stack; setting value would not.
          document.execCommand("insertText", false, "  ");
        }}
      />
    </div>
  );
}
