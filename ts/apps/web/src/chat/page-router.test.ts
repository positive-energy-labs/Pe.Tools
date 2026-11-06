// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vite-plus/test";
import { createMemoryHistory } from "@tanstack/react-router";
import { getRouter } from "../router";
import { threadIdentity } from "./graph";
vi.mock("../routes/__root", async () => {
  const { createRootRoute, Outlet } = await import("@tanstack/react-router");
  return { Route: createRootRoute({ component: Outlet }) };
});
afterEach(() => vi.unstubAllGlobals());
test.each(["all", JSON.stringify([{ kind: "thread", id: threadIdentity("first")! }])])(
  "Pea's router retains admitted selection while navigating mode, prompt and turn (%s)",
  async (selected) => {
    vi.stubGlobal("scrollTo", vi.fn());
    const router = getRouter();
    router.update({
      history: createMemoryHistory({
        initialEntries: [
          `/pea?thread=t&selected=${encodeURIComponent(selected)}&prompt=hello&turn=2`,
        ],
      }),
    });
    await router.load();
    const match = router.state.matches.find((match) => match.routeId === "/pea");
    expect(match?.status).toBe("success");
    const location = router.buildLocation({
      to: "/pea",
      search: (previous) => ({ ...previous, mode: "world" }),
    });
    const search = new URLSearchParams(location.searchStr);
    const value = search.get("selected")!;
    expect(value === "all" ? value : JSON.stringify(JSON.parse(value))).toBe(selected);
    expect(search.get("thread")).toBe("t");
    expect(search.get("prompt")).toBe("hello");
    expect(search.get("turn")).toBe("2");
  },
);
