// @vitest-environment jsdom
import { test, expect, afterEach } from "vite-plus/test";
import { fanSubjectGraph as fansGraph } from "./subject.test-support";
import { registerSubject, publishSubjectRoster } from "./subject";
import { tabTitle } from "../workbench/route-tabs";
import { tabPageSearch, restorePageSearch } from "../route/url";
afterEach(() => sessionStorage.clear());
// Places as `workbench/tabs.ts` writes them: the `ThreadTab` record.
const ONE = "00000000-0000-4000-8000-000000000001";
const TWO = "00000000-0000-4000-8000-000000000002";
const AT = "2026-11-02T00:00:00.000Z";
test("tab memory that does not decode restores nothing", () => {
  sessionStorage.setItem("pe.places", JSON.stringify([{ id: "one", link: "/fans?fan=x" }]));
  expect(tabPageSearch("/fans")).toBeUndefined();
  sessionStorage.setItem("pe.places", "{torn");
  expect(tabPageSearch("/fans")).toBeUndefined();
});
test("bare route restores the focused Place and explicit fields override memory independently", () => {
  sessionStorage.setItem(
    "pe.places",
    JSON.stringify([
      { id: ONE, route: "fans", link: "/fans?fan=uid-a%25400&fixture=layout", at: AT },
      { id: TWO, route: "fans", link: "/fans?fan=uid-b%25400", at: AT },
    ]),
  );
  sessionStorage.setItem("pe.place.focus", ONE);
  expect(restorePageSearch(tabPageSearch("/fans"), {})).toEqual({
    fan: "uid-a%400",
    fixture: "layout",
  });
  expect(restorePageSearch(tabPageSearch("/fans"), { fan: "" })).toEqual({
    fan: "",
    fixture: "layout",
  });
});
test("two Fans Place titles display their different roster labels", () => {
  registerSubject("fans", fansGraph);
  publishSubjectRoster("fans", {}, [
    { id: "uid-a@0", label: "FC-23 (00000002) / port 0" },
    { id: "uid-b@0", label: "FC-23 (00d1fa63) / port 0" },
  ]);
  const tab = {
    id: "one",
    route: "fans" as const,
    at: "2026-11-02T12:00:00Z",
    link: "/fans?fan=uid-a%25400",
  };
  expect(tabTitle(tab)).toBe("Fans \u00b7 FC-23 (00000002) / port 0");
  expect(tabTitle({ ...tab, link: "/fans?fan=uid-b%25400" })).toBe(
    "Fans \u00b7 FC-23 (00d1fa63) / port 0",
  );
});
