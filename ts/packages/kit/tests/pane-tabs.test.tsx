// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { PaneTabs } from "@pe/kit/lang/pane-tabs";

afterEach(cleanup);

test("pane views remain controlled while each choice retains its explanation", async () => {
  const change = vi.fn();
  const options = [
    { value: "threads", label: "Threads", title: "Choose a thread" },
    { value: "world", label: "World", title: "Inspect the thread context" },
  ];
  const screen = render(
    <PaneTabs options={options} value="threads" onChange={change} ariaLabel="View depth" />,
  );
  const world = screen.getByRole("button", { name: "World" });
  fireEvent.click(world);
  expect(change).toHaveBeenCalledWith("world");
  expect(world.getAttribute("aria-pressed")).toBe("false");
  expect(world.hasAttribute("title")).toBe(false);
  fireEvent.keyDown(document.body, { key: "Tab" });
  await act(async () => world.focus());
  expect((await screen.findByRole("tooltip")).textContent).toBe("Inspect the thread context");
  screen.rerender(
    <PaneTabs options={options} value="world" onChange={change} ariaLabel="View depth" />,
  );
  expect(world.getAttribute("aria-pressed")).toBe("true");
});
