/**
 * /pea is not a slot route (kaitpw, 2026-11-11, routes MAP decision log): the thread is the root
 * `thread` carry key every route's docked Pea reads, so it is never a declared subject.
 */
import { expect, test } from "vite-plus/test";
import { module } from "./route.ts";

test("/pea declares no sheet, picture or goal", () => {
  expect([module.spec.sheet, module.spec.picture, module.spec.goal]).toEqual([undefined, undefined, undefined]);
});
