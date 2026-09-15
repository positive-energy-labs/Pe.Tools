import { expect, test, vi } from "vite-plus/test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { scheduleGridRouteState } from "@pe/agent-contracts";
import { createRouteRegistrations } from "../../../packages/mcps/src/pea/routes.ts";
import { buildCapabilities } from "../../../packages/mcps/src/pea/capabilities.ts";
import {
  runSemanticAction,
  controlAction,
  readScopedActionStatuses,
} from "../../../packages/mcps/src/shared/takeoff-action-client.ts";
import { detailResponse } from "./schedule-fixture.ts";
import { setup } from "./schedule-test-fixture.ts";

test("actual HTTP Work + journal consumes fanout only after positive acknowledgments; readback is independent", async () => {
  const f = await setup();
  const result = await f.submit();
  expect(result).toMatchObject({
    state: "succeeded",
    result: {
      applied: 1,
      failures: [],
      readback: { snapshot: { rows: [{ values: ["P-1", "100 VA"] }] } },
    },
  });
  expect((await f.view()).doc.cells["1::2"].staged).toBeUndefined();
  expect(f.sent.filter((s) => s.key === "revit.apply.parameter-values")).toHaveLength(1);
  expect(f.sent.every((s) => s.session === "B" && s.openId === "open-B")).toBe(true);
  expect(f.reads()).toBe(3); // initial, binding validation, actual post-effect readback
  expect(
    JSON.parse(await readFile(join(f.dir, "actions.json"), "utf8")).actions[0].steps[0],
  ).toMatchObject({ state: "succeeded", result: { applied: 2 } });
});

test.each([
  ["missing", { applied: 0, dryRun: false, results: [] }],
  [
    "partial fanout",
    {
      applied: 1,
      dryRun: false,
      results: [
        { index: 0, ok: true },
        { index: 1, ok: false, error: "read only" },
      ],
    },
  ],
  [
    "duplicate",
    {
      applied: 2,
      dryRun: false,
      results: [
        { index: 0, ok: true },
        { index: 0, ok: true },
      ],
    },
  ],
  [
    "malformed",
    {
      applied: 2,
      dryRun: false,
      results: [
        { index: 0, ok: "true" },
        { index: 1, ok: true },
      ],
    },
  ],
  [
    "dry run",
    {
      applied: 0,
      dryRun: true,
      results: [
        { index: 0, ok: true },
        { index: 1, ok: true },
      ],
    },
  ],
])("%s keeps the expanded cell staged", async (_name, response) => {
  const f = await setup();
  f.setResponse(response);
  const result = await f.submit();
  expect(result.result.applied).toBe(0);
  expect((await f.view()).doc.cells["1::2"].staged.value).toBe("150 VA");
});

test("real 501-edit native cap refusal keeps every cell; diagnostic indices are not cells", async () => {
  const f = await setup();
  const detail = detailResponse();
  detail.entries[0].rows = Array.from({ length: 501 }, (_, index) => ({
    ...detail.entries[0].rows[0],
    rowNumber: index,
    bindings: [{ ...detail.entries[0].rows[0].bindings[0], targetElementIds: [index + 1] }],
  }));
  f.setDetail(detail);
  const reading = await f.read();
  await f.patch([
    { path: ["basis"], value: { captureId: reading.id } },
    {
      path: ["cells"],
      value: Object.fromEntries(
        Array.from({ length: 501 }, (_, index) => [`${index}::2`, { staged: { value: "150 VA" } }]),
      ),
    },
  ]);
  f.setResponse({
    applied: 0,
    dryRun: false,
    results: [{ index: 0, ok: false, error: "Edit count 501 exceeds the 500-edit cap per call." }],
  });
  const result = await f.submit();
  expect(result.result.applied).toBe(0);
  expect(Object.values((await f.view()).doc.cells).filter((c) => c.staged)).toHaveLength(501);
  expect(f.sent.find((s) => s.key === "revit.apply.parameter-values")?.input.edits).toHaveLength(
    501,
  );
});

test("extra transaction diagnostics retain native evidence without negating positive cell acknowledgments", async () => {
  const f = await setup();
  f.setResponse({
    applied: 2,
    dryRun: false,
    results: [
      { index: 0, ok: true },
      { index: 1, ok: true },
      { index: 4, ok: false, error: "transaction warning" },
    ],
  });
  expect(await f.submit()).toMatchObject({
    state: "succeeded",
    result: { applied: 1, diagnostics: [{ index: 4, ok: false }] },
  });
});

test("partial native outcome clears only a completely acknowledged cell and keeps explicit failures", async () => {
  const f = await setup();
  const detail = detailResponse();
  detail.entries[0].rows.push({
    ...detail.entries[0].rows[0],
    rowNumber: 2,
    bindings: [{ ...detail.entries[0].rows[0].bindings[0], targetElementIds: [9] }],
  });
  f.setDetail(detail);
  const reading = await f.read();
  await f.patch([
    { path: ["basis"], value: { captureId: reading.id } },
    { path: ["cells", "2::2"], value: { staged: { value: "200 VA" } } },
  ]);
  f.setResponse({
    applied: 2,
    dryRun: false,
    results: [
      { index: 0, ok: true },
      { index: 1, ok: true },
      { index: 2, ok: false, error: "read only" },
    ],
  });
  expect(await f.submit()).toMatchObject({
    result: { applied: 1, failures: [{ key: "2::2", error: "read only" }] },
  });
  expect((await f.view()).doc.cells["1::2"].staged).toBeUndefined();
  expect((await f.view()).doc.cells["2::2"].staged.value).toBe("200 VA");
});

test("Work edits finish while native execution waits and settlement preserves later staged/proposed values", async () => {
  const f = await setup();
  f.hold();
  const admission = await f.admission();
  await f.post("/actions", admission);
  await vi.waitFor(() =>
    expect(f.sent.some((s) => s.key === "revit.apply.parameter-values")).toBe(true),
  );
  expect(
    await f.patch([
      { path: ["cells", "1::2", "staged"], value: { value: "200 VA" } },
      { path: ["cells", "1::2", "proposal"], value: { value: "220 VA", by: "pea" } },
    ]),
  ).toMatchObject({ ok: true });
  f.release();
  await f.owner().wait(admission.id);
  expect((await f.view()).doc.cells["1::2"]).toMatchObject({
    staged: { value: "200 VA" },
    proposal: { value: "220 VA" },
  });
});

test("lost acceptance and host remount replay the original admission once", async () => {
  const f = await setup();
  const original = await f.admission();
  f.lose();
  expect(
    await runSemanticAction(
      "schedule-grid.apply",
      {},
      f.b,
      original.bases,
      "human",
      "",
      original.id,
    ),
  ).toMatchObject({ id: original.id, state: "succeeded" });
  await f.owner().wait(original.id);
  await f.restart();
  expect(
    await runSemanticAction(
      "schedule-grid.apply",
      {},
      f.b,
      original.bases,
      "human",
      "",
      original.id,
    ),
  ).toMatchObject({ id: original.id, state: "succeeded" });
  expect(f.sent.filter((s) => s.key === "revit.apply.parameter-values")).toHaveLength(1);
});

test("lost native outcome remains staged, original receipt recovers without a fresh-ID retry", async () => {
  const f = await setup();
  f.unknown();
  const original = await f.admission();
  expect(await f.submit(original)).toMatchObject({ state: "unknown" });
  expect((await f.view()).doc.cells["1::2"].staged).toBeTruthy();
  expect((await f.post("/actions", await f.admission())).status).toBe(409);
  await f.restart();
  await controlAction("action.recover", { id: original.id }, "", "human");
  await controlAction("action.resume", { id: original.id }, "", "human");
  expect(await f.owner().wait(original.id)).toMatchObject({ state: "succeeded" });
  expect(f.sent.filter((s) => s.key === "revit.apply.parameter-values")).toHaveLength(1);
});

test("same document in A/B has exact independent lifetimes; subject change and reopen cannot redeem old cells", async () => {
  const f = await setup();
  const a = await f.read(f.a);
  expect(a.workspaceId).toBe(f.reading.workspaceId);
  expect(
    await f.submit({ ...(await f.admission()), destination: { kind: "document", ref: f.a } }),
  ).toMatchObject({ state: "failed", notDispatched: true });
  const other = detailResponse();
  other.entries[0].scheduleId = 99;
  other.entries[0].scheduleUniqueId = "uid-99";
  f.setDetail(other);
  expect((await f.read()).workspaceId).not.toBe(f.scope.work);
  expect((await f.view()).doc.cells["1::2"].staged).toBeTruthy();
  f.setDetail(detailResponse());
  f.reopen();
  expect(await f.submit()).toMatchObject({ state: "failed", notDispatched: true });
  expect(f.sent.filter((s) => s.key === "revit.apply.parameter-values")).toHaveLength(0);
});

test("readback failure is explicit and original resume performs only a read, never another apply", async () => {
  const f = await setup();
  f.failReadback();
  const result = await f.submit();
  expect(result).toMatchObject({
    state: "incomplete",
    result: { applied: 1, readbackError: expect.stringContaining("readback unavailable") },
  });
  expect((await f.post("/actions", await f.admission())).status).toBe(409);
  f.failReadback(false);
  await controlAction("action.resume", { id: result.id }, "", "human");
  expect(await f.owner().wait(result.id)).toMatchObject({ state: "succeeded" });
  expect(f.sent.filter((s) => s.key === "revit.apply.parameter-values")).toHaveLength(1);
});

test("changed binding refuses before effects and stale/agent admission cannot consume Work", async () => {
  const f = await setup();
  const original = await f.admission();
  expect((await f.post("/actions", { ...original, actor: "agent" })).status).toBe(409);
  await f.patch([{ path: ["cells", "1::2", "staged"], value: { value: "175 VA" } }]);
  expect(await f.submit(original)).toMatchObject({ state: "failed", notDispatched: true });
  const changed = detailResponse();
  changed.entries[0].rows[0].bindings[0].targetElementIds = [999];
  f.setDetail(changed);
  expect(await f.submit()).toMatchObject({ state: "failed", notDispatched: true });
  expect((await f.view()).doc.cells["1::2"].staged.value).toBe("175 VA");
  expect(f.sent.filter((s) => s.key === "revit.apply.parameter-values")).toHaveLength(0);
});

test("unresolved original Work action survives another lifetime and is discoverable by subject", async () => {
  const f = await setup();
  f.unknown();
  const original = await f.admission();
  await f.submit(original);
  await f.restart();
  expect(
    await readScopedActionStatuses({ kind: "schedule-grid", workspaceId: f.scope.work }),
  ).toMatchObject([{ id: original.id, state: "unknown" }]);
  const a = await f.read(f.a);
  await f.patch([{ path: ["basis"], value: { captureId: a.id } }]);
  expect(
    (
      await f.post("/actions", {
        ...(await f.admission()),
        destination: { kind: "document", ref: f.a },
      })
    ).status,
  ).toBe(409);
  expect(f.sent.filter((s) => s.key === "revit.apply.parameter-values")).toHaveLength(1);
});

test("missing acknowledgments recover the same native receipt before original resume; no fresh dispatch", async () => {
  const f = await setup();
  f.setResponse({ applied: 0, dryRun: false, results: [] });
  const original = await f.admission();
  expect(await f.submit(original)).toMatchObject({ state: "incomplete" });
  f.setResponse({
    applied: 2,
    dryRun: false,
    results: [
      { index: 0, ok: true },
      { index: 1, ok: true },
    ],
  });
  await controlAction("action.recover", { id: original.id }, "", "human");
  await controlAction("action.resume", { id: original.id }, "", "human");
  expect(await f.owner().wait(original.id)).toMatchObject({ state: "succeeded" });
  expect((await f.view()).doc.cells["1::2"].staged).toBeUndefined();
  expect(f.sent.filter((s) => s.key === "revit.apply.parameter-values")).toHaveLength(1);
});

test("retired Family Types has no route or capabilities; current Schedule admission replays by exact ID", async () => {
  const registrations = createRouteRegistrations({ hostBaseUrl: "http://host" });
  expect(registrations.some((r) => r.spec.route === "family-types")).toBe(false);
  expect(scheduleGridRouteState.commands).toEqual({});
  const rows = buildCapabilities({
    ops: [],
    routes: registrations.map((r) => r.spec),
    pods: null,
    skills: [],
  });
  expect(rows.some((r) => r.key.includes("family-types"))).toBe(false);
  expect(rows.find((r) => r.key === "workflow:schedule-grid.apply")).toMatchObject({
    actor: "human",
  });
  const f = await setup();
  const admission = await f.admission();
  expect((await f.post("/actions", admission)).status).toBe(202);
  expect(await f.owner().wait(admission.id)).toMatchObject({ state: "succeeded" });
  await f.restart();
  expect((await f.post("/actions", admission)).status).toBe(200);
  expect(await f.owner().list()).toEqual([
    expect.objectContaining({ id: admission.id, state: "succeeded" }),
  ]);
  expect(
    await f.patch([{ path: ["basis"], value: { captureId: f.reading.id } }], "agent"),
  ).toMatchObject({ ok: false });
});
