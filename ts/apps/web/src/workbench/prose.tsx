/**
 * Chat and doc prose: the one markdown path. Both the chat and the grounded doc render through
 * `Markdown`: `react-markdown` + GFM + the typography below + two block overrides.
 *
 * A fenced block is a code payload, not prose, so it leaves the typography plugin entirely and
 * becomes `Code`: frame, language, line count, copy, 64 KB gate (ledger, 2026-09-15). That is
 * why `prose-pre:*` is gone from the class list while inline `code` keeps its hairline box.
 * `react-markdown` hands the `pre` override the real `code` element, `language-*` class and all.
 * The fence takes no rehype plugin: its head band is a React component with state (copy flips to
 * "copied", "show all" unlatches the gate). The one plugin splits a turn's linked element ids out
 * of text (never code or links) so each renders as a Subject token.
 */
import ReactMarkdown, { type Components, type ExtraProps } from "react-markdown";
import remarkGfm from "remark-gfm";
import { createContext, isValidElement, memo, useContext, useMemo, type ReactNode } from "react";

import { Code } from "@pe/kit/lang/code";
import { cn } from "@pe/kit/lib/utils";
import { subjectParts, TurnSubjectText, type TurnSubjects } from "./turn-names";

const PROSE_CLASS = [
  "prose min-w-0 max-w-none text-ink [overflow-wrap:anywhere]",
  "prose-pe",
  // `last:prose-p:mb-0` read as "when the PROSE BOX is a last child, kill every paragraph gap" —
  // and the box almost always is one, so the transcript had no paragraph spacing at all. The
  // variant belongs on the paragraph: `prose-p:last:mb-0` is the last paragraph inside the box.
  "prose-p:my-0 prose-p:mb-[0.8em] prose-p:last:mb-0",
  "prose-headings:font-sans prose-headings:text-ink prose-headings:mt-[0.9em] prose-headings:mb-[0.35em]",
  // A list is spaced like the paragraphs around it, not twice as loose: items sit a breath apart.
  "prose-ul:my-[0.6em] prose-ol:my-[0.6em] prose-li:my-[0.2em]",
  "prose-a:underline prose-a:underline-offset-2",
  // A table wears Table's cell grammar; the role lives in lang.css (`.prose-pe table`). It was
  // utilities here, and `prose-thead:on-recess` / `prose-th:t-upper` never rendered (classes, not
  // utilities), so the head had no ground and no case.
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
    <div className="my-[0.8em] max-w-full overflow-x-auto">
      {/* DOMAIN (kept hand table): GFM tables in prose; the markdown renderer owns them. */}
      <table {...props} />
    </div>
  ),
};

type Hast = {
  type: string;
  tagName?: string;
  value?: string;
  children?: Hast[];
  properties?: object;
};
/** Text nodes outside code and links: each linked id becomes a `pe-subject` element. */
const rehypeSubjects = (subjects: TurnSubjects) => () => (tree: Hast) => {
  const walk = (node: Hast) => {
    if (!node.children || ["code", "pre", "a"].includes(node.tagName ?? "")) return;
    node.children = node.children.flatMap((child): Hast[] => {
      if (child.type !== "text") return (walk(child), [child]);
      const parts = subjectParts(child.value ?? "", subjects);
      if (parts.every((part) => typeof part === "string")) return [child];
      return parts.map((part) =>
        typeof part === "string"
          ? { type: "text", value: part }
          : {
              type: "element",
              tagName: "pe-subject",
              properties: { dataId: String(part.id), dataConnector: part.connector },
              children: [],
            },
      );
    });
  };
  walk(tree);
};
const SubjectsOf = createContext<TurnSubjects | undefined>(undefined);
function PeSubject(props: { "data-id"?: string; "data-connector"?: string }) {
  const subject = useContext(SubjectsOf)?.get(Number(props["data-id"]));
  const connector = props["data-connector"];
  return subject ? (
    <TurnSubjectText subject={subject} connector={connector ? Number(connector) : undefined} />
  ) : null;
}
const SUBJECT_COMPONENTS = { ...MARKDOWN_COMPONENTS, "pe-subject": PeSubject } as Components;

// GFM, or pea's tables arrive as a paragraph of pipes. It also buys strikethrough, task lists,
// and bare autolinks.
const REMARK_PLUGINS = [remarkGfm];

export const Markdown = memo(function Markdown({
  text,
  className,
  subjects,
}: {
  text: string;
  className?: string;
  /** A settled chat turn's linked element ids; absent or empty, prose stays plain. */
  subjects?: TurnSubjects;
}) {
  const linked = subjects?.size ? subjects : undefined;
  const rehype = useMemo(() => (linked ? [rehypeSubjects(linked)] : []), [linked]);
  return (
    <div className={cn(PROSE_CLASS, className)}>
      <MarkdownSource.Provider value={text}>
        <SubjectsOf value={linked}>
          <ReactMarkdown
            remarkPlugins={REMARK_PLUGINS}
            rehypePlugins={rehype}
            components={linked ? SUBJECT_COMPONENTS : MARKDOWN_COMPONENTS}
          >
            {text}
          </ReactMarkdown>
        </SubjectsOf>
      </MarkdownSource.Provider>
    </div>
  );
});
