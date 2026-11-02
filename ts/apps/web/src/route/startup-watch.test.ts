// @vitest-environment jsdom
import { expect, test, vi } from "vite-plus/test";
import { startupWatch } from "./startup-watch";

test("a module failure before hydration replaces startup guidance with a reason and reload", () => {
  vi.useFakeTimers();
  document.body.innerHTML =
    '<section data-startup data-working><p role="status">Loading fixture…</p></section>';
  try {
    Function(startupWatch)();
    window.dispatchEvent(
      new ErrorEvent("error", { message: "Failed to fetch families/route.tsx" }),
    );
    vi.advanceTimersByTime(15_000);
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("families/route.tsx");
    expect(document.querySelector("[data-working]")).toBeNull();
    expect(document.querySelector("a")?.textContent).toBe("Reload page");
  } finally {
    window.dispatchEvent(new Event("pe:hydrated"));
    document.body.innerHTML = "";
    vi.useRealTimers();
  }
});
