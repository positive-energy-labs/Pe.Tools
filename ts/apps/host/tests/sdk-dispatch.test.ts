import { expect, test } from "vite-plus/test";
import { bindActionDispatch } from "../src/action-dispatch.ts";
import { StepFailure } from "../src/command-executor.ts";
import { dispatchSdk, namedSdkSession, SDK_REQUEST_ID } from "../src/sdk-dispatch.ts";
import { replay } from "./sdk-replay.ts";

test.each([
  {
    name: "supervisor refusal before any leg",
    argv: ["session", "stop"],
    state: "refused",
    legs: [],
    code: "op.stale-expectation",
    outcome: "refused",
    markers: 0,
  },
  {
    name: "supervisor refusal after an effect leg",
    argv: ["session", "stop"],
    state: "refused",
    legs: [{ name: "stop", status: "ok", detail: null, observedAtUtc: "2026-10-14T05:00:13Z" }],
    code: "op.stale-expectation",
    outcome: "unknown",
    markers: 1,
  },
  {
    name: "native document refusal",
    argv: ["doc", "save"],
    state: "refused",
    legs: [],
    code: "doc.refused",
    outcome: "refused",
    markers: 0,
  },
  {
    name: "native failure",
    argv: ["doc", "save"],
    state: "failed",
    legs: [],
    code: "doc.failed",
    outcome: "failed",
    markers: 1,
  },
  {
    name: "native cancellation",
    argv: ["doc", "save"],
    state: "cancelled",
    legs: [],
    code: "doc.cancelled",
    outcome: "cancelled",
    markers: 0,
  },
])("SDK boundary distinguishes $name", async ({ argv, state, legs, code, outcome, markers }) => {
  const id = crypto.randomUUID();
  let marked = 0;
  const release = bindActionDispatch(id, {
    refusal: () => null,
    validate: async () => null,
    dispatched: async () => {
      marked++;
    },
  });
  try {
    const error = await dispatchSdk(
      { argv: [...argv, "--request-id", SDK_REQUEST_ID] },
      id,
      async (actual) => {
        expect(actual.at(-1)).toBe(id);
        return replay(argv[0] === "session" ? "session-stop" : "doc-save", {
          result: argv[0] === "session" ? { state, legs } : { state },
          diagnostics: [{ code, detail: "SDK outcome", fix: null }],
        });
      },
    ).catch((error: unknown) => error);
    expect(error).toBeInstanceOf(StepFailure);
    expect(error).toMatchObject({ outcome });
    expect(marked).toBe(markers);
  } finally {
    release();
  }
});

test("lost SDK transport does not invent either dispatch or a no-effect refusal", async () => {
  const id = crypto.randomUUID();
  let marked = 0;
  const release = bindActionDispatch(id, {
    refusal: () => null,
    validate: async () => null,
    dispatched: async () => {
      marked++;
    },
  });
  try {
    const lost = Error("SDK child completion was lost");
    await expect(
      dispatchSdk({ argv: ["session", "start"] }, id, async () => {
        throw lost;
      }),
    ).rejects.toBe(lost);
    expect(marked).toBe(0);
  } finally {
    release();
  }
});

test.each([
  { kind: "cancelled" as const, reason: "rejected by you", status: 499 },
  { kind: "refused" as const, reason: "The cancel option changed", status: 409 },
  { kind: "refused" as const, reason: "Consumed input changed", status: 409 },
])(
  "SDK checkpoint $status blocks the process call before it starts",
  async ({ kind, reason, status }) => {
    const id = crypto.randomUUID();
    let entered = false;
    const release = bindActionDispatch(id, {
      refusal: () => ({ kind, message: reason }),
      validate: async () => ({ kind, message: reason }),
      dispatched: async () => {
        throw Error("Must not mark a planned call");
      },
    });
    try {
      await expect(
        dispatchSdk({ argv: ["session", "start"] }, id, async () => {
          entered = true;
          throw Error("Must not enter the SDK");
        }),
      ).rejects.toMatchObject({ outcome: "refused", status, message: reason });
      expect(entered).toBe(false);
    } finally {
      release();
    }
  },
);

test("named SDK selection decodes payload after diagnostic refusal", async () => {
  const valid = JSON.parse(replay("session-list"));
  expect(await namedSdkSession("acc-r1", async () => JSON.stringify(valid)))
    .toMatchObject({ case: "controlled-active", id: "acc-r1" });
  valid.result.sessions[0].process.pid = "71464";
  await expect(namedSdkSession("acc-r1", async () => JSON.stringify(valid)))
    .rejects.toThrow(/invalid SessionListResult payload/);
  valid.result = null;
  valid.diagnostics = [{ code: "session.failed", detail: "read failed", fix: null }];
  await expect(namedSdkSession("acc-r1", async () => JSON.stringify(valid)))
    .rejects.toThrow("The SDK does not name one session 'acc-r1'");
});
