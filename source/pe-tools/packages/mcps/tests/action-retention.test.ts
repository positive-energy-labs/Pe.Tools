/**
 * The retained admission is the client's memory of an attempt whose acceptance it lost. A SETTLED
 * one is history and must never refuse the next attempt (w4-revit defect 7: the only way out was
 * deleting a localStorage key by hand). A still-running one refuses, and names the stop control.
 */
import { expect, test, vi, afterEach } from "vite-plus/test";
import {
  cancelAction,
  runningAdmissions,
  runSemanticAction,
} from "../src/shared/takeoff-action-client.ts";

const target = { session: "S", openId: "open-1" };
const receipt = (id: string, state: string, extra: Record<string, unknown> = {}) => ({
  id,
  kind: "workflow",
  key: "families.confirm",
  actor: "human",
  destination: { kind: "document", ref: target },
  request: {},
  bases: {},
  steps: [],
  preparation: { state: "unprepared" },
  recovery: [],
  publication: { state: "unrequested" },
  startedAt: "2026-09-17T00:00:00.000Z",
  state,
  ...extra,
});

afterEach(() => vi.unstubAllGlobals());

/** Serves `/actions` reads from `rows` and answers every POST with the row for its id. */
function host(rows: Map<string, unknown>, onPost?: (path: string, body: unknown) => void) {
  const posted: { path: string; body: unknown }[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const path = new URL(url, "http://host").pathname;
    if (init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as { id: string; input?: unknown };
      posted.push({ path, body });
      onPost?.(path, body);
      // The client verifies the receipt echoes the exact admitted intent, so the stub must too.
      const row = rows.get(body.id) ?? receipt(body.id, "running", { request: body.input ?? {} });
      rows.set(body.id, row);
      return Response.json(row, { status: 202 });
    }
    const id = new URL(url, "http://host").searchParams.get("id")!;
    const row = rows.get(id);
    return Response.json(row ? [row] : []);
  });
  return posted;
}

test("a settled retained admission is discarded, not thrown at the next attempt", async () => {
  const rows = new Map<string, unknown>();
  host(rows);
  // First attempt settles cancelled — the state a stop now produces.
  const first = await runSemanticAction(
    "families.confirm",
    { scope: "a" },
    target,
    {},
    "human",
    "",
    undefined,
    400,
  );
  // The row never settles, so the client detaches and KEEPS its retained admission.
  expect(first.state).toBe("detached");
  rows.set(first.id, receipt(first.id, "cancelled", { error: "stopped", status: 499 }));

  // Same retention key, DIFFERENT input: the old admission has settled, so it gets out of the way.
  const second = await runSemanticAction(
    "families.confirm",
    { scope: "b" },
    target,
    {},
    "human",
    "",
    undefined,
    400,
  );
  expect(second.id).not.toBe(first.id);
});

test("a still-running retained admission refuses and names the stop control", async () => {
  const rows = new Map<string, unknown>();
  host(rows);
  const first = await runSemanticAction(
    "families.confirm",
    { scope: "a" },
    target,
    {},
    "human",
    "",
    undefined,
    400,
  );
  rows.set(first.id, receipt(first.id, "running"));
  await expect(
    runSemanticAction("families.confirm", { scope: "b" }, target, {}, "human", "", undefined, 400),
  ).rejects.toThrow(/is still running; stop it/);
  // And the control the refusal names reaches the host journal, not the bridge directly.
  rows.set(first.id, receipt(first.id, "cancelled", { error: "stopped", status: 499 }));
  const posted = host(rows);
  expect((await cancelAction(first.id)).state).toBe("cancelled");
  expect(posted).toEqual([{ path: "/actions/cancel", body: { id: first.id } }]);
  expect(runningAdmissions()).toEqual([]);
});
