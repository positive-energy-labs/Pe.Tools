// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
