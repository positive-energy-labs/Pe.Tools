import { expect, test } from "vite-plus/test";
import {
  ductLossManifest,
  grillesManifest,
  savedTakeoffsManifest,
  settingsManifest,
} from "./surface-manifests";
import { urlPage } from "./url";
import { manifest as takeoffsManifest } from "#/takeoff/manifest";
import { solve } from "#/duct/math";

test("calculator Page holds the inputs the formula consumes and accepts a shareable face", () => {
  const url = urlPage(ductLossManifest)!;
  const page = ductLossManifest.page!.parse(url.read({ cfm: 1200, a: 14, face: "residential" }));
  expect(page.cfm).toBe(1200);
  expect(page.face).toBe("residential");
  expect(solve(page).velocity).toBeGreaterThan(0);
  expect(url.read({ face: "missing" }).face).toBe("commercial");
});

test("grille Page owns profiles and export selection; saved review declares its real source", () => {
  const page = grillesManifest.page!.parse({});
  expect(page.rows.length).toBe(6);
  expect(page.picked).toEqual(["row7"]);
  const capture = savedTakeoffsManifest.readings!.capture;
  if (typeof capture !== "function") throw Error("saved capture must follow its Page");
  expect(capture({ work: "capture1" }, {} as never)).toEqual({
    kind: "takeoff-saved",
    id: "capture1",
  });
  expect(capture({}, {} as never)).toBeNull();
});

test("Settings and Takeoffs read only their declared shareable navigation", () => {
  expect(
    urlPage(settingsManifest)!.read({ subject: "machine", section: "providers", noise: 9 }),
  ).toEqual({ subject: "machine", section: "providers" });
  expect(urlPage(takeoffsManifest)!.read({ level: 42, work: "c1", room: "r" })).toEqual({
    level: "42",
    work: "c1",
    zone: undefined,
    room: "r",
    demo: undefined,
  });
});
