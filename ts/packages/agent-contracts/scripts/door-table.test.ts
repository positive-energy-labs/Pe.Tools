import { expect, test } from "vite-plus/test";
import { commandTable } from "../src/command-axes.ts";
import { httpRoutes, createPeCatalog } from "../src/pe-api.ts";
import { builtinHostActions } from "../src/semantic-actions.ts";
const { peRoutes } = createPeCatalog(builtinHostActions);

const axisNames = new Set([
  "subject",
  "touches",
  "effect",
  "cost",
  "cardinality",
  "cap",
  "internal",
  "rollsBack",
]);
test("every key shared by the HTTP doors and command table has exactly one policy", () => {
  const axes = new Map(Object.entries(commandTable).map(([key, row]) => [key, row.axes]));
  const shared = Object.entries(peRoutes).filter(([key]) => axes.has(key));
  expect(shared.length).toBeGreaterThan(0);
  for (const [key, route] of shared) {
    const door = Object.fromEntries(
      Object.entries(route.catalog).filter(([name]) => axisNames.has(name)),
    );
    expect.soft(axes.get(key), key).toEqual(door);
  }
});

test("every routed command names a declared PeRouteId", () => {
  const routed = Object.entries(commandTable).filter(([, row]) => row.via !== "command");
  expect(routed.length).toBeGreaterThan(0);
  for (const [key, row] of routed) {
    if (row.via === "command") throw Error(key);
    expect(Object.hasOwn(httpRoutes, row.via.route), key).toBe(true);
  }
});
