import { expect, test } from "vite-plus/test";
import { tsOnlyOperationCatalog, tsOnlyOperationSchemas } from "@pe/host-contracts/operation-types";
import { Schema } from "effect";
import * as generated from "@pe/host-contracts/generated";
import { hostOpCatalog } from "@pe/host-contracts/catalog";

test("browser contracts exclude the full discovery catalog; the host catalog covers the same operations", () => {
  expect(generated).not.toHaveProperty("hostOpCatalog");
  expect(hostOpCatalog.map((operation) => operation.key)).toEqual(generated.hostOpKeys);
});

test("host-local op catalog covers every TS-only op exactly once (GET /ops discovery)", () => {
  const catalogKeys = tsOnlyOperationCatalog.map((entry) => entry.key);
  const schemaKeys = Object.keys(tsOnlyOperationSchemas);
  expect(new Set(catalogKeys).size).toBe(catalogKeys.length); // no dupes
  expect(new Set(catalogKeys)).toEqual(new Set(schemaKeys)); // 1:1 with the schema map
  for (const entry of tsOnlyOperationCatalog) {
    expect(entry.origin).toBe("host-local"); // marks them for host-typegen to skip
    expect(entry.key in tsOnlyOperationSchemas).toBe(true);
  }
});

test("pod member ops decode the member address and split create from save", () => {
  // The host decodes requests with excess properties refused; so does this check.
  const write = Schema.decodeUnknownSync(tsOnlyOperationSchemas["pod.member.write"].request, {
    onExcessProperty: "error",
  });
  expect(() =>
    write({ pod: "p", path: "settings/a.json", content: "{}", expectedSha256: "x" }),
  ).toThrow();
  const save = Schema.decodeUnknownSync(tsOnlyOperationSchemas["pod.member.save"].request);
  expect(() => save({ pod: "p", path: "settings/a.json", content: "{}" })).toThrow();
  expect(save({ pod: "p", path: "settings/a.json", content: "{}", expectedSha256: "x" })).toEqual({
    pod: "p",
    path: "settings/a.json",
    content: "{}",
    expectedSha256: "x",
  });
});
