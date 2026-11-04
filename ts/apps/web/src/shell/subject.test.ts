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
import { openSet } from "./open-set.neutral";
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

test("an open set keeps its active member explicit: add never moves it, remove hands it to a neighbour", () => {
  const set = openSet((id: string) => id, ["a", "b", "c", "d"]);
  const empty = { kind: "ids", ids: [] } as const;
  // The first subject into an empty set is active; later adds stay in the background.
  const one = set.add(empty, ["b"]);
  expect(set.active(one)).toBe("b");
  const three = set.add(one, ["c", "a", "c"]);
  expect(three).toEqual({ kind: "ids", ids: ["b", "c", "a"] });
  expect(set.active(three)).toBe("b");
  // setActive pins a member; a URL keeps `active` only when it is not the first.
  const pinned = set.setActive(three, "a");
  expect(pinned).toEqual({ kind: "ids", ids: ["b", "c", "a"], active: "a" });
  expect(set.add(pinned, ["d"])).toEqual({ kind: "ids", ids: ["b", "c", "a", "d"], active: "a" });
  // Removing a background member keeps the active; removing the active falls to the next, else the previous.
  expect(set.remove(pinned, "c")).toEqual({ kind: "ids", ids: ["b", "a"], active: "a" });
  expect(set.active(set.remove(set.setActive(three, "c"), "c"))).toBe("a");
  expect(set.active(set.remove(pinned, "a"))).toBe("c");
  expect(set.remove(set.remove(one, "b"), "b")).toEqual(empty);
  // toggle opens into the background and closes; setActive on a closed subject opens it.
  expect(set.toggle(three, "d")).toEqual({ kind: "ids", ids: ["b", "c", "a", "d"] });
  expect(set.toggle(three, "b")).toEqual({ kind: "ids", ids: ["c", "a"] });
  expect(set.setActive(one, "d")).toEqual({ kind: "ids", ids: ["b", "d"], active: "d" });
  // All: everything is open and the roster's first is active; add never freezes it into ids.
  const all = { kind: "all" } as const;
  expect(set.add(all, ["a"])).toBe(all);
  expect(set.active(all)).toBe("a");
  expect(set.remove(all, "a")).toEqual({ kind: "ids", ids: ["b", "c", "d"] });
  expect(set.remove(all, "c")).toEqual({ kind: "ids", ids: ["a", "b", "d"] });
});
