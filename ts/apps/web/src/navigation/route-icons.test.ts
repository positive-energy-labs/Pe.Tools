import { expect, test } from "vite-plus/test";
import { icons } from "lucide-react";
import { ROUTE_DIRECTORY } from "@pe/agent-contracts";

// Slice 5a: a route names its icon by Lucide name and the library is the check, not a closed list.
test("every directory icon is a Lucide name", () => {
  expect(
    ROUTE_DIRECTORY.filter((route) => !(route.iconKey in icons)).map((route) => `${route.key}: ${route.iconKey}`),
  ).toEqual([]);
  expect(Object.keys(icons).length).toBeGreaterThan(1000);
});
