/**
 * /pea is not a slot route (kaitpw, 2026-11-11, routes MAP decision log): the thread is the root
 * `thread` carry key every route's docked Pea reads, so it is never a declared subject.
 */
import { expect, test } from "vite-plus/test";
import { routeAddress, routeAt } from "@pe/agent-contracts";
import { module, fields } from "./route.ts";

test("/pea declares no sheet, picture or goal", () => {
  expect([module.spec.sheet, module.spec.picture, module.spec.goal]).toEqual([
    undefined,
    undefined,
    undefined,
  ]);
});

test("chat owns its address fields and never shares the composer draft", () => {
  const address = routeAddress("chat");
  expect(routeAt("/pea")).toBe("chat");
  expect(Object.keys(fields)).toEqual(["threadSearch", "threadSort", "turn", "prompt"]);
  const { page } = address.read({ prompt: "private draft", turn: "2" });
  expect(page.prompt).toBe("private draft");
  expect(address.link(page)).not.toContain("prompt");
  expect(address.read({ threadSearch: "unfinished search" }).page.threadSearch).toEqual({
    v: 0,
    keywords: "unfinished search",
    pills: [],
  });
});
