import { readFileSync } from "node:fs";
import { expect, test } from "vite-plus/test";
import { decode } from "../../../../packages/agent-contracts/src/subject-ref.ts";
import { nameOf, oneName } from "../route/typed-route.ts";
import { module } from "./route";

/*
 * Slice 10 (MAP row 10), bind: the Page is the subject slot's SubjectRef (keyKind `name`, `[slug]`),
 * its roster is every Page the capability catalog serves (`bind.picker`'s `pages`), and the Page's
 * own `query` and `fragment` are route-owned query. No sheet. The route's hand slug input is gone:
 * the kernel's subject picker is the one Page chooser, and both writes take the slug from the subject.
 */
test("slice 10 bind: the Page is a name SubjectRef subject from the Page roster; query and fragment are query", () => {
  const { data, spec } = module;
  expect(data.subject).toMatchObject({ field: "page", noun: "Page", pane: "main" });
  expect(Object.fromEntries(Object.entries(data.fields).map(([k, f]) => [k, f.role]))).toEqual({
    query: "query", fragment: "query", page: "subject", view: "pose", selected: "selection",
  });
  expect(spec.sheet).toBeUndefined();
  const options = spec.subject!.options({
    threads: [], inventory: [] as never, pages: [{ slug: "chadds-duct-readiness", title: "Duct readiness" }, { slug: "todo", title: "" }],
  });
  expect(options).toEqual([
    { id: oneName("chadds-duct-readiness").ids[0], label: "Duct readiness" },
    { id: oneName("todo").ids[0], label: "todo" },
  ]);
  expect(decode(options[1]!.id)).toEqual({ ok: true, value: { keyKind: "name", key: ["todo"] } });
  const page = { page: oneName("todo"), view: false, query: {}, fragment: "", selected: [] };
  const bind = spec.commands.bind as { input(c: object, s: unknown): unknown };
  const read = spec.commands.read as { input(c: object): unknown };
  expect(bind.input({ page }, { kind: "unbind" })).toEqual({ slug: "todo", binding: { kind: "unbind" } });
  expect(read.input({ page })).toEqual({ slug: "todo" });
  expect(nameOf(oneName(""))).toBe("");
  // One capability, one choice path: the body draws no slug input beside the kernel's Page picker.
  expect(readFileSync(new URL("mount.tsx", import.meta.url), "utf8")).not.toMatch(/<Input|query\(\{ page/);
});
