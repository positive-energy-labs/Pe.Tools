// @vitest-environment jsdom
import { oneName } from "#/route/typed-route";
import { routeAddress, type PageTargetReading } from "@pe/agent-contracts";
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

test("the Bind viewer carries the Page query from the shell URL into the iframe", () => {
  const address = routeAddress("bind");
  const link = address.link({ page: oneName("todo"), view: true, query: { walk: "1", x: "2" } });
  const page = address.read(Object.fromEntries(new URL(link, "http://host").searchParams)).page;
  const ctx = {
    page: { read: () => page },
    value: { state: "ready", value: null },
    verb: () => ({ run: vi.fn() }),
  };
  const screen = render(<BindBody ctx={ctx as never} />);
  expect(screen.getByTitle("Page todo").getAttribute("src")).toBe("/pages/todo/?walk=1&x=2");
});

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

/**
 * D9: a top-level Page open lands on view=true, and the Page's refusal says "Bind it from the chip".
 * The viewed Page draws that chip; its link reaches the picker, and the picker links back, both
 * with the Page's query intact. Mutant: drop `<PageBindingChip>` from the view branch of mount.tsx.
 */
test("D9: a viewed unbound Page shows its chip, the chip reaches the picker, and the picker returns with the query", () => {
  stream.subscribe.mockReset().mockImplementation((_reading: unknown, deliver: (frame: unknown) => void) => {
    deliver({ kind: "snapshot", value: { ...reading, write: null } });
    return () => {};
  });
  const address = routeAddress("bind");
  const at = (link: string) => {
    const page = address.read(Object.fromEntries(new URL(link, "http://host").searchParams)).page;
    const ctx = { page: { read: () => page }, value: { state: "ready", value: null }, verb: () => ({ run: vi.fn() }) };
    return render(<BindBody ctx={ctx as never} />);
  };
  const viewed = address.link({ page: oneName("snowdon-ducts--tour"), view: true, query: { walk: "1" }, fragment: "p3" });
  const view = at(viewed);
  expect(view.getByLabelText("Page binding").textContent).toContain("unverified");
  expect(view.queryByTestId("pages-bind")).toBeNull();
  const toPicker = view.getByRole("link", { name: "Bind…" }).getAttribute("href")!;
  cleanup();
  const picker = at(toPicker);
  expect(picker.getByTestId("pages-bind")).toBeTruthy();
  expect(picker.queryByTitle("Page snowdon-ducts--tour")).toBeNull();
  expect(picker.getByRole("link", { name: "Back to the Page" }).getAttribute("href")).toBe(viewed);
});
