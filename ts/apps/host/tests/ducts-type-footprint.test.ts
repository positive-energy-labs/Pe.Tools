import { expect, test } from "vite-plus/test";
import { RouteWorkspace } from "@pe/runtime";
import { ductsExecutors } from "../src/ducts-actions.ts";
import { detachedBridge } from "./effect-test.ts";

test("loss apply refuses before reads or dispatch until shared parameter ownership is accounted for", async () => {
  const executor = ductsExecutors(detachedBridge())["ducts.apply-losses"]!;
  await expect(executor.bind({
    admission: { id: "shared-type-refused", key: "ducts.apply-losses", target: { kind: "document", ref: { session: "s", openId: "o" } }, input: {} },
    caller: { kind: "human", via: "local" }, basis: { kind: "human" },
    work: new RouteWorkspace({ registrations: [] }), consumed: [],
    selectWork: async () => { throw Error("Refusal must precede Work reads"); },
    read: { receipts: () => [] },
  })).rejects.toMatchObject({ refusal: { kind: "domain", code: "ducts.parameter-scope-unproven" } });
});
