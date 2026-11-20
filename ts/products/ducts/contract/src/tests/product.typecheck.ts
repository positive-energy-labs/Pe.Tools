import { z } from "zod";
import {
  documentRecord,
  entity,
  homeFile,
  ownerBlob,
  product,
  type ReadingLoad,
} from "@pe/agent-contracts/product";
import { contract } from "@pe/agent-contracts/handle";

export function productTypeRefusals() {
  // @ts-expect-error Settings paths have string segments.
  homeFile("proof", ["firm"], { bad: [1] });
  // @ts-expect-error Native identities are selected from the generated C# descriptor table.
  ownerBlob("other");
  // @ts-expect-error A Revit entity is not a document record.
  documentRecord(entity("specificLoss"));
  // @ts-expect-error Call policies name catalog operations.
  const badKey: ReadingLoad = { calls: { "proof.missing": {} } };
  // @ts-expect-error canonicalSession is a boolean.
  const badPolicy: ReadingLoad = { calls: { "ducts.tables": { canonicalSession: "yes" } } };
  // @ts-expect-error Resource registration is opt-in.
  const badResource: ReadingLoad = { resource: false };
  const echo = contract("proof.untagged", { input: z.object({}), data: z.string(), uses: [] });
  product({
    id: "proof",
    says: "Proof",
    routes: {},
    homes: {},
    cells: {},
    commands: {},
    readings: {
      // @ts-expect-error A resource handle's input carries a kind.
      echo: { handle: echo, sources: [], load: { resource: true } },
    },
  });
  return [badKey, badPolicy, badResource];
}
