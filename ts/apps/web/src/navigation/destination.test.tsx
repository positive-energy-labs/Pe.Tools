// @vitest-environment jsdom
/** Tool entry carries the selected conversation; only a conversation link names its own. */
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
  type AnyRouter,
} from "@tanstack/react-router";
import { useDestination } from "./state";

vi.mock("./surface-host", () => ({ useSurfaceHost: () => ({ surface: "web" }) }));
afterEach(cleanup);

async function at(entry: string) {
  let go: ((destination: string) => boolean) | null = null;
  const root = createRootRoute({
    component: () => {
      go = useDestination();
      return null;
    },
  });
  const router: AnyRouter = createRouter({
    routeTree: root.addChildren(
      ["/pea", "/ducts"].map((path) => createRoute({ getParentRoute: () => root, path })),
    ),
    history: createMemoryHistory({ initialEntries: [entry] }),
  });
  await router.load();
  render(<RouterProvider router={router} />);
  const open = async (destination: string) => {
    await act(async () => void go!(destination));
    return router.state.location.search as Record<string, unknown>;
  };
  return open;
}

test("a directory tool link keeps the selected chat", async () => {
  const open = await at("/pea?thread=T");
  expect(await open("/ducts?target=C%3A%2FModels%2FOffice.rvt")).toEqual({
    thread: "T",
    target: "C:/Models/Office.rvt",
  });
});

test("a tool destination keeps structured and numeric route values", async () => {
  const open = await at("/pea?thread=T");
  const fan = { kind: "some", keys: ["MUAS-1 50%@2", "8081605"] };
  const query = new URLSearchParams({ fan: JSON.stringify(fan), contextRadiusFt: "15" });
  expect(await open(`/ducts?${query}`)).toEqual({ thread: "T", fan, contextRadiusFt: 15 });
});

test("with no chat selected a tool link adds no thread and infers no target", async () => {
  const open = await at("/pea");
  expect(await open("/ducts")).toEqual({});
});

test("an explicit conversation link selects its own thread", async () => {
  const open = await at("/ducts?thread=T");
  expect(await open("/pea?thread=U")).toEqual({ thread: "U" });
});
