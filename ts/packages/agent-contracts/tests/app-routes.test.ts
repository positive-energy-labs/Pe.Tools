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
    expect(APP_ROUTES.filter((route) => route.directory)).toHaveLength(19);
    expect(
      APP_ROUTES.filter((route) => !route.directory)
        .map((route) => route.path)
        .sort(),
    ).toEqual(["/", "/bind", "/machine"]);
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
          ["/open", "/machine", "/pea"].includes(path) ? "compact" : undefined,
        );
      }
    }
    expect(appRouteMount("/pe/navigation", "web")).toBeUndefined();
  });
  it("declares each surface's shell as data, the tray reproducing its rulings exactly", () => {
    expect(SURFACE_SHELLS.tray).toEqual({
      mount: "compact",
      routes: ["instances", "chat", "machine"],
      home: { path: "/open", label: "Home / open work" },
      icons: [
        { route: "chat", label: "Pea Inbox", iconKey: "Inbox" },
        { route: "machine", label: "Machine", iconKey: "Server" },
      ],
      picker: false,
      settings: "route",
      history: "window",
    });
    expect([SURFACE_SHELLS.web.picker, SURFACE_SHELLS.web.settings]).toEqual([true, "quick"]);
    expect([SURFACE_SHELLS.web.history, SURFACE_SHELLS.pwa.history]).toEqual(["browser", "window"]);
    for (const [surface, shell] of Object.entries(SURFACE_SHELLS)) {
      const doors = [shell.home.path, ...shell.icons.map((icon) => routePath(icon.route))];
      for (const door of doors)
        expect(appRouteMount(door, surface as keyof typeof SURFACE_SHELLS)).toBe(shell.mount);
    }
  });
});
