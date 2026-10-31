// @vitest-environment jsdom
/**
 * The worksheet table (UI5, 2026-10-29, live on cloud Chadds MUAS-1): the side caption counts the
 * rows it shows, and a terminal stating no flow of its own reads the flow its run carries with
 * where that came from, never the alarm "none".
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vite-plus/test";
import type { DuctsInputs } from "@pe/agent-contracts";
import type { Detail } from "./model";
import { derivedFlowSource, sideCaption, Worksheet } from "./worksheet-table";

afterEach(cleanup);

type Ws = Detail<"worksheet">;
const end = (kind: Ws["supply"]["runs"][number]["end"]["kind"], elementId: number) => ({
  end: { kind, elementId },
});

it("the caption counts every row: delivering runs, then the rest by word", () => {
  // MUAS-1 supply: two ERV inlets and FC-23's return, no terminal; it read "0 runs".
  expect(
    sideCaption([end("roster-fan-port", 1), end("joins-other-fan", 2), end("roster-fan-port", 3)]),
  ).toBe("3 runs");
  expect(
    sideCaption([
      end("terminal", 1),
      end("sibling-fan", 2),
      end("sibling-fan", 3),
      end("open-end", 4),
    ]),
  ).toBe("1 run · 2 siblings · 1 open end");
});

it("a derived flow's source is read from the end leg, never typed", () => {
  expect(
    derivedFlowSource("balance; splitPolicy:even+sibling 6104810: revit:PE_M_Fan_AirFlow:1"),
  ).toBe("consumers");
  expect(derivedFlowSource("balance; splitPolicy:even:1")).toBe("balance");
  expect(derivedFlowSource(null)).toBe("derived");
});

it("a shared louver with no stated flow shows the 350 its run carries, sourced to its consumers, not 'none'", () => {
  const leg = {
    id: "14088043:1>",
    elementId: 14088043,
    kind: "terminal",
    flowCfm: 350,
    flowSource: "balance; splitPolicy:even+sibling 6104810: revit:PE_M_Fan_AirFlow:1",
    velocityFpm: null,
    lossInWg: 0.03,
    lossSource: { kind: "default", ref: "firm" },
    equivalentFt: null,
  };
  const run = {
    id: "return:terminal:14088043:1",
    side: "return",
    end: { kind: "terminal", elementId: 14088043, connector: 1 },
    legIds: [leg.id],
    sectionIds: [],
    cfm: 350,
    telFt: 120,
    knownInWg: 0.0469,
    complete: true,
    residualInWg: 0,
    critical: true,
    maxFpm: null,
    overLegIds: [],
  };
  const ws = {
    target: { session: "s", openId: "o" },
    basis: "b",
    kind: "worksheet",
    limits: { supplyFpm: 900, returnFpm: 700, source: "firm:seed" },
    supply: { runs: [], sections: [], worstKnownInWg: null, elementSections: {} },
    return: { runs: [run], sections: [], worstKnownInWg: 0.0469, elementSections: {} },
    legs: { [leg.id]: leg },
  } as unknown as Ws;
  const inputs = {
    terminals: {
      "14088043": {
        cfm: { value: null, source: "none", ref: "PE_M_Grd_AirFlow" },
        drop: { value: 0.03, source: "firm", ref: "seed" },
      },
    },
  } as unknown as DuctsInputs;
  const { container } = render(
    <Worksheet ws={ws} editing={{ inputs, changeInputs: () => {}, busy: false }} />,
  );
  const cell = container.querySelector("[data-sheet-cell='design cfm at 14088043']")!;
  expect(cell.querySelector("input")?.value ?? cell.textContent).toContain("350");
  const source = cell.querySelector("[data-input-source]")!;
  expect(source.textContent).toBe("consumers");
  expect(source.getAttribute("data-tone")).toBeNull();
  expect(source.getAttribute("title")).toMatch(/^consumers' sum: balance/);
  expect(screen.getByText(/1 run · worst known 0\.0469/)).toBeTruthy();
});
