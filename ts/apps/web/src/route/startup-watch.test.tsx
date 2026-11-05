// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vite-plus/test";
import { act } from "react";
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import { LoadingContext } from "./loading-context";
import { startupWatch } from "./startup-watch";
import { HOST_READ_WAIT_S } from "./waits";

afterEach(() => {
  window.dispatchEvent(new Event("pe:hydrated"));
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

test.each([
  [false, undefined],
  [true, undefined],
  [true, "Failed to fetch families/route.tsx"],
])(
  "startup watchdog preserves hydratable markup (timeout: %s, module error: %s)",
  async (timeout, moduleError) => {
    vi.useFakeTimers();
    const consoleError = vi.spyOn(console, "error");
    const recoverable = vi.fn();
    const page = (
      <LoadingContext name="Tools" says="Connecting to this host…">
        Guide
      </LoadingContext>
    );
    const server = renderToString(page);
    const container = document.createElement("div");
    container.innerHTML = server;
    document.body.append(container);
    // Run the exact inline watchdog before React, as on a slow cold module load.
    new Function(startupWatch)();
    if (moduleError) window.dispatchEvent(new ErrorEvent("error", { message: moduleError }));
    if (timeout) vi.advanceTimersByTime(HOST_READ_WAIT_S * 1000);
    expect(container.innerHTML).toBe(server);
    const diagnostic = container.querySelector("[data-startup-diagnostic]")?.shadowRoot;
    if (timeout) {
      expect(diagnostic?.querySelector('[role="alert"]')?.textContent).toContain(
        moduleError ?? "Page startup did not finish",
      );
      expect(diagnostic?.querySelector("a")?.textContent).toBe("Reload page");
    }
    let root: ReturnType<typeof hydrateRoot>;
    await act(async () => {
      root = hydrateRoot(container, page, { onRecoverableError: recoverable });
    });
    expect(recoverable).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
    window.dispatchEvent(new Event("pe:hydrated"));
    expect(diagnostic?.textContent ?? "").toBe("");
    vi.advanceTimersByTime(HOST_READ_WAIT_S * 1000);
    expect(container.innerHTML).toBe(server);
    await act(async () => root!.unmount());
  },
);
