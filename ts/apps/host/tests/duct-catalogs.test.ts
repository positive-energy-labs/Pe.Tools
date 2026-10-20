import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, test } from "vite-plus/test";
import { readDuctCatalogs } from "../src/duct-catalogs.ts";

test("a missing catalogs root is an empty catalog with no finding", async () => {
  const reading = await readDuctCatalogs(join(tmpdir(), "pe-no-such-catalogs-root"));
  expect(reading.tables).toEqual({});
  expect(reading.findings).toEqual([]);
});
