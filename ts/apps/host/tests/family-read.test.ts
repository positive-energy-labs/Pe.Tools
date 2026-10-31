import { randomUUID } from "node:crypto";
import { Effect } from "effect";
import { expect, test, vi } from "vite-plus/test";
import {
  address,
  bindWork,
  familyLiveReadSchema,
  familyDraftRouteState,
} from "@pe/agent-contracts";
import { RouteWorkspace } from "@pe/runtime";
import { CANCEL_OPERATION_KEY, type RevitBridge } from "../src/bridge.ts";
import { readFamily } from "../src/family-actions.ts";
import type { TakeoffCaptures } from "../src/takeoff-captures.ts";
import { hostOwnership } from "../src/host-ownership.ts";
import { sdkSessions } from "./native-receipt-fixture.ts";

function fixture() {
  const target = { session: randomUUID(), openId: randomUUID() };
  const scope = bindWork("family", address("C:/Family.rfa"), undefined, target);
  const readId = randomUUID();
  let openedAddress = scope.target;
  let family = true;
  let start = 1000;
  let duringRead: (() => Promise<void>) | undefined;
  let stored = {
    version: 1,
    revision: 1,
    doc: familyDraftRouteState.schema.parse({
      reading: "Before",
      cells: {
        "/parameters/Model": { edit: { value: "Staged" }, suggestion: { value: "Proposed" } },
      },
    }),
  };
  const workspace = new RouteWorkspace({
    registrations: [{ spec: familyDraftRouteState }],
    store: {
      getState: async () => stored,
      setState: async ({ value }) => {
        stored = value as typeof stored;
      },
    },
  });
  const invoke = vi.fn(
    (key: string, _input: unknown, _session: string, _openId: string, _requestId?: string) =>
      Effect.promise(async () => {
        if (key === CANCEL_OPERATION_KEY) return { value: {} };
        await duringRead?.();
        return {
          value: {
            modelJson: JSON.stringify({ family: { name: "Live" }, unmodeled: ["native-only"] }),
          },
        };
      }),
  );
  const bridge = {
    list: Effect.sync(() => [
      {
        sessionId: target.session,
        connected: true,
        ...hostOwnership,
        processId: 42,
        processStartUtcUnixMs: start,
        state: {
          openDocuments: [
            { openId: target.openId, address: openedAddress, isFamilyDocument: family },
          ],
        },
      },
    ]),
    subscribe: () => () => {},
    invoke,
  } as unknown as RevitBridge["Service"];
  // Live reads publish Work, but file no captures, Pod members or command receipts.
  const captures = {} as TakeoffCaptures;
  const read = (key = "family.read", where = target) =>
    readFamily(
      {
        key,
        input: key === "family.read" ? { readId, expectedRevision: 1 } : { readId },
        scope,
        target: where,
      },
      captures,
      bridge,
      {
        sdk: sdkSessions,
        workspace,
      },
    );
  return {
    read,
    readId,
    target,
    invoke,
    stored: () => stored,
    moveDocument: () => {
      openedAddress = address("C:/Other.rfa");
    },
    editDuringRead: () => {
      stored = { ...stored, revision: 2 };
    },
    project: () => {
      family = false;
    },
    replaceProcess: () => {
      start = 2000;
    },
    hold: (run: () => Promise<void>) => {
      duringRead = run;
    },
  };
}

test("Family read uses the old empty capture input and publishes only the host-owned baseline, preserving cells", async () => {
  const f = fixture();
  const cells = structuredClone(f.stored().doc.cells);
  const result = familyLiveReadSchema.parse(await f.read());
  expect(JSON.parse(result.reading)).toMatchObject({
    family: { name: "Live" },
    $schema: expect.any(String),
  });
  expect(JSON.parse(result.reading)).not.toHaveProperty("unmodeled");
  expect(result.executionContext).toEqual(f.target);
  expect(result.process.pid).toBe(42);
  expect(f.stored()).toMatchObject({
    revision: 2,
    doc: { reading: result.reading, takenAt: result.takenAt, cells },
  });
  expect(f.invoke).toHaveBeenCalledExactlyOnceWith(
    "family.capture",
    {},
    f.target.session,
    f.target.openId,
    f.readId,
  );
});

test("Family read cannot overwrite Work edited while the native capture was running", async () => {
  const f = fixture();
  f.hold(async () => f.editDuringRead());
  await expect(f.read()).rejects.toThrow("document moved to r2");
  expect(f.stored().doc.reading).toBe("Before");
});

test("Family read refuses Work belonging to another family before native dispatch", async () => {
  const f = fixture();
  f.moveDocument();
  await expect(f.read()).rejects.toThrow("Work belongs to a different document");
  expect(f.invoke).not.toHaveBeenCalled();
  expect(f.stored().doc.reading).toBe("Before");
});

test("Family read refuses a project before native dispatch and rejects a replaced process after capture", async () => {
  const project = fixture();
  project.project();
  await expect(project.read()).rejects.toThrow("exact admitted document");
  expect(project.invoke).not.toHaveBeenCalled();
  const changed = fixture();
  changed.hold(async () => changed.replaceProcess());
  await expect(changed.read()).rejects.toThrow("exact admitted document");
});

test("Family cancellation is owned by its exact target and discards even a successful late native result", async () => {
  const f = fixture();
  let release!: () => void;
  f.hold(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  const running = f.read();
  const outcome = expect(running).rejects.toThrow("Family read cancelled");
  await vi.waitFor(() => expect(f.invoke).toHaveBeenCalledTimes(1));
  try {
    await expect(
      f.read("family.cancel-read", { ...f.target, openId: randomUUID() }),
    ).rejects.toThrow("No matching");
    expect(f.invoke).toHaveBeenCalledTimes(1);
    await expect(f.read("family.cancel-read")).resolves.toEqual({ cancelled: true });
    expect(f.invoke).toHaveBeenLastCalledWith(
      CANCEL_OPERATION_KEY,
      { requestId: f.readId },
      f.target.session,
      f.target.openId,
      undefined,
    );
  } finally {
    release();
    await outcome;
  }
  await expect(f.read("family.cancel-read")).rejects.toThrow("No matching");
  expect(f.stored().doc.reading).toBe("Before");
});
