// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { useState } from "react";

import { NumberCell } from "#/components/master-table/cells";
import { Press } from "#/components/lang/press";
import { MasterTable } from "#/components/master-table/master-table";
import type { Column, MasterTableState } from "#/components/master-table/model";

interface Fam {
  id: string;
  name: string;
  cat: string;
  params: number;
  flags: string[];
}

const rows: Fam[] = [
  { id: "a", name: "VAV Box", cat: "mech", params: 12, flags: ["low-ceiling"] },
  { id: "b", name: "Diffuser", cat: "mech", params: 4, flags: [] },
  { id: "c", name: "Panelboard", cat: "elec", params: 9, flags: ["low-ceiling", "odd"] },
];

const columns: Column<Fam>[] = [
  {
    key: "name",
    label: "name",
    header: <span>asset name</span>,
    group: ["asset", "identity"],
    search: (row) => row.name,
    sort: (row) => row.name,
    cell: (row) => row.name,
  },
  {
    key: "cat",
    label: "category",
    group: ["asset", "identity"],
    facet: (row) => row.cat,
    sort: (row) => row.cat,
    cell: (row) => row.cat,
  },
  {
    key: "params",
    label: "params",
    group: ["asset", "metrics"],
    right: true,
    sort: (row) => row.params,
    cell: (row) => row.params,
  },
  {
    key: "flags",
    label: "flags",
    options: [
      { value: "any", label: "any open" },
      { value: "none", label: "none open" },
      { value: "odd", label: "odd" },
    ],
    match: (row, value) => {
      if (value === "any") return row.flags.length > 0;
      if (value === "none") return row.flags.length === 0;
      return row.flags.includes(value);
    },
    cell: (row) => row.flags.join(", "),
  },
];

const emptyState: MasterTableState = { filters: {}, sorts: [], query: "" };

afterEach(cleanup);

function table(props: Partial<React.ComponentProps<typeof MasterTable<Fam>>> = {}) {
  return (
    <MasterTable
      rows={rows}
      columns={columns}
      rowKey={(row) => row.id}
      scopeLabel="families in scope"
      searchPlaceholder="search families"
      {...props}
    />
  );
}

const renderTable = (props: Parameters<typeof table>[0] = {}) => render(table(props));

function SelectedTable({
  initial = [],
  ...props
}: { initial?: string[] } & Partial<React.ComponentProps<typeof MasterTable<Fam>>>) {
  const [selectedKeys, setSelectedKeys] = useState<ReadonlySet<string>>(() => new Set(initial));
  return table({ ...props, selectedKeys, onSelectedKeysChange: setSelectedKeys });
}

const rowFor = (name: string) => screen.getByText(name).closest("tr")!;

test("controlled selection toggles rows and leaves uncontrolled tables unchanged", () => {
  const { rerender } = render(<SelectedTable />);
  fireEvent.click(rowFor("VAV Box"));
  expect(rowFor("VAV Box").classList.contains("on-select")).toBe(true);
  fireEvent.click(rowFor("VAV Box"));
  expect(rowFor("VAV Box").classList.contains("on-select")).toBe(false);

  rerender(table());
  expect(screen.queryByRole("button", { name: /select 3/i })).toBeNull();
  fireEvent.click(rowFor("VAV Box"));
  expect(rowFor("VAV Box").classList.contains("on-select")).toBe(false);
});

test("shift-click selects a range in sorted row order", () => {
  render(<SelectedTable />);
  fireEvent.click(screen.getByRole("button", { name: /asset name/i }));
  fireEvent.click(rowFor("Diffuser"));
  fireEvent.click(rowFor("VAV Box"), { shiftKey: true });
  expect(
    ["Diffuser", "Panelboard", "VAV Box"].map((name) =>
      rowFor(name).classList.contains("on-select"),
    ),
  ).toEqual([true, true, true]);
});

test("the header selects visible rows and Escape clears selection", () => {
  render(<SelectedTable tableState={{ ...emptyState, filters: { cat: "mech" } }} />);
  fireEvent.click(screen.getByRole("button", { name: "select 2" }));
  expect(screen.getByRole("button", { name: "clear 2" })).toBeTruthy();
  expect(rowFor("VAV Box").classList.contains("on-select")).toBe(true);
  expect(rowFor("Diffuser").classList.contains("on-select")).toBe(true);
  expect(screen.queryByText("Panelboard")).toBeNull();
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.getByRole("button", { name: "select 2" })).toBeTruthy();
});

test("column facets keep the vocabulary of all rows while other filters narrow the grid", async () => {
  renderTable({ tableState: { ...emptyState, filters: { cat: "mech" } } });

  // The facet filter is a combobox popup now — its vocabulary renders on open, in a portal.
  fireEvent.click(screen.getByLabelText("category filter"));
  const options = await screen.findAllByRole("option");
  expect(options.map((option) => option.textContent)).toEqual(["any", "elec", "mech"]);
  expect(screen.getByText("category: mech")).toBeTruthy();
  expect(screen.getByText("VAV Box")).toBeTruthy();
  expect(screen.queryByText("Panelboard")).toBeNull();
});

test("custom match predicates remain the authority for non-facet filters", () => {
  renderTable({ tableState: { ...emptyState, filters: { flags: "none" } } });

  expect(screen.getByText("Diffuser")).toBeTruthy();
  expect(screen.queryByText("VAV Box")).toBeNull();
  expect(screen.queryByText("Panelboard")).toBeNull();
});

test("sorting and search change the rendered row model, with search limited to declared columns", () => {
  const view = renderTable({
    tableState: { ...emptyState, sorts: [{ key: "params", dir: "asc" }] },
  });
  const names = () =>
    within(screen.getByRole("grid"))
      .getAllByRole("gridcell")
      .filter((_, index) => index % columns.length === 0)
      .map((cell) => cell.textContent);
  expect(names()).toEqual(["Diffuser", "Panelboard", "VAV Box"]);

  view.rerender(table({ tableState: { ...emptyState, query: "panel" } }));
  expect(names()).toEqual(["Panelboard"]);

  view.rerender(table({ tableState: { ...emptyState, query: "mech" } }));
  expect(screen.getByText(/all 3 rows in scope are filtered out/i)).toBeTruthy();
});

test("controlled table state can be read and driven without changing the Column contract", () => {
  const onTableStateChange = vi.fn();
  renderTable({ tableState: emptyState, onTableStateChange });

  fireEvent.click(screen.getByRole("button", { name: "params" }));
  expect(onTableStateChange).toHaveBeenLastCalledWith({
    filters: {},
    sorts: [{ key: "params", dir: "asc" }],
    query: "",
  });

  fireEvent.change(screen.getByPlaceholderText("search families"), {
    target: { value: "panel" },
  });
  expect(onTableStateChange).toHaveBeenLastCalledWith({
    filters: {},
    sorts: [{ key: "params", dir: "asc" }],
    query: "panel",
  });
});

test("changing the active row re-renders at most the two changed rows", () => {
  Element.prototype.scrollIntoView = vi.fn();
  let renders = 0;
  const countingColumns: Column<Fam>[] = [
    { key: "name", label: "name", cell: (row) => (renders += 1) && row.name },
  ];
  const view = renderTable({ columns: countingColumns, activeKey: "a" });

  renders = 0;
  view.rerender(table({ columns: countingColumns, activeKey: "b" }));

  expect(renders).toBeLessThanOrEqual(2);
});

test("nested group paths render true multi-level headers", () => {
  renderTable();

  const asset = screen.getByRole("columnheader", { name: "asset" });
  const identity = screen.getByRole("columnheader", { name: "identity" });
  const metrics = screen.getByRole("columnheader", { name: "metrics" });
  expect(
    [asset, identity, metrics].map((header) => (header as HTMLTableCellElement).colSpan),
  ).toEqual([3, 2, 1]);
  expect(screen.getByText("asset name")).toBeTruthy();
});

test("scope emptiness and filter emptiness remain distinct explanations", () => {
  const view = renderTable({ rows: [], empty: "No families are in the route-owned scope." });
  expect(screen.getByText("No families are in the route-owned scope.")).toBeTruthy();

  view.rerender(table({ tableState: { ...emptyState, filters: { cat: "missing" } } }));
  expect(screen.getByText(/all 3 rows in scope are filtered out/i)).toBeTruthy();
});

test("the table owns one rail, optional filters, and rail actions", () => {
  const { container, rerender } = renderTable({
    modes: <Press>table mode</Press>,
    actions: <Press>export</Press>,
  });

  expect(container.querySelectorAll("[data-slot='rail']")).toHaveLength(1);
  expect(container.querySelector("[data-slot='table-filters']")).toBeNull();
  expect(
    screen.getByRole("button", { name: "table mode" }).closest("[data-slot='rail']"),
  ).toBeTruthy();
  expect(screen.getByRole("button", { name: "export" }).closest("[data-slot='rail']")).toBeTruthy();

  rerender(table({ chips: [{ label: "narrowed", onClear: () => undefined }] }));
  expect(container.querySelector("[data-slot='table-filters']")).toBeTruthy();
  expect(screen.getByText("narrowed")).toBeTruthy();
});

test("the rail scrolls its lead and focused controls into view", () => {
  const originalScrollIntoView = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "scrollIntoView",
  );
  const scrollIntoView = vi.fn();
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: scrollIntoView,
  });
  const { container } = renderTable({
    summary: <span className="flex flex-wrap">facts</span>,
    modes: <Press>table mode</Press>,
    actions: <Press>export</Press>,
  });
  const rail = container.querySelector<HTMLElement>("[data-slot='rail']")!;
  const [lead, trail] = Array.from(rail.children) as HTMLElement[];

  expect(rail.classList.contains("overflow-hidden")).toBe(false);
  expect(lead.classList.contains("whitespace-nowrap")).toBe(true);
  expect(lead.classList.contains("overflow-x-auto")).toBe(true);
  expect(trail.dataset.slot).toBe("rail-actions");
  expect(trail.classList.contains("no-scrollbar")).toBe(true);
  expect(trail.classList.contains("overflow-x-auto")).toBe(true);
  expect(trail.classList.contains("whitespace-nowrap")).toBe(true);
  screen.getByRole("button", { name: "export" }).focus();
  expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest", inline: "nearest" });
  if (originalScrollIntoView)
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", originalScrollIntoView);
  else delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView;
});

test("grid keys move the roving cell focus and release Tab at the outer boundary", () => {
  renderTable();
  const cells = screen.getAllByRole("gridcell");
  const first = cells[0] as HTMLTableCellElement;
  const second = cells[1] as HTMLTableCellElement;
  const belowFirst = cells[columns.length] as HTMLTableCellElement;
  const last = cells.at(-1) as HTMLTableCellElement;

  first.focus();
  fireEvent.keyDown(first, { key: "ArrowRight" });
  expect(document.activeElement).toBe(second);

  first.focus();
  fireEvent.keyDown(first, { key: "Enter" });
  expect(document.activeElement).toBe(belowFirst);

  last.focus();
  expect(fireEvent.keyDown(last, { key: "Tab" })).toBe(true);
});

test("the owed gutter marks rows without entering the navigation order", () => {
  renderTable({
    gutter: (row) =>
      row.flags.length > 0
        ? { count: row.flags.length, title: `${row.flags.length} open flags — a person decides` }
        : null,
  });

  // Marked rows carry the count; the sentence rides the title; unmarked rows stay empty.
  expect(screen.getByTitle("1 open flags — a person decides").textContent).toBe("1");
  expect(screen.getByTitle("2 open flags — a person decides").textContent).toBe("2");

  // The gutter is a marker, not a data cell: ArrowLeft from the first data column goes nowhere.
  const grid = screen.getByRole("grid");
  const firstDataCell = within(grid)
    .getAllByRole("gridcell")
    .find((cell) => cell.textContent === "VAV Box") as HTMLTableCellElement;
  firstDataCell.focus();
  fireEvent.keyDown(firstDataCell, { key: "ArrowLeft" });
  expect(document.activeElement).toBe(firstDataCell);
});

test("cell editing and navigation stay spreadsheet-fast", () => {
  const onCommit = vi.fn();
  let renders = 0;
  const editableColumns: Column<Fam>[] = [
    {
      key: "params",
      label: "params",
      cell: (row) => {
        renders += 1;
        return <NumberCell value={row.params} onCommit={onCommit} />;
      },
    },
  ];
  renderTable({ columns: editableColumns });

  const cells = screen.getAllByRole("gridcell") as HTMLTableCellElement[];
  const inputs = within(screen.getByRole("grid")).getAllByRole("textbox") as HTMLInputElement[];
  fireEvent.change(inputs[0]!, { target: { value: "" } });
  fireEvent.blur(inputs[0]!);
  expect(onCommit).not.toHaveBeenCalled();

  cells[0]!.focus();
  renders = 0;
  fireEvent.keyDown(cells[0]!, { key: "ArrowDown" });
  expect(document.activeElement).toBe(cells[1]);
  const navigationRenders = renders;

  fireEvent.keyDown(cells[1]!, { key: "Enter" });
  expect(document.activeElement).toBe(inputs[1]);
  expect(inputs[1]!.selectionStart).toBe(inputs[1]!.value.length);

  fireEvent.change(inputs[1]!, { target: { value: "7" } });
  fireEvent.keyDown(inputs[1]!, { key: "ArrowUp" });
  expect(onCommit).toHaveBeenCalledWith(7);
  expect(document.activeElement).toBe(cells[0]);

  fireEvent.keyDown(cells[0]!, { key: "4" });
  expect(document.activeElement).toBe(inputs[0]);
  expect(inputs[0]!.value).toBe("4");
  fireEvent.keyDown(inputs[0]!, { key: "ArrowRight" });
  expect(document.activeElement).toBe(inputs[0]);
  expect(navigationRenders).toBeLessThanOrEqual(2);
});

test("absent density renders exactly the default table", () => {
  // React ids (`_r_1_`) count up across renders; everything else must match byte for byte.
  const html = (props: Parameters<typeof table>[0]) =>
    renderTable(props).container.innerHTML.replace(/_r_[0-9a-z]+_/g, "id");
  const absent = html({});
  cleanup();
  expect(html({ density: "default" })).toBe(absent);
  expect(screen.getByText("families in scope")).toBeTruthy();
  expect(screen.getAllByRole("gridcell")[0]!.className).toContain("border-l");
});

test("compact drops the scope strip and keeps sort, selection and cell keyboard", () => {
  render(<SelectedTable density="compact" />);
  expect(screen.queryByText("families in scope")).toBeNull();
  expect(screen.queryByPlaceholderText("search families")).toBeNull();
  expect(screen.getByRole("grid", { name: "families in scope" })).toBeTruthy();
  const first = screen.getAllByRole("gridcell")[0]!;
  expect(first.className).toContain("face-mono");
  expect(first.className).toContain("truncate");
  expect(first.className).not.toContain("border-l");

  fireEvent.click(screen.getByRole("button", { name: /asset name/i }));
  const names = () =>
    screen
      .getAllByRole("gridcell")
      .filter((_, index) => index % columns.length === 0)
      .map((cell) => cell.textContent);
  expect(names()).toEqual(["Diffuser", "Panelboard", "VAV Box"]);

  fireEvent.click(rowFor("Diffuser"));
  fireEvent.click(rowFor("VAV Box"), { shiftKey: true });
  expect(rowFor("Panelboard").classList.contains("on-select")).toBe(true);
  fireEvent.keyDown(document, { key: "Escape" });
  expect(rowFor("Panelboard").classList.contains("on-select")).toBe(false);

  const cells = screen.getAllByRole("gridcell");
  cells[0]!.focus();
  fireEvent.keyDown(cells[0]!, { key: "ArrowRight" });
  expect(document.activeElement).toBe(cells[1]);
});
