// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, test } from "vite-plus/test";

import { Rail } from "./rail";

afterEach(cleanup);

test("the rail's lanes scroll horizontally only, and a head title sits on the rail's line", () => {
  const { container } = render(<Rail lead={<h1 className="t-head">Family</h1>} trail="x" />);
  for (const lane of ["rail-lead", "rail-actions"]) {
    const classes = container.querySelector(`[data-slot="${lane}"]`)!.className.split(" ");
    expect(classes).toContain("overflow-x-auto");
    expect(classes).toContain("overflow-y-hidden");
  }
  const css = readFileSync(join(import.meta.dirname, "../../base.css"), "utf8");
  expect(css).toMatch(/\[data-slot="rail-lead"\] \.t-head \{\s*line-height: var\(--rail-h\);/);
});
