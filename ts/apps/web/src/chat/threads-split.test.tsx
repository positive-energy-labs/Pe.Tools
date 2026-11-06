// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { GraphLayoutView } from "../../../../packages/kit/src/components/lang/graph-layout";
import type { GraphLayoutState } from "../../../../packages/kit/src/components/lang/graph-layout";
import { RouterContextProvider, createRouter, createMemoryHistory } from "@tanstack/react-router";
import { Route as rootRoute } from "../routes/__root";
import { chatData } from "./graph";
vi.mock("../routes/__root", async () => {
  const { createRootRoute } = await import("@tanstack/react-router");
  return { Route: createRootRoute() };
});

vi.mock("#/navigation/surface-host", () => ({ useSurfaceHost: () => ({ surface: "web" }) }));

beforeEach(() => {
  // Comfort tokens, so Pea's floor reads 643px as in the app.
  const root = document.documentElement.style;
  root.setProperty("--gutter", "8px");
  root.setProperty("--type-prose-size", "13px");
  root.setProperty("--control-h", "24px");
  // Pea's surface at 1400x900 with the tools open: 683px (round 7's measured width).
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 0, 683, 800),
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function Dock() {
  const [panes, onChange] = useState<GraphLayoutState>({});
  return (
    <GraphLayoutView
      layout={{ ...chatData.layout, minOtherSize: 643 }}
      panes={{
        threads: { ...chatData.panes.threads, verbs: [], draws: [] },
        chat: { ...chatData.panes.chat, verbs: [], draws: [] },
      }}
      active={() => true}
      state={{ panes, onChange }}
      bodies={{
        threads: (pane) =>
          pane(
            <nav aria-label="Threads">
              <div role="option" aria-selected={false} onClick={() => onChange({})}>
                Office model
              </div>
            </nav>,
          ),
        chat: (pane) => pane(<input aria-label="draft" defaultValue="kept" />),
      }}
    />
  );
}

test("under both floors, threads and chat trade one rail while retaining the draft", async () => {
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  render(
    <RouterContextProvider router={router}>
      <Dock />
    </RouterContextProvider>,
  );
  const draft = screen.getByRole("textbox", { name: "draft" });
  fireEvent.change(draft, { target: { value: "unsent" } });
  fireEvent.click(screen.getByRole("button", { name: "Expand threads" }));
  const office = screen.getByRole("option", { name: "Office model" });
  expect(draft.closest(".hidden")).toBeTruthy();
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Expand chat" }));
  expect(screen.getByRole("textbox", { name: "draft" })).toBe(draft);
  expect((draft as HTMLInputElement).value).toBe("unsent");
  expect(office.closest(".hidden")).toBeTruthy();
  expect(screen.queryByRole("option", { name: "Office model" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Expand threads" }));
  fireEvent.click(screen.getByRole("option", { name: "Office model" }));
  expect(draft.closest(".hidden")).toBeNull();
  expect(office.closest(".hidden")).toBeTruthy();
});
