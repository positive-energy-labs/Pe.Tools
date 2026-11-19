import { afterEach, expect, test } from "vite-plus/test";
import { snapshot } from "@pe/ducts-domain/test-fixture";
import { nativeFixture } from "../../../../fans/host/src/tests/fans-work-fixture.ts";
import { closedFan, recordedTables } from "../../../../fans/host/src/tests/closed-fan.fixture.ts";

const closes: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const close of closes.splice(0).reverse()) await close(); });

/*
 * P19, the /duct-systems door (D9: "a staged /duct-systems verdict lands only from /duct-systems"), through the
 * real `sheet.plan` and `sheet.apply` dispatch. Red at d91b9fda: the route fell to the generic parameter
 * executor, which refuses with "Nothing to write: stage a parameter cell first".
 */
const RULE = "elbow-1d-gt10", VERDICT = "open-end:101:1", TABLE = "CD3-21";
type Sent = { store: { rules?: Record<string, unknown>; verdicts?: Record<string, { verdict: string }> }; storeDeletes?: { verdicts?: string[]; roles?: number[] } } & Record<string, unknown>;

test("a /duct-systems apply stores its staged rule table and verdict, writes no element, and removes a stored verdict on a staged delete", async () => {
  // The native owner overlays a request's store per key on the model's whole store (K3). The fixture only echoes
  // the last request, so the store the next read answers is composed here.
  let store: Record<string, unknown> | undefined;
  const f = await nativeFixture("real", undefined, null, { native: (key, input) =>
    key.startsWith("ducts.snapshot.") && store ? { ...snapshot, slots: { ...snapshot.slots, ...input.slots }, store } : undefined });
  closes.push(() => f.close());
  const round = async (id: string, patches: { path: (string | number)[]; value: unknown }[]) => {
    const before = await f.saved.view(f.key, "duct-systems");
    const staged = await f.saved.apply(f.key, "duct-systems", "human", patches, before?.revision ?? 0);
    expect(staged).toMatchObject({ ok: true });
    const work = { key: f.key, revision: staged.ok ? staged.revision : -1 };
    for (const command of ["sheet.plan", "sheet.apply"] as const) {
      const response = await f.post("/actions", { id: `${id}-${command}`, key: command, target: f.target, input: { work } });
      expect(response.status, await response.clone().text()).toBeLessThan(400);
      const row = await f.journal.wait(`${id}-${command}`);
      expect(row, `${command}: ${JSON.stringify((row as { error?: unknown }).error)}`).toMatchObject({ state: "succeeded" });
    }
    return { sent: f.dispatched.filter((row) => row.key === "ducts.apply").map((row) => row.input as Sent), doc: (await f.saved.view(f.key, "duct-systems"))!.doc as Record<string, Record<string, { edit?: unknown }>> };
  };

  const first = await round("store", [
    { path: ["rules", RULE, "edit"], value: { value: { table: TABLE } } },
    { path: ["assumptions", VERDICT, "edit"], value: { value: { kind: "verdict", verdict: "ignore" } } },
  ]);
  expect(first.sent).toHaveLength(1);
  expect(first.sent[0]!.store.rules).toEqual({ [RULE]: { table: TABLE } });
  expect(first.sent[0]!.store.verdicts).toEqual({ [VERDICT]: { verdict: "ignore", ruledAt: expect.any(String) } });
  expect(first.sent[0]!.storeDeletes).toEqual({ verdicts: [] });
  // No element write rides the door.
  for (const rows of ["fittings", "terminals", "components", "equipment", "terminalFlows", "equipmentFlows"]) expect(first.sent[0]![rows], rows).toEqual([]);
  // Both cells are retired, under duct-systems.
  expect(first.doc.rules?.[RULE]?.edit ?? null).toBeNull();
  expect(first.doc.assumptions?.[VERDICT]?.edit ?? null).toBeNull();

  // The model's store now holds the verdict; a staged delete names it in storeDeletes.
  store = { instances: {}, terminals: {}, terminalFlows: {}, equipmentFlows: {}, roles: {}, ...first.sent[0]!.store, workRevision: 1 };
  const second = await round("delete", [{ path: ["assumptions", VERDICT, "edit"], value: { delete: true } }]);
  expect(second.sent).toHaveLength(2);
  expect(second.sent[1]!.storeDeletes).toEqual({ verdicts: [VERDICT] });
  expect(second.sent[1]!.store.verdicts).toEqual({});
  expect(second.sent[1]!.store.rules).toEqual({});
  expect(second.doc.assumptions?.[VERDICT]?.edit ?? null).toBeNull();
});

const wholeStore = (verdicts: Record<string, unknown>) => ({ version: 2, rules: {}, instances: {}, terminals: {}, terminalFlows: {}, equipmentFlows: {}, roles: {}, verdicts, workRevision: 1 });

test("a capped verdict staged over a stored ignore removes the stored one, and its cell stays staged", async () => {
  const store = wholeStore({ [VERDICT]: { verdict: "ignore", ruledAt: "2026-11-18T00:00:00.000Z" } });
  const f = await nativeFixture("real", undefined, null, { native: (key, input) =>
    key.startsWith("ducts.snapshot.") ? { ...snapshot, slots: { ...snapshot.slots, ...input.slots }, store } : undefined });
  closes.push(() => f.close());
  const staged = await f.saved.apply(f.key, "duct-systems", "human", [{ path: ["assumptions", VERDICT, "edit"], value: { value: { kind: "verdict", verdict: "capped" } } }], 0);
  const work = { key: f.key, revision: staged.ok ? staged.revision : -1 };
  for (const command of ["sheet.plan", "sheet.apply"] as const) {
    await f.post("/actions", { id: command, key: command, target: f.target, input: { work } });
    expect(await f.journal.wait(command), command).toMatchObject({ state: "succeeded" });
  }
  const sent = f.dispatched.filter((row) => row.key === "ducts.apply").map((row) => row.input as Sent);
  expect(sent).toHaveLength(1);
  expect(sent[0]!.storeDeletes).toEqual({ verdicts: [VERDICT] });
  expect(sent[0]!.store.verdicts).toEqual({});
  // The store does not keep `capped`: it stays Work's, still staged.
  expect((await f.saved.view(f.key, "duct-systems"))!.doc).toMatchObject({ assumptions: { [VERDICT]: { edit: { value: { verdict: "capped" } } } } });
});

test("a /fans plan made between a /duct-systems plan and its apply refuses that apply, and nothing is written", async () => {
  const f = await nativeFixture("real", (_key, input) => closedFan(100, { requiredEsp: input.slots?.requiredEsp }), null,
    { native: (key) => (key === "ducts.tables" ? recordedTables() : undefined) });
  closes.push(() => f.close());
  const fansKey = { ...f.key, route: "fans" };
  const fans = await f.saved.apply(fansKey, "fans", "human", [{ path: ["writeIntent", "edit"], value: { value: { walk: { unitId: 100, portIndex: 0 } } } }], 0);
  const ducts = await f.saved.apply(f.key, "duct-systems", "human", [{ path: ["assumptions", VERDICT, "edit"], value: { value: { kind: "verdict", verdict: "ignore" } } }], 0);
  expect([fans, ducts]).toMatchObject([{ ok: true }, { ok: true }]);
  const post = (id: string, key: string, work: unknown) => f.post("/actions", { id, key, target: f.target, input: { work } });
  const door = { key: f.key, revision: ducts.ok ? ducts.revision : -1 };
  await post("door-plan", "sheet.plan", door);
  expect(await f.journal.wait("door-plan")).toMatchObject({ state: "succeeded" });
  await new Promise((resolve) => setTimeout(resolve, 5));
  await post("fans-plan", "sheet.plan", { key: fansKey, revision: fans.ok ? fans.revision : -1 });
  expect(await f.journal.wait("fans-plan")).toMatchObject({ state: "succeeded" });
  await post("door-apply", "sheet.apply", door);
  expect(await f.journal.wait("door-apply")).toMatchObject({ state: "failed", refusal: { code: "preview.stale", message: expect.stringContaining("Plan changed") } });
  expect(f.dispatched.filter((row) => row.key === "ducts.apply")).toEqual([]);
  // The control: planned again with nothing in between, the same Work applies.
  await post("door-replan", "sheet.plan", door);
  expect(await f.journal.wait("door-replan")).toMatchObject({ state: "succeeded" });
  await post("door-reapply", "sheet.apply", door);
  expect(await f.journal.wait("door-reapply")).toMatchObject({ state: "succeeded" });
  expect(f.dispatched.filter((row) => row.key === "ducts.apply")).toHaveLength(1);
});
