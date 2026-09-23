// @vitest-environment jsdom
/**
 * The Families door's refusal, drawn for a person (mission 25 item 2, M13-3): one sentence per
 * `code` from its structured parts. The raw `agentHint` is Pea's, and sits behind a disclosure.
 */
import type { FamiliesRefusal } from "@pe/agent-contracts";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, test } from "vite-plus/test";

import { Table } from "#/components/master-table/table";
import { writeRefusal } from "#/route/refusal";
import { SituationAction } from "#/route/situation";

import { useFamiliesColumns, type ParamColumn, type TypeRow } from "./matrix-columns";

afterEach(cleanup);

const HINT =
  "1 cell key(s) name no type of a family loaded in this Work's scope. Read revit.catalog.loaded-families and fix what this names (the Work's scope, or its document open in Revit)";
const CELL_REFUSAL: FamiliesRefusal = {
  ok: false,
  kind: "refused",
  code: "unknown-family-type",
  cells: [
    {
      familyName: "Price LBP15A Exhaust",
      typeName: "12 X 4",
      parameter: "Mech Equip Model Number",
    },
  ],
  agentHint: HINT,
};
const SCOPE_REFUSAL: FamiliesRefusal = {
  ok: false,
  kind: "refused",
  code: "unknown-family",
  families: ["Price LBPH15A Exhaust"],
  agentHint:
    'the scope names 1 family not loaded under its categories and placement: "Price LBPH15A Exhaust". Fix what this names from revit.catalog.loaded-families',
};

/** The person's text: everything drawn except the disclosure's hidden body. */
const personText = (root: HTMLElement) => {
  const copy = root.cloneNode(true) as HTMLElement;
  copy.querySelectorAll("details > :not(summary)").forEach((node) => node.remove());
  return copy.textContent ?? "";
};

const PARAMETER = "Mech Equip Model Number";
const PARAMS = [
  {
    key: PARAMETER,
    name: PARAMETER,
    kind: "FamilyParameter",
    isInstance: false,
    isBuiltIn: false,
    isProjectOnly: false,
    familyCount: 1,
  } as ParamColumn,
];
const ROWS: TypeRow[] = [
  {
    key: "Price LBP15A Exhaust::12 X 4",
    familyId: 1,
    familyName: "Price LBP15A Exhaust",
    categoryName: "Air Terminals",
    typeName: "12 X 4",
    typeCount: 1,
    values: { [PARAMETER]: "LBP15A" },
    scopes: { [PARAMETER]: "Family" },
    formulas: { [PARAMETER]: "None" },
    storageTypes: { [PARAMETER]: "String" },
  },
];

function Matrix() {
  const { columns } = useFamiliesColumns({
    familyState: () => ({ word: "", tone: "mute", note: "" }),
    params: PARAMS,
    showUncommon: true,
    totalFamilies: 1,
    cells: {},
    wire: { segment: "cells", revision: 1, write: async () => null },
    propose: async () => writeRefusal(CELL_REFUSAL),
  });
  return <Table rows={ROWS} columns={columns} rowKey={(r) => r.key} label="families" />;
}

test("a door-refused cell edit names the refused cell in the person's words; Pea's hint is behind a disclosure", async () => {
  const view = render(<Matrix />);
  const input = view.container.querySelector<HTMLInputElement>("input.dl-cell-input")!;
  await act(async () => fireEvent.change(input, { target: { value: "LBP20A" } }));
  await act(async () => fireEvent.keyDown(input, { key: "Enter" }));
  expect(input.value).toBe("LBP15A");
  const text = personText(view.container);
  expect(text).toContain(
    "Price LBP15A Exhaust · 12 X 4 · Mech Equip Model Number: that family isn't in this page's scope",
  );
  expect(text).not.toContain("revit.catalog");
  expect(view.container.querySelector("details")?.textContent).toContain(HINT);
});

test("a refused apply scope names the unloaded family in the person's words; Pea's hint is behind a disclosure", () => {
  const refusal = writeRefusal(SCOPE_REFUSAL)!;
  render(
    <SituationAction
      handle={{ outcome: { key: "scope", refusal, at: 1 }, busy: null } as never}
      name="scope"
      action={
        {
          label: "apply scope",
          says: "",
          refusal: null,
          count: null,
          run: async () => null,
        } as never
      }
    />,
  );
  const text = personText(document.body);
  expect(text).toContain(
    "Price LBPH15A Exhaust: not loaded under this scope's categories and placement",
  );
  expect(text).not.toContain("revit.catalog");
  expect(document.body.querySelector("details")?.textContent).toContain(SCOPE_REFUSAL.agentHint);
});
