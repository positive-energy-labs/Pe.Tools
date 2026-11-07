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
// Plan reviews seal model inputs, never browser pane visibility or Page pose.
import { useEffect, useReducer } from "react";
import { act } from "@testing-library/react";
import realMuas from "../../../../packages/ducts-domain/src/sheet/fixtures/muas-local-20261102.json";
import { createWitness } from "../fans/cutover.test-support";
import { StateCell } from "@pe/kit/lang/cell";
import { actionStatusSchema, type WorkJournalDoor } from "@pe/agent-contracts";
import type { ReceiptFeedState, ReceiptCursor } from "../../../../packages/agent-contracts/src/work-journal-door";
import { TypedWrite } from "../shell/typed-shell";
import type { ReadingDelivery } from "../shell/source-contract";
const native = vi.hoisted(() => ({ submit: vi.fn(), permission:vi.fn(), retained: [] as unknown[] }));
vi.mock("../../../../packages/mcps/src/shared/takeoff-action-client", async (actual) => ({
  ...(await actual<object>()),
  submitAction: native.submit,
}));

vi.mock("../workbench/provider/harness-client",()=>({harnessClient:()=>({permission:native.permission})}));

const closes: (() => void)[] = [];
afterEach(() => {
  cleanup();
  closes
    .splice(0)
    .reverse()
    .forEach((close) => close());
});

test.each([false, true])(
  "JZ Plan pane/pose: pending Fans review stays Apply-eligible without Work revisions (oversized reading: %s)",
  async (large) => {
    native.retained.length = 0;
    const capture = structuredClone(realMuas);
    if (large) capture.document.title = "large-model-evidence".repeat(65536);
    const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
    if (large) expect(bytes(capture)).toBeGreaterThan(1024 * 1024);
    let plan!: (result: unknown) => void;
    const snapshots: ReadingDelivery[] = [];
    const snapshot:ReadingDelivery = frame => snapshots.forEach(deliver=>deliver(frame));
    native.submit.mockImplementation(
      () =>
        new Promise((resolve) => {
          plan = resolve;
        }),
    );
    native.permission.mockClear();
    const receiptSubscribers=new Set<(state:ReceiptFeedState)=>void>();
    const receipts:WorkJournalDoor["receipts"]=()=>({subscribe(deliver){receiptSubscribers.add(deliver);return ()=>{receiptSubscribers.delete(deliver);};}});
    const f = await createWitness(closes, new Map(), {
      "ducts.sheet-snapshot": {
        kind: "use",
        open(_ctx, deliver) {
          snapshots.push(deliver);
          deliver({ kind: "complete", value: capture, revision: 1 });
        },
      },
    },undefined,receipts);
    await vi.waitFor(() => expect(f.fans.work()).not.toBeNull());
    const key = f.fans.workBasis()!.token.scope.identity.work!;
    await f.ws.apply(
      key,
      "fans",
      "pea",
      [
        {
          path: ["writeIntent"],
          value: { edit: { value: { walk: { unitId: 14577391, portIndex: 2 } } } },
        },
        {
          path: ["equipmentFlows", "14577391", "edit"],
          value: { value: { cfm: 925, source: "test" } },
        },
      ],
      f.fans.work()!.revision,
    );
    await vi.waitFor(() => expect(f.fans.work()!.value.writeIntent).toBeTruthy());
    f.fans.refresh("value");
    for (const id of ["value", "owner:ducts"])
      await vi.waitFor(() => {
        const snapshot = f.fans.readingStatus(id).snapshot;
        if (snapshot.status === "failed") throw Error(`${id}: ${snapshot.reason}`);
        expect(snapshot).toMatchObject({ current: true });
      });
    function Write() {
      const [, changed] = useReducer((n) => n + 1, 0);
      useEffect(() => f.fans.subscribe(changed), []);
      return <TypedWrite mount={f.typed} id="losses" />;
    }
    render(<Write />);
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "plan Write to Revit" })),
    );
    // The native mount retains handles and hash dependencies; it never serializes a Value into a token.
    expect(bytes(f.fans.workBasis())).toBeLessThan(2048);
    expect(plan).toBeTypeOf("function");
    const input = f.inputs.get("fans:ducts.plan-losses") as { work: unknown; readWorks: unknown };
    expect(input.readWorks).toHaveProperty("fans");
    // H1: a plan the host refuses after invoke returned shows its reason, arms nothing, and retries clean.
    const refusedText = "Fans Work belongs to another document";
    await act(async () => plan({ id: "plan-refused", state: "refused", error: refusedText }));
    expect(document.querySelector("[data-write-outcome=refused]")?.textContent).toBe(refusedText);
    expect(screen.queryByRole("button", { name: "Write to Revit" })).toBeNull();
    const trigger = screen.getByRole("button", { name: "plan Write to Revit" });
    await act(async () => fireEvent.click(trigger));
    await act(async () => fireEvent.click(trigger));
    expect(f.fans.reviewRefusal("losses")).toBeNull();
    expect(document.body.textContent).not.toContain(refusedText);
    const stagedRevision = f.fans.work()!.revision;
    const beforeSwitch = f.typed.value().publication!.evaluation;
    const beforeReads = f.calls.get("fans:fans.sheet");
    // The shell releases the retained typed mount while another pane is expanded.
    await act(async () => {
      f.typed.release();
      f.typed.subscribe(() => {})();
      f.typed.page.pose({ layers: [] });
    });
    expect(f.fans.work()!.revision).toBe(stagedRevision);
    expect(f.calls.get("fans:fans.sheet")).toBe(beforeReads);
    expect(f.typed.value().publication!.evaluation).toBe(beforeSwitch);
    await act(async () =>
      plan({
        id: "plan-retention",
        state: "succeeded",
        result: {
          previewOnly: true,
          takenAt: "2026-11-05T00:00:00Z",
          derivedRequest: { equipmentFlows: [{ id: 14577391, cfm: 925, source: "test" }] },
          seal: {
            caller: { kind: "human", via: "local" },
            requestHash: "sealed",
            work: { handle: input.work },
            documentMark: {
              session: "fixture",
              openId: "fans",
              observedSince: null,
              changedAt: null,
            },
            incarnation: {},
            dependencies: "exact",
          },
          response: {
            writes: [
              {
                id: 14577391,
                kind: "equipment-flow",
                outcome: "planned",
                before: "880 cfm",
                after: "925 cfm",
              },
            ],
            counts: { planned: 1, written: 0, refused: 0, unchanged: 0 },
          },
        },
      }),
    );
    expect(f.fans.review("losses")).toMatchObject({
      stale: false,
      cells: [{ before: "880 cfm", author: "human" }],
    });
    expect(f.fans.review("losses")!.rows[0]).toContain("MUAS-1");
    expect(f.typed.action("losses").read()?.preview).toBeTruthy();
    const reviewTrigger = screen.getByRole("button", { name: /Write to Revit.*planned/ });
    if (reviewTrigger.getAttribute("aria-expanded") !== "true")
      await act(async () => fireEvent.click(reviewTrigger));
    expect((await screen.findByRole("button", { name: "Write to Revit" })).hasAttribute("disabled")).toBe(false);
    expect(document.querySelector("[data-write-cell]")?.textContent).toContain("925 cfm");
    expect(f.fans.work()!.revision).toBe(stagedRevision);
    // Broad route-surface witness: the real typed action consumes its receipt feed, and the
    // consent review contains the exact owned Work cell rather than a parallel fake handle.
    const receipt=actionStatusSchema.parse({id:"consent-review",key:"ducts.apply-losses",state:"waiting",
      caller:{kind:"pea",thread:"consent-thread",context:"surface-test"},basis:null,target:{kind:"host"},input:{},startedAt:new Date().toISOString(),
      consentWindow:{requestId:"consent-request",deadline:new Date(Date.now()+60_000).toISOString()}});
    act(()=>{for(const deliver of receiptSubscribers)deliver({kind:"ready",receipts:{rows:[receipt],from:0 as ReceiptCursor,through:1 as ReceiptCursor}});});
    expect(f.typed.action("losses").consent).not.toBeNull();
    cleanup();
    function ConsentReview(){return <PreviewAction handle={f.typed.action("losses")} label="Write to Revit">
      {f.typed.draw("sheet-inputs",ctx=><StateCell label="Equipment flow" cell={ctx.cells.at(["equipmentFlows","14577391"],"fans",{
        format:value=>typeof value==="object"&&value!==null&&"cfm" in value?String(value.cfm):String(value),
      })}/> ) as import("react").ReactNode}
    </PreviewAction>;}
    render(<ConsentReview/>);
    await act(async()=>fireEvent.click(screen.getByRole("button",{name:/Write to Revit.*planned/})));
    expect(screen.getByDisplayValue("925")).toBeTruthy();
    expect(screen.queryByRole("button",{name:"Write to Revit"})).toBeNull();
    fireEvent.click(document.querySelector("[data-write-reject]")!);
    expect(native.permission).toHaveBeenCalledWith("consent-thread","consent-request","stop_writes");
    // New naming evidence must revoke the old before/after review rather than silently re-present it.
    const moved = structuredClone(capture);
    moved.document.title = "changed model evidence";
    act(() => {
      f.fans.refresh("value");
      snapshot({ kind: "complete", value: moved, revision: 2 });
    });
    expect(f.fans.review("losses")).toMatchObject({ stale: true, rows: [], cells: [] });
    expect(() => f.fans.confirm("losses")).toThrow(/stale/i);
  },
);
