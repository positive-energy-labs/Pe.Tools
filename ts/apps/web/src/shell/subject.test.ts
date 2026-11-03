import { expect, test } from "vite-plus/test";
import { z } from "zod";
import {
  field,
  manyField,
  manyCodec,
  resolveMany,
} from "../../../../packages/agent-contracts/src/route-field";
import { validateRouteGraph } from "@pe/agent-contracts";
import { systemSubjectGraph as ductsGraph } from "./subject.test-support";
import { fanSubjectGraph as fansGraph } from "./subject.test-support";
import { graphUrlPage } from "./mount-page";
import { restorePageSearch } from "../route/url";
test("subject many codec preserves exact sets and resolves all against the current roster", () => {
  const ids = ["SA,1", "FC-1@2", "a%b", "all"];
  expect(manyCodec.decode(manyCodec.encode(ids))).toEqual(ids);
  expect(resolveMany("all", ["A", "B"])).toEqual(["A", "B"]);
  expect(() => manyField("ElementId" as never, {})).toThrow(/ElementId/);
});
test("URL beats tab memory, which beats Page defaults", () => {
  const url = graphUrlPage(fansGraph);
  expect(
    url.read(restorePageSearch({ fan: "memory", stage: "sheet" }, { fan: "link" })!),
  ).toMatchObject({ fan: ["link"], stage: "sheet" });
  expect(url.read(restorePageSearch({ fan: "memory" }, {})!)).toMatchObject({ fan: ["memory"] });
  expect(url.read({})).toMatchObject({ fan: [], stage: "sheet" });
});
test("typed graphs declare one subject and one kernel selection", () => {
  expect(validateRouteGraph(ductsGraph)).toEqual([]);
  expect(validateRouteGraph(fansGraph)).toEqual([]);
  for (const graph of [ductsGraph, fansGraph])
    expect(
      Object.entries(graph.fields)
        .filter(([, field]) => field.role === "selection")
        .map(([key]) => key),
    ).toEqual(["selected"]);
  const custom = { encode: JSON.stringify, decode: JSON.parse };
  // @ts-expect-error Page arrays must use manyField
  field(z.array(z.object({ key: z.string() })), {}, custom);
});

test("restore is per field; explicit empty clears memory but absent and undefined do not", () => {
  const url = graphUrlPage(fansGraph);
  expect(
    url.read(restorePageSearch({ fan: "saved", stage: "sheet" }, { fan: undefined })!),
  ).toMatchObject({ fan: ["saved"], stage: "sheet" });
  expect(url.read(restorePageSearch({ fan: "saved" }, { fan: "" })!)).toMatchObject({ fan: [] });
  expect(url.read(restorePageSearch({ fan: "saved" }, { fan: [] })!)).toMatchObject({ fan: [] });
});

test("graph URL preserves explicit defaults and round-trips changed subject fields", () => {
  const url = graphUrlPage(fansGraph);
  const defaults = url.read({});
  expect(url.read(url.write(defaults))).toEqual(defaults);
  const page = { ...defaults, fan: ["uid,1@2"] };
  expect(url.read(url.write(page))).toEqual(page);
});

test("URL projection preserves setting defaults but preserves an explicit empty subject over memory", () => {
  const url = graphUrlPage(fansGraph);
  const project = (search: Record<string, unknown>) =>
    url.middlewares[0]!({ search, next: (value: Record<string, unknown>) => value } as never);
  expect(project({ stage: "sheet", fan: [] })).toEqual({ stage: "sheet", fan: "" });
  expect(project({ fan: [1, 2] })).toEqual({ fan: [1, 2] });
  expect(project({ fan: "%" })).toEqual({ fan: "%" });
});
