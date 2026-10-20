// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vite-plus/test";
import { Inbox, type InboxGroupSpec } from "@pe/kit/lang/inbox";

afterEach(cleanup);
const order = ["fix", "set", "diagnostics"] as const;
const row = (key: string, extra = {}) => ({
  key,
  title: `title ${key}`,
  status: `status ${key}`,
  ...extra,
});
const groups = (over: Partial<Record<(typeof order)[number], InboxGroupSpec>> = {}) => ({
  diagnostics: {
    label: "Diagnostics",
    rows: [row("d1"), row("d2")],
    collapsible: true,
    defaultCollapsed: true,
  },
  fix: { label: "Fix", rows: [row("f1")] },
  set: { label: "Set", rows: [] },
  ...over,
});
const heads = (container: HTMLElement) =>
  [...container.querySelectorAll("[data-inbox-group]")].map((g) => g.getAttribute("data-inbox-group"));

test("group heads draw in the fixed order, an empty group draws nothing", () => {
  const { container } = render(
    <Inbox aria-label="inbox" order={order} groups={groups()} empty="nothing" />,
  );
  expect(heads(container)).toEqual(["fix", "diagnostics"]);
  expect(screen.getByText("title f1")).toBeTruthy();
});

test("a collapsible group folds to its head and count, and opens on a press", () => {
  const { container } = render(
    <Inbox aria-label="inbox" order={order} groups={groups()} empty="nothing" />,
  );
  expect(screen.queryByText("title d1")).toBeNull();
  const diag = container.querySelector('[data-inbox-group="diagnostics"] [role="button"]')!;
  expect(diag.textContent).toContain("Diagnostics");
  expect(diag.textContent).toContain("2");
  fireEvent.click(diag);
  expect(screen.getByText("title d1")).toBeTruthy();
  fireEvent.click(diag);
  expect(screen.queryByText("title d1")).toBeNull();
});

test("a row with detail opens in place; a row without is a plain pick", () => {
  let picked = 0;
  render(
    <Inbox
      aria-label="inbox"
      order={order}
      groups={groups({
        fix: {
          label: "Fix",
          rows: [row("f1", { detail: <p>why</p>, onClick: () => picked++ }), row("f2")],
        },
      })}
      empty="nothing"
    />,
  );
  expect(screen.queryByText("why")).toBeNull();
  fireEvent.click(screen.getByText("title f1"));
  expect(screen.getByText("why")).toBeTruthy();
  expect(picked).toBe(1);
  fireEvent.click(screen.getByText("title f1"));
  expect(screen.queryByText("why")).toBeNull();
  fireEvent.click(screen.getByText("title f2"));
  expect(screen.queryByText("why")).toBeNull();
});

test("a group marked always draws with no rows, and with nothing at all the inbox says so", () => {
  const { container, rerender } = render(
    <Inbox
      aria-label="inbox"
      order={order}
      groups={{ set: { label: "Set", rows: [], always: true } }}
      empty="nothing"
    />,
  );
  expect(heads(container)).toEqual(["set"]);
  rerender(<Inbox aria-label="inbox" order={order} groups={{}} empty="nothing here" />);
  expect(screen.getByText("nothing here")).toBeTruthy();
});
