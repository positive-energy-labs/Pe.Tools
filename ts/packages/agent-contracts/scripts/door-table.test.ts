import { expect, test } from "vite-plus/test";
import { commandTable, type CommandKey } from "../src/command-axes.ts";
import { httpRoutes, peRoutes, type PeRouteId } from "../src/pe-api.ts";

const axisNames = new Set(["subject", "touches", "effect", "cost", "cardinality", "cap", "internal", "rollsBack"]);
test("every key shared by the HTTP doors and command table has exactly one policy", () => {
  const shared = Object.keys(commandTable).filter((key) => Object.hasOwn(httpRoutes, key));
  expect(shared.length).toBeGreaterThan(0);
  for (const key of shared) {
    const door = Object.fromEntries(Object.entries(peRoutes[key as PeRouteId].catalog).filter(([name]) => axisNames.has(name)));
    expect.soft(commandTable[key as CommandKey].axes, key).toEqual(door);
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
