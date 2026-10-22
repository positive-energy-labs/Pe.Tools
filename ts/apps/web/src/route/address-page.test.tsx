// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { afterEach, expect, test } from "vite-plus/test";
import { routeAddress } from "@pe/agent-contracts";
import { routeFile, useAddressPage } from "./address-page";

afterEach(cleanup);

/** A route that is only its address: Ops. The page is read, moved and restored like a manifest route's. */
function Ops() {
  const [{ op, actionId }, setPage] = useAddressPage("ops");
  return (
    <div>
      <output aria-label="page">{`${op}|${actionId}`}</output>
      <button onClick={() => setPage({ op: "revit.b", actionId: "" })}>pick</button>
      <button onClick={() => setPage({ actionId: "a1" })}>receipt</button>
    </div>
  );
}

async function mount(entry: string) {
  const root = createRootRoute();
  const ops = createRoute({
    getParentRoute: () => root,
    path: "/ops",
    ...routeFile("ops"),
    component: Ops,
  });
  const history = createMemoryHistory({ initialEntries: [entry] });
  const router = createRouter({ routeTree: root.addChildren([ops]), history });
  await router.load();
  const view = render(<RouterProvider router={router} />);
  const page = () => view.getByLabelText("page").textContent;
  const place = () =>
    routeAddress("ops").read(router.state.location.search as Record<string, unknown>).page;
  await waitFor(() => expect(page()).toBeTruthy());
  return { view, history, page, place };
}

test("a deep link reopens the same view", async () => {
  const { page } = await mount("/ops?op=revit.a&actionId=r9");
  expect(page()).toBe("revit.a|r9");
});

test("a pick pushes an entry, a receipt replaces, and Back restores the pick", async () => {
  const { view, history, page, place } = await mount("/ops?op=revit.a");
  fireEvent.click(view.getByText("pick"));
  await waitFor(() => expect(page()).toBe("revit.b|"));
  expect(history.length).toBe(2);
  fireEvent.click(view.getByText("receipt"));
  await waitFor(() => expect(place().actionId).toBe("a1"));
  expect(history.length).toBe(2);
  expect(page()).toBe("revit.b|a1");
  act(() => history.back());
  await waitFor(() => expect(page()).toBe("revit.a|"));
});
