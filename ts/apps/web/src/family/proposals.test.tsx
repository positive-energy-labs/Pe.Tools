// @vitest-environment jsdom
import { transitionPatches } from "@pe/agent-contracts";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";

import type { CellWire } from "#/components/work/band";
import { AnatomyDrawing } from "#/family/anatomy";
import type { FieldState } from "#/family/host";
import { initialDraft, savedFrom } from "#/family/model";
import { familySource } from "#/family/source";
import type { FamilyStore } from "#/family/store";
import { FamilyWorkspaceProvider } from "#/family/workspace-context";
import { useFamilyWorkspaceCore } from "#/family/workspace-core";
import { FamilyWorkspaceDocPane } from "#/family/workspace-doc-pane";
import { useFamilyIdentityColumns } from "#/family/workspace-identity-columns";
import { useFamilyTypeColumn } from "#/family/workspace-type-column";
import type { TableState } from "@pe/kit/table/model";

vi.mock("@pe/kit/lib/token", () => ({ token: () => "currentColor", dash: () => "none" }));
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
  [SPEC]: { suggestion: { value: { dataType: "Number", value: "2" }, note: "from the cut sheet" } },
  [OVERRIDE]: { suggestion: { value: "4" } },
  [NESTED]: { suggestion: { value: { family: "Pump", type: "Std", host: "Level" } } },
  [CONNECTOR]: { suggestion: { value: { domain: "Duct", shape: "Round" } } },
  [FORM]: { suggestion: { value: { kind: "Prism" } } },
  "/types/HCB 04/Width": { suggestion: { value: "36in" } },
};

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
    .filter((name) => name === "take" || name === "unsuggest");

test("a suggestion on a parameter the reading lacks draws in its row, and accept writes it", async () => {
  const write = vi.fn(async () => null);
  render(<Harness wire={{ segment: "cells", revision: 3, write }} />);
  const override = screen.getByRole("region", { name: "override" });
  expect(within(override).getByDisplayValue("4")).toBeTruthy();
  expect(verbs(override)).toEqual(["unsuggest", "take"]);
  await act(async () => fireEvent.click(within(override).getByRole("button", { name: "take" })));
  expect(write).toHaveBeenCalledWith(
    transitionPatches(["cells"], OVERRIDE, fields[OVERRIDE]!, { kind: "take" }),
    3,
  );
});

// ── proposals about ONE PROPERTY of something the reading holds ─────────────────────────────────

const heldRaw = JSON.stringify({
  family: { name: "Box" },
  parameters: { Width: { dataType: "Length", value: "24in", propertiesGroup: "Other" } },
  types: { Standard: {} },
  connectors: { c1: { domain: "Duct", shape: "Round", on: "Front" } },
});
const held = {
  sha256: null,
  rawContent: heldRaw,
  composedContent: heldRaw,
  validation: { isValid: true, issues: [] },
};

function PropertyHarness({
  fields: wired,
  wire,
}: {
  fields: Record<string, FieldState>;
  wire: CellWire;
}) {
  const lane = familySource(held, null, wired);
  const draft = initialDraft(lane.world);
  const store = {
    lane,
    draft,
    saved: savedFrom(draft),
    fields: wired,
    wire,
    overlay: "draft",
    docMode: "text",
    docZoom: 1,
    drillType: null,
    inspect: null,
    actions: new Proxy({}, { get: () => () => undefined }),
  } as unknown as FamilyStore;
  const core = useFamilyWorkspaceCore(store);
  const width = core.rows.find((row) => row.name === "Width")!;
  const identity = useFamilyIdentityColumns(core);
  const column = useFamilyTypeColumn(core);
  return (
    <>
      <section aria-label="identity">
        {identity.identityColumn({} as TableState).cell!(width)}
      </section>
      <section aria-label="standard">{column("Standard").cell!(width)}</section>
      <section aria-label="constituents">
        <AnatomyDrawing
          world={core.world}
          draft={draft}
          typeName="Standard"
          model={null}
          focusedParts={new Set()}
          focusedParams={new Set()}
          onFocus={() => undefined}
          onInspect={() => undefined}
          inspecting={null}
          fields={wired}
          transitionsAt={core.transitionsAt}
        />
      </section>
    </>
  );
}

test.each([
  ["/parameters/Width/isInstance", false, "isInstance false"],
  ["/parameters/Width/formula", "Height * 2", "formula Height * 2"],
  ["/parameters/Width/propertiesGroup", "Dimensions", "propertiesGroup Dimensions"],
])(
  "%s is a proposed property of its row, never the family-level value",
  async (pointer, value, words) => {
    const wired: Record<string, FieldState> = { [pointer]: { suggestion: { value } } };
    const write = vi.fn(async () => null);
    const { world } = familySource(held, null, wired);
    expect(world.proposals).toMatchObject([{ param: "Width", property: pointer.split("/")[3] }]);
    render(<PropertyHarness fields={wired} wire={{ segment: "cells", revision: 3, write }} />);
    const identity = screen.getByRole("region", { name: "identity" });
    const cell = within(identity).getByText(words).closest<HTMLElement>(".dl-cell")!;
    expect(cell.dataset.body).toBe("proposed");
    expect(verbs(identity)).toEqual(["unsuggest", "take"]);
    // the type cell on the row owns no fold: the suggestion is not about its value
    const standard = screen.getByRole("region", { name: "standard" });
    expect(standard.querySelector("[data-body=proposed]")).toBeNull();
    await act(async () => fireEvent.click(within(identity).getByRole("button", { name: "take" })));
    expect(write).toHaveBeenCalledWith(
      transitionPatches(["cells"], pointer, wired[pointer]!, { kind: "take" }),
      3,
    );
  },
);

test("/connectors/c1/on is a proposed property of the held constituent", async () => {
  const pointer = "/connectors/c1/on";
  const wired: Record<string, FieldState> = { [pointer]: { suggestion: { value: "Back" } } };
  const write = vi.fn(async () => null);
  const { world } = familySource(held, null, wired);
  expect(world.constituents.filter((part) => part.slug === "c1")).toHaveLength(1);
  expect(world.constituents.find((part) => part.slug === "c1")).toMatchObject({
    proposedProps: [{ id: pointer, property: "on", text: "Back" }],
  });
  render(<PropertyHarness fields={wired} wire={{ segment: "cells", revision: 3, write }} />);
  const list = screen.getByRole("region", { name: "constituents" });
  expect(within(list).getByText("on Back")).toBeTruthy();
  await act(async () => fireEvent.click(within(list).getByRole("button", { name: "take" })));
  expect(write).toHaveBeenCalledWith(
    transitionPatches(["cells"], pointer, wired[pointer]!, { kind: "take" }),
    3,
  );
});
