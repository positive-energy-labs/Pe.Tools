// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";

// The real renderer runs in jsdom (it touches no DOM). One source is made to throw, so the
// failure path is exercised without depending on which input the library happens to reject.
vi.mock("beautiful-mermaid", async (importOriginal) => {
  const real = await importOriginal<typeof import("beautiful-mermaid")>();
  return {
    ...real,
    renderMermaidSVG: (text: string, options: unknown) => {
      if (text.includes("BOOM")) throw new Error("Parse error on line 2\nmore detail");
      return real.renderMermaidSVG(text, options as never);
    },
  };
});

import { Code } from "#/components/lang/code";
import { diagramColors, diagramKind, sanitizeSvg, stripStyles } from "#/components/lang/diagram";
import { renderMermaidSVG } from "beautiful-mermaid";

afterEach(cleanup);

test("the sanitizer keeps the drawing and drops every live part", () => {
  const hostile = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" onload="alert(1)">
    <script>alert(2)</script>
    <foreignObject><div xmlns="http://www.w3.org/1999/xhtml" onclick="alert(3)">x</div></foreignObject>
    <a href="javascript:alert(4)"><text onmouseover="alert(5)">A</text></a>
    <a xlink:href="https://evil.example/"><rect width="1" height="1"/></a>
    <use href="#node-1"/>
    <g fill="currentColor"><rect id="node-1" width="2" height="2"/></g>
  </svg>`;
  const clean = sanitizeSvg(hostile);
  expect(clean).not.toMatch(/script|foreignObject|onload|onclick|onmouseover|javascript|evil/i);
  expect(clean).toContain('href="#node-1"');
  expect(clean).toContain('fill="currentColor"');
  expect(clean).toContain("<text");
});

test("style directives are stripped so a diagram stays on the house palette", () => {
  const source = [
    "flowchart TD",
    "  A --> B",
    "  style A fill:inherit",
    "  classDef hot fill:inherit",
    "  linkStyle 0 stroke:inherit",
    "  class A hot",
  ].join("\n");
  expect(stripStyles(source)).toBe(["flowchart TD", "  A --> B", "  class A hot"].join("\n"));
});

test("only the diagram types the renderer supports are drawn", () => {
  expect(diagramKind("%% note\n\nflowchart LR\n A-->B")).toBe("supported");
  expect(diagramKind("graph TD\n A-->B")).toBe("supported");
  expect(diagramKind("sequenceDiagram\n A->>B: hi")).toBe("supported");
  expect(diagramKind("stateDiagram-v2\n [*] --> A")).toBe("supported");
  for (const header of ["gantt", "pie title x", "mindmap", "timeline", "journey"])
    expect(diagramKind(`${header}\n  x`)).toBe("unsupported");
});

const FLOW = "flowchart LR\n  AHU --> Main --> VAV";

test("generated diagrams keep theme fonts without requesting Google Fonts", () => {
  for (const source of [FLOW, "classDiagram\n  class AHU {\n    +start()\n  }"]) {
    const svg = sanitizeSvg(renderMermaidSVG(source, diagramColors()));
    expect(svg).not.toContain("fonts.googleapis.com");
    expect(svg).toContain("font-family: 'var(--font-body)', system-ui, sans-serif");
  }
});

test("a mermaid block draws by default, toggles to its source, and copies the source", async () => {
  const writeText = vi.fn(async () => undefined);
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  const { container } = render(<Code code={FLOW} lang="mermaid" />);
  await waitFor(() => expect(container.querySelector("[data-diagram] svg")).toBeTruthy());
  expect(container.querySelector("[data-diagram] svg")?.outerHTML).toContain(diagramColors().fg);
  expect(screen.getByText("2 lines")).toBeTruthy();
  expect(container.textContent).not.toContain("no grammar");

  fireEvent.click(screen.getByRole("button", { name: "source" }));
  expect(container.querySelector("[data-diagram]")).toBe(null);
  expect(container.querySelector("pre")?.textContent).toBe(FLOW);
  fireEvent.click(screen.getByRole("button", { name: "copy" }));
  expect(writeText).toHaveBeenCalledWith(FLOW);
  fireEvent.click(screen.getByRole("button", { name: "diagram" }));
  expect(container.querySelector("[data-diagram] svg")).toBeTruthy();
});

test("an open fence shows its source and never draws", async () => {
  const { container } = render(<Code code={FLOW} lang="mermaid" complete={false} />);
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(container.querySelector("[data-diagram]")).toBe(null);
  expect(container.querySelector("pre")?.textContent).toBe(FLOW);
  expect(screen.queryByRole("button", { name: "source" })).toBe(null);
});

test("an unsupported type is source only, in the caution voice", () => {
  const { container } = render(<Code code={'pie title Airflow\n  "A": 1'} lang="mermaid" />);
  const tag = screen.getByText("source only");
  expect(tag.getAttribute("data-tone")).toBe("caution");
  expect(container.querySelector("[data-diagram]")).toBe(null);
});

test("a block past the 64 KB gate is source only", () => {
  const big = `flowchart TD\n${"  A --> B\n".repeat(7000)}`;
  render(<Code code={big} lang="mermaid" />);
  expect(screen.getByText("source only")).toBeTruthy();
});

test("an invalid closed fence collapses to its head until show source is pressed", async () => {
  const { container } = render(<Code code={"flowchart TD\n  BOOM --> A"} lang="mermaid" />);
  const invalid = await screen.findByText("invalid diagram");
  expect(invalid.getAttribute("title")).toBe("Parse error on line 2");
  expect(invalid.getAttribute("data-tone")).toBe("caution");
  expect(screen.getByText("2 lines")).toBeTruthy();
  expect(screen.getByRole("button", { name: "copy" })).toBeTruthy();
  expect(container.querySelector("[data-code-pane]")).toBe(null);

  fireEvent.click(screen.getByRole("button", { name: "show source" }));
  expect(container.querySelector("[data-diagram]")).toBe(null);
  expect(container.querySelector("pre")?.textContent).toContain("BOOM");
  fireEvent.click(screen.getByRole("button", { name: "hide source" }));
  expect(container.querySelector("[data-code-pane]")).toBe(null);
});
