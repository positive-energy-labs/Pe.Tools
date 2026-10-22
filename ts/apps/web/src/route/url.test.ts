// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { createElement } from "react";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import { z } from "zod";
import { routePageSchema } from "@pe/agent-contracts";
import { peReadings } from "#/readings";
import { defineRoute, type RouteManifest } from "./manifest";
import type { RouteHandle } from "./handle";
import { urlPage } from "./url";
import { useRoute } from "./use-route";

const manifest = defineRoute({
  key: "t",
  name: "T",
  page: z.intersection(
    z.object({ stage: z.enum(["a", "b"]).default("a"), epoch: z.number().default(0) }),
    z.object({ selected: z.string().default(""), layers: z.array(z.string()).default([]) }),
  ),
  url: ["stage", "selected", "layers"],
});
const url = urlPage(manifest)!;

describe("urlPage", () => {
  test("reads the address through the page schema: numbers back to strings, lists split, bad values to default", () => {
    expect(url.read({ selected: 8081605, layers: "a,b", stage: "zzz", epoch: 9 })).toEqual({
      stage: "a",
      selected: "8081605",
      layers: ["a", "b"],
    });
    expect(url.read({})).toEqual({ stage: "a", selected: "", layers: [] });
  });

  test("writes only the url keys, lists joined", () => {
    expect(url.write({ stage: "b", selected: "x", layers: ["a", "b"], epoch: 3 })).toEqual({
      stage: "b",
      selected: "x",
      layers: "a,b",
    });
  });

  test("the middleware keeps a bare URL bare", () => {
    const [strip] = url.middlewares;
    const search = { stage: "a", selected: "", layers: "", target: "x" };
    expect(strip!({ search, next: (s: unknown) => s } as never)).toEqual({ target: "x" });
  });

  test("a url key without a default is refused at definition", () => {
    expect(() =>
      urlPage(defineRoute({ key: "u", name: "U", page: z.object({ q: z.string() }), url: ["q"] })),
    ).toThrow(/needs a default/);
    expect(urlPage(defineRoute({ key: "v", name: "V" }))).toBeNull();
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** Mounts `useRoute(manifest)` under a memory router; `move` sets the Page and lets the address follow. */
async function mount<P>(manifest: RouteManifest<unknown, string, P, string>) {
  vi.spyOn(peReadings, "subscribe").mockImplementation(() => () => {});
  let handle: RouteHandle<unknown, string, P, string> | null = null;
  const history = createMemoryHistory({ initialEntries: ["/"] });
  const router = createRouter({
    routeTree: createRootRoute({
      component: () => {
        handle = useRoute(manifest as never) as never;
        return null;
      },
    }),
    history,
  });
  await router.load();
  render(createElement(RouterProvider, { router } as never));
  const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 10)));
  await settle();
  const move = async (next: Partial<P>, history?: "push" | "replace") => {
    act(() => handle!.page[1](next, history ? { history } : undefined));
    await settle();
  };
  return { history, router, move };
}

describe("useUrlPage history", () => {
  test("a gesture replaces its entry; a named move pushes one", async () => {
    const view = defineRoute({
      key: "h",
      name: "H",
      page: z.object({ viewport: z.string().default("plane:1,0,0") }),
      url: ["viewport"],
    });
    const { history, router, move } = await mount<{ viewport: string }>(view);
    const before = history.length;
    await move({ viewport: "plane:1.1,0,0" }, "replace");
    await move({ viewport: "plane:1.2,0,0" }, "replace");
    expect(history.length).toBe(before);
    expect(router.state.location.search).toMatchObject({ viewport: "plane:1.2,0,0" });
    await move({ viewport: "plane:2,0,0" });
    expect(history.length).toBe(before + 1);
    expect(router.state.location.search).toMatchObject({ viewport: "plane:2,0,0" });
  });

  test("a contract route moves history by each field's class unless the move overrides it", async () => {
    const rooms = defineRoute({
      key: "rooms",
      name: "Rooms",
      address: "rooms",
      page: routePageSchema("rooms").extend({ epoch: z.number().default(0) }),
    });
    type Page = { stage: string; focus: string; epoch: number };
    const { history, router, move } = await mount<Page>(rooms as never);
    const before = history.length;
    await move({ focus: "R1" }); // focus is a tweak: replace
    await move({ focus: "R1,R2" });
    expect(history.length).toBe(before);
    await move({ epoch: 1 }); // Page-only: no entry
    expect(history.length).toBe(before);
    await move({ stage: "review" }); // stage is a step: push
    expect(history.length).toBe(before + 1);
    await move({ focus: "R3" }, "push"); // a named move overrides the tweak
    expect(history.length).toBe(before + 2);
    await move({ stage: "history" }, "replace"); // a gesture overrides the step
    expect(history.length).toBe(before + 2);
    expect(router.state.location.search).toMatchObject({ stage: "history", focus: "R3" });
    await move({ stage: "partition", focus: "" }); // defaults leave the address bare
    expect(router.state.location.search).not.toHaveProperty("stage");
    expect(router.state.location.search).not.toHaveProperty("focus");
  });
});
