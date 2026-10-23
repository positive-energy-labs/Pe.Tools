// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, expect, test } from "vite-plus/test";
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { useRouteSearchSlice } from "./activity";

afterEach(cleanup);

test("URL field subscribers ignore selection writes and still follow their own fields and Back", async () => {
  let targetRenders = 0;
  function Target() {
    const target = useRouteSearchSlice((search) => search.target);
    targetRenders++;
    return <output data-testid="target">{target}</output>;
  }
  function Selection() {
    const selected = useRouteSearchSlice((search) => search.selected);
    return <output data-testid="selected">{String(selected ?? "")}</output>;
  }
  const route = createRootRoute({ component: () => <><Target /><Selection /></>, validateSearch: (search) => search });
  const history = createMemoryHistory({ initialEntries: ["/?target=A"] });
  const router = createRouter({ routeTree: route, history });
  const view = render(<RouterProvider router={router} />);
  await waitFor(() => expect(view.getByTestId("target").textContent).toBe("A"));
  const before = targetRenders;
  await act(() => router.navigate({ to: "/", search: { target: "A", selected: "42" } } as never));
  await waitFor(() => expect(view.getByTestId("selected").textContent).toBe("42"));
  expect(targetRenders).toBe(before);
  await act(() => router.navigate({ to: "/", search: { target: "B", selected: "42" } } as never));
  await waitFor(() => expect(view.getByTestId("target").textContent).toBe("B"));
  act(() => history.back());
  await waitFor(() => expect(view.getByTestId("target").textContent).toBe("A"));
});
