/**
 * Chat and doc prose: the one markdown path. Both the chat and the grounded doc render through
 * `Markdown`: `react-markdown` + GFM + the typography below + two block overrides.
 *
 * A fenced block is a code payload, not prose, so it leaves the typography plugin entirely and
 * becomes `Code`: frame, language, line count, copy, 64 KB gate (ledger, 2026-09-15). That is
 * why `prose-pre:*` is gone from the class list while inline `code` keeps its hairline box.
 * `react-markdown` hands the `pre` override the real `code` element, `language-*` class and all.
 * No rehype plugin: the head band is a React component with state (copy flips to "copied",
 * "show all" unlatches the gate).
 */
import ReactMarkdown, { type Components, type ExtraProps } from "react-markdown";
import remarkGfm from "remark-gfm";
import { createContext, isValidElement, memo, useContext, type ReactNode } from "react";

import { Code } from "#/components/lang/code";
import { cn } from "#/lib/utils";

const PROSE_CLASS = [
  "prose min-w-0 max-w-none text-ink [overflow-wrap:anywhere]",
  "prose-pe",
  // `last:prose-p:mb-0` read as "when the PROSE BOX is a last child, kill every paragraph gap" —
  // and the box almost always is one, so the transcript had no paragraph spacing at all. The
  // variant belongs on the paragraph: `prose-p:last:mb-0` is the last paragraph inside the box.
  "prose-p:my-0 prose-p:mb-[0.8em] prose-p:last:mb-0",
  "prose-headings:font-sans prose-headings:text-ink prose-headings:mt-[0.9em] prose-headings:mb-[0.35em]",
  "prose-a:underline prose-a:underline-offset-2",
  "prose-code:rounded-none prose-code:border-[0.5px] prose-code:border-line prose-code:px-[5px] prose-code:py-px",
  "prose-code:before:content-none prose-code:after:content-none",
  // A table wears Table's cell grammar (see master-table-header.tsx / master-table-body.tsx):
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

/**
 * Is this fence finished? Decided from the fence's own raw text (its markdown node's span): the
 * last line must be a closing run of the opener's character, at least as long. While a message
 * streams, the fence under the cursor has no such line yet.
 */
function fenceClosed(raw: string): boolean {
  const lines = raw.trimEnd().split("\n");
  const opener = /^\s*(`{3,}|~{3,})/.exec(lines[0] ?? "")?.[1];
  if (!opener || lines.length < 2) return false;
  const closer = lines.at(-1)!.trim();
  return closer.length >= opener.length && closer === opener[0]!.repeat(closer.length);
}

/** The markdown source being rendered, so a fence can find its own raw text by offset. */
const MarkdownSource = createContext("");

function FencedBlock({ node, children }: { children?: ReactNode } & ExtraProps) {
  const source = useContext(MarkdownSource);
  const code = isValidElement<{ className?: string; children?: ReactNode }>(children)
    ? children
    : undefined;
  const lang = /language-([\w#+-]+)/.exec(code?.props.className ?? "")?.[1];
  const start = node?.position?.start.offset;
  const end = node?.position?.end.offset;
  const complete =
    start === undefined || end === undefined || fenceClosed(source.slice(start, end));
  // The trailing newline every fence carries is the fence's, not the payload's.
  return <Code code={codeText(children).replace(/\n$/, "")} lang={lang} complete={complete} />;
}

const MARKDOWN_COMPONENTS: Components = {
  pre: FencedBlock,
  // A table is the one block that can be wider than the lane. It gets its own scroll box so it
  // scrolls inside the message instead of widening the chat column.
  table: ({ node: _node, ...props }) => (
    <div className="my-2 max-w-full overflow-x-auto">
      {/* DOMAIN (kept hand table): GFM tables in prose; the markdown renderer owns them. */}
      <table {...props} />
    </div>
  ),
};

// GFM, or pea's tables arrive as a paragraph of pipes. It also buys strikethrough, task lists,
// and bare autolinks.
const REMARK_PLUGINS = [remarkGfm];

export const Markdown = memo(function Markdown({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  return (
    <div className={cn(PROSE_CLASS, className)}>
      <MarkdownSource.Provider value={text}>
        <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={MARKDOWN_COMPONENTS}>
          {text}
        </ReactMarkdown>
      </MarkdownSource.Provider>
    </div>
  );
});
