// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, test } from "vite-plus/test";
import { Legend } from "@pe/kit/lang/legend";

afterEach(cleanup);

test("a ramp is its swatches with a break under each seam and both ends", () => {
  const view = render(
    <Legend
      label="Velocity"
      unit="fpm"
      ramp={{
        steps: [
          { key: "a", ink: "red" },
          { key: "b", ink: "blue" },
        ],
        breaks: ["0", "800", "2100"],
      }}
    />,
  );
  expect(view.container.querySelectorAll("[data-legend-band] span").length).toBe(2);
  expect(view.container.textContent).toContain("Velocity, fpm");
  for (const text of ["0", "800", "2100"]) expect(view.container.textContent).toContain(text);
});

test("rows carry a count each, and a missing value is a row, never left out", () => {
  const stroke = { ink: "black", width: 2 };
  const view = render(
    <Legend
      label="Health"
      rows={[{ key: "ok", stroke, word: "clean", count: 41 }]}
      missing={{ key: "missing", stroke, word: "no value", count: 2 }}
    />,
  );
  expect(view.container.querySelector("[data-bin=ok]")!.textContent).toContain("41");
  expect(view.container.querySelector("[data-bin=missing]")!.textContent).toContain("no value");
});

test("with no reading it says so instead of drawing an empty key", () => {
  const view = render(<Legend label="none" plain="pick a reading" />);
  expect(view.container.textContent).toContain("pick a reading");
});
