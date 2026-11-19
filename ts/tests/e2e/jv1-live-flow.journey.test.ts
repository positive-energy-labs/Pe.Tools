import { expect, test } from "vite-plus/test";
import { nativeFixture } from "../../products/fans/host/src/tests/fans-native.fixture.ts";
import { closedFan, recordedTables, CLOSED_AT } from "../../products/fans/host/src/tests/closed-fan.fixture.ts";
import { resolveInputs } from "@pe/ducts-domain/calc/inputs";
import { TEST_FIRM } from "@pe/ducts-domain/test-inputs";
import { toGrids } from "@pe/ducts-domain/loss-grid";
import { suggestRoster } from "@pe/ducts-domain/roster";
import { buildCalc } from "@pe/fans-domain/calc/build";
import { mintWriteRequest } from "@pe/fans-domain/calc/write-request";
import { fansCalc } from "../../products/fans/web/src/calc.ts";
import { sheetCells } from "../../apps/web/src/route/slots/sheet/index.ts";
import { elementSubject } from "@pe/ducts-domain/work-subject";
import { factOf } from "@pe/ducts-domain/test-snapshot";
import { fansDocumentSchema } from "@pe/fans-contract/fans";
import { NATIVE_BODY_VERSION_HEADER } from "@pe/agent-contracts";
import { DUCTS_REFRESH_HEADER } from "@pe/ducts-contract/reading";
import { HOST_RPC_BRIDGE_SESSION_HEADER, HOST_RPC_DOCUMENT_HEADER } from "@pe/host-contracts/operation-types";

// Fixture-host target: vp test --config tests/e2e/jv1-live-flow.config.ts
// Synthetic native state; the host admission, resolver, calculator, binding and mint are production.
// This is linkage evidence, never a real-Revit or rendered-browser acceptance stamp.
test("J-V1: live terminal edit after receipt reprices, shows drift, and writes the new ESP", async () => {
  const model = closedFan(100);
  const terminal = model.nodes.find(n => n.id === 3)!;
  const subject = elementSubject(terminal);
  model.store = { version: 2, workRevision: 1, appliedAt: CLOSED_AT,
    rules: {}, instances: {}, terminals: {}, equipmentFlows: {}, verdicts: {}, roles: {},
    terminalFlows: { "3": { cfm: 200, source: "human", appliedAt: CLOSED_AT } } };
  const terminalWrites: unknown[] = [];
  const f = await nativeFixture("real", (key, raw) => {
    if (key === "ducts.snapshot.walk") return structuredClone(model);
    if (key === "ducts.apply") {
      const request = raw as { terminalFlows: { id: number; cfm: number }[]; equipment: { id: number; externalStaticInWg: number }[] };
      terminalWrites.push(...request.terminalFlows);
      for (const row of request.terminalFlows) {
        const node = model.nodes.find(n => n.id === row.id)!;
        node.facts.find(f => f.key === "flow")!.value = row.cfm;
        node.connectors[0]!.flowCfm = row.cfm;
      }
      const esp = request.equipment.find(row => row.id === 100)?.externalStaticInWg;
      if (esp != null) model.nodes.find(n => n.id === 100)!.facts.push(factOf("externalStatic", esp, { unit: "in-wg" }));
    }
  });
  try {
    let version = "";
    const read = async () => {
      // The synthetic writer emits no bridge event. Use the public conditional refresh door.
      const response = await f.request(new Request("http://fixture/call", { method: "POST", headers: {
        "content-type": "application/json", [HOST_RPC_BRIDGE_SESSION_HEADER]: f.target.ref.session,
        [HOST_RPC_DOCUMENT_HEADER]: f.target.ref.openId, ...(version ? { [DUCTS_REFRESH_HEADER]: version } : {}),
      }, body: JSON.stringify({ key: "ducts.snapshot.walk", request: { selector: { kind: "from", unitId: 100 } } }) }));
      expect(response.ok, await response.clone().text()).toBe(true);
      version = response.headers.get(NATIVE_BODY_VERSION_HEADER) ?? "";
      const body = await response.json();
      return body;
    };
    const calculate = (snapshot: typeof model) => {
      const inputs = resolveInputs({ snapshot, firm: TEST_FIRM });
      const roster = suggestRoster(snapshot);
      const input = { snapshot, inputs, grids: toGrids(recordedTables()),
        fan: { unitId: 100, portIndex: 0 }, roster: [...roster.fans, ...roster.suggestions] };
      return { input, sheet: buildCalc(input) };
    };
    const before = calculate(await read());
    expect(before.sheet.claim.kind, "fixture must price a complete fan before the edit").toBe("complete");
    // An outside writer changes the live parameter, leaving Pe's receipt untouched.
    terminal.facts.find(fact => fact.key === "flow")!.value = 400;
    terminal.connectors[0]!.flowCfm = 400;
    const live = await read();
    expect(live.nodes.find((n: { id: number }) => n.id === 3).facts.find((v: { key: string }) => v.key === "flow").value).toBe(400);
    expect(live.store.terminalFlows["3"].cfm).toBe(200);
    const after = calculate(live);
    const resolved = after.input.inputs.terminals["3"]!.cfm;
    console.log("J-V1 outside edit", JSON.stringify({ live: 400, receipt: 200, resolved }));
    expect(resolved.value, "J-V1 stale store flow: live 400 cfm must beat receipt 200 cfm").toBe(400);
    expect(resolved.source).not.toBe("model-store");
    expect(after.sheet.claim.kind).toBe("complete");
    if (before.sheet.claim.kind !== "complete" || after.sheet.claim.kind !== "complete") throw Error("incomplete claim");
    expect(after.sheet.claim.requiredEspInWg).toBeGreaterThan(before.sheet.claim.requiredEspInWg);
    // Match pane.tsx: receipt evidence travels in calcSnapshot.store.
    // Do not fabricate a model override to hide the product's missing drift handling.
    const cells = sheetCells(fansCalc, { rows: [subject], work: {}, read: {
      calcSnapshot: live, calcView: { inputs: after.input.inputs },
      fansWork: fansDocumentSchema.parse({}), settings: {},
    } });
    expect(cells.find(cell => cell.binding === "flows" && cell.row === subject)?.note,
      "terminal cell must expose receipt drift").toBe("Changed in Revit since Pe wrote 200 cfm");
    const { request } = mintWriteRequest(after.sheet.claim, after.sheet, after.input, {
      appliedAt: CLOSED_AT, slots: live.slots, peerClaims: new Map(), rulings: {}, storeDeletes: { roles: [] },
    });
    expect(request.terminalFlows, "apply must not reassert the old flow").toEqual([]);
    const key = { ...f.key, route: "fans" };
    const staged = await f.saved.apply(key, "fans", "human", [
      { path: ["writeIntent", "edit"], value: { value: { walk: { unitId: 100, portIndex: 0 } } } },
    ], 0);
    if (!staged.ok) throw Error(JSON.stringify(staged));
    const work = { key, revision: staged.revision };
    for (const [id, action] of [["jv1-plan", "sheet.plan"], ["jv1-apply", "sheet.apply"]]) {
      const response = await f.post("/actions", { id, key: action, target: f.target, input: { work } });
      expect(response.ok, await response.clone().text()).toBe(true);
      expect(await f.journal.wait(id!), action).toMatchObject({ state: "succeeded" });
    }
    expect(terminalWrites, "native apply must send no terminal writes").toEqual([]);
    const readback = await read();
    expect(readback.nodes.find((n: { id: number }) => n.id === 100).facts.find((v: { key: string }) => v.key === "externalStatic").value)
      .toBeCloseTo(after.sheet.claim.requiredEspInWg, 6);
    expect(readback.nodes.find((n: { id: number }) => n.id === 3).facts.find((v: { key: string }) => v.key === "flow").value).toBe(400);
  } finally { await f.close(); }
});
