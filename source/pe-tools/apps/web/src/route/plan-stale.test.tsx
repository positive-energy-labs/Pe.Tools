// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";

import { entityRoute, sheetOf, STALE_PLAN, type PlanSheet } from "./manifest";
import { PlanSheetView } from "./plan-sheet";

afterEach(cleanup);

const entry = {
  id: "3101",
  name: "A",
  planHash: "p",
  actions: 1,
  detail: "",
  flag: null,
  warnings: [],
  source: { pod: "p", path: "gen/a.json", sha256: "8".repeat(64) },
};
type Cells = Record<string, { staged?: { value: string } | null }>;
let cells: Cells = {};
const def = {
  key: "families",
  name: "Families",
  entity: "family",
  target: "document" as const,
  schema: "/schemas/x.json",
  capture: "families.capture" as never,
  apply: "families.apply" as never,
  staged: {
    cells: () => cells,
    plan: async () => ({ entries: [entry] }),
    apply: async () => {},
  },
};
const route = entityRoute(def as never);
const ctx = (page: Record<string, unknown>) =>
  ({
    target: { kind: "document", ref: { session: "s", openId: "o" } },
    work: { key: {}, doc: { cells }, revision: 4 },
    readings: {},
    page: {
      stage: "apply",
      pod: "p",
      path: "",
      selection: [],
      confirming: false,
      sheet: null,
      ...page,
    },
    write: vi.fn(),
    setPage: vi.fn(),
  }) as never;

test("a plan whose staged cells moved is stale before the press, in the host's words", async () => {
  cells = { "3101::Voltage": { staged: { value: "240V" } }, "3101::Amps": { staged: null } };
  const planning = ctx({});
  await route.actions!.plan.run(planning, undefined as never);
  const sheet = (planning as { setPage: ReturnType<typeof vi.fn> }).setPage.mock.calls.at(-1)![0]
    .sheet as PlanSheet;
  // The sheet carries the staged values the plan read, and nothing unstaged.
  expect(sheet.staged).toEqual({ "3101::Voltage": { value: "240V" } });

  const confirming = () => ctx({ confirming: true, sheet });
  expect(sheetOf(def as never, confirming() as never)!.stale).toBe(false);
  expect(route.actions!.apply.ready(confirming(), undefined as never)).toBe(null);

  // A proposal elsewhere, or a newly staged cell the plan did not read, leaves it fresh.
  cells = { ...cells, "3102::Voltage": { staged: { value: "120V" } } };
  expect(route.actions!.apply.ready(confirming(), undefined as never)).toBe(null);

  // The staged value the plan read moved: stale, and apply refuses with the host's words.
  cells = { ...cells, "3101::Voltage": { staged: { value: "208V" } } };
  expect(sheetOf(def as never, confirming() as never)!.stale).toBe(true);
  expect(route.actions!.apply.ready(confirming(), undefined as never)).toBe(STALE_PLAN);

  render(
    <PlanSheetView
      sheet={sheet}
      excluded={new Set()}
      included={sheet.entries}
      apply={() => {}}
      cancel={() => {}}
      replan={() => {}}
      refusal={STALE_PLAN}
      stale
      busy={false}
    />,
  );
  // The sheet's own line says it, beside the refused apply's reason.
  const line = screen.getByText("stale plan").parentElement!;
  expect(line.textContent).toContain(STALE_PLAN);
});
