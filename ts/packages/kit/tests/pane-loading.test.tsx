// @vitest-environment jsdom
import { lazy, Suspense } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vite-plus/test";
import { PaneErrorBoundary, PaneLoading } from "@pe/kit/lang/pane";

test("a rejected module renders its error; an unanswered module cannot spin forever", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.useFakeTimers();
  try {
    const Failed = lazy(() => Promise.reject(Error("module unavailable")));
    await act(async () => {
      render(
        <PaneErrorBoundary>
          <Suspense fallback={<PaneLoading />}>
            <Failed />
          </Suspense>
        </PaneErrorBoundary>,
      );
    });
    expect(screen.getByRole("alert").textContent).toContain("module unavailable");
    cleanup();
    const Silent = lazy(() => new Promise<{ default: () => null }>(() => {}));
    render(
      <PaneErrorBoundary>
        <Suspense fallback={<PaneLoading />}>
          <Silent />
        </Suspense>
      </PaneErrorBoundary>,
    );
    await act(async () => {
      vi.advanceTimersByTime(15_000);
    });
    expect(screen.getByRole("alert").textContent).toContain("did not load after 15s");
  } finally {
    cleanup();
    vi.useRealTimers();
    log.mockRestore();
  }
});
