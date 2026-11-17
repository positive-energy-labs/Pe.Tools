import { expect, test } from "vite-plus/test";
import { z } from "zod";
import { bindWork, publicationSchema, workKeySchema } from "@pe/agent-contracts";
import { evaluate, leaf, read, workInput } from "../src/reads/evaluator.ts";
import { workRead } from "../src/reads/inputs.ts";
import { RouteWorkspace } from "@pe/runtime";
import { hostTimeline } from "../src/reads/work-timeline.ts";

test("publication members are deduplicated Work leaves, including absent Work, never unread Works", async () => {
  const ducts = bindWork("duct-systems", null, "one"), fans = { ...ducts, route: "fans" }, rooms = { ...ducts, route: "rooms" }, schedules = { ...ducts, route: "schedules" };
  const schema = z.object({ n: z.number() });
  const definition = read("membership-proof", {
    input: workKeySchema, output: z.literal(true),
    async run(ctx, scope) {
      await ctx.read(workRead("duct-systems", schema), scope);
      await ctx.read(workRead("fans", schema), { ...scope, route: "fans" });
      await ctx.read(workInput, { owner: "duct-systems", scope });
      // The input port dispatches by name, including an equivalent leaf from a bundled read.
      await ctx.read(leaf(workInput.name, workInput.input, workInput.output), { owner: "rooms", scope: rooms });
      return true as const;
    },
  });
  const value = await evaluate(definition, ducts, {
    evaluation: "fixture", origin: null, revision: () => 0,
    take: async (name, args) => {
      if (name !== "work") throw Error(`Unexpected input ${name}`);
      const { owner } = workInput.input.parse(args);
      return owner === "fans" ? null : { doc: { n: 1 }, revision: 1 };
    },
  });
  expect(value.works).toEqual([ducts, fans, rooms]);
  expect(value.works).not.toContainEqual(schedules);
  expect(publicationSchema(z.boolean()).parse({ key: "fixture", generation: 0, version: 1, state: "current", value }).value?.works).toEqual([ducts, fans, rooms]);
});

test("document Timeline reaches registered Works at that document without route owners", async () => {
  const saved = new Map<string, unknown>();
  const workspace = new RouteWorkspace({
    registrations: ["fans", "schedules"].map(route => ({ spec: { route, title: route, description: "Document membership", schema: z.object({ n: z.number().default(0) }) } })),
    store: { getState: async ({ targetKey }) => saved.get(targetKey), setState: async ({ targetKey, value }) => { saved.set(targetKey, structuredClone(value)); } },
  });
  const document = bindWork("chat", null, undefined, { session: "proof", openId: "a" });
  if (document.binding !== "open") throw Error("Expected the unsaved document fixture");
  const fans = { ...document, route: "fans" }, schedules = { ...document, route: "schedules" };
  const other = bindWork("fans", null, undefined, { session: "proof", openId: "b" });
  for (const key of [fans, schedules, other]) {
    await workspace.view(key, key.route);
    expect(await workspace.write(key, key.route, "human", { kind: "apply", expectedRevision: 0, press: crypto.randomUUID(), label: key.route, patches: [{ path: ["n"], value: 1 }] }, async () => [])).toMatchObject({ ok: true });
    await new Promise(resolve => setTimeout(resolve, 3));
  }
  const timeline = hostTimeline(workspace, async () => []);
  const shown = await timeline.read([], "human", document);
  expect(shown.undo).toMatchObject({ work: schedules });
  expect(shown.rows.filter(row => "work" in row && row.work).map(row => "work" in row && row.work)).toEqual(expect.arrayContaining([fans, schedules]));
  expect(shown.rows.some(row => "work" in row && row.work?.binding === "open" && row.work.open.openId === "b")).toBe(false);
  expect(await timeline.step({ direction: "undo", works: [], document, expected: shown.undo! }, { kind: "human", via: "local" }, "human")).toMatchObject({ ok: true });
  expect((await workspace.view(schedules, "schedules"))!.doc).toEqual({ n: 0 });
});
