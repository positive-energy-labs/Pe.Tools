// @vitest-environment jsdom
import {
  address,
  emptyThreadHead,
  pageChoiceSchema,
  type HarnessThreadSummary,
  type PageTargetReading,
} from "@pe/agent-contracts";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";

vi.mock("../machine/bay", () => ({ useThreadSummaries: () => null }));
vi.mock("#/host/resource-state", () => ({
  useInventory: () => ({ state: "absent" }),
  previousOf: () => undefined,
  inventoryOf: () => [],
}));

import { BindPicker } from "./bind-picker";

afterEach(cleanup);

test.each(["Chadds_detached.rvt", null])(
  "a detached inventory row (%s) can be picked by lifetime",
  (address) => {
    const onBind = vi.fn();
    const ref = { session: "S", openId: "detached" };
    const screen = render(
      <BindPicker
        slug="pdrop--tour"
        back="/bind"
        reading={null}
        threads={[]}
        documents={[{ title: "Chadds detached", address, ref, revit: "Revit 2025" }]}
        outcome={null}
        onBind={onBind}
      />,
    );
    fireEvent.click(screen.getByText("Chadds detached"));
    expect(onBind).toHaveBeenCalledOnce();
    expect(pageChoiceSchema.parse(onBind.mock.calls[0]![0])).toEqual({ kind: "pinned", ref });
  },
);

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
};
const thread = (id: string, title: string): HarnessThreadSummary =>
  ({
    id,
    title,
    head: {
      ...emptyThreadHead,
      targets: [
        {
          request: { kind: "named", session: "S", address: address(MODEL) },
          label: "Project A MEP",
          admission: null,
        },
      ],
    },
  }) as HarnessThreadSummary;

test("the picker shows what the host resolved and binds a thread, a pin, or nothing", () => {
  const onBind = vi.fn();
  const screen = render(
    <BindPicker
      back="/bind?view=true"
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
  expect(onBind).toHaveBeenLastCalledWith({ kind: "pinned", ref: { session: "S", openId: "A" } });
  // An unsaved document still has an exact lifetime to pin.
  fireEvent.click(screen.getByText("Project1"));
  expect(onBind).toHaveBeenLastCalledWith({ kind: "pinned", ref: { session: "S", openId: "B" } });
});
