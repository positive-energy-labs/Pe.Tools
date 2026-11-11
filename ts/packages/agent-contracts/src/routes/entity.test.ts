import { describe, expect, test } from "vite-plus/test";
import { routeAddress } from "../route-address.ts";
import { podMemberCode } from "../pods-read.ts";

describe("an entity route's address", () => {
  test("Family declaration publishes its spec keys and pose through one codec", () => {
    const family = routeAddress("family");
    const page = { stage: "history" as const, pod: "p", member: { kind: "ids" as const, ids: [podMemberCode({ pod: "p", path: "a.json" })] }, pane: "output" as const };
    const link = family.link(page);
    expect(new URL(link, "http://x").pathname).toBe("/family");
    expect(family.read(Object.fromEntries(new URL(link, "http://x").searchParams)).page).toMatchObject(page);
    expect(family.keys).toContain("pane");
    expect(Object.keys(family.agent.fields.shape)).toEqual(expect.arrayContaining(["stage", "pane", "pod", "member", "query", "sort", "hidden", "inspector"]));
    const schedules = routeAddress("schedules");
    expect(Object.keys(schedules.agent.fields.shape)).toEqual(expect.arrayContaining(["workspaceId", "table", "cell"]));
  });

  test("a table's sorts and hidden columns survive names with commas and leading dashes", () => {
    const family = routeAddress("family");
    const page = { sort: { columns: [{ key: "Width, Nominal", dir: "desc" as const }, { key: "-odd", dir: "asc" as const }] }, hidden: { "a,b": true as const, "c\\d": true as const } };
    const link = family.link(page);
    expect(family.read(Object.fromEntries(new URL(link, "http://x").searchParams)).page).toMatchObject(page);
    expect(family.agent.read({ sort: family.agent.write(page).sort! }).sort).toEqual(page.sort);
  });

  test("Pea's patch reads through the field's codec, and a bad one is refused by name", () => {
    const family = routeAddress("family");
    const sort = { columns: [{ key: "Width", dir: "desc" }, { key: "Name", dir: "asc" }] };
    expect(family.agent.read({ sort: JSON.stringify(sort) }).sort).toEqual(sort);
    expect(family.agent.patch.safeParse({ sort: "-" }).success).toBe(false);
    expect(routeAddress("schedules").agent.patch.safeParse({ cell: JSON.stringify("3:1") }).success).toBe(false);
    expect(family.agent.patch.safeParse({ inspector: JSON.stringify("part:hinge") }).success).toBe(true);
  });

  test("a subject pick pushes while table and pane pose changes replace", () => {
    const family = routeAddress("family");
    expect(family.history({ member: { kind: "ids", ids: [] } }, { member: { kind: "ids", ids: [podMemberCode({ pod: "p", path: "b.json" })] } })).toBe("push");
    expect(family.history({ sort: { columns: [] } }, { sort: { columns: [{ key: "x", dir: "asc" }] } })).toBe("replace");
    expect(family.history({ pane: "spec" }, { pane: "output" })).toBe("replace");
  });

  test("Pods subject and run scope use the declared JSON field codec", () => {
    const pods = routeAddress("pods");
    expect(Object.keys(pods.agent.fields.shape)).toEqual(expect.arrayContaining(["member", "runs"]));
    const page = { member: { kind: "ids" as const, ids: [podMemberCode({ pod: "p", path: "a.json" })] }, runs: "pod" as const };
    const link = pods.link(page);
    expect(pods.read(Object.fromEntries(new URL(link, "http://x").searchParams)).page).toMatchObject(page);
  });
});
