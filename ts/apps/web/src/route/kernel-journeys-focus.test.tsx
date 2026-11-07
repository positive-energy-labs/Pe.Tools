// @vitest-environment jsdom
import { useState } from "react";
import { createPortal } from "react-dom";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { route } from "./typed-route";
import { module as fans } from "../fans/route";
import { TypedShell } from "../shell/typed-shell";
import * as mounts from "../shell/typed-mount";
import { workFingerprintSchema } from "@pe/agent-contracts";
import { ReviewSurface } from "../shell/review-surface";
import { RouteVisibility } from "./activity";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

test("JZ B04 read a long review, dismiss with Escape and return to its opener", async () => {
  function Journey() {
    const [open, setOpen] = useState(false);
    return <><button onClick={() => setOpen(true)}>Review airflows</button>{open && <ReviewSurface
      label="Update airflows" sentence="Change Supply" rows={Array.from({ length: 200 }, (_, i) => `Change ${i}`)}
      enabled confirm={() => { throw Error("Escape must not commit"); }} cancel={() => setOpen(false)} />}</>;
  }
  const view = render(<Journey />);
  const opener = screen.getByRole("button", { name: "Review airflows" });
  opener.focus();
  fireEvent.click(opener);
  const commit = await screen.findByRole("button", { name: "Commit Update airflows" });
  expect(view.container.contains(commit), "B04: review is portalled").toBe(false);
  expect(screen.getByText("Change 199"), "B04: final change is present").toBeTruthy();
  commit.focus();
  expect(document.activeElement).toBe(commit);
  fireEvent.keyDown(commit, { key: "Escape", code: "Escape" });
  await waitFor(() => expect(screen.queryByRole("button", { name: "Commit Update airflows" })).toBeNull());
  await waitFor(() => expect(document.activeElement, "B04: dismissal restores prior focus").toBe(opener));
  // Scroll reach and footer visibility require Driver layout evidence; jsdom cannot establish either.
});

test("JZ B02 undo follows focus between typed routes, portal and hidden pane; text keeps native undo", async () => {
  const live = mounts.mountTypedRoute;
  const owners: mounts.TypedMount[] = [];
  vi.spyOn(mounts, "mountTypedRoute").mockImplementation((...args) => {
    const owner = live(...args); owners.push(owner); return owner;
  });
  const make = (key: string) => route({ ...fans.spec, key, name: key, needs: "browser", core: undefined,
    subject: undefined, reads: {}, edits: undefined, commands: {}, fields: {},
    panes: { main: { title: key, purpose: "Focus ownership", draw: () => <><button>{key} focus</button><textarea aria-label={`${key} text`} />{createPortal(<button>{key} portal</button>, document.body)}</> } },
    layout: { kind: "pane", id: "main" } });
  const a = make("jz-a"), b = make("jz-b");
  const stamp = workFingerprintSchema.parse(`builtin-closure:${"a".repeat(64)}`);
  const address = () => ({ read: () => new URLSearchParams(), write: () => {}, subscribe: () => () => {} });
  const addressA = address(), addressB = address();
  function Journey() {
    const [hidden, setHidden] = useState(false);
    return <><button onClick={() => setHidden(true)}>Hide B</button><TypedShell module={a} fingerprint={stamp} address={addressA} />
      <RouteVisibility.Provider value={!hidden}><div hidden={hidden}><TypedShell module={b} fingerprint={stamp} address={addressB} /></div></RouteVisibility.Provider></>;
  }
  const root = createRootRoute({ component: Journey });
  const router = createRouter({ routeTree: root, history: createMemoryHistory({ initialEntries: ["/"] }) });
  render(<RouterProvider router={router} />);
  await screen.findByRole("button", { name: "jz-b focus" });
  expect(owners).toHaveLength(2);
  const undo = owners.map(owner => vi.spyOn(owner.history, "undo"));
  const press = (node: HTMLElement) => { node.focus(); const native = fireEvent.keyDown(node, { key: "z", code: "KeyZ", ctrlKey: true }); fireEvent.keyUp(node, { key: "z", code: "KeyZ", ctrlKey: true }); return native; };
  press(screen.getByRole("textbox", { name: "jz-a text" }));
  expect(undo.map(spy => spy.mock.calls.length), "B02: browser retains text undo").toEqual([0, 0]);
  press(screen.getByRole("button", { name: "jz-a focus" }));
  expect(undo.map(spy => spy.mock.calls.length), "B02: only the focused route receives undo").toEqual([1, 0]);
  press(screen.getByRole("button", { name: "jz-b portal" }));
  expect(undo.map(spy => spy.mock.calls.length), "B02: portal belongs to B").toEqual([1, 1]);
  fireEvent.click(screen.getByRole("button", { name: "Hide B" }));
  press(screen.getByRole("button", { name: "jz-a focus" }));
  expect(undo.map(spy => spy.mock.calls.length), "B02: hidden B cannot steal undo").toEqual([2, 1]);
});


// Chadds continuation at 2026-11-07T15:30:23Z: one human fan-flow edit, a refused
// missing parameter and ancillary loss/store writes. This is a reconstructed Plan,
// not a recovered native receipt. Keep this surface journey independent of run files.
import type { DuctsApply } from "@pe/host-contracts/generated";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import { inputsFor } from "@pe/ducts-domain/sheet/test-inputs";
import { lossPlanRefusal } from "../../../host/src/ducts-actions";
import { snapshot as ductsSeed } from "../ducts/test-fixture";
import { presentLosses } from "../ducts/reviews";
import { inputRows } from "../ducts/sheet/input-rows";
import { SheetCell } from "../ducts/sheet/sheet-cell";
import { writeHeld } from "../shell/admitted-chrome";
import { PreviewAction, WriteAction } from "@pe/kit/lang/write-action";

// Rule: refused human intent cannot authorize ancillary writes; review must name
// each element and its numeric current evidence, and disclose computed write-back.
test("JZ Fans Plan integrity: inspect refused flow and computed losses without authorizing Apply", () => {
  const fanId = 8775469;
  const slots = {
    fanStatic: "PE_M_Fan_ExternalStaticPressure", fanFlow: "PE_M_Fan_AirFlowDesign",
    componentDrop: "Pressure Drop", terminalDrop: "PE_M_Grd_ExternalStaticPressure",
    fittingCoefficient: "Pe_C", terminalFlow: "PE_M_Grd_AirFlow",
  };
  const snapshot: DuctSnapshot = {
    ...ductsSeed, slots,
    levels: [{ id: 1, name: "Level 1", elevationFt: 0 }, { id: 2, name: "Level 2", elevationFt: 10 }],
    nodes: [
      { id: fanId, kind: "equipment", category: "Mechanical Equipment", label: "MUAS-1",
        type: "MUAS 10", family: "Fantech", flowParameter: null, connectors: [], facts: [] },
      { id: 2, kind: "accessory", type: '10"', category: "Duct Accessories", partType: "Damper",
        levelId: 1, connectors: [], facts: [],
        loss: { method: "ashrae-table", coefficient: 0.19, table: "CD9-1", fields: {} } },
      { id: 3, kind: "accessory", type: '10"', category: "Duct Accessories", partType: "Damper",
        levelId: 2, connectors: [], facts: [] },
    ], segments: [],
  };
  const writes: DuctsApply.Res.Response["writes"] = [
    { id: 2, kind: "component", outcome: "planned", before: "ashrae-table", after: "specific-loss 0.0398 in-wg" },
    { id: fanId, kind: "equipment-flow", outcome: "refused", before: null,
      reason: "neither the instance nor its type has 'PE_M_Fan_AirFlowDesign'" },
    ...Object.entries(slots).map(([key, after]) => ({ kind: "slot", key, before: null, after, outcome: "planned" })),
    { kind: "store", before: "absent", after: "revision 1", outcome: "planned" },
    { kind: "store", key: "instances", before: null, after: "updated", outcome: "planned" },
  ];
  const refusal = lossPlanRefusal(writes);
  const preview = {
    previewOnly: true,
    seal: { caller: { kind: "human", via: "local" }, requestHash: "fans-plan-integrity",
      work: {}, documentMark: { session: "recorded-chadds", openId: "chadds", observedSince: 1, changedAt: 1 },
      incarnation: null, dependencies: "recorded-chadds" },
    ...(refusal ? { planRefusal: `MUAS-1: ${refusal}; add the parameter to the family or map flow to an existing parameter` } : {}),
    value: { writes, counts: { planned: 9, refused: 1, unchanged: 0, written: 0 } },
    derivedRequest: { slots, equipmentFlows: [{ id: fanId, cfm: 1000 }],
      components: [{ id: 2, inWg: 0.0398, source: "damper CD9-1 C=0.19" }] },
  };
  const review = presentLosses(preview, { readings: { sheetSnapshot: { value: snapshot } } });
  const held = writeHeld("Write to Revit", { ...review, preview, stale: false });
  const apply = vi.fn(async () => null);
  render(<WriteAction label="Plan fan writes" says="Plan current Work" held={held.held}
    plan={async () => null} apply={{ label: "Write to Revit", says: "Apply the Plan",
      refusal: held.sealed ? null : "MUAS-1 has no writable PE_M_Fan_AirFlowDesign parameter", run: apply, done: "Written" }} />);
  fireEvent.click(screen.getByRole("button", { name: /planned/ }));
  const commit = screen.getByRole("button", { name: "Write to Revit" });
  fireEvent.click(commit);
  expect.soft(apply, "atomic intent: the admitted chrome cannot apply the refused Plan").not.toHaveBeenCalled();
  expect.soft(held.sealed, "atomic intent: bookkeeping cannot arm Apply").toBe(false);
  expect.soft(document.body.textContent, "refusal names the human edit and its remedy").toMatch(/MUAS-1.*PE_M_Fan_AirFlowDesign[\s\S]*add the missing parameter/);
  expect.soft(screen.queryByText("Computed losses written back"), "derived losses have their own heading").not.toBeNull();
  expect.soft(screen.queryByText("Pe loss record"), "bookkeeping has its own heading").not.toBeNull();
  expect.soft(document.body.textContent, "before carries a numeric value and table source").toContain("0.19 (ASHRAE CD9-1)");
  const labels = review.cells.filter(cell => cell.key.startsWith("component:")).map(cell => cell.label);
  expect.soft(labels[0], "a size-only type names the damper and its level").toMatch(/damper.*Level 1/i);
  expect.soft(document.body.textContent, "display text contains no raw element identity").not.toContain(String(fanId));
  cleanup();

  // The shared review entry point must refuse too, even for older results with no planRefusal field.
  const { planRefusal: _reason, ...legacyPreview } = { planRefusal: undefined, ...preview };
  render(<PreviewAction label="Write to Revit" handle={{ read: () => ({ ...review, preview: legacyPreview, stale: false }),
    plan() {}, apply, cancel() {} }} />);
  fireEvent.click(screen.getByRole("button", { name: /planned/ }));
  expect.soft(screen.queryByRole("button", { name: "Write to Revit" }), "a mixed native result exposes no Apply").toBeNull();
  cleanup();

  const rows = inputRows({ snapshot, doc: null, fanUnitId: fanId, inputs: inputsFor(snapshot) });
  const control = rows.find(row => row.key === `unit:${fanId}:cfm`)!.control;
  if (control.kind !== "number") throw Error("Unit airflow is not a number cell");
  // Base has no refusal member: the cast lets the same journey reach its DOM falsifier there.
  const editRefusal = (control as typeof control & { refusal?: string }).refusal ?? null;
  render(<SheetCell label="MUAS-1 flow" value={control.value} unit={{ label: "cfm" }} digits={0}
    source="none" refusal={editRefusal} onValue={apply} />);
  expect.soft(document.querySelector('[data-body="locked"]'), "missing parameter locks the edit before Plan").not.toBeNull();
  expect.soft(document.body.innerHTML, "the edit-time explanation identifies the missing slot").toContain("PE_M_Fan_AirFlowDesign");
});
