// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vite-plus/test";
import { Tree } from "@pe/kit/lang/row";

afterEach(cleanup);

interface N {
  key: string;
  children: N[];
}
const roots: N[] = [{ key: "a", children: [{ key: "b", children: [] }] }];

const tree = (columns?: { label: string; meta?: string }) =>
  render(
    <Tree<N>
      aria-label="t"
      roots={roots}
      keyOf={(n) => n.key}
      childrenOf={(n) => n.children}
      defaultOpen={["a"]}
      empty="none"
      columns={columns}
      row={(n) => ({ label: n.key, meta: "1.0" })}
    />,
  );

test("columns draw one header ahead of the rows, naming the label and the meta column", () => {
  const { container } = tree({ label: "path", meta: "own" });
  const head = container.querySelector("[data-tree-columns]")!;
  expect(head.textContent).toBe("pathown");
  expect(head.compareDocumentPosition(screen.getAllByRole("treeitem")[0]!)).toBe(
    Node.DOCUMENT_POSITION_FOLLOWING,
  );
  expect(screen.getAllByRole("treeitem")).toHaveLength(2);
});

test("without columns there is no header", () => {
  const { container } = tree();
  expect(container.querySelector("[data-tree-columns]")).toBeNull();
});
