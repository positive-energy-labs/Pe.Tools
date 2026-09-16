// @vitest-environment jsdom
import { TextMessagePartProvider } from "@assistant-ui/react";
import { MarkdownTextPrimitive } from "@assistant-ui/react-markdown";
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, test } from "vite-plus/test";

import { CHAT_MARKDOWN_COMPONENTS, PROSE_CLASS } from "#/workbench/prose";

afterEach(cleanup);

/** Exactly what `workbench/aui.tsx`'s `MarkdownText` renders, inside the part context it reads. */
function chat(text: string) {
  return render(
    <TextMessagePartProvider text={text}>
      <MarkdownTextPrimitive className={PROSE_CLASS} components={CHAT_MARKDOWN_COMPONENTS} />
    </TextMessagePartProvider>,
  );
}

const FENCE = "```";

test("a chat fence keeps its tag all the way to the highlighter", () => {
  const { container } = chat(`${FENCE}csharp\npublic class Door { }\n${FENCE}\n`);
  const block = container.querySelector(".th-code--csharp");
  expect(block, container.innerHTML).toBeTruthy();
  expect(block?.querySelector(".th-keyword")).toBeTruthy();
});

// The head says the fence's own tag, never a language nobody asked for.
const head = (container: HTMLElement) =>
  container.querySelector("[role='group'] > div")?.textContent ?? "";

test("a `text` fence names itself and renders plain without a warning", () => {
  const { container } = chat(`${FENCE}text\nplain words\n${FENCE}\n`);
  expect(head(container)).toMatch(/^text/);
  expect(head(container)).not.toContain("no grammar");
  expect(container.querySelector("[data-code-pane] [class*='th-token']")).toBe(null);
});

test("a tag the highlighter has no grammar for names itself and says so", () => {
  const { container } = chat(`${FENCE}rust\nfn main() {}\n${FENCE}\n`);
  expect(head(container)).toMatch(/^rust/);
  const warning = container.querySelector("[data-tone='caution']");
  expect(warning?.textContent).toBe("no grammar");
  expect(container.querySelector(".th-code--plaintext")).toBeTruthy();
});

test("an untagged fence says nothing about language", () => {
  const { container } = chat(`${FENCE}\nno tag here\n${FENCE}\n`);
  expect(head(container)).toMatch(/^1 lines/);
  expect(head(container)).not.toContain("no grammar");
  expect(head(container)).not.toContain("unknown");
  expect(head(container)).not.toContain("plaintext");
});
