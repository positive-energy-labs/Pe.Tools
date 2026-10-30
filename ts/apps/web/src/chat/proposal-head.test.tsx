// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";

import { ProposalHead, type HeadWork } from "./proposal-head";

afterEach(cleanup);

const stagedRule = { edit: { value: { table: "CD3-2" } } } as never;

function work(over: Partial<HeadWork> = {}): HeadWork {
  return {
    id: "ducts:rules",
    route: "Ducts",
    subject: "loss rules",
    cells: { "elbow-1d-le10": stagedRule, "tap-std": stagedRule },
    wire: { segment: "rules", revision: 26, write: vi.fn(async () => null) } as never,
    groupOf: (key) => [key],
    commit: { word: "open", run: () => {} },
    open: () => {},
    ...over,
  };
}

test("review on a edit cell opens the route on that cell and the group reads in words", () => {
  const open = vi.fn();
  render(
    <ProposalHead
      asks={[]}
      works={[
        work({
          open,
          label: (group) => (group === "elbow-1d-le10" ? "Round Elbow 1 D · D ≤ 10 in" : group),
        }),
      ]}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /^review/ }));
  expect(screen.getByText("Round Elbow 1 D · D ≤ 10 in")).toBeTruthy();
  expect(screen.queryByText("elbow-1d-le10")).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: "review Round Elbow 1 D · D ≤ 10 in in Ducts" }),
  );
  expect(open).toHaveBeenCalledWith("elbow-1d-le10");
});

test("review separates every group level and acts only on the chosen type", async () => {
  const write = vi.fn(async () => null);
  const open = vi.fn();
  const family = "Broan_B210E75RT_ERV";
  render(
    <ProposalHead
      asks={[]}
      works={[
        work({
          route: "Families",
          cells: {
            small: { suggestion: { value: "small model" } },
            large: { suggestion: { value: "large model" } },
          },
          groupOf: (key) => [family, key === "small" ? "Small" : "Large"],
          wire: { segment: "edits", revision: 7, write },
          open,
        }),
      ]}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /^review/ }));
  expect(screen.getByText(`${family} · Small`)).toBeTruthy();
  expect(screen.getByText(`${family} · Large`)).toBeTruthy();
  fireEvent.click(screen.getAllByRole("button", { name: "accept 1" })[0]!);
  await waitFor(() => expect(write).toHaveBeenCalledOnce());
  expect(write).toHaveBeenCalledWith(
    [
      { path: ["edits", "large", "edit"], value: { value: "large model" } },
      { path: ["edits", "large", "suggestion"], value: null },
    ],
    7,
  );
  fireEvent.click(screen.getByRole("button", { name: `review ${family} · Small in Families` }));
  expect(open).toHaveBeenCalledWith("small");
});
