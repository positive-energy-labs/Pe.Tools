// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";

import { StateCell, type CellTransition } from "#/components/lang/cell";
import { MasterTable } from "#/components/master-table/master-table";

afterEach(cleanup);

const t = (
  kind: CellTransition["kind"],
  out: Awaited<ReturnType<CellTransition["run"]>> = null,
): CellTransition => ({ kind, run: vi.fn(async () => out) });

/** Row scale inside the real MasterTable: one row, one column drawing the cell. */
const inTable = (node: React.ReactNode) => {
  const view = render(
    <MasterTable
      rows={[{ key: "r" }]}
      columns={[{ key: "c", label: "c", cell: () => node }]}
      rowKey={(row) => row.key}
      scopeLabel="cells"
    />,
  );
  return { ...view, cell: within(view.container.querySelector<HTMLElement>(".dl-cell")!) };
};
const gridcell = () => document.querySelector<HTMLElement>('td[role="gridcell"]')!;

test("row scale adds no height: its verbs are an absolute overlay inside the one clipped line", () => {
  const { container } = inTable(
    <StateCell value="10in" scale="row" transitions={[t("accept"), t("deny")]} />,
  );
  const cell = container.querySelector(".dl-cell")!;
  // the value is the only in-flow content; everything else is the overlay
  expect([...cell.children].map((el) => el.className)).toEqual(["dl-acts"]);
  const css = readFileSync(join(import.meta.dirname, "lang.css"), "utf8");
  const rule = css.slice(css.indexOf(".dl-acts {"), css.indexOf("}", css.indexOf(".dl-acts {")));
  expect(rule).toContain("position: absolute");
  expect(rule).toContain("display: none");
});

test("the cell draws exactly the kinds it is given, in order, at both scales", () => {
  const { cell } = inTable(
    <StateCell value="10in" scale="row" transitions={[t("unstage"), t("accept")]} />,
  );
  expect(cell.getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual([
    "unstage",
    "accept",
  ]);
  cleanup();
  render(<StateCell value="10in" transitions={[t("deny")]} />);
  expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["deny"]);
  cleanup();
  render(<StateCell value="10in" />);
  expect(screen.queryAllByRole("button")).toEqual([]);
});

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

test("inside MasterTable, a focused cell fires a / d / u through the hotkey registry", async () => {
  const [accept, deny, unstage] = [t("accept"), t("deny"), t("unstage")];
  inTable(<StateCell value="10in" scale="row" transitions={[accept, deny, unstage]} />);
  const td = gridcell();
  await act(async () => td.focus());
  await act(async () => fireEvent.keyDown(td, { key: "d", code: "KeyD" }));
  await act(async () => fireEvent.keyDown(td, { key: "u", code: "KeyU" }));
  expect(deny.run).toHaveBeenCalledOnce();
  expect(unstage.run).toHaveBeenCalledOnce();
  expect(accept.run).not.toHaveBeenCalled();
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

test("an aggregate's refusal draws in the same note on each covered cell", () => {
  inTable(<StateCell value="10in" scale="row" refused="moved since you looked" />);
  expect(screen.getByText("moved since you looked").className).toBe("dl-refuse");
  cleanup();
  render(<StateCell value="10in" refused="moved since you looked" />);
  expect(screen.getByText("moved since you looked").className).toBe("dl-refuse");
});

test("with no table around it, a card-scale field is its own host: a / d / u on the field", async () => {
  const [accept, deny] = [t("accept"), t("deny")];
  const { container } = render(<StateCell value="10in" transitions={[accept, deny]} />);
  const field = container.firstElementChild as HTMLElement;
  expect(field.tabIndex).toBe(0);
  await act(async () => field.focus());
  await act(async () => fireEvent.keyDown(field, { key: "d", code: "KeyD" }));
  await act(async () => fireEvent.keyDown(field, { key: "a", code: "KeyA" }));
  expect(deny.run).toHaveBeenCalledOnce();
  expect(accept.run).toHaveBeenCalledOnce();
});

test("with no table around it, Escape returns to the cell itself, where u unstages", async () => {
  const unstage = t("unstage");
  const { container } = render(
    <StateCell value="10in" scale="row" onCommit={vi.fn()} transitions={[unstage]} />,
  );
  const cell = container.querySelector<HTMLElement>(".dl-cell")!;
  const input = cell.querySelector("input")!;
  await act(async () => input.focus());
  fireEvent.change(input, { target: { value: "12in" } });
  await act(async () => fireEvent.keyDown(input, { key: "Escape", code: "Escape" }));
  expect(input.value).toBe("10in");
  expect(document.activeElement).toBe(cell);
  await act(async () => fireEvent.keyDown(cell, { key: "u", code: "KeyU" }));
  expect(unstage.run).toHaveBeenCalledOnce();
});

test("a cell with no verbs takes no tab stop of its own", () => {
  const { container } = render(<StateCell value="10in" />);
  expect((container.firstElementChild as HTMLElement).hasAttribute("tabindex")).toBe(false);
});
