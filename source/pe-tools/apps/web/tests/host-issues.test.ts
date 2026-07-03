import { expect, test } from "vite-plus/test";
import { HostCallError } from "@pe/host-contracts/operation-types";
import { toHostIssue } from "../src/host/issues";

test("host RPC error kind drives web issue classification", () => {
  const issue = toHostIssue(
    new HostCallError("revit.apply: busy", 423, {
      kind: "BridgeBusy",
      operationKey: "revit.apply.example",
      status: 423,
      title: "Bridge busy",
    }),
  );

  expect(issue.kind).toBe("bridge_busy");
  expect(issue.operationKey).toBe("revit.apply.example");
});
