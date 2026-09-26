// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, it } from "vite-plus/test";
import { partitionReviewSchema } from "@pe/agent-contracts";
import { PartitionReview } from "#/takeoff/partition-review";

afterEach(cleanup);

const square = (x: number, y: number, s: number): [number, number][] => [
  [x, y],
  [x + s, y],
  [x + s, y + s],
  [x, y + s],
];

it("keeps holes, dispositions and reasons through selection, flagging and export", () => {
  const data = partitionReviewSchema.parse({
    source: { runId: "unchanged", documentKey: "doc", zoneKey: "scope" },
    zone: { key: "zone", name: "zone", loops: [] },
    shapes: [
      {
        id: "R01",
        kind: "room",
        disposition: "accepted",
        sqft: 10,
        label: [2, 2],
        loops: [square(0, 0, 5)],
      },
      {
        id: "R02",
        kind: "room",
        disposition: "held",
        reason: "too-small",
        sqft: 0.24,
        label: [3, 3],
        loops: [square(0.123456789, 0, 5), square(1, 1, 1)],
      },
      {
        id: "R03",
        kind: "room",
        disposition: null,
        sqft: 2,
        label: null,
        loops: [square(0, 0, 5)],
      },
      {
        id: "R04",
        kind: "residue",
        disposition: "void",
        reason: "low-headroom",
        sqft: 0.4,
        label: [1, 1],
        loops: [square(1, 1, 1)],
      },
      {
        id: "R05",
        kind: "residue",
        disposition: "excluded",
        reason: "outside",
        sqft: 1,
        label: [2, 2],
        loops: [square(2, 2, 1)],
      },
    ],
  });
  function Review() {
    const [flags, setFlags] = useState<string[]>([]);
    return (
      <PartitionReview
        review={{ zone: "zone", data, flags, source: "fresh solver" }}
        onFlag={(key) => setFlags(flags.includes(key) ? [] : [key])}
      />
    );
  }
  render(<Review />);
  for (const label of [
    /accepted R01/,
    /held R02 · 0.24 sf · too-small/,
    /unknown R03/,
    /void R04 .* low-headroom/,
    /excluded R05 .* outside/,
  ])
    expect(screen.getAllByRole("button", { name: label }).length).toBeGreaterThan(0);
  const held = screen
    .getAllByRole("button", { name: /held R02.*too-small/ })
    .find((el) => el.tagName === "path")!;
  expect(held.getAttribute("d")?.match(/Z/g)).toHaveLength(2);
  fireEvent.keyDown(held, { key: "Enter" });
  expect(held.getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(screen.getByRole("button", { name: "flag R04" }));
  expect(screen.getByRole("button", { name: "unflag R04" })).toBeTruthy();
  const link = screen.getByRole("link", { name: "export review JSON" });
  const exported = JSON.parse(
    decodeURIComponent(link.getAttribute("href")!.split(",").slice(1).join(",")),
  );
  expect(exported).toEqual({ ...data, flags: ["residue:R04"] });
});
