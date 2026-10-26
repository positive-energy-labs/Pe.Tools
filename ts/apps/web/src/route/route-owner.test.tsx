// @vitest-environment jsdom
/** A hidden retained body reads one real snapshot on first mount, then freezes until shown. */
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, test } from "vite-plus/test";
import * as Atom from "effect/unstable/reactivity/Atom";
import { makeAtomRegistry, useOwned } from "./route-owner";
import { RouteActivity, type RouteActivityScope } from "./activity";

afterEach(cleanup);

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
