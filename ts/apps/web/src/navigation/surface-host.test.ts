import { describe, expect, it } from "vite-plus/test";
import {
  captionColor,
  fullWindowDestination,
  nativeTitlebarArea,
  nativeNavigationHistory,
  usableOverlay,
  surfaceDestination,
} from "./surface-host";

describe("surface host admission", () => {
  it("keeps exactly the three declared tray routes local and hands all other registered tools to a full window", () => {
    const origin = "https://tools.example";
    for (const path of ["/open", "/machine", "/pea"])
      expect(surfaceDestination("tray", `${path}?shell=tray#detail`, origin)).toBe("local");
    for (const path of ["/families", "/settings", "/"]) {
      expect(surfaceDestination("tray", path, origin)).toBe("window");
      expect(surfaceDestination("web", path, origin)).toBe("local");
      expect(surfaceDestination("pwa", path, origin)).toBe("local");
    }
    expect(surfaceDestination("tray", "/api/private", origin)).toBeNull();
    expect(surfaceDestination("tray", "https://elsewhere.example/families", origin)).toBeNull();
  });
  it("accepts explicit native history booleans and refuses partial or coerced capabilities", () => {
    expect(
      nativeNavigationHistory({ type: "navigation-history", canGoBack: true, canGoForward: false }),
    ).toEqual({ canGoBack: true, canGoForward: false });
    for (const message of [
      null,
      [],
      { type: "other", canGoBack: true, canGoForward: true },
      { type: "navigation-history", canGoBack: 1, canGoForward: false },
      { type: "navigation-history", canGoBack: false },
      { type: "navigation-history", canGoBack: false, canGoForward: "false" },
    ])
      expect(nativeNavigationHistory(message)).toBeNull();
  });
  it("admits only visible measured native geometry inside the actual viewport", () => {
    const viewport = { width: 747, height: 525 };
    const rect = { x: 0, y: 0, width: 595, height: 29 };
    const message = { type: "titlebar-geometry", visible: true, rect };
    expect(nativeTitlebarArea(message, viewport)).toEqual(rect);
    expect(nativeTitlebarArea({ ...message, visible: false }, viewport)).toBeNull();
    expect(nativeTitlebarArea({ ...message, rect: { ...rect, width: 800 } }, viewport)).toBeNull();
    expect(
      nativeTitlebarArea({ ...message, rect: { ...rect, width: "595" } }, viewport),
    ).toBeNull();
    expect(nativeTitlebarArea({ ...message, rect: { ...rect, x: -1 } }, viewport)).toBeNull();
    expect(nativeTitlebarArea({ ...message, rect: { ...rect, height: 0 } }, viewport)).toBeNull();
    expect(
      nativeTitlebarArea({ ...message, rect: { ...rect, width: Number.NaN } }, viewport),
    ).toBeNull();
    expect(nativeTitlebarArea({ ...message, type: "other" }, viewport)).toBeNull();
  });
  it("projects opaque CSS colors into Windows byte order without accepting invalid values", () => {
    const channels = [18, 52, 86].join(", ");
    expect(captionColor(`rgb(${channels})`)).toBe(0x563412);
    expect(captionColor(`rgb(${256}, 0, 0)`)).toBeNull();
    expect(captionColor(`rgba(${channels}, 0.5)`)).toBeNull();
    expect(captionColor("transparent")).toBeNull();
  });
  it("requires actual usable geometry before moving controls into a caption overlay", () => {
    expect(usableOverlay(true, { x: 0, y: 0, width: 0, height: 40 })).toBe(false);
    expect(usableOverlay(false, { x: 0, y: 0, width: 500, height: 40 })).toBe(false);
    expect(usableOverlay(true, { x: 0, y: 0, width: 500, height: 40 })).toBe(true);
    expect(usableOverlay(true, { x: 0, y: 0, width: Number.NaN, height: 40 })).toBe(false);
  });
  it("hands off the same explicit resource while dropping only tray presentation", () => {
    const target = JSON.stringify({ kind: "open", ref: { session: "a", openId: "b" } });
    const source = new URL("/families", "https://tools.example");
    source.searchParams.set("target", target);
    source.searchParams.set("thread", "chosen");
    source.searchParams.set("shell", "tray");
    source.hash = "parameter";
    const handed = new URL(fullWindowDestination(source.href, source.origin)!);
    expect(handed.pathname).toBe("/families");
    expect(handed.searchParams.get("target")).toBe(target);
    expect(handed.searchParams.get("thread")).toBe("chosen");
    expect(handed.searchParams.has("shell")).toBe(false);
    expect(handed.hash).toBe("#parameter");
    expect(fullWindowDestination("https://elsewhere.example/pea", source.origin)).toBeNull();
    expect(fullWindowDestination("/api/private", source.origin)).toBeNull();
  });
});
