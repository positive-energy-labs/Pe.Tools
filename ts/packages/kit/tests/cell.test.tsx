// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";

import { cellFromDraft, StateCell, type CellTransition } from "@pe/kit/lang/cell";
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
  const deny = t("unsuggest", { code: "stale-revision", message: "another writer landed first" });
  const { cell } = inTable(<StateCell value="10in" scale="row" transitions={[deny]} />);
  await act(async () => fireEvent.click(cell.getByRole("button", { name: "unsuggest" })));
  expect(deny.run).toHaveBeenCalledOnce();
  expect(screen.getByText("another writer landed first").className).toBe("dl-refuse");
  expect(screen.getByText("10in")).toBeTruthy();
});

test("a run in flight marks the cell busy and inerts its verbs", async () => {
  let land!: () => void;
  const accept: CellTransition = {
    kind: "take",
    run: () => new Promise<void>((resolve) => (land = resolve)),
  };
  const { container, cell } = inTable(
    <StateCell value="10in" scale="row" transitions={[accept]} />,
  );
  await act(async () => fireEvent.click(cell.getByRole("button", { name: "take" })));
  expect(container.querySelector(".dl-cell")!.getAttribute("aria-busy")).toBe("true");
  expect(cell.getByRole("button", { name: "take" }).hasAttribute("disabled")).toBe(true);
  await act(async () => land());
  expect(container.querySelector(".dl-cell")!.getAttribute("aria-busy")).toBeNull();
});

test("Escape in the input restores the value and hands focus back to the td, where a accepts", async () => {
  const accept = t("take");
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

test("a edit empty value draws the empty mark, never the baseline text, at both scales", () => {
  for (const scale of ["row", "card"] as const)
    for (const onCommit of [undefined, () => {}]) {
      const { container, unmount } = render(
        <StateCell
          scale={scale}
          value=""
          stage="edit"
          author="human"
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
  // The typed text is not left looking edit: the drawn value is back, and the refusal is said.
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

test("cell authorship comes from host provenance even when values match", () => {
  const same = { value: "250" };
  expect(
    cellFromDraft(
      { edit: { ...same, by: "human" }, suggestion: { ...same, by: "pea" } },
      { value: "250" },
    ).author,
  ).toBe("human");
  expect(
    cellFromDraft(
      { edit: { ...same, by: "pea" }, suggestion: { ...same, by: "human" } },
      { value: "250" },
    ).author,
  ).toBe("pea");
  expect(cellFromDraft({ edit: { ...same, by: "unknown" } }, { value: "250" }).author).toBe(
    "unknown",
  );
});

const KINDS = [
  { key: "erv", label: "erv", description: "fan: supply out c2 from supply in c4; exhaust out c3" },
  { key: "other", label: "other", description: "passive: adds its drop and moves no air" },
];

test("a choice cell lists its options with what each means and commits the picked key", async () => {
  const pick = vi.fn();
  const { container } = render(
    <StateCell value="erv" scale="row" choice={{ options: KINDS, current: "erv", pick }} />,
  );
  const trigger = container.querySelector<HTMLElement>(".dl-cell button")!;
  expect(trigger.textContent).toContain("erv");
  await act(async () => fireEvent.click(trigger));
  expect(screen.getByText("passive: adds its drop and moves no air")).toBeTruthy();
  await act(async () => fireEvent.click(screen.getByText("other")));
  expect(pick).toHaveBeenCalledWith("other");
});

test("a Pea suggestion on a choice cell draws proposed with Pea's option, and take stages it", async () => {
  const take = t("take");
  const label = (v: unknown) => (v as { kind: string }).kind;
  const drawn = cellFromDraft(
    { suggestion: { value: { kind: "other" }, by: "pea" } },
    { value: "erv", scale: "row" },
    label,
  );
  const { container } = render(
    <StateCell
      {...drawn}
      scale="row"
      choice={{ options: KINDS, current: "erv", pick: vi.fn() }}
      transitions={[take, t("unsuggest")]}
    />,
  );
  const cell = container.querySelector<HTMLElement>(".dl-cell")!;
  expect(cell.getAttribute("data-body")).toBe("proposed");
  expect(cell.getAttribute("data-suggestion-author")).toBe("pea");
  expect(cell.querySelector("button")!.textContent).toContain("other");
  await act(async () => fireEvent.click(within(cell).getByRole("button", { name: "take" })));
  expect(take.run).toHaveBeenCalledOnce();
});

test("a locked choice cell draws its value and opens no list", () => {
  const { container } = render(
    <StateCell
      value="erv"
      scale="row"
      cap="locked"
      capReason="wait for the element snapshot"
      choice={{ options: KINDS, current: "erv", pick: vi.fn() }}
    />,
  );
  expect(container.querySelector(".dl-cell")!.getAttribute("data-body")).toBe("locked");
  expect(container.querySelector(".dl-cell button")).toBeNull();
});

test("a choice cell greys a disabled option with its reason and refuses to pick it", async () => {
  const pick = vi.fn();
  const options = [
    { key: "erv", label: "erv", description: "fan: two ports" },
    {
      key: "air-handler",
      label: "air-handler",
      description: "fan: one port",
      disabled: "no fan port: 2 outlets",
    },
    { key: "other", label: "other", description: "passive" },
  ];
  const { container } = render(
    <StateCell value="erv" scale="row" choice={{ options, current: "erv", pick }} />,
  );
  await act(async () => fireEvent.click(container.querySelector<HTMLElement>(".dl-cell button")!));
  const row = screen.getByText("air-handler").closest<HTMLElement>("[role=option]")!;
  expect(row.getAttribute("aria-disabled")).toBe("true");
  expect(screen.getByText("no fan port: 2 outlets")).toBeTruthy();
  expect(screen.queryByText("fan: one port")).toBeNull();
  await act(async () => fireEvent.click(screen.getByText("air-handler")));
  expect(pick).not.toHaveBeenCalled();
  // The keyboard cannot reach it either: arrowing from erv skips to other.
  const keys = screen.getByRole("listbox").parentElement!;
  for (const key of ["ArrowDown", "ArrowDown", "ArrowDown", "Enter"])
    await act(async () => fireEvent.keyDown(keys, { key }));
  // Enter lands on the next enabled option, never the disabled one.
  expect(pick).toHaveBeenCalledOnce();
  expect(pick).toHaveBeenCalledWith("other");
});
