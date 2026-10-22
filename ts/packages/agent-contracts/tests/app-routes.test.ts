import { describe, expect, it } from "vite-plus/test";
import {
  APP_ROUTES,
  appRouteByKey,
  appRouteByPath,
  appRouteMount,
  routeKey,
  routePath,
  SURFACE_SHELLS,
} from "../src/app-routes.ts";

describe("application route identities and surfaces", () => {
  it("declares each route and satellite once without losing the directory", () => {
    const paths = APP_ROUTES.flatMap((route) => [
      route.path,
      ...(route.satellites ?? []).map((satellite) => satellite.to),
    ]);
    expect(new Set(paths).size).toBe(paths.length);
    expect(new Set(APP_ROUTES.map((route) => route.key)).size).toBe(APP_ROUTES.length);
    expect(APP_ROUTES.filter((route) => route.directory)).toHaveLength(20);
    expect(appRouteByPath("/space")).toMatchObject({ key: "space", exposure: "Preview" });
    expect(
      APP_ROUTES.filter((route) => !route.directory)
        .map((route) => route.path)
        .sort(),
    ).toEqual(["/", "/bind"]);
    expect(appRouteByPath("/design-system/revit")?.path).toBe("/design-system");
    expect(
      APP_ROUTES.filter((route) => route.resume === "document")
        .map((route) => route.key)
        .sort(),
    ).toEqual(["families", "family", "rooms", "schedules", "takeoffs"]);
  });
  it("preserves persisted identities and arbitrary route lifetime keys", () => {
    for (const [key, path] of [
      ["chat", "/pea"],
      ["instances", "/open"],
      ["index", "/"],
    ]) {
      expect(routePath(key!)).toBe(path);
      expect(routeKey(path!)).toBe(key);
      expect(appRouteByKey(key!)?.path).toBe(path);
    }
    expect(appRouteByKey("pea")?.key).toBe("chat");
    expect(appRouteByKey("open")?.key).toBe("instances");
    expect(routeKey("/design-system/band")).toBe("design-system/band");
    expect(routePath("unregistered-work")).toBe("/unregistered-work");
    expect(appRouteByPath("/family/unknown")).toBeUndefined();
    expect(appRouteByKey("unknown")).toBeUndefined();
  });
  it("mounts all routes on full surfaces and only the declared compact routes on tray", () => {
    for (const route of APP_ROUTES) {
      for (const path of [
        route.path,
        ...(route.satellites ?? []).map((satellite) => satellite.to),
      ]) {
        expect(appRouteMount(path, "web")).toBe("full");
        expect(appRouteMount(path, "pwa")).toBe("full");
        expect(appRouteMount(path, "tray")).toBe(
          ["/open", "/settings", "/pea"].includes(path) ? "compact" : undefined,
        );
      }
    }
    expect(appRouteMount("/pe/navigation", "web")).toBeUndefined();
  });
  it("declares each surface's shell as data, the tray reproducing its rulings exactly", () => {
    expect(SURFACE_SHELLS.tray).toEqual({
      mount: "compact",
      routes: ["instances", "chat", "settings"],
      home: { path: "/open", label: "Home / open work" },
      icons: [
        { route: "chat", label: "Pea Inbox", iconKey: "Inbox" },
        { route: "settings", label: "Settings", iconKey: "Settings2" },
      ],
      field: "page",
      settings: "route",
      history: "window",
    });
    expect([SURFACE_SHELLS.web.field, SURFACE_SHELLS.web.settings]).toEqual(["global", "quick"]);
    expect([SURFACE_SHELLS.web.history, SURFACE_SHELLS.pwa.history]).toEqual(["browser", "window"]);
    // Every door the chrome draws mounts in place: a door that hands off leaves the app window
    // (the tray's full-window handoff falls back to a browser tab when no PWA is installed).
    for (const [surface, shell] of Object.entries(SURFACE_SHELLS)) {
      const doors = [
        shell.home.path,
        "/settings",
        ...shell.icons.map((icon) => routePath(icon.route)),
      ];
      for (const door of doors)
        expect(appRouteMount(door, surface as keyof typeof SURFACE_SHELLS)).toBe(shell.mount);
    }
  });
});
