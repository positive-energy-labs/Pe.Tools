import { expect, it } from "vite-plus/test";
import { address, here, superseded } from "../src/reading.ts";
import {
  callTargetSchema,
  resolveCallTarget,
  targetInventorySchema,
  type DocumentRequest,
  type TargetInventory,
} from "../src/target.ts";

const project = address("C:\\Fixtures\\projectA.rvt");
const selected: DocumentRequest = { kind: "named", session: "process-1", address: project };
const family: DocumentRequest = { kind: "open", ref: { session: "process-1", openId: "family-1" } };
const fleet = targetInventorySchema.parse({
  kind: "ready",
  sessions: {
    "process-1": {
      kind: "ready",
      values: [
        { openId: "project-1", address: project, kind: "project" },
        { openId: "family-1", address: null, kind: "family" },
        { openId: "cloud-1", address: "f2933e8d-9e16-4bf4-b9ca-484f461e4563", kind: "project" },
      ],
    },
    "process-2": {
      kind: "ready",
      values: [{ openId: "project-2", address: project, kind: "project" }],
    },
  },
});
const read = { needs: "document" } as const;

it.each([
  ["C:\\Fixtures\\projectA.rvt", "c:/fixtures/projectA.rvt"],
  ["\\\\server\\Models\\projectA.rvt", "\\\\SERVER\\models\\projectA.rvt"],
  ["f2933e8d-9e16-4bf4-b9ca-484f461e4563", "F2933E8D-9E16-4BF4-B9CA-484F461E4563"],
])("address spelling does not change the document: %s", (first, second) => {
  const at = address(first);
  const requested = address(second);
  const inventory: TargetInventory = {
    kind: "ready",
    sessions: {
      "process-1": {
        kind: "ready",
        values: [{ openId: "open-1", address: at, kind: "project" }],
      },
    },
  };
  expect(
    resolveCallTarget(read, { kind: "named", session: "process-1", address: requested }, inventory),
  ).toMatchObject({ kind: "resolved" });
  const value = { reading: { at, version: "1", observedAt: "2026-09-08T00:00:00.000Z" } };
  expect(here(value, requested)).toBe(value);
  expect(superseded(value.reading, { ...value.reading, at: requested, version: "2" })).toBe(true);
});

it("launch, document arrival, outage and confirmed closure never silently switch sessions", () => {
  expect(resolveCallTarget(read, null, fleet)).toEqual({ kind: "choose", reason: "missing" });
  const launching: TargetInventory = {
    kind: "ready",
    sessions: { "process-1": { kind: "checking" } },
  };
  expect(resolveCallTarget(read, selected, launching)).toEqual({ kind: "checking" });
  expect(resolveCallTarget(read, selected, fleet)).toEqual({
    kind: "resolved",
    target: { kind: "document", ref: { session: "process-1", openId: "project-1" } },
  });
  expect(resolveCallTarget(read, selected, { kind: "failed", message: "Disconnected" })).toEqual({
    kind: "failed",
    message: "Disconnected",
  });
  const gone: TargetInventory = {
    kind: "ready",
    sessions: fleet.kind === "ready" ? { "process-2": fleet.sessions["process-2"]! } : {},
  };
  expect(resolveCallTarget(read, selected, gone)).toEqual({
    kind: "choose",
    reason: "session-gone",
  });
  expect(selected).toEqual({ kind: "named", session: "process-1", address: project });
  expect(
    resolveCallTarget({ ...read, target: { ...selected, session: "process-2" } }, selected, gone),
  ).toMatchObject({ kind: "resolved", target: { ref: { session: "process-2" } } });
});

it("a frozen project default supports a family detour without affecting the next call", () => {
  const frozen = Object.freeze(selected);
  expect(resolveCallTarget({ needs: "family-document", target: family }, frozen, fleet)).toEqual({
    kind: "resolved",
    target: { kind: "document", ref: family.ref },
  });
  expect(resolveCallTarget({ needs: "family-document" }, frozen, fleet)).toEqual({
    kind: "choose",
    reason: "wrong-document-kind",
  });
  expect(resolveCallTarget(read, frozen, fleet)).toMatchObject({
    kind: "resolved",
    target: { ref: { openId: "project-1" } },
  });
  expect(
    resolveCallTarget(
      {
        needs: "document",
        target: { kind: "open", ref: { session: "process-1", openId: "closed-family" } },
      },
      frozen,
      fleet,
    ),
  ).toEqual({ kind: "choose", reason: "document-closed" });
  expect(
    resolveCallTarget(
      {
        needs: "project-document",
        target: {
          kind: "named",
          session: "process-1",
          address: address("f2933e8d-9e16-4bf4-b9ca-484f461e4563"),
        },
      },
      frozen,
      fleet,
    ),
  ).toMatchObject({ kind: "resolved", target: { ref: { openId: "cloud-1" } } });
});

it("host work needs no Revit and bootstrap needs a session without a document", () => {
  expect(
    resolveCallTarget({ needs: "nothing" }, null, { kind: "failed", message: "offline" }),
  ).toEqual({ kind: "resolved", target: { kind: "host" } });
  expect(callTargetSchema.parse({ needs: "session", target: { id: "4242" } })).toEqual({
    needs: "session",
    target: { id: "4242" },
  });
  expect(callTargetSchema.safeParse({ needs: "session" }).success).toBe(true);
  for (const target of ["session:dev", "4242", { id: "dev", pid: 42 }, { pid: 0 }])
    expect(callTargetSchema.safeParse({ needs: "session", target }).success).toBe(false);
  expect(
    targetInventorySchema.safeParse({
      kind: "ready",
      sessions: [
        { session: "duplicate", documents: { kind: "checking" } },
        { session: "duplicate", documents: { kind: "ready", values: [] } },
      ],
    }).success,
  ).toBe(false);
  expect(callTargetSchema.safeParse({ needs: "nothing", target: family }).success).toBe(false);
  expect(
    callTargetSchema.safeParse({ needs: "document", target: { kind: "named", address: project } })
      .success,
  ).toBe(false);
});
