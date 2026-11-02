import { expect, test } from "vite-plus/test";
import { z } from "zod";
import {
  field,
  manyField,
  manyCodec,
  resolveMany,
} from "../../../../packages/agent-contracts/src/route-field";
import { validateRouteGraph } from "@pe/agent-contracts";
import { ductsGraph } from "../ducts/graph";
import { fansGraph } from "../fans/graph";
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
test("one subject and kernel many codec are admission rules; query arrays retain their codecs", () => {
  expect(validateRouteGraph(ductsGraph)).toEqual([]);
  expect(validateRouteGraph(fansGraph)).toEqual([]);
  expect(fansGraph.workRoute).toBe(ductsGraph.key);
  for (const graph of [ductsGraph, fansGraph])
    expect(
      Object.entries(graph.fields)
        .filter(([, field]) => field.role === "selection")
        .map(([key]) => key),
    ).toEqual(["selected"]);
  const custom = { encode: JSON.stringify, decode: JSON.parse };
  expect(() => field(z.array(z.object({ key: z.string() })), {}, custom)).not.toThrow();
  expect(
    validateRouteGraph({
      ...fansGraph,
      fields: { ...fansGraph.fields, fan: { ...fansGraph.fields.fan, codec: custom } },
    }),
  ).toEqual(expect.arrayContaining([expect.objectContaining({ path: "subjectField" })]));
});
