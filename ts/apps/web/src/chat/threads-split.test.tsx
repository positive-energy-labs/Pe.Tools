// @vitest-environment jsdom
import { useMemo, useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { createGraphMount, GraphRouteView } from "#/shell/mount";
import type { GraphLayoutState } from "../../../../packages/kit/src/components/lang/graph-layout";
import { chatGraph } from "./graph";
const owners: { dispose(): void }[] = [];
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
  for (const owner of owners.splice(0)) owner.dispose();
  vi.restoreAllMocks();
});

function Dock() {
  const [panes, onChange] = useState<GraphLayoutState>({});
  const graph = useMemo(() => chatGraph(() => ({ thread: "t" }), 643), []);
  const adapters = useMemo(
    () => ({
      sources: Object.fromEntries(
        Object.keys(graph.readings).map((id) => [id, { kind: "use" as const, open: () => {} }]),
      ),
      bodies: {
        threads: () => (
          <nav aria-label="Threads">
            <div role="option" aria-selected={false} onClick={() => onChange({})}>
              Office model
            </div>
          </nav>
        ),
        chat: () => <input aria-label="draft" defaultValue="kept" />,
      },
    }),
    [graph],
  );
  const owner = useMemo(() => {
    const owner = createGraphMount(graph, {
      ...adapters,
      getSnapshot: () => ({ target: { kind: "host" }, work: null }),
      subscribe: () => () => {},
      subscribeAcceptedDeltas: () => () => {},
      write: async () => {
        throw Error("No Work");
      },
    });
    owners.push(owner);
    return owner;
  }, [graph, adapters]);
  return (
    <GraphRouteView
      graph={graph}
      adapters={adapters}
      owner={owner}
      hidden={false}
      current={() => true}
      hosted
      situation={null}
      device={{ panes, onChange }}
      status={{
        resolution: { kind: "resolved", target: { kind: "host" } },
        bindingLost: null,
        targetProvenance: { source: "none" },
        closed: false,
        unreadable: false,
        failure: null,
      }}
    />
  );
}

test("under both floors, threads and chat trade one rail while retaining the draft", () => {
  render(<Dock />);
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
