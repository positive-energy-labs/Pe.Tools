import { expect, test } from "vite-plus/test";
import { bindActionDispatch } from "../src/action-dispatch.ts";
import { StepFailure } from "../src/command-executor.ts";
import { dispatchSdk, SDK_REQUEST_ID } from "../src/sdk-dispatch.ts";
import { replayAnswer } from "./sdk-replay.ts";

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
    legs: [{ state: "ok" }],
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
        return replayAnswer(actual, {
          result: { state, legs },
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
  { reason: "consent.stopped: root turn ended", status: 499 },
  { reason: "Consumed input changed", status: 409 },
])(
  "SDK checkpoint $status blocks the process call before it starts",
  async ({ reason, status }) => {
    const id = crypto.randomUUID();
    let entered = false;
    const release = bindActionDispatch(id, {
      refusal: () => reason,
      validate: async () => reason,
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
