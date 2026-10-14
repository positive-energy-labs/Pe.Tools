import { mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Context, Layer } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { expect, test, vi } from "vite-plus/test";
import type { Envelope, UpdatePlan, UpdateReceipt } from "@pe/host-contracts/pe-revit-contract";
import {
  createUpdateReader,
  UpdateReader,
  type UpdateFact,
  type UpdateRunner,
} from "../src/update-reader.ts";
import { updateRoutes } from "../src/update-route.ts";
import { sdkBinary, sdkCommand } from "./sdk-replay.ts";

vi.mock("../src/host-ownership.ts", async (original) => {
  const real = await original<typeof import("../src/host-ownership.ts")>();
  return { ...real, hostOwnership: { ...real.hostOwnership, lane: "installed" } };
});

const PLAN_ID = "a64fc2d5-49ee-4ca5-9861-e1a050ae62cb";
const plan = {
  installedRoot: "C:/installed-Pe.Tools",
  planId: PLAN_ID,
  observedAtUtc: "2026-10-09T00:00:00Z",
  product: "Pe.Tools",
  current: "0.7.0",
  latest: "0.8.0",
  available: true,
  feed: "test-feed",
  msi: { name: "Pe.Tools.msi", digest: "sha256:digest", size: 42, url: "https://example.test/msi" },
  quiet: true,
  revits: [],
  blockers: [],
  effects: { close: [], reopen: [], restartYears: [] },
} as UpdatePlan;
const envelope = (result: unknown, exitCode = 0): Envelope<unknown> => ({
  result,
  exitCode,
  diagnostics: [],
  resolved: null,
  binary: sdkBinary,
  command: sdkCommand,
  nextSteps: [],
  guide: "update",
  related: [],
});
const receipt = (requestId: string, state: string, detail = "confirmed leg"): UpdateReceipt =>
  ({
    requestId,
    state,
    planId: PLAN_ID,
    receiptPath: "exact.receipt.json",
    reopen: [],
    restartYears: [],
    legs: [
      {
        name: state === "running" ? "handoff" : "done",
        status: state === "failed" ? "failed" : "ok",
        observedAtUtc: "2026-10-09T00:00:01Z",
        detail,
        exitCode: null,
      },
    ],
  }) as UpdateReceipt;
const recovered = (value: UpdateReceipt) =>
  envelope(
    {
      requestId: value.requestId,
      state: value.state,
      receipt: {},
      response: {
        key: "update.apply",
        requestId: value.requestId,
        verdict: value.state,
        result: value,
      },
    },
    value.state === "running" ? 4 : 0,
  );

async function fixture(terminal: "ok" | "failed" = "ok") {
  const dir = await mkdtemp(join(tmpdir(), "pe-receipt-update-"));
  const path = join(dir, "host-update.json");
  const automaticOffPath = join(dir, "host-update-automatic-off");
  const facts: UpdateFact[] = [];
  let settledReceipt: UpdateReceipt | null = null;
  const run: UpdateRunner = async (args) => {
    if (args[1] === "check") return envelope(plan);
    if (args[0] === "op") {
      if (!settledReceipt) throw Error("successor not answering");
      return recovered(settledReceipt);
    }
    const saved = JSON.parse(await readFile(path, "utf8"));
    settledReceipt = receipt(
      saved.requestId,
      terminal,
      terminal === "failed" ? "no space" : "done",
    );
    return envelope(receipt(saved.requestId, "running"), 4);
  };
  const make = () =>
    createUpdateReader({
      path,
      run,
      installed: true,
      pid: 1,
      manifest: "m.json",
      automaticOffPath,
      fact: (fact) => facts.push(fact),
    });
  return {
    dir,
    path,
    automaticOffPath,
    facts,
    make,
    close: () => rm(dir, { recursive: true, force: true }),
  };
}

test("a settled update announces on its transition into terminal, and a re-read repeats nothing", async () => {
  const f = await fixture();
  const reader = f.make();
  try {
    await reader.refresh();
    await reader.apply(PLAN_ID);
    expect(f.facts).toEqual([]);
    expect(reader.current().receipt?.state).toBe("running");
    // The successor host recovers the terminal receipt: it is the one that announces.
    const successor = f.make();
    await successor.refresh();
    await successor.refresh();
    expect(f.facts).toEqual([
      {
        kind: "settled",
        requestId: reader.current().requestId,
        state: "ok",
        detail: "done",
      },
    ]);
    // A third host loading the already-terminal admission announces nothing.
    await f.make().refresh();
    expect(f.facts).toHaveLength(1);
  } finally {
    await f.close();
  }
});

test("a failed update announces failure with the last leg detail", async () => {
  const f = await fixture("failed");
  try {
    const reader = f.make();
    await reader.refresh();
    await reader.apply(PLAN_ID);
    await f.make().refresh();
    expect(f.facts).toMatchObject([{ kind: "settled", state: "failed", detail: "no space" }]);
  } finally {
    await f.close();
  }
});

test("the automatic-update switch is one marker file that survives a new reader", async () => {
  const f = await fixture();
  try {
    const reader = f.make();
    expect(reader.current().automatic).toBe(true);
    expect((await reader.setAutomatic(false)).automatic).toBe(false);
    expect(existsSync(f.automaticOffPath)).toBe(true);
    expect(f.make().current().automatic).toBe(false);
    expect((await reader.setAutomatic(true)).automatic).toBe(true);
    expect(existsSync(f.automaticOffPath)).toBe(false);
    expect(f.make().current().automatic).toBe(true);
  } finally {
    await f.close();
  }
});

test("POST /host/update/automatic validates its body and flips the marker", async () => {
  const f = await fixture();
  const reader = f.make();
  const web = HttpRouter.toWebHandler(
    updateRoutes.pipe(Layer.provideMerge(Layer.succeed(UpdateReader, reader))),
    { disableLogger: true },
  );
  const post = (body: unknown) =>
    web.handler(
      new Request("http://host/host/update/automatic", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      Context.empty() as never,
    );
  try {
    expect((await post({})).status).toBe(400);
    expect((await post({ enabled: "no" })).status).toBe(400);
    const off = await post({ enabled: false });
    expect(off.status).toBe(200);
    expect((await off.json()).automatic).toBe(false);
    expect(existsSync(f.automaticOffPath)).toBe(true);
  } finally {
    await web.dispose();
    await f.close();
  }
});
