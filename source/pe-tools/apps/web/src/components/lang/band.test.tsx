// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";

import { ReviewActions, type ReviewCell } from "#/components/lang/band";
import type { ScheduleGridState } from "#/route/schedules/workspace";
import { ScheduleGridReview } from "#/workbench/plugins/schedule-grid-chat-plugin";

afterEach(cleanup);

const verbs = (cell: ReviewCell) => {
  render(
    <ReviewActions
      address="a"
      cell={cell}
      onAccept={vi.fn()}
      onDeny={vi.fn()}
      onUnstage={vi.fn()}
    />,
  );
  return screen.queryAllByRole("button").map((button) => button.textContent);
};

test("an open proposal takes accept and deny", () => {
  expect(verbs({ proposal: { value: "10in", by: "pea" }, staged: null })).toEqual([
    "accept",
    "deny",
  ]);
});

test("a contested cell takes accept, deny and unstage", () => {
  expect(
    verbs({
      proposal: { value: "Neck Width + 5in", by: "pea" },
      staged: { value: "Neck Width + 6in" },
    }),
  ).toEqual(["accept", "deny", "unstage"]);
});

test("a staged cell that agrees with Pea takes unstage only, compared as canonical JSON", () => {
  expect(
    verbs({ proposal: { value: { w: 10, h: 8 }, by: "pea" }, staged: { value: { h: 8, w: 10 } } }),
  ).toEqual(["unstage"]);
});

test("unstage on the schedule-grid review clears staged through the consumer's apply", () => {
  const apply = vi.fn<ScheduleGridState["apply"]>(async () => null);
  const state = {
    slice: {
      cells: { "1::2": { proposal: { value: "180 VA", by: "pea" }, staged: { value: "180 VA" } } },
    },
    revision: 3,
    apply,
    busy: null,
    failure: null,
    snapshot: null,
    execute: vi.fn(async () => null),
    blockedBecause: null,
  } as unknown as ScheduleGridState;
  render(<ScheduleGridReview state={state} />);

  fireEvent.click(screen.getByRole("button", { name: "unstage" }));

  expect(apply).toHaveBeenCalledWith([{ path: ["cells", "1::2", "staged"] }]);
  expect(screen.queryByRole("button", { name: "accept" })).toBeNull();
});
