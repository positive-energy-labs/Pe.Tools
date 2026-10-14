import { expect, test } from "vite-plus/test";
import { documentRequestSchema, sameAddress } from "@pe/agent-contracts";
import { parseTarget } from "./route-target";

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
