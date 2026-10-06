// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vite-plus/test";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { transitionPatches } from "@pe/agent-contracts";

import type { CellWire } from "#/components/lang/band";
import { AnatomyDrawing } from "#/family/anatomy";
import type { FieldState } from "#/family/host";
import { initialDraft, savedFrom } from "#/family/model";
import { familySource } from "#/family/source";
import type { FamilyStore } from "#/family/store";
import { FamilyWorkspaceProvider } from "#/family/workspace-context";
import { useFamilyWorkspaceCore } from "#/family/workspace-core";
import { FamilyWorkspaceDocPane } from "#/family/workspace-doc-pane";
import { useFamilyTypeColumn } from "#/family/workspace-type-column";

vi.mock("#/lib/token", () => ({ token: () => "currentColor", dash: () => "none" }));
afterEach(cleanup);

const raw = JSON.stringify({
  family: { name: "Box" },
  parameters: { Width: { dataType: "Length", value: "24in" } },
  // capture order, as Revit reports it
  types: { "HCB 30": {}, "HCB 04": { Width: "30in" }, "HCB 12": {}, "HCB 06": {} },
});
const snapshot = {
  sha256: null,
  rawContent: raw,
  composedContent: raw,
  validation: { isValid: true, issues: [] },
};

// Pointers the reading does not hold, in the shapes Pea sends them.
const SPEC = "/parameters/PE_Pressure";
const OVERRIDE = "/types/HCB 06/PE_Pressure";
const NESTED = "/nested/pump";
const CONNECTOR = "/connectors/c1";
const FORM = "/forms/body";
const fields: Record<string, FieldState> = {
  [SPEC]: { proposal: { value: { dataType: "Number", value: "2" }, note: "from the cut sheet" } },
  [OVERRIDE]: { proposal: { value: "4" } },
  [NESTED]: { proposal: { value: { family: "Pump", type: "Std", host: "Level" } } },
  [CONNECTOR]: { proposal: { value: { domain: "Duct", shape: "Round" } } },
  [FORM]: { proposal: { value: { kind: "Prism" } } },
  "/types/HCB 04/Width": { proposal: { value: "36in" } },
};

test("types collate naturally, whatever order Revit reported them in", () => {
  const { world } = familySource(snapshot, null, {});
  expect(world.typeNames).toEqual(["HCB 04", "HCB 06", "HCB 12", "HCB 30"]);
  expect(world.mergeAnchor).toBe("HCB 04");
});

test("proposals the reading lacks become a proposed row and proposed constituents", () => {
  const { world } = familySource(snapshot, null, fields);
  const row = world.paramRows.find((entry) => entry.name === "PE_Pressure");
  expect(row).toMatchObject({ kind: "profile", proposed: true, dataType: "Number" });
  expect(world.paramRows.filter((entry) => entry.name === "Width")).toHaveLength(1);
  expect(
    world.constituents
      .filter((part) => part.proposed)
      .map((part) => [part.slug, part.kind, part.proposed, part.text]),
  ).toEqual([
    ["pump", "nested", NESTED, "Pump · Std · on Level"],
    ["c1", "connector", CONNECTOR, "Duct · Round"],
    ["body", "solid", FORM, "Prism"],
  ]);
  // none of the three constituents is mistaken for a parameter named after its slug
  expect(world.paramRows.map((entry) => entry.name)).toEqual(["Width", "PE_Pressure"]);
});

/** The real core over a Family Work, the store's plumbing stubbed. */
function Harness({ wire }: { wire: CellWire }) {
  const lane = familySource(snapshot, null, fields);
  const draft = initialDraft(lane.world);
  const store = {
    lane,
    draft,
    saved: savedFrom(draft),
    fields,
    wire,
    overlay: "draft",
    docMode: "text",
    docZoom: 1,
    drillType: null,
    inspect: null,
    actions: new Proxy({}, { get: () => () => undefined }),
  } as unknown as FamilyStore;
  const core = useFamilyWorkspaceCore(store);
  const proposed = core.rows.find((row) => row.name === "PE_Pressure")!;
  const width = core.rows.find((row) => row.name === "Width")!;
  const column = useFamilyTypeColumn(core);
  return (
    <>
      <section aria-label="override">{column("HCB 06").cell!(proposed)}</section>
      <section aria-label="width">{column("HCB 04").cell!(width)}</section>
      <section aria-label="constituents">
        <AnatomyDrawing
          world={core.world}
          draft={draft}
          typeName="HCB 04"
          model={null}
          focusedParts={new Set()}
          focusedParams={new Set()}
          onFocus={() => undefined}
          onInspect={() => undefined}
          inspecting={null}
          fields={fields}
          transitionsAt={core.transitionsAt}
        />
      </section>
      <FamilyWorkspaceProvider
        value={
          { ...core, bindPicker: () => null } as unknown as Parameters<
            typeof FamilyWorkspaceProvider
          >[0]["value"]
        }
      >
        <FamilyWorkspaceDocPane />
      </FamilyWorkspaceProvider>
    </>
  );
}

const verbs = (scope: HTMLElement) =>
  within(scope)
    .queryAllByRole("button")
    .map((button) => button.getAttribute("aria-label") ?? button.textContent)
    .filter((name) => name === "accept" || name === "deny");

test("a cell draws Pea's value and keeps the original for the tooltip", () => {
  render(<Harness wire={{ segment: "cells", revision: 3, write: async () => null }} />);
  const width = screen.getByRole("region", { name: "width" });
  // the type holds 30in; Pea proposes 36in: the cell prints 36in, hover says 30in
  const cell = within(width).getByDisplayValue("36in").closest<HTMLElement>(".dl-cell")!;
  expect(within(width).queryByDisplayValue("30in")).toBeNull();
  expect(cell.dataset.body).toBe("proposed");
  expect(cell.title).toContain("currently 30in");
  expect(cell.title).toContain("proposed by pea");
});

test("a proposal on a parameter the reading lacks draws in its row, and accept writes it", async () => {
  const write = vi.fn(async () => null);
  render(<Harness wire={{ segment: "cells", revision: 3, write }} />);
  const override = screen.getByRole("region", { name: "override" });
  expect(within(override).getByDisplayValue("4")).toBeTruthy();
  expect(verbs(override)).toEqual(["accept", "deny"]);
  await act(async () => fireEvent.click(within(override).getByRole("button", { name: "accept" })));
  expect(write).toHaveBeenCalledWith(
    transitionPatches(["cells"], OVERRIDE, fields[OVERRIDE]!, { kind: "accept" }),
    3,
  );
});

test("proposed constituents list with the cell's own verbs", async () => {
  const write = vi.fn(async () => null);
  render(<Harness wire={{ segment: "cells", revision: 3, write }} />);
  const list = screen.getByRole("region", { name: "constituents" });
  for (const slug of ["pump", "c1", "body"]) expect(within(list).getByText(slug)).toBeTruthy();
  expect(within(list).getByText("Pump · Std · on Level")).toBeTruthy();
  const pump = within(list).getByText("pump").closest<HTMLElement>("[role=option], li, div")!;
  await act(async () =>
    fireEvent.click(within(pump.parentElement!).getAllByRole("button", { name: "deny" })[0]!),
  );
  expect(write).toHaveBeenCalledTimes(1);
});

test("the sidebar card drops the proposed mark, and its constituent card is labelled", () => {
  render(<Harness wire={{ segment: "cells", revision: 3, write: async () => null }} />);
  expect(screen.queryByText(/proposed · pea/)).toBeNull();
  expect(screen.getByText("nested · pump")).toBeTruthy();
  expect(screen.getByText("PE_Pressure · family value")).toBeTruthy();
});
