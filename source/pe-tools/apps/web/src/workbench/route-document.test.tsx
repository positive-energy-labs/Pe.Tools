// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { address } from "@pe/agent-contracts";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";

const router = vi.hoisted(() => ({ href: "/settings?thread=thread-1&source=fixture#fields" }));

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    useLocation: (options?: { select?: (location: { href: string }) => unknown }) =>
      options?.select?.({ href: router.href }) ?? { href: router.href },
  };
});

import {
  RouteDocumentPicker,
  RouteDocumentSurface,
  routeDocumentAddress,
  routeDocumentChoices,
  routeDocumentSearch,
  routeDocumentTabHref,
} from "./route-document";
import type { SessionFacts } from "#/host/target";

const session = (id: string, title: string, at: string): SessionFacts => ({
  sessionId: id,
  sdkSessionId: id,
  processId: 25,
  lane: "dev",
  custody: "controlled",
  activeDocumentId: at,
  activeDocumentTitle: title,
  openDocumentCount: 1,
});

afterEach(cleanup);

describe("route document choice", () => {
  it("handles zero, one, and two open documents", () => {
    const one = routeDocumentChoices([session("pe.app-25", "project-a", "C:\\Models\\projectA.rvt")]);
    const two = routeDocumentChoices([
      session("pe.app-25", "project-a", "C:\\Models\\projectA.rvt"),
      session("pe.app-26", "Tower", "C:\\Models\\Tower.rvt"),
    ]);

    expect(routeDocumentAddress([], null)).toBeNull();
    expect(routeDocumentAddress(one, null)).toBe(address("C:\\Models\\projectA.rvt"));
    expect(routeDocumentAddress(two, null)).toBeNull();

    const pick = vi.fn();
    render(<RouteDocumentPicker choices={two} onPick={pick} />);
    fireEvent.click(screen.getByRole("button", { name: "pe.app-26 · Tower" }));
    expect(pick).toHaveBeenCalledWith(address("C:\\Models\\Tower.rvt"));
  });

  it("opens the exact route and Address in a new tab", () => {
    const at = address("C:\\Models\\projectA.rvt");
    render(<RouteDocumentSurface at={at}>route body</RouteDocumentSurface>);

    const link = screen.getByRole("link", { name: "open in another tab" });
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(link.getAttribute("href")).toBe(routeDocumentTabHref(router.href, at));

    const opened = new URL(link.getAttribute("href")!, "http://localhost");
    expect(opened.pathname).toBe("/settings");
    expect(opened.searchParams.get("thread")).toBe("thread-1");
    expect(opened.searchParams.get("source")).toBe("fixture");
    expect(opened.searchParams.get("doc")).toBe(at);
    expect(opened.hash).toBe("#fields");
  });

  it("loads only an available validated URL Address", () => {
    const at = address("C:\\Models\\projectA.rvt");
    const choices = routeDocumentChoices([session("pe.app-25", "project-a", at)]);
    const loaded = routeDocumentSearch({ doc: at }).doc;
    expect(routeDocumentAddress(choices, null, loaded)).toBe(at);

    expect(
      routeDocumentAddress(choices, null, routeDocumentSearch({ doc: "observed" }).doc),
    ).toBeNull();
    expect(
      routeDocumentAddress(
        choices,
        null,
        routeDocumentSearch({ doc: "C:\\Models\\Unavailable.rvt" }).doc,
      ),
    ).toBeNull();
  });

  it("inherits root doc search through a validating child route", async () => {
    const at = address("C:\\Models\\projectA.rvt");
    const root = createRootRoute({ validateSearch: routeDocumentSearch });
    const child = createRoute({
      getParentRoute: () => root,
      path: "child",
      validateSearch: (search: Record<string, unknown>) => ({
        thread: typeof search.thread === "string" ? search.thread : undefined,
      }),
    });
    const childRouter = createRouter({
      routeTree: root.addChildren([child]),
      history: createMemoryHistory({
        initialEntries: [`/child?thread=thread-1&doc=${encodeURIComponent(at)}`],
      }),
    });

    await childRouter.load();

    expect(childRouter.state.location.search).toEqual({ doc: at, thread: "thread-1" });
    expect(
      routeDocumentAddress(
        routeDocumentChoices([session("pe.app-25", "project-a", at)]),
        null,
        (childRouter.state.location.search as { doc?: ReturnType<typeof address> }).doc,
      ),
    ).toBe(at);
  });
});
