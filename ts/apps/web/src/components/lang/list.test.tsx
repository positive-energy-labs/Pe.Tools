// @vitest-environment jsdom
/** The one row and the one collection (ix-list step c): states, filters, selection, ladder, keys. */
import { useState } from "react";
import { KeyScope, useHotkeyRegistrations } from "#/route/keys";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";

const popover = vi.hoisted(() => ({ roots: 0 }));
vi.mock("@base-ui/react/popover", async (original) => {
  const actual = (await original()) as { Popover: Record<string, unknown> };
  const Root = actual.Popover.Root as (props: object) => unknown;
  return {
    ...actual,
    Popover: {
      ...actual.Popover,
      Root: (props: object) => {
        popover.roots += 1;
        return Root(props);
      },
    },
  };
});

import { filterItems, fuzzyScore } from "./collection";
import { CellListSelect, List } from "./list-popup";
import { Row } from "./row";
import { readKeyMeta } from "#/route/keys";
import { Table } from "#/components/master-table/table";

afterEach(cleanup);

const WORDS = ["Neck Width", "Face Width", "Throw", "Airflow", "Neck Height"];
const rows = () =>
  [...document.querySelectorAll('[role="option"]')].map((el) => el.textContent ?? "");

function Words(props: Partial<Parameters<typeof List<string>>[0]>) {
  return (
    <List<string>
      aria-label="words"
      items={WORDS}
      keyOf={(w) => w}
      labelOf={(w) => w}
      empty="no words"
      row={(w) => ({ label: w })}
      {...props}
    />
  );
}

test("row states are attributes, never colour: one class, no inline paint", () => {
  render(<Row label="x" cursor selected active pending failed refusal="read-only in Revit" />);
  const row = document.querySelector(".dl-row") as HTMLElement;
  for (const state of [
    "data-cursor",
    "data-selected",
    "data-active",
    "data-pending",
    "data-failed",
  ])
    expect(row.hasAttribute(state)).toBe(true);
  expect(row.getAttribute("aria-disabled")).toBe("true");
  expect(row.getAttribute("style")).toBeNull();
  expect(row.className).toBe("dl-row");
  // The refusal is said, not guessed.
  expect(row.textContent).toContain("read-only in Revit");
});

test("filter modes: none keeps order, substring filters, fuzzy ranks in-order hits", () => {
  const label = (w: string) => w;
  expect(filterItems(WORDS, label, "none", "zz")).toEqual(WORDS);
  expect(filterItems(WORDS, label, "substring", "width")).toEqual(["Neck Width", "Face Width"]);
  expect(filterItems(WORDS, label, "fuzzy", "nw")).toEqual(["Neck Width"]);
  expect(filterItems(WORDS, label, "fuzzy", "nh")[0]).toBe("Neck Height");
  expect(fuzzyScore("Airflow", "zz")).toBeNull();
});

test("typing filters the rendered rows; the query is not the selection", async () => {
  render(<Words filter="substring" />);
  const search = screen.getByLabelText("words search");
  fireEvent.change(search, { target: { value: "wid" } });
  expect(rows()).toEqual(["Neck Width", "Face Width"]);
});

test("multi: click toggles, shift-click extends over the visible order", async () => {
  let picked: string[] = [];
  function Multi() {
    const [selected, setSelected] = useState<string[]>([]);
    picked = selected;
    return <Words select="multi" selected={selected} onSelectedChange={setSelected} />;
  }
  render(<Multi />);
  const list = screen.getByRole("listbox");
  const option = (w: string) => within(list).getByText(w).closest('[role="option"]')!;
  fireEvent.click(option("Face Width"));
  fireEvent.click(option("Neck Height"), { shiftKey: true });
  expect(picked).toEqual(["Face Width", "Throw", "Airflow", "Neck Height"]);
  expect(option("Throw").getAttribute("aria-selected")).toBe("true");
  expect(option("Neck Width").getAttribute("aria-selected")).toBe("false");
});

test("a ladder advances on Enter, shows a breadcrumb, and finds hits one level down", async () => {
  const onPick = vi.fn();
  const docs: Record<string, string[]> = {
    "pe.app-26": ["projectA.rvt", "Ops.rvt"],
    "pe.app-25": [],
  };
  render(
    <List<string>
      aria-label="ladder"
      filter="substring"
      levels={[
        { label: "session", items: () => Object.keys(docs) },
        { label: "document", items: (path) => docs[path[0]!] ?? [] },
      ]}
      keyOf={(k) => k}
      labelOf={(k) => k}
      empty="no sessions"
      onPick={onPick}
      row={(k) => ({ label: k })}
    />,
  );
  const search = screen.getByLabelText("ladder search");
  // A search hit one level down shows under "session › document".
  fireEvent.change(search, { target: { value: "project-a" } });
  expect(document.body.textContent).toContain("pe.app-26 › document");
  fireEvent.change(search, { target: { value: "" } });
  await act(async () => search.focus());
  await act(async () => fireEvent.keyDown(search, { key: "ArrowDown" }));
  await act(async () => fireEvent.keyDown(search, { key: "Enter" }));
  expect(rows()).toEqual(["projectA.rvt", "Ops.rvt"]);
  expect(screen.getByRole("button", { name: "pe.app-26" })).toBeTruthy();
  await act(async () => fireEvent.keyDown(search, { key: "ArrowDown" }));
  await act(async () => fireEvent.keyDown(search, { key: "Enter" }));
  expect(onPick).toHaveBeenCalledWith("projectA.rvt", ["pe.app-26"]);
});

test("empty, no-match, pending and failed are four different lines", () => {
  const status = () => screen.getByRole("status").textContent;
  const view = render(<Words items={[]} empty="no words in scope" />);
  expect(status()).toBe("no words in scope");
  view.rerender(<Words filter="substring" />);
  fireEvent.change(screen.getByLabelText("words search"), { target: { value: "zzz" } });
  expect(status()).toBe("nothing matches “zzz”");
  view.rerender(<Words status="pending" />);
  expect(status()).toBe("reading…");
  view.rerender(<Words status="failed" failure="field options failed: host offline" />);
  expect(status()).toBe("field options failed: host offline");
});

test("the list's keys are registrations on the scope node it sits in, as help reads them", () => {
  let seen: { name: string; scope: string; depth: number }[] = [];
  function Help() {
    const { hotkeys } = useHotkeyRegistrations();
    seen = hotkeys.flatMap((reg) => {
      const meta = readKeyMeta(reg.options.meta);
      return meta ? [meta] : [];
    });
    return null;
  }
  render(
    <KeyScope id="words">
      <Words select="multi" />
      <Help />
    </KeyScope>,
  );
  const words = seen.filter((meta) => meta.scope === "words");
  // One node below the root: the context default is the root, so depth 0 is never a list.
  expect(words.every((meta) => meta.depth === 1)).toBe(true);
  expect(words.map((meta) => meta.name)).toEqual(
    expect.arrayContaining(["next", "previous", "pick", "back", "toggle", "extend down"]),
  );
});

const STORAGE = ["String", "Integer", "Double"];
function Cells({ count }: { count: number }) {
  const [value, setValue] = useState<Record<string, string>>({});
  const rows = Array.from({ length: count }, (_, i) => ({ key: `p${i}` }));
  return (
    <Table<{ key: string }>
      label="params"
      rows={rows}
      rowKey={(r) => r.key}
      columns={[
        {
          key: "storage",
          label: "storage",
          cell: ({ key: r }) => (
            <CellListSelect<string>
              aria-label={`${r} storage`}
              value={value[r] ?? "String"}
              items={STORAGE}
              keyOf={(s) => s}
              labelOf={(s) => s}
              empty="none"
              onPick={(s) => setValue({ ...value, [r]: s })}
              row={(s) => ({ label: s })}
            />
          ),
        },
        { key: "note", label: "note", cell: (r) => <span>{r.key}</span> },
      ]}
    />
  );
}

test("500 resting cells mount no popup root and no popup (the 2026-09-01 perf gate)", () => {
  popover.roots = 0;
  render(<Cells count={500} />);
  expect(document.querySelectorAll("td[data-master-cell]").length).toBe(1000);
  expect(popover.roots).toBe(0);
  expect(document.querySelectorAll("[data-list-popup]").length).toBe(0);
});

test("in-cell: Enter opens from the td, a pick commits and focus returns, Tab moves the cell", async () => {
  render(<Cells count={2} />);
  const td = () => document.querySelectorAll<HTMLElement>("td[data-master-cell]")[0]!;
  await act(async () => td().focus());
  await act(async () => fireEvent.keyDown(td(), { key: "Enter" }));
  await vi.waitFor(() => expect(document.querySelector("[data-list-popup]")).not.toBeNull());
  await act(async () => fireEvent.click(screen.getByText("Double")));
  await vi.waitFor(() => expect(document.querySelector("[data-list-popup]")).toBeNull());
  expect(td().textContent).toContain("Double");
  expect(document.activeElement).toBe(td());

  // Escape closes back to the td.
  await act(async () => fireEvent.keyDown(td(), { key: "Enter" }));
  await vi.waitFor(() => expect(document.querySelector("[data-list-popup]")).not.toBeNull());
  await act(async () => fireEvent.keyDown(document.activeElement!, { key: "Escape" }));
  await vi.waitFor(() => expect(document.querySelector("[data-list-popup]")).toBeNull());
  expect(document.activeElement).toBe(td());

  // Tab from an open list closes it and moves to the next cell.
  await act(async () => fireEvent.keyDown(td(), { key: "Enter" }));
  await vi.waitFor(() => expect(document.querySelector("[data-list-popup]")).not.toBeNull());
  await act(async () => fireEvent.keyDown(document.activeElement!, { key: "Tab" }));
  await vi.waitFor(() => expect(document.querySelector("[data-list-popup]")).toBeNull());
  expect(document.activeElement).toBe(document.querySelectorAll("td[data-master-cell]")[1]);
});

test("in-cell: a printable key opens the list already filtered by it", async () => {
  render(<Cells count={1} />);
  const td = document.querySelector<HTMLElement>("td[data-master-cell]")!;
  await act(async () => td.focus());
  await act(async () => fireEvent.keyDown(td, { key: "d" }));
  await vi.waitFor(() => expect(document.querySelector("[data-list-popup]")).not.toBeNull());
  expect(rows()).toEqual(["Double"]);
});

test("a footer holds verbs that are not rows", () => {
  render(<Words footer={<button type="button">Clear target</button>} />);
  expect(screen.getByRole("button", { name: "Clear target" })).toBeTruthy();
  expect(rows()).not.toContain("Clear target");
});
