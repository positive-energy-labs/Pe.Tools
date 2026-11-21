import { seedPlaces } from "../workbench/places.test-support";
// @vitest-environment jsdom
import { test, expect, afterEach } from "vite-plus/test";
import { restorableTabSearch, restorePageSearch } from "../route/url";
afterEach(() => sessionStorage.clear());
// Places as `workbench/tabs.ts` writes them: the `ThreadTab` record.
const ONE = "00000000-0000-4000-8000-000000000001";
const TWO = "00000000-0000-4000-8000-000000000002";
const AT = "2026-11-02T00:00:00.000Z";
test("an empty host list restores nothing", async () => {
  await seedPlaces([]);
  expect(restorableTabSearch("/pumps", new URLSearchParams())).toBeUndefined();
});
test("bare route restores the focused Place and explicit fields override memory independently", async () => {
  await seedPlaces([
    { id: ONE, route: "pumps", link: "/pumps?fan=uid-a%25400&fixture=layout", at: AT },
    { id: TWO, route: "pumps", link: "/pumps?fan=uid-b%25400", at: AT },
  ]);
  sessionStorage.setItem("pe.place.focus", ONE);
  const memory = restorableTabSearch("/pumps", new URLSearchParams());
  expect(restorePageSearch(memory, {})).toEqual({
    fan: "uid-a%400",
    fixture: "layout",
  });
  expect(restorePageSearch(memory, { fan: "" })).toEqual({
    fan: "",
    fixture: "layout",
  });
});
