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
  expect(derivedFlowSource("balance; splitPolicy:even:1")).toBe("balance");
  expect(derivedFlowSource(null)).toBe("derived");
});

it("a shared louver keeps its authored flow empty and shows the computed consumer flow separately", () => {
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
        cfm: {
          value: null,
          source: "none",
          ref: "PE_M_Grd_AirFlow",
          units: null,
          version: null,
          status: "valid",
        },
        drop: {
          value: 0.03,
          source: "firm",
          ref: "seed",
          units: null,
          version: null,
          status: "valid",
        },
      },
    },
  } as unknown as DuctsInputs;
  const { container } = render(
    <Worksheet ws={ws} editing={{ inputs, changeInputs: () => {}, busy: false }} />,
  );
  const cell = container.querySelector("[data-sheet-cell='design cfm at 14088043']")!;
  expect(cell.querySelector("input")?.value).toBe("");
  expect(screen.getByText("350 cfm computed ? consumers")).toBeTruthy();
  const source = cell.querySelector("[data-input-source]")!;
  expect(source.textContent).toBe("none");
  expect(source.getAttribute("data-tone")).toBe("alarm");

  expect(screen.getByText(/1 run · 1 of 1 branches known · worst known 0\.0469/)).toBeTruthy();
});

/*
 * F1 (2026-11-10, scripted journey on main, step2-selectFan.png): incomplete rows read TEL 0 and
 * loss 0.0000 and the caption "worst known 0.0000". An incomplete branch draws no number, only its
 * reason; the caption counts the known branches and names a worst only over complete ones.
 */
it("an incomplete branch shows no zero, and the caption names the known count", () => {
  const leg = (id: string, flowCfm: number | null, lossInWg: number | null) => ({
    id, elementId: Number(id.slice(1)), kind: "duct", flowCfm, flowSource: null, velocityFpm: null,
    lossInWg, lossSource: { kind: "fitting" }, equivalentFt: lossInWg == null ? null : 40,
  });
  const run = (id: string, legId: string, complete: boolean, knownInWg: number) => ({
    id, side: "supply", end: { kind: "terminal", elementId: Number(legId.slice(1)), connector: 1 },
    legIds: [legId], sectionIds: [], cfm: complete ? 200 : null, telFt: complete ? 40 : 0,
    knownInWg, complete, residualInWg: null, critical: false, maxFpm: null, overLegIds: [],
  });
  // The domain's worst is over complete branches only (worksheet.ts); the table draws what it says.
  const side = (runs: unknown[], worst: number | null) => ({ runs, sections: [], worstKnownInWg: worst, elementSections: {} });
  const ws = (runs: unknown[], worst: number | null = null) => ({
    target: { session: "s", openId: "o" }, basis: "b", kind: "worksheet",
    limits: { supplyFpm: 900, returnFpm: 700, source: "firm:seed" },
    supply: side(runs, worst), return: side([], null),
    legs: { l1: leg("l1", 200, 0.05), l2: leg("l2", null, null) },
  }) as unknown as Ws;
  const editing = { inputs: null, changeInputs: () => {}, busy: false };
  const both = render(<Worksheet ws={ws([run("r1", "l1", true, 0.05), run("r2", "l2", false, 0)], 0.05)} editing={editing} />);
  const incomplete = both.container.querySelector("[data-run='r2']")!;
  const cells = [...incomplete.querySelectorAll(".face-mono.text-right")].map((c) => c.textContent);
  // cfm, then TEL and loss: nothing drawn for either.
  expect(cells.slice(1, 3)).toEqual(["", ""]);
  expect(incomplete.textContent).not.toMatch(/\b0(\.0+)?\b/);
  expect(incomplete.textContent).toContain("no flow");
  const caption = both.container.querySelector("[data-worksheet-caption='supply']")!.textContent!;
  expect(caption).toContain("1 of 2 branches known");
  expect(caption).toContain("worst known 0.0500");
  both.unmount();

  // No complete branch: the caption counts and names no worst.
  const none = render(<Worksheet ws={ws([run("r2", "l2", false, 0)])} editing={editing} />);
  const bare = none.container.querySelector("[data-worksheet-caption='supply']")!.textContent!;
  expect(bare).toContain("0 of 1 branches known");
  expect(bare).not.toMatch(/worst|0\.0000/);
});
