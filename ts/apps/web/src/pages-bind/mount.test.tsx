// @vitest-environment jsdom
import { oneName } from "#/route/typed-route";
import type { PageTargetReading } from "@pe/agent-contracts";
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";

vi.mock("../machine/bay", () => ({ useThreadSummaries: () => null }));
const stream = vi.hoisted(() => ({ subscribe: vi.fn() }));
vi.mock("../host/resource-stream", () => ({ peReadings: stream }));
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
  stream.subscribe.mockReset().mockImplementation((_reading: unknown, deliver: (frame: unknown) => void) => {
    deliver({ kind: "snapshot", value: reading });
    return () => {};
  });
  const ctx = {
    page: { read: () => ({ page: oneName("snowdon-ducts--tour"), view: false, query: {}, fragment: "" }) },
    value: { state: "ready", value: null },
    verb: () => ({ run: vi.fn() }),
  };
  return render(<BindBody ctx={ctx as never} />);
};

test("a chosen Page's target draws from its Reading without a press, though the host names the Page by its key", async () => {
  const screen = mount();
  expect(await screen.findByText("choose: missing")).toBeTruthy();
  expect(screen.queryByText("no reading yet")).toBeNull();
  expect(stream.subscribe).toHaveBeenCalledWith({ kind: "page-target", slug: "snowdon-ducts--tour" }, expect.any(Function));
});
