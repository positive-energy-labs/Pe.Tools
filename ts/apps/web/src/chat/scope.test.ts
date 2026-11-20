import { machineFixture } from "../../../../packages/agent-contracts/tests/machine-fixture.ts";
import { expect, test } from "vite-plus/test";
import { documentRequestSchema, machineInventory } from "@pe/agent-contracts";

import { pinnedDocument, pinsDocument, soleUserDocument } from "#/workbench/sole-user-document";

const doc = (openId: string) => ({
  openId,
  title: `${openId}.rvt`,
  address: `C:/Jobs/${openId}.rvt`,
  isFamilyDocument: false,
  isActive: true,
});

test("one connected Revit with one user document defaults the draft to it", () => {
  const machine = machineFixture([{ session: "pe.app-26", documents: [doc("one")] }]);
  // The default is a wire-shaped request: the same schema the composer sends to PUT /pe/scope.
  expect(documentRequestSchema.parse(soleUserDocument(machine))).toEqual({
    kind: "open",
    ref: { session: "pe.app-26", openId: "one" },
  });
});

test("two documents, two Revits, Pea's own document or no reading leave the draft unbound", () => {
  const twoDocs = machineFixture([{ session: "a", documents: [doc("one"), doc("two")] }]);
  const twoRevits = machineFixture([
    { session: "a", documents: [doc("one")] },
    { session: "b", documents: [doc("two")] },
  ]);
  const base = machineFixture([{ session: "a", documents: [doc("one")] }]);
  const peas = {
    ...base,
    revit: {
      ...base.revit,
      sessions: base.revit.sessions!.map((session) => ({
        ...session,
        attachment: {
          ...session.attachment!,
          documents: session.attachment!.documents!.map((document) => ({
            ...document,
            access: { kind: "pea" as const, acquisition: "acq-1" },
          })),
        },
      })),
    },
  };
  for (const machine of [twoDocs, twoRevits, peas, null])
    expect(soleUserDocument(machine)).toBeNull();
});

// Row 12 (owner ruling 2026-11-13): a thread binds to the document the URL's `?target` names.
test("a ?target address pin names the one open document at that address, among several", () => {
  const machine = machineFixture([{ session: "a", documents: [doc("A"), doc("B")] }]);
  const inventory = machineInventory(machine);
  expect(soleUserDocument(machine)).toBeNull();
  expect(pinnedDocument(inventory, "C:/Jobs/A.rvt")).toEqual({
    kind: "open",
    ref: { session: "a", openId: "A" },
  });
  // No pin, a pin no open document holds, and a document two Revits hold all bind nothing.
  expect(pinnedDocument(inventory, undefined)).toBeNull();
  expect(pinnedDocument(inventory, "C:/Jobs/Closed.rvt")).toBeNull();
  const twice = machineFixture([
    { session: "a", documents: [doc("A")] },
    { session: "b", documents: [doc("A")] },
  ]);
  expect(pinnedDocument(machineInventory(twice), "C:/Jobs/A.rvt")).toBeNull();
});

test("a ?target request pin binds its open document, and a pin is told apart from a session or nothing", () => {
  const inventory = machineInventory(
    machineFixture([{ session: "a", documents: [doc("A"), doc("B")] }]),
  );
  const open = (openId: string) => JSON.stringify({ kind: "open", ref: { session: "a", openId } });
  expect(pinnedDocument(inventory, open("B"))).toEqual({
    kind: "open",
    ref: { session: "a", openId: "B" },
  });
  expect(pinnedDocument(inventory, open("closed"))).toBeNull();
  expect([open("B"), "C:/Jobs/A.rvt"].map((target) => pinsDocument(target))).toEqual([true, true]);
  // A session name, a malformed value and no target name no document: the draft keeps its default.
  expect(["pe.app-26", "{broken", undefined, null].map((target) => pinsDocument(target))).toEqual([
    false,
    false,
    false,
    false,
  ]);
});
