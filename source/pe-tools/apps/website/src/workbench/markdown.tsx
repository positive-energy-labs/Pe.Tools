import { Fragment } from "react";

type MarkdownBlock =
  | { kind: "heading"; level: 2 | 3; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; items: string[] }
  | { kind: "code"; text: string };

type InlineToken =
  | { kind: "text"; text: string }
  | { kind: "strong"; text: string }
  | { kind: "code"; text: string }
  | { kind: "link"; text: string; href: string };

export function Markdown({ text }: { text: string }) {
  return (
    <div className="mg-prose">
      {markdownBlocks(text).map((block, index) => {
        switch (block.kind) {
          case "heading": {
            const Heading = block.level === 2 ? "h2" : "h3";
            return (
              <Heading key={index}>
                <Inline text={block.text} />
              </Heading>
            );
          }
          case "list":
            return (
              <ul key={index}>
                {block.items.map((item, itemIndex) => (
                  <li key={itemIndex}>
                    <Inline text={item} />
                  </li>
                ))}
              </ul>
            );
          case "code":
            return <pre key={index}>{block.text}</pre>;
          case "paragraph":
            return (
              <p key={index}>
                <Inline text={block.text} />
              </p>
            );
        }
      })}
    </div>
  );
}

function Inline({ text }: { text: string }) {
  return (
    <>
      {inlineTokens(text).map((token, index) => {
        switch (token.kind) {
          case "strong":
            return <strong key={index}>{token.text}</strong>;
          case "code":
            return <code key={index}>{token.text}</code>;
          case "link":
            return (
              <a href={token.href} key={index} rel="noreferrer" target="_blank">
                {token.text}
              </a>
            );
          case "text":
            return <Fragment key={index}>{token.text}</Fragment>;
        }
      })}
    </>
  );
}

function markdownBlocks(text: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let paragraph: string[] = [];
  let list: string[] = [];
  let code: string[] | undefined;

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    blocks.push({ kind: "paragraph", text: paragraph.join(" ").trim() });
    paragraph = [];
  };
  const flushList = () => {
    if (list.length === 0) return;
    blocks.push({ kind: "list", items: list });
    list = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (code) {
      if (line.trim().startsWith("```")) {
        blocks.push({ kind: "code", text: code.join("\n") });
        code = undefined;
      } else {
        code.push(rawLine);
      }
      continue;
    }
    if (line.trim().startsWith("```")) {
      flushParagraph();
      flushList();
      code = [];
      continue;
    }
    if (line.trim() === "") {
      flushParagraph();
      flushList();
      continue;
    }

    const heading = /^(#{2,3})\s+(.+)$/.exec(line);
    if (heading) {
      flushParagraph();
      flushList();
      blocks.push({
        kind: "heading",
        level: heading[1].length === 2 ? 2 : 3,
        text: heading[2].trim(),
      });
      continue;
    }

    const listItem = /^[-*]\s+(.+)$/.exec(line.trim());
    if (listItem) {
      flushParagraph();
      list.push(listItem[1].trim());
      continue;
    }

    flushList();
    paragraph.push(line.trim());
  }

  if (code) blocks.push({ kind: "code", text: code.join("\n") });
  flushParagraph();
  flushList();
  return blocks;
}

function inlineTokens(text: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  const pattern = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\[[^\]]+\]\([^)]+\))/g;
  let lastIndex = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index === undefined) continue;
    if (match.index > lastIndex) {
      tokens.push({ kind: "text", text: text.slice(lastIndex, match.index) });
    }
    const value = match[0];
    if (value.startsWith("`")) {
      tokens.push({ kind: "code", text: value.slice(1, -1) });
    } else if (value.startsWith("**")) {
      tokens.push({ kind: "strong", text: value.slice(2, -2) });
    } else {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(value);
      tokens.push(
        link ? { kind: "link", text: link[1], href: link[2] } : { kind: "text", text: value },
      );
    }
    lastIndex = match.index + value.length;
  }
  if (lastIndex < text.length) tokens.push({ kind: "text", text: text.slice(lastIndex) });
  return tokens;
}
