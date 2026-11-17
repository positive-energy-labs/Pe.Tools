// @vitest-environment jsdom
/**
 * The worksheet table (UI5, 2026-10-29, live on cloud Chadds MUAS-1): the side caption counts the
 * rows it shows, and a terminal stating no flow of its own reads the flow its run carries with
 * where that came from, never the alarm "none".
 */
import { cleanup, fireEvent, render, screen, act } from "@testing-library/react";
import { afterEach, expect, it } from "vite-plus/test";
import type { DuctsInputs } from "@pe/agent-contracts";
import type { Detail } from "@pe/ducts-web/calc/model";
import { derivedFlowSource, sideCaption, CalcBreakdown } from "./calc-breakdown-table.tsx";
import { fansCalcEditsSchema } from "@pe/ducts-contract/duct-inputs";
import { fixture, key as workKey, roster as capturedRoster } from "../../../../../apps/host/tests/host-read-graph.test-support";
import { snapshot as testSnapshot } from "@pe/ducts-domain/test-fixture";
import { elementSubject } from "@pe/ducts-domain/work-subject";
import { stableFanKey } from "@pe/ducts-web/calc/model";

afterEach(cleanup);

it("a breakdown edit reaches UniqueId Work and reprices the recorded fan", async () => {
  const snapshot = structuredClone(testSnapshot);
  const unit = snapshot.nodes.find(n => n.id === 100)!;
  unit.id = 14577391;
  unit.uniqueId = capturedRoster.nodes.find(n => n.id === unit.id)!.uniqueId;
  unit.connectors[0]!.index = 2;
  for (const e of [...snapshot.nodes, ...snapshot.segments]) for (const c of e.connectors)
    if (c.connectedTo?.elementId === 100) c.connectedTo = { elementId: unit.id, connector: 2 };
  snapshot.groups[0]!.rootIds = [unit.id];
  const host = await fixture(false, { snapshot });
  try {
    const roster = await host.send(0, []);
    const fan = roster.value!.data.rows.find(row => row.mark === "MUAS-1")!;
    const selected = [stableFanKey(fan)];
    const before = (await host.send(1, selected)).value!.data;
    const ws = before.open!.calcBreakdown!;
    const run = [...ws.supply.runs, ...ws.return.runs].find(r => r.end.kind === "terminal")!;
    const node = snapshot.nodes.find(n => n.id === run.end.elementId)!;
    const subject = elementSubject(node);
    await host.workspace.start(workKey("fans"), before.fansWork, "human");
    let pending: Promise<unknown> | undefined;
    const { container } = render(<CalcBreakdown ws={ws} editing={{
      inputs: before.calcView.inputs, busy: false, subjectFor: () => subject,
      changeInputs: edits => { const flows = fansCalcEditsSchema.parse(edits).flows!;
        pending = host.workspace.apply(workKey("fans"), "fans", "human", Object.entries(flows).map(([key, value]) => ({ path: ["flows", key, "edit"], value: { value } })), 1); },
    }} />);
    const input = container.querySelector(`[data-sheet-cell='design cfm at ${node.id}'] input`)!;
    await act(async () => {
      fireEvent.change(input, { target: { value: "432" } }); fireEvent.blur(input);
      await pending;
    });
    const after = (await host.send(2, selected)).value!.data;
    expect(after.fansWork.flows[subject]?.edit?.value).toBe(432);
    expect(after.calcView.inputs?.terminals[String(node.id)]?.cfm).toMatchObject({ value: 432, source: "Work" });
    const priced = after.open!.calcBreakdown!;
    expect([...priced.supply.runs, ...priced.return.runs].find(r => r.id === run.id)?.cfm).toBe(432);
    expect(after.open?.calcBreakdown?.basis).not.toBe(ws.basis);
  } finally { await host.close(); }
});

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
    limits: { supplyFpm: 900, returnFpm: 700, supplySource: "firm:seed", returnSource: "firm:seed" },
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
  const key = "UniqueId:33aa576c-31d0-4633-b2a9-d7becda6ca74-00d6f76b";
  let changed: unknown;
  const { container } = render(
    <CalcBreakdown ws={ws} editing={{ inputs, subjectFor: () => key, changeInputs: edits => { changed = edits; }, busy: false }} />,
  );
  const cell = container.querySelector("[data-sheet-cell='design cfm at 14088043']")!;
  expect(cell.querySelector("input")?.value).toBe("");
  expect(screen.getByText("350 cfm computed ? consumers")).toBeTruthy();
  const source = cell.querySelector("[data-input-source]")!;
  expect(source.textContent).toBe("none");
  expect(source.getAttribute("data-tone")).toBe("alarm");
  fireEvent.change(cell.querySelector("input")!, { target: { value: "420" } });
  fireEvent.blur(cell.querySelector("input")!);
  expect(fansCalcEditsSchema.parse(changed).flows).toEqual({ [key]: 420 });

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
    limits: { supplyFpm: 900, returnFpm: 700, supplySource: "firm:seed", returnSource: "firm:seed" },
    supply: side(runs, worst), return: side([], null),
    legs: { l1: leg("l1", 200, 0.05), l2: leg("l2", null, null) },
  }) as unknown as Ws;
  const editing = { inputs: null, changeInputs: () => {}, busy: false };
  const both = render(<CalcBreakdown ws={ws([run("r1", "l1", true, 0.05), run("r2", "l2", false, 0)], 0.05)} editing={editing} />);
  const incomplete = both.container.querySelector("[data-run='r2']")!;
  const cells = [...incomplete.querySelectorAll(".face-mono.text-right")].map((c) => c.textContent);
  // cfm, then TEL and loss: nothing drawn for either.
  expect(cells.slice(1, 3)).toEqual(["", ""]);
  expect(incomplete.textContent).not.toMatch(/\b0(\.0+)?\b/);
  expect(incomplete.textContent).toContain("no flow");
  const caption = both.container.querySelector("[data-calc-breakdown-caption='supply']")!.textContent!;
  expect(caption).toContain("1 of 2 branches known");
  expect(caption).toContain("worst known 0.0500");
  both.unmount();

  // No complete branch: the caption counts and names no worst.
  const none = render(<CalcBreakdown ws={ws([run("r2", "l2", false, 0)])} editing={editing} />);
  const bare = none.container.querySelector("[data-calc-breakdown-caption='supply']")!.textContent!;
  expect(bare).toContain("0 of 1 branches known");
  expect(bare).not.toMatch(/worst|0\.0000/);
});

it("each side labels the home that served its own velocity limit", () => {
  const side = (name: string) => ({ runs: [{ id: name, side: name, end: { kind: "terminal", elementId: 1 }, legIds: [], sectionIds: [], complete: true, telFt: 20, knownInWg: 0.03, residualInWg: null, maxFpm: null, cfm: 100, overLegIds: [] }], sections: [], worstKnownInWg: null, elementSections: {} });
  const ws = { kind: "worksheet", limits: { supplyFpm: 800, returnFpm: 700, supplySource: "project", returnSource: "firm" }, supply: side("supply"), return: side("return"), legs: {} } as unknown as Ws;
  const { container } = render(<CalcBreakdown ws={ws} editing={{ inputs: null, changeInputs: () => {}, busy: false }} />);
  expect(container.querySelector("[data-calc-breakdown-caption='supply']")!.textContent).toContain("over 800 fpm (project)");
  expect(container.querySelector("[data-calc-breakdown-caption='return']")!.textContent).toContain("over 700 fpm (firm)");
});
