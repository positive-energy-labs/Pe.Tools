/**
 * Chat and doc prose: the typography of rendered markdown, and the two fenced-block overrides.
 *
 * A fenced block is a code payload, not prose, so it leaves the typography plugin entirely and
 * becomes `Code` — frame, language, line count, copy, 64 KB gate (ledger, 2026-09-15). That is
 * why `prose-pre:*` is gone from the class list while inline `code` keeps its hairline box.
 *
 * TWO RENDERERS, TWO SEAMS. `react-markdown` (the grounded doc) hands a `pre` override the real
 * `code` element, `language-*` class and all, so the doc path overrides `pre`. assistant-ui's
 * `MarkdownTextPrimitive` (chat) does not: its `CodeOverride` reads the language itself and then
 * renders `SyntaxHighlighter` with a rebuilt `code` whose props carry no className, so a `pre`
 * override there always saw an untagged block and every chat fence rendered as plaintext
 * (found in the browser, 2026-09-16). Chat therefore overrides `SyntaxHighlighter`, which is
 * handed the language directly. Neither path uses the rehype plugin: the head band is a React
 * component with state (copy flips to "copied", "show all" unlatches the gate).
 */
import type { MarkdownTextPrimitiveProps } from "@assistant-ui/react-markdown";
import type { Components } from "react-markdown";
import { isValidElement, type ComponentProps, type ReactNode } from "react";

import { Code } from "#/components/lang/code";

export const PROSE_CLASS = [
  "prose max-w-none text-ink",
  "prose-pe",
  "prose-p:my-0 prose-p:mb-[0.45em] last:prose-p:mb-0",
  "prose-headings:font-sans prose-headings:text-ink prose-headings:mt-[0.9em] prose-headings:mb-[0.35em]",
  "prose-a:underline prose-a:underline-offset-2",
  "prose-code:rounded-none prose-code:border-[0.5px] prose-code:border-line prose-code:px-[5px] prose-code:py-px",
  "prose-code:before:content-none prose-code:after:content-none",
  // A table wears MasterTable's cell grammar (see master-table-header.tsx / master-table-body.tsx):
  // `border-separate` + per-cell `border-l`/`first:border-l-0` so no edge doubles, the recess
  // ground and small-caps under the head, hairline row rules, tabular figures. GFM's own
  // `text-align` lands as an inline style and still wins, so a `---:` column stays right-aligned.
  "prose-table:my-2 prose-table:w-full prose-table:border-separate prose-table:border-spacing-0",
  "prose-table:border-[0.5px] prose-table:border-line prose-table:t-small",
  "prose-thead:on-recess",
  "prose-th:t-small prose-th:t-upper prose-th:border-b prose-th:border-l prose-th:border-line",
  "prose-th:px-2 prose-th:py-1 prose-th:text-left prose-th:font-normal prose-th:text-ink",
  "prose-th:first:border-l-0",
  "prose-td:hairline-b-inset prose-td:border-l prose-td:border-line prose-td:first:border-l-0",
  "prose-td:px-2 prose-td:py-1 prose-td:tabular-nums",
  "prose-tr:last:[&_td]:border-b-0",
].join(" ");

/** Flatten the `code` child's children — markdown gives text nodes, streaming gives several. */
function codeText(node: ReactNode): string {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(codeText).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return codeText(node.props.children);
  return "";
}

/** `react-markdown` only — see the header for why chat cannot use this. */
export const REACT_MARKDOWN_COMPONENTS: Components = {
  pre: ({ children }) => {
    const code = isValidElement<{ className?: string; children?: ReactNode }>(children)
      ? children
      : undefined;
    const lang = /language-([\w#+-]+)/.exec(code?.props.className ?? "")?.[1];
    // The trailing newline every fence carries is the fence's, not the payload's.
    return <Code code={codeText(children).replace(/\n$/, "")} lang={lang} />;
  },
};

/** assistant-ui only. It says `"unknown"` for an untagged fence; `Code` wants no tag at all. */
export const CHAT_MARKDOWN_COMPONENTS: MarkdownTextPrimitiveProps["components"] = {
  // A table is the one block that can be wider than the lane. It gets its own scroll box so it
  // scrolls inside the message instead of widening the chat column.
  table: ({ node: _node, ...props }: ComponentProps<"table"> & { node?: unknown }) => (
    <div className="my-2 max-w-full overflow-x-auto">
      <table {...props} />
    </div>
  ),
  SyntaxHighlighter: ({ language, code }) => (
    // The trailing newline every fence carries is the fence's, not the payload's.
    <Code code={code.replace(/\n$/, "")} lang={language === "unknown" ? undefined : language} />
  ),
};
