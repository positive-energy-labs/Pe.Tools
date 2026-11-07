import { targetInventory, retainTargetInventory } from "#/host/resource-state";
import { expect, test } from "vite-plus/test";
import { documentRequestSchema, sameAddress } from "@pe/agent-contracts";
import { machineFixture } from "../../../../packages/agent-contracts/tests/machine-fixture";
import { retainSoleDocument, parseTarget } from "./route-target";

test("an admitted exact open request retains both executable identities through the URL", () => {
  const request = documentRequestSchema.parse({
    kind: "open",
    ref: { session: "incarnation-A", openId: "document-lifetime-1" },
  });
  expect(parseTarget(JSON.stringify(request))).toEqual({ kind: "request", request });
  const successor = documentRequestSchema.parse({
    kind: "open",
    ref: { session: "incarnation-B", openId: "document-lifetime-1" },
  });
  expect(parseTarget(JSON.stringify(successor))).toEqual({ kind: "request", request: successor });
  expect(parseTarget(JSON.stringify(successor))).not.toEqual(parseTarget(JSON.stringify(request)));
});

test("named requests with the same document address retain their distinct sessions", () => {
  const first = documentRequestSchema.parse({
    kind: "named",
    session: "A",
    address: "C:/Models/Review.rvt",
  });
  const second = documentRequestSchema.parse({
    kind: "named",
    session: "B",
    address: "c:\\models\\review.rvt",
  });
  if (first.kind !== "named" || second.kind !== "named") throw Error("expected named requests");
  expect(sameAddress(first.address, second.address)).toBe(true);
  expect(parseTarget(JSON.stringify(first))).toEqual({ kind: "request", request: first });
  expect(parseTarget(JSON.stringify(second))).toEqual({ kind: "request", request: second });
  expect(parseTarget(JSON.stringify(second))).not.toEqual(parseTarget(JSON.stringify(first)));
});

test.each(['{"kind":"open"', ' {"kind":"wrong"}', '[{"kind":"open"}]'])(
  "access-063: JSON target %s is never reinterpreted as a session",
  (raw) => {
    expect(parseTarget(raw)).toMatchObject({ kind: "invalid", raw });
  },
);

test("an incomplete or failed census retains the exact fallback; a confirmed close clears it", () => {
  const machine = machineFixture([
    {
      session: "one",
      documents: [
        {
          openId: "doc",
          title: "Project",
          address: "C:/Models/A.rvt",
          isActive: true,
          isFamilyDocument: false,
        },
      ],
    },
  ]);
  const first = retainSoleDocument(machine, null);
  expect(first).toMatchObject({ busy: false, request: { ref: { session: "one", openId: "doc" } } });
  const slow = structuredClone(machine);
  Object.assign(slow.legs, { attachments: { ...slow.legs.attachments!, error: "Revit is busy" } });
  expect(retainSoleDocument(slow, first.request)).toEqual({ request: first.request, busy: true });
  Object.assign(slow.legs, { attachments: machine.legs.attachments! });
  Object.assign(slow.revit.sessions![0]!.attachment!, { documents: null });
  expect(retainSoleDocument(slow, first.request)).toEqual({ request: first.request, busy: true });
  expect(retainSoleDocument(machineFixture(), first.request)).toEqual({
    request: null,
    busy: false,
  });
});

test("N4: a fresh page mid-read (machine census busy, nothing kept) binds the live inventory's only document", () => {
  const machine = machineFixture([
    {
      session: "one",
      documents: [
        {
          openId: "doc",
          title: "Project",
          address: "C:/Models/A.rvt",
          isActive: true,
          isFamilyDocument: false,
        },
      ],
    },
  ]);
  const busy = structuredClone(machine);
  Object.assign(busy.revit.sessions![0]!.attachment!, { documents: null });
  const live = {
    kind: "ready" as const,
    sessions: {
      one: {
        kind: "ready" as const,
        values: [{ openId: "doc", address: null, kind: "project" as const }],
      },
    },
  };
  expect(retainSoleDocument(busy, null)).toEqual({ request: null, busy: true });
  expect(retainSoleDocument(busy, null, live)).toEqual({
    request: { kind: "open", ref: { session: "one", openId: "doc" } },
    busy: true,
  });
  // Two open documents in the live inventory name no sole one; the kept target still wins.
  const two = {
    ...live,
    sessions: {
      one: {
        kind: "ready" as const,
        values: [
          ...live.sessions.one.values,
          { openId: "b", address: null, kind: "project" as const },
        ],
      },
    },
  };
  expect(retainSoleDocument(busy, null, two).request).toBeNull();
  const kept = { kind: "open" as const, ref: { session: "one", openId: "kept" } };
  expect(retainSoleDocument(busy, kept, live).request).toBe(kept);
});

test("a reconnecting attachment does not confirm that the automatic document closed", () => {
  const machine = machineFixture([
    {
      session: "one",
      documents: [
        {
          openId: "doc",
          title: "Project",
          address: "C:/Models/A.rvt",
          isActive: true,
          isFamilyDocument: false,
        },
      ],
    },
  ]);
  const first = retainSoleDocument(machine, null);
  const reconnecting = structuredClone(machine);
  Object.assign(reconnecting.revit.sessions![0]!, { attachment: null });
  expect(retainSoleDocument(reconnecting, first.request)).toEqual({
    request: first.request,
    busy: true,
  });
});

test("an unavailable open-document list is checking, not a confirmed empty list", () => {
  const result = targetInventory({
    state: "ready",
    observation: { sessions: [{ sessionId: "one", connected: true, openDocuments: null }] },
  } as never);
  expect(result).toMatchObject({ kind: "ready", sessions: { one: { kind: "checking" } } });
});

test("target facts survive a refetch and an incomplete session but not a confirmed close", () => {
  const ready = {
    kind: "ready" as const,
    sessions: {
      one: {
        kind: "ready" as const,
        values: [{ openId: "doc", address: null, kind: "project" as const }],
      },
    },
  };
  expect(retainTargetInventory({ kind: "checking" }, ready)).toBe(ready);
  expect(
    retainTargetInventory({ kind: "ready", sessions: { one: { kind: "checking" } } }, ready),
  ).toEqual(ready);
  const closed = {
    kind: "ready" as const,
    sessions: { one: { kind: "ready" as const, values: [] } },
  };
  expect(retainTargetInventory(closed, ready)).toEqual(closed);
  expect(retainTargetInventory({ kind: "ready", sessions: {} }, ready)).toEqual({
    kind: "ready",
    sessions: {},
  });
});

test("an automatic target is tab memory while still open, even if preview opens another document", () => {
  const docs = [
    {
      openId: "project",
      title: "Project",
      address: "C:/A.rvt",
      isActive: true,
      isFamilyDocument: false,
    },
  ];
  const first = retainSoleDocument(machineFixture([{ session: "one", documents: docs }]), null);
  const expanded = machineFixture([
    {
      session: "one",
      documents: [...docs, { ...docs[0]!, openId: "family", isFamilyDocument: true }],
    },
  ]);
  expect(retainSoleDocument(expanded, first.request)).toMatchObject({ request: first.request });
});
