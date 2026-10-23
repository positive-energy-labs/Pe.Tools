// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";

import { StateCell, type CellTransition } from "@pe/kit/lang/cell";
import { Table } from "@pe/kit/table/table";

afterEach(cleanup);

const t = (
  kind: CellTransition["kind"],
  out: Awaited<ReturnType<CellTransition["run"]>> = null,
): CellTransition => ({ kind, run: vi.fn(async () => out) });

/** Row scale inside the real Table: one row, one column drawing the cell. */
const inTable = (node: React.ReactNode) => {
  const view = render(
    <Table
      rows={[{ key: "r" }]}
      columns={[{ key: "c", label: "c", cell: () => node }]}
      rowKey={(row) => row.key}
      label="cells"
    />,
  );
  return { ...view, cell: within(view.container.querySelector<HTMLElement>(".dl-cell")!) };
};
const gridcell = () => document.querySelector<HTMLElement>('td[role="gridcell"]')!;

test("a refused run keeps the value and says why beside the cell", async () => {
  const deny = t("deny", { code: "stale-revision", message: "another writer landed first" });
  const { cell } = inTable(<StateCell value="10in" scale="row" transitions={[deny]} />);
  await act(async () => fireEvent.click(cell.getByRole("button", { name: "deny" })));
  expect(deny.run).toHaveBeenCalledOnce();
  expect(screen.getByText("another writer landed first").className).toBe("dl-refuse");
  expect(screen.getByText("10in")).toBeTruthy();
});

test("a run in flight marks the cell busy and inerts its verbs", async () => {
  let land!: () => void;
  const accept: CellTransition = {
    kind: "accept",
    run: () => new Promise<void>((resolve) => (land = resolve)),
  };
  const { container, cell } = inTable(
    <StateCell value="10in" scale="row" transitions={[accept]} />,
  );
  await act(async () => fireEvent.click(cell.getByRole("button", { name: "accept" })));
  expect(container.querySelector(".dl-cell")!.getAttribute("aria-busy")).toBe("true");
  expect(cell.getByRole("button", { name: "accept" }).hasAttribute("disabled")).toBe(true);
  await act(async () => land());
  expect(container.querySelector(".dl-cell")!.getAttribute("aria-busy")).toBeNull();
});

test("Escape in the input restores the value and hands focus back to the td, where a accepts", async () => {
  const accept = t("accept");
  const commit = vi.fn();
  const { container } = inTable(
    <StateCell value="10in" scale="row" onCommit={commit} transitions={[accept]} />,
  );
  const td = gridcell();
  const input = container.querySelector<HTMLInputElement>("input.dl-cell-input")!;
  await act(async () => input.focus());
  fireEvent.change(input, { target: { value: "12in" } });
  await act(async () => fireEvent.keyDown(input, { key: "Escape", code: "Escape" }));
  expect(input.value).toBe("10in");
  expect(document.activeElement).toBe(td);
  await act(async () => fireEvent.keyDown(td, { key: "a", code: "KeyA" }));
  expect(accept.run).toHaveBeenCalledOnce();
  expect(commit).not.toHaveBeenCalled();
});

test("a staged empty value draws the empty mark, never the baseline text, at both scales", () => {
  for (const scale of ["row", "card"] as const)
    for (const onCommit of [undefined, () => {}]) {
      const { container, unmount } = render(
        <StateCell
          scale={scale}
          value=""
          stage="staged"
          stagedBy="you"
          placeholder="Old value"
          onCommit={onCommit}
        />,
      );
      const input = container.querySelector("input");
      const drawn = `${container.textContent ?? ""}${input?.placeholder ?? ""}`;
      expect(drawn, `${scale} ${onCommit ? "editable" : "read"}`).toContain("–");
      expect(drawn).not.toContain("Old value");
      unmount();
    }
});

test("25 item 3: a commit refused LATER (an async write) puts the cell back and says why", async () => {
  // The families edit is a Work write: its refusal arrives after the commit returned.
  let refuse!: (reason: string) => void;
  const onCommit = vi.fn(
    () =>
      new Promise<string>((resolve) => {
        refuse = resolve;
      }),
  );
  const { cell } = inTable(<StateCell value="10in" scale="row" onCommit={onCommit} />);
  const input = cell.getByRole("textbox") as HTMLInputElement;
  await act(async () => fireEvent.change(input, { target: { value: "12in" } }));
  await act(async () => fireEvent.keyDown(input, { key: "Enter" }));
  expect(onCommit).toHaveBeenCalledWith("12in");
  await act(async () => refuse("that family isn't in this page's scope"));
  // The typed text is not left looking staged: the drawn value is back, and the refusal is said.
  expect(input.value).toBe("10in");
  expect(document.body.textContent).toContain("that family isn't in this page's scope");
});

test("a unit-bearing cell draws its unit inside the box, empty or filled, and keeps committing", async () => {
  const onCommit = vi.fn(() => undefined);
  const { cell } = inTable(
    <StateCell
      value=""
      cap="editable"
      scale="row"
      unit={{ label: "in-wg", short: "wg" }}
      numeric={{ min: 0, digits: 2 }}
      onCommit={onCommit}
    />,
  );
  const box = document.querySelector<HTMLElement>(".dl-cell[data-unit]")!;
  expect(within(box).getByText("in-wg")).toBeTruthy();
  expect(within(box).getByText("wg").getAttribute("aria-hidden")).toBe("true");
  const input = cell.getByRole("textbox") as HTMLInputElement;
  expect(input.placeholder).toBe("–");
  await act(async () => {
    fireEvent.change(input, { target: { value: "0.5" } });
    fireEvent.blur(input);
  });
  expect(onCommit).toHaveBeenCalledWith("0.5");
});
