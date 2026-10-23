// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { createPortal } from "react-dom";
import { afterEach, expect, test } from "vite-plus/test";
import { Table } from "../src/components/master-table/table";
import { listOf, listModel, emptyListState, useList } from "../src/components/lang/collection";
import { ListView } from "../src/components/lang/list-view";
import type { Reading } from "@pe/agent-contracts";
import { rowDamage, type Column } from "../src/components/master-table/model";
import { RevitTarget, rowRevit } from "../src/components/lang/revit-target";
import { Row } from "../src/components/lang/row";
import { FactChip } from "../src/components/lang/chip";
import { SubjectText } from "../src/components/lang/subject-text";
import { SubjectTextContext } from "../src/components/lang/reach";

afterEach(cleanup);
const scope = { document: { session: "session", openId: "captured-document" }, source: "native" };

test("Row ids, chip ids and subject tokens carry their captured scope through portals and null boundaries", () => {
  const view = render(
    <RevitTarget scope={scope}>
      {createPortal(<Row label="fitting" revit={[42, 43]} />, document.body)}
      <FactChip title="captured fitting" revit={[42]}>
        chip
      </FactChip>
      <SubjectTextContext value={{ nameOf: () => "fitting" }}>
        <SubjectText text="42" revit={[42]} />
      </SubjectTextContext>
      <RevitTarget scope={null}>
        <Row label="unscoped" revit={[99]} />
      </RevitTarget>
    </RevitTarget>,
  );
  const row = document.querySelector('.dl-row[data-revit-ids="42,43"]');
  expect(row?.getAttribute("data-revit-scope")).toBe(JSON.stringify(scope));
  expect(
    screen.getByText("chip").closest("[data-revit-ids]")?.getAttribute("data-revit-scope"),
  ).toBe(JSON.stringify(scope));
  expect(view.container.querySelector(".subject-ref")?.getAttribute("data-revit-ids")).toBe("42");
  expect(view.container.querySelector(".subject-ref")?.getAttribute("data-revit-scope")).toBe(
    JSON.stringify(scope),
  );
  expect(document.querySelector('[data-revit-ids="99"]')?.getAttribute("data-revit-scope")).toBe(
    "null",
  );
});

test("native identities infer targets; composite and non-native keys do not invent ids", () => {
  expect(rowRevit({ elementId: 42 }, "name")).toEqual([42]);
  expect(rowRevit({ targetElementId: 43 }, "write:key")).toEqual([43]);
  expect(rowRevit({ room: { elementId: 44 } }, "guid")).toEqual([44]);
  expect(rowRevit({}, "45")).toEqual([45]);
  expect(rowRevit({}, "42:parameter")).toBeUndefined();
  expect(rowRevit({ elementId: -1 }, "profile")).toEqual([]);
  expect(rowRevit({ elementId: 3.5 }, "profile")).toEqual([]);
  expect(rowRevit({ elementId: null }, "42")).toEqual([]);
  const row = { id: 42, damage: "blocked" };
  const model = listModel(
    { items: [row], keyOf: () => "composite:42", search: () => ({ text: [], ids: [42] }) },
    emptyListState(),
  );
  expect(model.all[0]!.revit).toEqual([42]);
  expect(model.all[0]!.damage).toBe("blocked");
  expect(listOf({ state: "absent" }, () => [row]).items).toEqual([]);
  expect(
    listOf({ state: "loading", requestId: "read", deadline: 1, previous: [row] }, (rows) => rows)
      .items,
  ).toEqual([row]);
});

test("Reading lifecycle retains rows and damage across list and table with captured scope", () => {
  type Item = { key: string; elementId: number; missing: boolean };
  const items: Item[] = [{ key: "terminal", elementId: 42, missing: true }];
  const columns: Column<Item>[] = [
    {
      key: "flow",
      label: "flow",
      state: (row) => ({ value: "flow", damage: row.missing ? "no airflow" : null }),
    },
  ];
  function Fixture({ reading }: { reading: Reading<readonly Item[]> }) {
    const source = listOf(reading, (rows) => rows);
    const list = useList({
      ...source,
      keyOf: (row) => row.key,
      search: (row) => ({ text: [row.key] }),
    });
    return (
      <RevitTarget scope={scope}>
        <Table
          {...source}
          columns={columns}
          rowKey={(row) => row.key}
          state={{ query: "", sorts: [], hiddenColumns: ["flow"] }}
          label="readings"
        />
        <ListView
          list={list}
          aria-label="list readings"
          row={(row) => ({ label: row.key })}
          empty={{ message: "Empty", exit: "Read" }}
        />
      </RevitTarget>
    );
  }
  const view = render(<Fixture reading={{ state: "ready", observation: items }} />);
  expect(view.container.querySelector('tr[data-key="terminal"]')?.getAttribute("data-damage")).toBe(
    "no airflow",
  );
  expect(rowDamage(items[0], columns)).toBe("no airflow");
  expect(
    view.container.querySelectorAll('[data-key="terminal"][data-revit-ids="42"]'),
  ).toHaveLength(2);
  view.rerender(<Fixture reading={{ state: "stale", previous: items, reason: "dirtied" }} />);
  expect(view.container.querySelectorAll('[data-key="terminal"]')).toHaveLength(2);
  expect(
    screen.getAllByRole("status").some((node) => /reading/i.test(node.textContent ?? "")),
  ).toBe(true);
  view.rerender(<Fixture reading={{ state: "failed", previous: items, message: "offline" }} />);
  expect(view.container.querySelectorAll('[data-key="terminal"]')).toHaveLength(2);
  expect(screen.getAllByText("offline")).toHaveLength(2);
  expect(
    view.container.querySelector('tr[data-key="terminal"]')?.getAttribute("data-revit-scope"),
  ).toBe(JSON.stringify(scope));
  view.rerender(<Fixture reading={{ state: "ready", observation: [] }} />);
  expect(view.container.querySelectorAll('[data-key="terminal"]')).toHaveLength(0);
});
