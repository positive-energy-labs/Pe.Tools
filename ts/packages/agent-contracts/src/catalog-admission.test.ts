import { expect, test } from "vite-plus/test";
import { catalogEntries } from "./pe-api.ts";
import { requireLinkedCatalog, type CatalogLink } from "./catalog.ts";

test("runtime admission refuses every omitted axis", () => {
  for (const axis of ["subject", "touches", "effect", "cost", "cardinality", "uses"]) {
    const row = { ...catalogEntries[0], key: "bad" } as Record<string, unknown>;
    delete row[axis];
    expect(() => requireLinkedCatalog([row as unknown as CatalogLink])).toThrow(axis);
  }
});
test("runtime admission links the complete shipped catalog", () => {
  expect(() => requireLinkedCatalog(catalogEntries)).not.toThrow();
});

test("runtime admission refuses Unset axes and names the op", () => {
  for (const axis of ["subject", "touches", "effect"]) {
    const row = {
      ...catalogEntries[0],
      key: "test.unset",
      [axis]: axis === "touches" ? ["Unset"] : "Unset",
    };
    expect(() => requireLinkedCatalog([row as unknown as CatalogLink])).toThrow(
      `test.unset: missing or invalid ${axis}`,
    );
  }
});
