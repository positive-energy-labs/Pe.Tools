// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { useCallback } from "react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { useList } from "../src/components/lang/collection";
import { ListView } from "../src/components/lang/list-view";
import { Scroll } from "../src/components/lang/scroll";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

type Node = { key: string; name: string; children: Node[] };
const trees: Node[] = Array.from({ length: 6 }, (_, s) => ({
  key: `s${s}`,
  name: `system ${s}`,
  children: Array.from({ length: 300 }, (_, i) => ({
    key: `s${s}-${i}`,
    name: `run ${s}-${i}`,
    children: [],
  })),
}));
const TREE = { childrenOf: (node: Node) => node.children };
const SEARCH = (node: Node) => ({ text: [node.name] });

test("a pointer move in an expanded tree moves the cursor without re-deriving the list", () => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(400);
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(24);
  const keyOf = vi.fn((node: Node) => node.key);
  const rows = vi.fn();
  function Tree() {
    const list = useList<Node, "name">({
      items: trees,
      keyOf,
      tree: TREE,
      search: SEARCH,
      initialState: { open: trees.map((tree) => tree.key) },
    });
    const row = useCallback((node: Node) => {
      rows();
      return { label: node.name };
    }, []);
    return <ListView list={list} row={row} aria-label="tree" empty={{ message: "-", exit: "-" }} />;
  }
  const view = render(
    <Scroll maxHeight="400px">
      <Tree />
    </Scroll>,
  );
  const shown = view.container.querySelectorAll("[data-key]");
  keyOf.mockClear();
  rows.mockClear();
  fireEvent.mouseMove(shown[3]!);
  fireEvent.mouseMove(shown[4]!);
  expect(shown[4]!.hasAttribute("data-cursor")).toBe(true);
  // 1806 rows: the walk/search/sort ran per hover before (keyOf once per node, every move).
  expect(keyOf.mock.calls.length).toBeLessThan(50);
  // Only the rows whose cursor state moved redraw.
  expect(rows.mock.calls.length).toBeLessThanOrEqual(4);
});
