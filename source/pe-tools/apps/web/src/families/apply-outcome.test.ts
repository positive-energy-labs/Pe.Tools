/**
 * F-J3-3 / F-J3-4: a staged-sheet apply is N `families.apply` actions, one per plan. Its outcome
 * counts per-family receipts across them, names each failed family with its reason, and never
 * lets one action's reason stand for the verb. A refusal (nothing ran) is not a failure.
 */
import { expect, test, vi } from "vite-plus/test";

const client = vi.hoisted(() => ({ runSemanticAction: vi.fn() }));
vi.mock("../../../../packages/mcps/src/shared/takeoff-action-client", async (actual) => ({
  ...(await actual<object>()),
  runSemanticAction: client.runSemanticAction,
}));

import { manifest } from "./manifest";

const entry = (id: string, name: string, plan: string) => ({
  id,
  name,
  planHash: `h-${id}`,
  actions: 1,
  detail: "",
  flag: null,
  warnings: [],
  plan,
  source: { pod: "", path: "", sha256: "" },
});
const BACKDRAFT = entry("1", "Backdraft Damper", "plan-1");
const MECHANICAL = entry("2", "Mechanical Damper", "plan-2");
const ctx = () =>
  ({
    target: { kind: "document", ref: { session: "s", openId: "o" } },
    work: { key: {}, doc: { cells: {} }, revision: 4, refusal: null },
    readings: {},
    page: {
      stage: "apply",
      pod: "",
      path: "",
      selection: [],
      confirming: true,
      sheet: { entries: [BACKDRAFT, MECHANICAL], staged: { "1::T::URL": { value: "x" } } },
      draft: { placement: "AllLoaded", categories: [], families: [] },
    },
    write: vi.fn(async () => null),
    setPage: vi.fn(),
  }) as never;

const base = {
  kind: "workflow",
  id: "a",
  key: "families.apply",
  actor: "human",
  request: {},
  bases: {},
};
const succeeded = (receipts: object[]) => ({
  ...base,
  state: "succeeded",
  result: {},
  steps: [{ key: "families.apply", state: "succeeded", result: { receipts } }],
});
const receipt = (familyName: string, success: boolean, error?: string) => ({
  familyId: 1,
  familyName,
  success,
  converged: success,
  error: error ?? null,
  residue: [],
  errors: [],
});
const run = (...answers: object[]) => {
  client.runSemanticAction.mockReset();
  for (const answer of answers) client.runSemanticAction.mockResolvedValueOnce(answer);
  return manifest.actions!.apply.run(ctx(), undefined as never);
};

test("N actions summarize as applied X of N, naming each failed family and its reason", async () => {
  const outcome = await run(succeeded([receipt("Backdraft Damper", true)]), {
    ...base,
    state: "failed",
    notDispatched: true,
    error: "Reconciliation left 2 differences",
    status: 500,
    steps: [{ key: "families.apply", state: "failed", error: "Reconciliation left 2 differences" }],
  });
  expect(outcome).toMatchObject({ code: "partial" });
  expect((outcome as { message: string }).message).toBe(
    "partly applied: 1 written, 1 refused; failed: Mechanical Damper (Reconciliation left 2 differences)",
  );
});

test("failed with no steps (a 409 refusal) reads refused — nothing ran, never failed", async () => {
  const refusal = {
    ...base,
    state: "failed",
    notDispatched: true,
    error: "The staged cells changed since this plan; plan again",
    status: 409,
    steps: [],
  };
  const outcome = await run(refusal, refusal);
  expect(outcome).toMatchObject({
    code: "not-ready",
    message: "refused — nothing ran: The staged cells changed since this plan; plan again",
  });
});

test("failed with a native step reads failed in Revit — nothing changed", async () => {
  const native = (reason: string) => ({
    ...base,
    state: "failed",
    notDispatched: true,
    error: reason,
    status: 500,
    steps: [{ key: "families.apply", state: "failed", error: reason }],
  });
  const outcome = await run(native("connector diameter disagrees"), native("family is read-only"));
  expect(outcome).toMatchObject({
    code: "failed",
    message:
      "failed in Revit — nothing changed: Backdraft Damper (connector diameter disagrees); Mechanical Damper (family is read-only)",
  });
});

test("succeeded with a receipt success false reads partly applied", async () => {
  const outcome = await run(
    succeeded([receipt("Backdraft Damper", true)]),
    succeeded([receipt("Mechanical Damper", false, "Reconciliation left 2 differences")]),
  );
  expect(outcome).toMatchObject({ code: "partial" });
  expect((outcome as { message: string }).message).toMatch(/^partly applied: 1 written, 1 refused/);
});

test("every family applied is a plain run", async () => {
  const outcome = await run(
    succeeded([receipt("Backdraft Damper", true)]),
    succeeded([receipt("Mechanical Damper", true)]),
  );
  expect(outcome).toBeNull();
});

test("a family reloaded since its plan reads in the host's words, verbatim; nothing retargets", async () => {
  const reloaded = "'Mechanical Damper' was reloaded since this plan; plan again.";
  const outcome = await run(
    succeeded([receipt("Backdraft Damper", true)]),
    succeeded([receipt("Mechanical Damper", false, reloaded)]),
  );
  expect((outcome as { message: string }).message).toContain(`Mechanical Damper (${reloaded})`);
  // One apply per plan, each naming only its own sealed plan: no second apply, no new target.
  expect(client.runSemanticAction).toHaveBeenCalledTimes(2);
});
