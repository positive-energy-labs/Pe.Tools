// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vite-plus/test";
import type { FittingGroup } from "./fitting-groups.ts";
import { FittingReadouts } from "./fitting-readouts.tsx";

afterEach(cleanup);

it.each([
  { losses: [0.1, null], lossInWg: 0.1, text: "0.1000 in-wg partial", tone: "caution" },
  { losses: [0.1, 0.2], lossInWg: 0.3, text: "0.3000 in-wg", tone: null },
  { losses: [null, null], lossInWg: null, text: "— in-wg", tone: null },
])("qualifies the loss cell for $losses", ({ losses, lossInWg, text, tone }) => {
  const group: FittingGroup = {
    key: "rule:elbow",
    kind: "rule",
    title: "Elbows",
    reach: "every elbow",
    table: "CD3-1",
    tableMeaning: "Elbow",
    source: "default",
    choices: [],
    clear: null,
    members: losses.map((loss, i) => ({
      key: String(i),
      subject: [],
      ids: [],
      lossInWg: loss,
      note: loss == null ? "not priced" : null,
    })),
    lossInWg,
    unpriced: losses.filter((loss) => loss == null).length,
  };
  const { container } = render(
    <FittingReadouts groups={[group]} ductsHref="/ducts" waiting={null} />,
  );
  const cell = container.querySelector('[data-fitting-group="rule:elbow"] > .face-mono')!;
  expect(cell.textContent).toBe(text);
  expect(cell.querySelector('[data-tone="caution"]')?.getAttribute("data-tone") ?? null).toBe(tone);
});
