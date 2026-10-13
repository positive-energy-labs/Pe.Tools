import { expect, test } from "vite-plus/test";
import type { ActionReceipt, ActionStep } from "@pe/agent-contracts";
import {
  acquiredOpenIds,
  foldAcquisitions,
  planAcquisition,
  processWhose,
  type AcquisitionIntent,
} from "../src/acquisition.ts";

const process = { pid: 42, processStartUtc: "2026-10-13T00:00:00.0000000Z" };
const openId = "a".repeat(32);
const source = "C:/models/Tower.rvt";
const intent = planAcquisition(
  "acq-1",
  "C:/pea-work",
  { kind: "create", year: "2025" },
  { source, into: { start: { year: "2025", owner: "pea", addins: "on" } } },
  false,
);
const work = (intent.document!.origin as { work: string }).work;

const step = (key: string, state: ActionStep["state"], extra: Record<string, unknown> = {}) =>
  ({
    id: `${key}-id`,
    kind: key.startsWith("acquisition.") ? "file" : "native",
    key,
    input: key.startsWith("acquisition.") ? { to: `${key}-path` } : { argv: [] },
    state,
    ...(state === "succeeded" ? { result: null } : {}),
    ...(state === "unknown" || state === "failed" ? { error: "x", status: 503 } : {}),
    ...extra,
  }) as ActionStep;
const started = step("instances.open.start", "succeeded", { result: { session: { process } } });
const opened = step("instances.open", "succeeded", {
  result: { state: "ok", document: { openId, path: work } },
});
const receipt = (
  state: ActionReceipt["state"],
  steps: ActionStep[],
  value: unknown = { target: null, acquisition: intent },
  over: Partial<ActionReceipt> = {},
) =>
  ({
    kind: "workflow",
    id: "acq-1",
    key: "instances.open",
    caller: { kind: "human", via: "local" },
    basis: { kind: "human" },
    state,
    destination: { kind: "host" },
    request: {},
    bases: {},
    steps,
    preparation: { state: "ready", value },
    recovery: [],
    startedAt: "2026-10-13T00:00:00Z",
    publication: { state: "unrequested" },
    ...(state === "succeeded" ? { result: null } : {}),
    ...(state === "unknown" || state === "failed" || state === "incomplete"
      ? { error: "x", status: 503 }
      : {}),
    ...over,
  }) as ActionReceipt;
const certified: { openId: string; isWorkshared: boolean | null; isDetached: boolean | null }[] = [
  { openId, isWorkshared: false, isDetached: false },
];
const mint = (receipts: ActionReceipt[], sdk = certified) =>
  acquiredOpenIds(foldAcquisitions(receipts), process, sdk, [openId]);

test("only a held, bound, natively certified lifetime mints a Pea write; planned, partial and unknown never do", () => {
  expect(mint([receipt("succeeded", [started, opened])])).toEqual(new Map([[openId, "acq-1"]]));
  // planned: intent frozen, nothing allocated
  expect(foldAcquisitions([receipt("running", [])])[0]!.state).toBe("planned");
  expect(mint([receipt("running", [])]).size).toBe(0);
  // partial: the start succeeded, the open is unknown
  const partial = [receipt("unknown", [started, step("instances.open", "unknown")])];
  expect(foldAcquisitions(partial)[0]).toMatchObject({ state: "reconciling", process });
  expect(mint(partial).size).toBe(0);
  // the start succeeded and the open failed: the Revit is still Pea's, no document is
  const failedOpen = [receipt("incomplete", [started, step("instances.open", "failed")])];
  expect(foldAcquisitions(failedOpen)[0]).toMatchObject({ state: "held", process, document: null });
  expect(processWhose(foldAcquisitions(failedOpen), process)).toBe("pea");
  expect(mint(failedOpen).size).toBe(0);
  // native facts unknown or workshared and attached: read
  expect(
    mint(
      [receipt("succeeded", [started, opened])],
      [{ openId, isWorkshared: null, isDetached: null }],
    ).size,
  ).toBe(0);
  expect(
    mint(
      [receipt("succeeded", [started, opened])],
      [{ openId, isWorkshared: true, isDetached: false }],
    ).size,
  ).toBe(0);
  // another product openId or another process incarnation: read
  const held = foldAcquisitions([receipt("succeeded", [started, opened])]);
  expect(acquiredOpenIds(held, process, certified, ["b".repeat(32)]).size).toBe(0);
  expect(
    acquiredOpenIds(held, { ...process, processStartUtc: "2026-10-13T00:00:01Z" }, certified, [
      openId,
    ]).size,
  ).toBe(0);
  // an open that names a path other than the reserved work copy binds nothing
  const elsewhere = step("instances.open", "succeeded", {
    result: { document: { openId, path: source } },
  });
  expect(mint([receipt("succeeded", [started, elsewhere])]).size).toBe(0);
});

test("a malformed or foreign persisted intent mints nothing; a reload never enters acquire", () => {
  const broken = { ...intent, document: { ...intent.document, origin: { kind: "user-original" } } };
  expect(
    foldAcquisitions([receipt("succeeded", [started, opened], { acquisition: broken })]),
  ).toEqual([]);
  const foreign: AcquisitionIntent = { ...intent, id: "someone-else" };
  expect(
    foldAcquisitions([receipt("succeeded", [started, opened], { acquisition: foreign })]),
  ).toEqual([]);
  // the wave-1 shape (no intent) is not upgraded to an acquisition
  expect(
    foldAcquisitions([receipt("succeeded", [started, opened], { target: null, pea: null })]),
  ).toEqual([]);
  expect(() =>
    planAcquisition(
      "r",
      "C:/w",
      { kind: "create", year: "2025" },
      { source: openId, reload: true, into: { session: { id: "x" } } },
      false,
    ),
  ).toThrow(/never an acquisition/);
});

test("a cleanup in flight reconciles and a succeeded cleanup releases", () => {
  const cleanup = (state: ActionReceipt["state"]) =>
    receipt(state, state === "unknown" ? [step("instances.cleanup.close", "unknown")] : [], null, {
      id: "c",
      key: "instances.cleanup",
      request: { acquisition: "acq-1" },
    });
  const acquired = receipt("succeeded", [started, opened]);
  expect(foldAcquisitions([acquired, cleanup("unknown")])[0]!.state).toBe("reconciling");
  expect(foldAcquisitions([acquired, cleanup("succeeded")])[0]!.state).toBe("released");
  expect(processWhose(foldAcquisitions([acquired, cleanup("succeeded")]), process)).toBe("you");
  expect(mint([acquired, cleanup("succeeded")]).size).toBe(0);
});
