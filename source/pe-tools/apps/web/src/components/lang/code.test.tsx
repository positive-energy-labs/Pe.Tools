// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vite-plus/test";

import { Code, highlighter, stringify } from "#/components/lang/code";

afterEach(cleanup);

test("csharp tokenizes a Pod-shaped method into its five roles", () => {
  // The spec line, plus one carrying the literals C# has and JS does not.
  const code = [
    "public async Task<Element> Get(string id) => await _db.Find(id); // note",
    'var path = @"C:\\pods"; var greet = $"hi {id}";',
  ].join("\n");
  const classes = new Set(
    highlighter.tokenize(code, { lang: "cs" }).tokens.map((token) => token.className),
  );
  for (const role of ["keyword", "type", "function", "string", "comment"]) {
    expect(classes.has(role as never), `${role} missing from ${[...classes].join(", ")}`).toBe(
      true,
    );
  }
});

test("a block past the tokenize gate renders plain and offers show all", () => {
  const big = `{"pad":"${"x".repeat(70 * 1024)}"}`;
  const { container } = render(<Code code={big} lang="json" />);
  expect(container.querySelector("span[class*='th-']")).toBe(null);
  expect(container.querySelector("pre")?.textContent?.length).toBe(64 * 1024);
  expect(screen.getByRole("button", { name: "show all" })).toBeTruthy();
});

test("wrap is opt-in, so code keeps its line structure by default", () => {
  const { container, rerender } = render(<Code code="x" lang="plaintext" />);
  expect(container.querySelector("[data-code-wrap]")).toBe(null);
  rerender(<Code code="x" lang="plaintext" wrap />);
  expect(container.querySelector("[data-code-wrap]")).toBeTruthy();
});

test("stringify survives a value JSON refuses", () => {
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  expect(() => stringify(circular)).not.toThrow();
  expect(stringify({ a: 1 })).toBe('{\n  "a": 1\n}');
});
