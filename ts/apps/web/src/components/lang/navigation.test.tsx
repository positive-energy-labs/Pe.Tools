// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { NavigationItem } from "./navigation";

afterEach(cleanup);

test("thread rows keep title before target, state separate from unread, and real row actions", () => {
  const pick = vi.fn();
  const menu = vi.fn();
  const screen = render(
    <nav data-navigation="">
      <NavigationItem
        id="thread"
        title="Rename sheets"
        target="Model.rvt · Closed document"
        mark={<span>Provider</span>}
        meta="Claude · Opus"
        time="2h"
        state="Waiting for you"
        activity="waiting"
        unread
        compact
        actions={<button>Thread actions</button>}
        onPick={pick}
        onMenu={menu}
        onRename={menu}
      />
    </nav>,
  );
  const row = screen.getByRole("button", { name: /Rename sheets/ });
  expect(row.textContent!.indexOf("Rename sheets")).toBeLessThan(
    row.textContent!.indexOf("Model.rvt"),
  );
  expect(screen.getByRole("img", { name: "Waiting for you" })).toBeTruthy();
  expect(screen.getByRole("img", { name: "unread" })).toBeTruthy();
  expect(screen.container.querySelector('[data-slot="nav-time"]')?.textContent).toBe("2h");
  expect(
    screen.container.querySelector('.dl-row-sub [data-slot="nav-provider"]')?.textContent,
  ).toBe("Provider");
  fireEvent.keyDown(row, { key: "Enter" });
  expect(pick).toHaveBeenCalledOnce();
  fireEvent.keyDown(row, { key: "F10", shiftKey: true });
  expect(menu).toHaveBeenCalledOnce();
  expect(screen.getByRole("button", { name: "Thread actions" })).toBeTruthy();
});

test("untargeted resting threads keep two rows without a fabricated state or target", () => {
  const screen = render(
    <NavigationItem
      id="thread"
      title="Draft a note"
      meta="Codex"
      time="now"
      actions={null}
      onPick={() => {}}
      onMenu={() => {}}
      onRename={() => {}}
    />,
  );
  expect(screen.container.querySelector(".dl-row-sub")?.textContent).toBe("");
  expect(screen.container.querySelector('[data-slot="nav-state"]')).toBeNull();
  expect(screen.container.querySelector(".dl-row")?.getAttribute("data-lines")).toBe("2");
});
