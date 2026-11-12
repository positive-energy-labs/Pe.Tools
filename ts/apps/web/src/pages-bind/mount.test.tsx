// @vitest-environment jsdom
import { oneName } from "#/route/typed-route";
import type { PageTargetReading } from "@pe/agent-contracts";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";

vi.mock("#/open/bay", () => ({ useThreadSummaries: () => null }));
vi.mock("#/host/resource-state", () => ({
  useInventory: () => ({ state: "absent" }),
  previousOf: () => undefined,
  inventoryOf: () => [],
}));

import { BindBody } from "./mount";

afterEach(cleanup);

/**
 * Drive 7, fix line 1: the host names a Page by its key (`page:@<pod>/pages/<page>`), the route by
 * its slug (`<pod>--<page>`). The body compared the two, so a 200 reading never drew.
 */
const reading: PageTargetReading = {
    page: "page:@snowdon-ducts/pages/tour",
    slot: "default",
    binding: { kind: "none" },
    resolution: { kind: "choose", reason: "missing" },
    document: null,
  write: null,
};
const mount = () => {
  const run = vi.fn(async () => reading);
  const ctx = {
    page: { read: () => ({ page: oneName("snowdon-ducts--tour"), view: false, query: {}, fragment: "" }) },
    value: { current: true, value: null },
    write: () => ({ run }),
  };
  return { run, screen: render(<BindBody ctx={ctx as never} />) };
};

test("a pressed reading draws, though the host names the Page by its key", async () => {
  const { screen } = mount();
  fireEvent.click(screen.getByRole("button", { name: "Read current binding" }));
  expect(await screen.findByText("choose: missing")).toBeTruthy();
  expect(screen.queryByText("no reading yet")).toBeNull();
});

test("a chosen Page is read without a press, so a reload shows its binding", async () => {
  const { screen, run } = mount();
  expect(await screen.findByText("choose: missing")).toBeTruthy();
  expect(run).toHaveBeenCalledTimes(1);
});
