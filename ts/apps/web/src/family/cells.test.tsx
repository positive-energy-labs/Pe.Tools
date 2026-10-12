// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vite-plus/test";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { availableTransitions, transitionPatches, type FamilyDraft } from "@pe/agent-contracts";

import type { CellWire } from "#/components/lang/band";
import type { FieldState } from "#/family/host";
import { initialDraft, savedFrom } from "#/family/model";
import { familySource } from "#/family/source";
import { familyLockOf, type FamilyStore } from "#/family/store";
import { FamilyWorkspaceProvider } from "#/family/workspace-context";
import { useFamilyWorkspaceCore } from "#/family/workspace-core";
import { FamilyWorkspaceDocPane } from "#/family/workspace-doc-pane";
import { useFamilyTypeColumn } from "#/family/workspace-type-column";

vi.mock("#/lib/token", () => ({ token: () => "currentColor", dash: () => "none" }));
afterEach(cleanup);

const raw = JSON.stringify({
  family: { name: "Box" },
  parameters: {
    Width: { dataType: "Length", value: "24in" },
    Height: { dataType: "Length", value: "12in" },
  },
  types: { Standard: {}, Wide: { Width: "36in" } },
});
const TYPE = "/types/Wide/Width";
const FAMILY = "/parameters/Height/value";
const fields: Record<string, FieldState> = {
  [TYPE]: { proposal: { value: "40in" } },
  [FAMILY]: { proposal: { value: "10in" } },
};
const drawn = (key: string, lock: string | null = null) =>
  availableTransitions(fields[key]!, "human", { lock }).filter((kind) => kind !== "stage");

/** The real core and its real cells over a Family Work, with the store's plumbing stubbed. */
function Harness({ wire }: { wire: CellWire }) {
  const lane = familySource(
    {
      sha256: null,
      rawContent: raw,
      composedContent: raw,
      validation: { isValid: true, issues: [] },
    },
    null,
    fields,
  );
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
    inspect: { kind: "param", name: "Height" },
    actions: new Proxy({}, { get: () => () => undefined }),
  } as unknown as FamilyStore;
  const core = useFamilyWorkspaceCore(store);
  const width = core.rows.find((row) => row.name === "Width")!;
  return (
    <>
      <section aria-label="table">{useFamilyTypeColumn(core)("Wide").cell!(width)}</section>
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
    .filter((name) => name === "accept" || name === "deny" || name === "unstage");

test("a Family table cell and a doc-pane field draw exactly the contract's transitions", async () => {
  const write = vi.fn(async () => null);
  render(<Harness wire={{ segment: "cells", revision: 3, write }} />);
  const table = screen.getByRole("region", { name: "table" });
  expect(verbs(table)).toEqual(drawn(TYPE));
  // The inspector's family value is the same kind of cell on its own field.
  const inspector = screen.getByDisplayValue("10in").closest<HTMLElement>(".dl-cell")!;
  expect(verbs(inspector.parentElement!)).toEqual(drawn(FAMILY));
  // The sidebar card is the same field as a ReviewRow: the cell's verbs, not the card's.
  const card = screen.getByText("Width · Wide").closest<HTMLElement>(".grid")!;
  expect(verbs(card)).toEqual(drawn(TYPE));

  await act(async () => fireEvent.click(within(table).getByRole("button", { name: "accept" })));
  expect(write).toHaveBeenCalledWith(
    transitionPatches(["cells"], TYPE, fields[TYPE]!, { kind: "accept" }),
    3,
  );
});

test("a locked Family cell draws deny only, and a shared-source pointer is such a lock", () => {
  render(
    <Harness
      wire={{
        segment: "cells",
        revision: 3,
        write: async () => null,
        lockOf: (key) => (key === TYPE ? "shared source" : null),
      }}
    />,
  );
  expect(verbs(screen.getByRole("region", { name: "table" }))).toEqual(["deny"]);
  const shared = { parameters: { $preset: "@local/_params/width" } } as unknown as FamilyDraft;
  expect(familyLockOf(shared)(FAMILY)).toContain("shared source");
  expect(familyLockOf(JSON.parse(raw))(FAMILY)).toBeNull();
});
