// @vitest-environment jsdom
/**
 * Attributed exclusions on the plan sheet: the host's plan result says who held each family back
 * (`excluded: [{ familyId, by }]`); the sheet says it by family name, never by id.
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";

const client = vi.hoisted(() => ({ runSemanticAction: vi.fn() }));
vi.mock("../../../../packages/mcps/src/shared/takeoff-action-client", () => client);

import { PlanSheetView } from "#/route/plan-sheet";
import type { PlanSheet } from "#/route";
import { manifest } from "./manifest";

afterEach(cleanup);

const row = (familyId: number, familyName: string) => ({
  familyId,
  familyName,
  planHash: `p-${familyId}`,
  changes: [],
  runEffects: ["x"],
  refusals: [],
  warnings: [],
});
const ctx = (cells: Record<string, unknown> = {}) => ({
  target: { kind: "document", ref: { session: "s", openId: "o" } },
  work: {
    key: { route: "families", target: null },
    doc: { scope: null, cells, excluded: { Beta: { by: "pea" }, Gamma: { by: "person" } } },
    revision: 4,
  },
  readings: {
    pods: {
      state: "ready",
      observation: [
        {
          id: "pod",
          members: [
            {
              path: "a.json",
              sha256: "8".repeat(64),
              schema: "/schemas/settings/family-foundry/patch.schema.json",
            },
          ],
        },
      ],
    },
  },
  page: {
    stage: "apply",
    pod: "pod",
    path: "a.json",
    selection: [],
    confirming: false,
    sheet: null,
    draft: { placement: "AllLoaded", categories: [], families: [] },
  },
  write: vi.fn(async () => null),
  setPage: vi.fn(),
});

test("plan carries who held each family back, by name, onto the sheet", async () => {
  client.runSemanticAction.mockResolvedValueOnce({
    state: "succeeded",
    result: {
      id: "plan-1",
      plan: [row(3101, "Alpha"), row(3102, "Beta"), row(3103, "Gamma")],
      excluded: [
        { familyName: "Beta", by: "pea" },
        { familyName: "Gamma", by: "person" },
      ],
    },
  });
  const c = ctx();
  await manifest.actions!.plan.run(c as never, undefined as never);
  const sheet = (c.setPage.mock.calls[0]![0] as { sheet: PlanSheet }).sheet;
  expect(sheet.held).toEqual([
    { name: "Beta", by: "pea" },
    { name: "Gamma", by: "person" },
  ]);

  render(
    <PlanSheetView
      sheet={sheet}
      excluded={new Set(["Beta", "Gamma"])}
      included={sheet.entries.filter((entry) => entry.id === "Alpha")}
      apply={() => {}}
      cancel={() => {}}
      replan={{ says: "plans the saved spec", run: () => {} }}
      refusal={null}
      busy={false}
    />,
  );
  const text = document.body.textContent!;
  expect(text).toContain("excluded by Pea: Beta");
  expect(text).toContain("excluded by you: Gamma");
  expect(text).not.toMatch(/excluded by (Pea|you): 310/);
});
