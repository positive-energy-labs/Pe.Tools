import { expect, test } from "vite-plus/test";
import { z } from "zod";
import { routeRegistry } from "../route/registry";
import { typedWorkCells } from "../route/route-discovery";
import { workPathName } from "./work-writes";

const routes = Object.keys(routeRegistry).sort().map((key) => routeRegistry[key]!.module).filter((route) => route.spec.edits);

test("every Work field a route can write has a declared name for History and Inputs", () => {
  const unnamed: string[] = [];
  for (const route of routes) {
    const names = { cells: typedWorkCells(route), workFields: route.data.workFields };
    const fields = Object.keys(z.toJSONSchema(route.spec.edits!.work.schema, { io: "input" }).properties ?? {});
    expect(fields.length, `${route.data.key} Work schema is an object`).toBeGreaterThan(0);
    for (const field of fields) {
      const family = names.cells.find((cell) => (cell.segment ?? cell.key) === field);
      // A cell family names its own rows by key; probe with a sample row key.
      const name = workPathName(names, family?.segment === null ? [field] : [field, "k"]);
      if (!name) unnamed.push(`${route.data.key}.${field}`);
    }
  }
  expect(unnamed).toEqual([]);
});
