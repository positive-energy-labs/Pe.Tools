// @vitest-environment jsdom
import { oneName } from "#/route/typed-route";
import { routeAddress, type PageTargetReading } from "@pe/agent-contracts";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { workFingerprintSchema } from "@pe/agent-contracts";
import { mountTypedRoute } from "../shell/typed-mount";
import { module as bindRoute } from "./route";
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

/**
 * D9 on the live lane (drive f1/A): the chip's link drops `view=false` (a default), and a Place reads
 * an absent key from its memory, so inside the viewed Page the href alone settles on view=true again.
 * This mounts the real route over the real /bind search with the Place remembering view=true.
 * Mutant: drop `onBind` from the chip in mount.tsx (the click then only follows the href).
 */
test("D9: from a real /bind?view=true Place that remembers view=true, one chip click draws the picker with the query intact", () => {
  stream.subscribe.mockReset().mockImplementation(() => () => {});
  const link = routeAddress("bind").link({ page: oneName("pdrop--tour"), view: true, query: { walk: "1" } });
  let search = new URL(link, "http://host").searchParams;
  const listeners = new Set<() => void>();
  const go = (next: URLSearchParams) => { search = new URLSearchParams(next); listeners.forEach((l) => l()); };
  let remembered: unknown = {};
  const mount = mountTypedRoute(bindRoute, {
    address: { read: () => new URLSearchParams(search), write: go, subscribe: (l: () => void) => (listeners.add(l), () => listeners.delete(l)) },
    fixture: null, target: { kind: "host" }, work: { address: null, open: null }, custody: { current: () => true },
    memory: () => remembered,
  } as never, workFingerprintSchema.parse(`builtin-closure:${"a".repeat(64)}`), { sources: {} });
  // The pane's context, with the mount's own Page port; the picker read is not under test.
  const ctxOf = () => ({ page: mount.page, value: { state: "ready", value: null }, verb: () => ({ run: vi.fn() }) });
  try {
    remembered = ctxOf().page.read(); // the Place's memory of the viewed Page
    const view = render(<BindBody ctx={ctxOf() as never} />);
    const chip = view.getByRole("link", { name: "Bind…" });
    // The cause, held: the href alone, followed in this Place, reads view=true back from memory.
    go(new URL(chip.getAttribute("href")!, "http://host").searchParams);
    expect(ctxOf().page.read().view).toBe(true);
    fireEvent.click(chip);
    expect(search.get("view")).toBe("false");
    expect(ctxOf().page.read()).toMatchObject({ view: false, query: { walk: "1" } });
    view.rerender(<BindBody ctx={ctxOf() as never} />);
    expect(view.getByTestId("pages-bind")).toBeTruthy();
    expect(view.queryByTitle("Page pdrop--tour")).toBeNull();
  } finally { mount.dispose(); }
});
