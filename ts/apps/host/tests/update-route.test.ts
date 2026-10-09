import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Context, Deferred, Effect, Layer } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { expect, test, vi } from "vite-plus/test";
import type { Envelope, UpdatePlan, UpdateReceipt } from "@pe/host-contracts/pe-revit-contract";
import type { ServiceHostHandle } from "@pe/host-contracts/pe-service-host";
import { createUpdateReader, UpdateReader, type UpdateRunner } from "../src/update-reader.ts";
import { HostLifecycle } from "../src/host-lifecycle.ts";
import { updateRoutes } from "../src/update-route.ts";

vi.mock("../src/host-ownership.ts", async (original) => {
  const real = await original<typeof import("../src/host-ownership.ts")>();
  return { ...real, hostOwnership: { ...real.hostOwnership, lane: "installed" } };
});

const plan: UpdatePlan = {
  planId: "checked-plan",
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
  effects: { close: [], reopen: ["C:/saved.rvt"], restartYears: [2025] },
};
const envelope = (result: unknown, exitCode = 0): Envelope<unknown> => ({
  result,
  exitCode,
  diagnostics: [],
  resolved: null,
  binary: {} as Envelope<unknown>["binary"],
  command: {} as Envelope<unknown>["command"],
  nextSteps: [],
  guide: "update",
  related: [],
});
const receipt = (requestId: string, state = "running"): UpdateReceipt => ({
  requestId,
  state,
  planId: plan.planId,
  receiptPath: "exact.receipt.json",
  reopen: ["C:/saved.rvt"],
  restartYears: [2025],
  legs: [
    {
      name: state === "ok" ? "done" : "handoff",
      status: "ok",
      observedAtUtc: "2026-10-09T00:00:01Z",
      detail: "confirmed leg",
      exitCode: null,
    },
  ],
});
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

const MANIFEST = "C:/Users/x/AppData/Local/Positive Energy/Pe.Tools/product.payloads.json";

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "pe-update-reader-"));
  const path = join(dir, "host-update.json");
  const calls: { args: string[]; detached: boolean }[] = [];
  let confirmed: UpdateReceipt | null = null;
  const run: UpdateRunner = vi.fn(async (args, detached = false) => {
    calls.push({ args, detached });
    if (args[0] === "update" && args[1] === "check") {
      // The installed root resolves from the manifest; without it the SDK says update.not-installed.
      expect(args).toEqual(["update", "check", "--manifest", MANIFEST, "--json"]);
      return envelope(plan);
    }
    if (args[0] === "op") {
      if (!confirmed) throw Error("successor not answering");
      expect(args).toEqual(["op", "result", confirmed.requestId, "--json"]);
      return recovered(confirmed);
    }
    const saved = JSON.parse(await readFile(path, "utf8"));
    expect(args).toContain(saved.requestId);
    expect(saved.planId).toBe(plan.planId);
    confirmed = receipt(saved.requestId);
    return envelope(confirmed, 4);
  });
  const make = (runner = run) =>
    createUpdateReader({ path, run: runner, installed: true, pid: 123, manifest: MANIFEST });
  return {
    dir,
    path,
    calls,
    run,
    make,
    reader: make(),
    confirm: (next: UpdateReceipt | null) => {
      confirmed = next;
    },
    close: () => rm(dir, { recursive: true, force: true }),
  };
}

test("GET carries the full validated plan, POST returns persisted request and receipt evidence", async () => {
  const f = await fixture();
  const lifecycle = await Effect.runPromise(
    Effect.gen(function* () {
      return {
        latch: yield* Deferred.make<void>(),
        handle: yield* Deferred.make<ServiceHostHandle>(),
      };
    }),
  );
  const web = HttpRouter.toWebHandler(
    updateRoutes.pipe(
      Layer.provideMerge(
        Layer.mergeAll(
          Layer.succeed(UpdateReader, f.reader),
          Layer.succeed(HostLifecycle, lifecycle),
        ),
      ),
    ),
    { disableLogger: true },
  );
  const post = (body: unknown) =>
    web.handler(
      new Request("http://host/host/update", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      Context.empty() as never,
    );
  try {
    const read = await web.handler(
      new Request("http://host/host/update"),
      Context.empty() as never,
    );
    const body = await read.json();
    expect(body.plan).toEqual(plan);
    expect(body.plan.effects.reopen).toEqual(["C:/saved.rvt"]);
    expect((await post({})).status).toBe(400);
    const admitted = await post({ planId: plan.planId });
    expect(admitted.status).toBe(202);
    const evidence = await admitted.json();
    const saved = JSON.parse(await readFile(f.path, "utf8"));
    expect(evidence).toMatchObject({
      accepted: true,
      planId: plan.planId,
      requestId: saved.requestId,
      receiptPath: "exact.receipt.json",
      receipt: saved.receipt,
    });
    const duplicate = await post({ planId: plan.planId });
    expect((await duplicate.json()).requestId).toBe(saved.requestId);
    expect(f.calls.filter(({ args }) => args[1] === "apply")).toHaveLength(1);
    expect(f.calls.find(({ args }) => args[1] === "apply")).toEqual({
      args: [
        "update",
        "apply",
        plan.planId,
        "--manifest",
        MANIFEST,
        "--request-id",
        saved.requestId,
        "--wait-pid",
        "123",
        "--json",
      ],
      detached: true,
    });
  } finally {
    await web.dispose();
    await f.close();
  }
});

test("lost acknowledgement recovers exactly the admitted id and never applies twice", async () => {
  const f = await fixture();
  try {
    const lost: UpdateRunner = async (args, detached) => {
      const answer = await f.run(args, detached);
      if (args[1] === "apply") throw Error("ack lost after effects");
      return answer;
    };
    const reader = f.make(lost);
    const [first, second] = await Promise.all([
      reader.apply(plan.planId),
      reader.apply(plan.planId),
    ]);
    expect(first.requestId).toBe(second.requestId);
    expect(first.receipt?.state).toBe("running");
    expect(first.receiptLeg.error).toBeNull();
    expect(f.calls.filter(({ args }) => args[1] === "apply")).toHaveLength(1);
    expect(f.calls.filter(({ args }) => args[0] === "op")).toHaveLength(1);
  } finally {
    await f.close();
  }
});

test("successor keeps last confirmed handoff through disconnect and confirms completion only by receipt", async () => {
  const f = await fixture();
  try {
    const admitted = await f.reader.apply(plan.planId);
    const original = admitted.receipt!;
    f.confirm(null);
    const successor = f.make();
    const disconnected = await successor.refresh();
    expect(disconnected.requestId).toBe(admitted.requestId);
    expect(disconnected.receipt).toEqual(original);
    expect(disconnected.receipt?.state).toBe("running");
    expect(disconnected.receiptLeg.observedAtUtc).toBe(admitted.receiptLeg.observedAtUtc);
    expect(disconnected.receiptLeg.error).toContain("successor not answering");
    f.confirm(receipt(admitted.requestId!, "ok"));
    const confirmed = await successor.refresh();
    expect(confirmed.receipt?.state).toBe("ok");
    expect(confirmed.receipt?.legs.at(-1)?.name).toBe("done");
    await successor.apply(plan.planId);
    expect(f.calls.filter(({ args }) => args[1] === "apply")).toHaveLength(1);
    expect(f.calls.some(({ args }) => args[0] === "op" && args[1] === "list")).toBe(false);
  } finally {
    await f.close();
  }
});

test("a disconnected admission stays pending across restart and blocks a second plan's apply", async () => {
  const f = await fixture();
  try {
    const down: UpdateRunner = async (args) => {
      if (args[1] === "check") return envelope({ ...plan, current: "0.8.0" });
      throw Error("wire disconnected");
    };
    const first = await f.make(down).apply(plan.planId);
    expect(first.requestId).toBeTruthy();
    expect(first.receipt).toBeNull();
    const successor = f.make(down);
    const reading = await successor.refresh();
    expect(reading.plan?.current).toBe("0.8.0");
    expect(reading.receipt).toBeNull();
    expect(reading.requestId).toBe(first.requestId);
    expect(reading.admittedPlanId).toBe(plan.planId);
    await expect(successor.apply("different-plan")).rejects.toThrow(
      "no confirmed terminal receipt",
    );
    await successor.apply(plan.planId);
    expect(f.calls).toEqual([]);
  } finally {
    await f.close();
  }
});

test("wrong request or plan cannot overwrite a confirmed receipt, and corrupt admission fails closed", async () => {
  const f = await fixture();
  try {
    const admitted = await f.reader.apply(plan.planId);
    const mismatched = f.make(async (args) =>
      args[0] === "op"
        ? recovered({ ...admitted.receipt!, planId: "another-plan" })
        : envelope(plan),
    );
    const invalid = await mismatched.refresh();
    expect(invalid.receipt).toEqual(admitted.receipt);
    expect(invalid.receiptLeg.error).toContain("does not match");
    const wrongRequest = f.make(async (args) =>
      args[0] === "op" ? recovered(receipt("different-request")) : envelope(plan),
    );
    expect((await wrongRequest.refresh()).receiptLeg.error).toContain("different update request");
    await writeFile(f.path, "{}");
    const broken = f.make();
    await expect(broken.apply(plan.planId)).rejects.toThrow();
    expect(f.calls.filter(({ args }) => args[1] === "apply")).toHaveLength(1);
  } finally {
    await f.close();
  }
});

test("malformed plans and failed reads retain the full last plan, one refresh shared", async () => {
  const f = await fixture();
  try {
    let next: unknown = plan;
    const reader = f.make(vi.fn(async () => envelope(next)));
    const first = reader.refresh();
    expect(reader.refresh()).toBe(first);
    expect((await first).plan).toBe(plan);
    next = { planId: "subset", available: true };
    const failed = await reader.refresh();
    expect(failed.plan).toBe(plan);
    expect(failed.planLeg.error).not.toBeNull();
    expect(failed.planLeg.observedAtUtc).toBe((await first).planLeg.observedAtUtc);
  } finally {
    await f.close();
  }
});
