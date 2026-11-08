import { machineFixture } from "../../../../packages/agent-contracts/tests/machine-fixture.ts";
import { expect, test } from "vite-plus/test";
import { documentRequestSchema } from "@pe/agent-contracts";

import { soleUserDocument } from "./scope";

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
