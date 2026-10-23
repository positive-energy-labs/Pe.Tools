import { describe, expect, test } from "vite-plus/test";
import { routeAddress } from "../route-address.ts";

describe("an entity route's address", () => {
  test("stage, pod and path deep-link a spec; the right pane never rides the address", () => {
    const schedules = routeAddress("schedules");
    expect(schedules.link({ stage: "history" })).toBe("/schedules?stage=history");
    expect(schedules.keys).not.toContain("pane");
    expect(schedules.agent.keys).toContain("pane");
    expect(Object.keys(schedules.agent.fields.shape)).toEqual(
      expect.arrayContaining(["stage", "pane", "query", "sort", "hidden", "cell"]),
    );
    // The opened spec and schedule are apply's input: Pea reads them, never sets them.
    for (const key of ["pod", "path", "workspaceId"])
      expect(Object.keys(schedules.agent.fields.shape)).not.toContain(key);
    expect(schedules.agent.keys).toEqual(expect.arrayContaining(["pod", "path", "workspaceId"]));
  });

  test("a table's sorts and hidden columns survive names with commas and leading dashes", () => {
    const family = routeAddress("family");
    const page = {
      sort: [
        { key: "Width, Nominal", dir: "desc" as const },
        { key: "-odd", dir: "asc" as const },
      ],
      hidden: ["a,b", "c\\d"],
    };
    const link = family.link(page);
    const search = Object.fromEntries(new URL(link, "http://x").searchParams);
    expect(family.read(search).page).toMatchObject(page);
    expect(family.agent.write(page).sort).toBe("-Width\\, Nominal,\\-odd");
  });

  test("Pea's patch reads through the field's codec, and a bad one is refused by name", () => {
    const families = routeAddress("families");
    expect(families.agent.read({ sort: "-Width,Name" }).sort).toEqual([
      { key: "Width", dir: "desc" },
      { key: "Name", dir: "asc" },
    ]);
    expect(families.agent.patch.safeParse({ sort: "-" }).success).toBe(false);
    expect(routeAddress("schedules").agent.patch.safeParse({ cell: "3:1" }).success).toBe(false);
    expect(routeAddress("family").agent.patch.safeParse({ inspector: "part:hinge" }).success).toBe(
      true,
    );
  });

  test("a query typed is a step, a sort is a tweak; an agent-only pane makes no entry", () => {
    const families = routeAddress("families");
    expect(families.history({ query: "a" }, { query: "b" })).toBe("push");
    expect(families.history({ sort: [] }, { sort: [{ key: "x", dir: "asc" }] })).toBe("replace");
    expect(families.history({ pane: "spec" }, { pane: "output" })).toBeNull();
  });

  test("/pods: the open member is read-only to Pea; the runs scope is Pea's", () => {
    const pods = routeAddress("pods");
    expect(Object.keys(pods.agent.fields.shape)).toEqual(["threadQuery", "threadSort", "runs"]);
    expect(pods.link({ pod: "p", path: "a.json", runs: "pod" })).toBe(
      "/pods?pod=p&path=a.json&runs=pod",
    );
  });
});
