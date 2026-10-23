import { expect, test } from "vite-plus/test";
import { emptyListSearch, pickListPill, routeAddress } from "@pe/agent-contracts";
import { parseSearchWith, stringifySearchWith } from "@tanstack/react-router";
import { routeUrlPage } from "./url";

test("typed and already encoded list searches cross the router once and restore identically", () => {
  const search = pickListPill(
    { ...emptyListSearch(), keywords: 'air: "RV-28" & supply' },
    "airType",
    "SupplyAir",
  );
  const contract = routeAddress("ducts");
  const url = routeUrlPage("ducts");
  const middleware = url.middlewares[0]!;
  for (const value of [search, contract.write({ systemSearch: search }).systemSearch]) {
    const encoded = middleware({ search: { systemSearch: value }, next: (value) => value });
    const query = stringifySearchWith(JSON.stringify)(encoded);
    expect(new URLSearchParams(query).get("systemSearch")).toBe(JSON.stringify(search));
    expect(url.read(parseSearchWith(JSON.parse)(query)).systemSearch).toEqual(search);
  }
  const cleared = middleware({
    search: { systemSearch: emptyListSearch() },
    next: (value) => value,
  });
  expect(cleared).not.toHaveProperty("systemSearch");
});
