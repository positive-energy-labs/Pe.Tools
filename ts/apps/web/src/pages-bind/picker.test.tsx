// @vitest-environment jsdom
import {
  emptyThreadHead,
  type HarnessThreadSummary,
  type PageTargetReading,
} from "@pe/agent-contracts";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";

vi.mock("#/open/bay", () => ({ useThreadSummaries: () => null }));
vi.mock("#/readings", () => ({
  useInventory: () => ({ state: "absent" }),
  previousOf: () => undefined,
  inventoryOf: () => [],
}));

import { BindPicker } from "./picker";

afterEach(cleanup);

const MODEL = "C:\\Jobs\\Project A MEP.rvt";
const reading: PageTargetReading = {
  page: "page:@pdrop/pages/tour",
  slot: "default",
  binding: { kind: "none" },
  resolution: { kind: "choose", reason: "ambiguous" },
  document: null,
  write: {
    kind: "read",
    refusal: {
      code: "page.unbound",
      door: "/pages/pdrop--tour/act",
      reason: "Refused at /pages/pdrop--tour/act: this Page has no target.",
    },
  },
  hostNow: "2026-10-12T12:00:00.000Z",
};
const thread = (id: string, title: string): HarnessThreadSummary =>
  ({
    id,
    title,
    head: { ...emptyThreadHead, displayLabel: "Project A MEP" },
  }) as HarnessThreadSummary;

test("the picker shows what the host resolved and binds a thread, a pin, or nothing", () => {
  const onBind = vi.fn();
  const screen = render(
    <BindPicker
      slug="pdrop--tour"
      reading={reading}
      threads={[thread("t-duct-1", "Duct loss walk")]}
      documents={[
        {
          title: "Project A MEP",
          address: MODEL,
          revit: "Revit 2025 · pid 10",
          ref: { session: "S", openId: "A" },
        },
        {
          title: "Project1",
          address: null,
          revit: "Revit 2025 · pid 10",
          ref: { session: "S", openId: "B" },
        },
      ]}
      outcome={null}
      onBind={onBind}
    />,
  );
  expect(screen.getByText("Bind page:@pdrop/pages/tour")).toBeTruthy();
  // Two Revits and no binding: the picker says choose, never a document.
  expect(screen.getByText("choose: ambiguous")).toBeTruthy();
  expect(screen.getAllByText("read")).toHaveLength(2); // the Page, and the ungranted thread
  fireEvent.click(screen.getByText("Duct loss walk"));
  expect(onBind).toHaveBeenLastCalledWith({ kind: "thread", thread: "t-duct-1" });
  fireEvent.click(screen.getAllByText("Project A MEP").at(-1)!);
  expect(onBind).toHaveBeenLastCalledWith({ kind: "pinned", address: MODEL });
  // An unsaved document has no Address, so it refuses the pin.
  fireEvent.click(screen.getByText("Project1"));
  expect(onBind).toHaveBeenCalledTimes(2);
});
