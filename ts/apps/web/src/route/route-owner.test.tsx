// @vitest-environment jsdom
/** A hidden retained body reads one real snapshot on first mount, then freezes until shown. */
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { Activity, StrictMode } from "react";
import * as Atom from "effect/unstable/reactivity/Atom";
import { makeAtomRegistry, useOwned, useRouteOwner } from "./route-owner";
import { RouteActivity, type RouteActivityScope } from "./activity";

afterEach(cleanup);

test("the retained pane owns disposal when Activity hides a still-current route", async () => {
  vi.useFakeTimers();
  const retained = new Set<{ dispose(): void }>();
  const dispose = vi.fn();
  const scope: RouteActivityScope = {
    pathname: "/ducts",
    search: {},
    current: () => true,
    retain: (owner) => {
      retained.add(owner);
    },
    retire: (owner) => {
      retained.delete(owner);
      owner.dispose();
    },
  };
  let seen: unknown;
  function Body() {
    seen = useRouteOwner(() => ({ registry: makeAtomRegistry(), dispose }));
    return null;
  }
  const tree = (hidden: boolean) => (
    <StrictMode>
      <RouteActivity.Provider value={scope}>
        <Activity mode={hidden ? "hidden" : "visible"}>
          <Body />
        </Activity>
      </RouteActivity.Provider>
    </StrictMode>
  );
  try {
    const view = render(tree(false));
    const original = seen;
    view.rerender(tree(true));
    await act(() => vi.runAllTimersAsync());
    expect(dispose).not.toHaveBeenCalled();
    view.rerender(tree(false));
    expect(seen).toBe(original);
    view.unmount();
    await act(() => vi.runAllTimersAsync());
    expect(dispose).not.toHaveBeenCalled();
    for (const owner of retained) owner.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
  }
});

test("a body that first mounts hidden gets a non-null snapshot and ignores notifications while hidden", () => {
  const registry = makeAtomRegistry();
  const atom = Atom.make({ page: "saved" });
  let renders = 0;
  let seen: { page: string } | null = null;
  function Body() {
    renders++;
    seen = useOwned(registry, atom);
    return null;
  }
  const scope: RouteActivityScope = {
    pathname: "/ducts",
    search: {},
    current: () => false,
    retain() {},
    retire() {},
  };
  render(
    <RouteActivity.Provider value={scope}>
      <Body />
    </RouteActivity.Provider>,
  );
  expect(seen).toEqual({ page: "saved" });
  const before = renders;
  act(() => registry.set(atom, { page: "moved" }));
  expect(renders).toBe(before);
  expect(seen).toEqual({ page: "saved" });
});
