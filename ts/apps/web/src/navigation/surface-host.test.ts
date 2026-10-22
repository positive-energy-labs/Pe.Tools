import { describe, expect, it } from "vite-plus/test";
import { fullWindowDestination, nativeNavigationHistory } from "./surface-host";

describe("surface host admission", () => {
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
