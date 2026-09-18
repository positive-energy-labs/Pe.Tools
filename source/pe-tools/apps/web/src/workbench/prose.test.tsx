// @vitest-environment jsdom
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, expect, test } from "vite-plus/test";

import { Markdown, fenceClosed } from "#/workbench/prose";

afterEach(cleanup);

/** The one markdown path, exactly as chat and the grounded doc render it. */
function chat(text: string) {
  return render(<Markdown text={text} />);
}

const FENCE = "```";

test("a fence keeps its tag all the way to the highlighter", () => {
  const { container } = chat(`${FENCE}csharp\npublic class Door { }\n${FENCE}\n`);
  const block = container.querySelector(".th-code--csharp");
  expect(block, container.innerHTML).toBeTruthy();
  expect(block?.querySelector(".th-keyword")).toBeTruthy();
  // Typography must not reach inside: `prose-code:*` boxed the block's own `<code>` in chat.
  expect(block?.closest("[role='group']")?.classList.contains("not-prose")).toBe(true);
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
  expect(head(container)).toMatch(/^1 line(?!s)/);
  expect(head(container)).not.toContain("no grammar");
  expect(head(container)).not.toContain("unknown");
  expect(head(container)).not.toContain("plaintext");
});

test("a `c#` fence arrives with its whole tag", () => {
  const { container } = chat(`${FENCE}c#\nvar door = 1;\n${FENCE}\n`);
  expect(head(container)).toMatch(/^c#/);
});

test("a wide table scrolls inside its own box", () => {
  const { container } = chat("| a | b |\n|---|---|\n| 1 | 2 |\n");
  expect(container.querySelector("div.overflow-x-auto > table")).toBeTruthy();
});

test("a fence is closed only when its own closing fence is in the source", () => {
  expect(fenceClosed("```mermaid\nflowchart TD\n  A --> B\n```")).toBe(true);
  expect(fenceClosed("```mermaid\nflowchart TD\n  A --> B")).toBe(false);
  expect(fenceClosed("```mermaid\nflowchart TD\n  A --> B\n``")).toBe(false);
  expect(fenceClosed("```mermaid")).toBe(false);
  expect(fenceClosed("````mermaid\n```\nstill inside\n````")).toBe(true);
  expect(fenceClosed("````mermaid\nA\n```")).toBe(false);
  expect(fenceClosed("~~~mermaid\nA\n~~~")).toBe(true);
  expect(fenceClosed("~~~mermaid\nA\n```")).toBe(false);
  expect(fenceClosed("  ```mermaid\n  A\n  ```  ")).toBe(true);
});

test("a streaming mermaid fence stays source until it closes", async () => {
  const open = "Here:\n\n```mermaid\nflowchart LR\n  AHU --> Main";
  const { container, rerender } = render(<Markdown text={open} />);
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(container.querySelector("[data-diagram]")).toBe(null);
  expect(container.querySelector("pre")?.textContent).toContain("AHU --> Main");
  rerender(<Markdown text={`${open}\n\`\`\`\n\nDone.`} />);
  await waitFor(() => expect(container.querySelector("[data-diagram] svg")).toBeTruthy());
});
