// @vitest-environment jsdom
/**
 * The install scrim: shown while the host's receipt runs, gone once the host settles, and across
 * the host's absence it polls for the successor and reloads the page when a different build answers.
 */
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";

import { MACHINE_SEEDS } from "#/open/seeds";

import { InstallGate, SUCCESSOR_POLL_MS, SUCCESSOR_WAIT_MS } from "./install-scrim";

vi.mock("#/host/runtime", () => ({
  hostFetch: (url: string, init?: RequestInit) => fetch(url, init),
}));

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const settle = () => act(async () => void (await vi.advanceTimersByTimeAsync(0)));
const tick = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

test("a gone host keeps the scrim, polls, and reloads once a different build answers", async () => {
  const answers = ["down", "same", "successor"] as const;
  const probe = vi.fn(async () => answers[Math.min(probe.mock.calls.length - 1, 2)]!);
  const reload = vi.fn();
  render(
    <InstallGate
      reading={MACHINE_SEEDS.disconnected}
      fixture={false}
      probe={probe}
      reload={reload}
    />,
  );
  await settle();
  expect(screen.getByRole("dialog").textContent).toContain("Waiting for the new host");
  expect(probe).toHaveBeenCalledWith("0.7.0");
  expect(reload).not.toHaveBeenCalled();
  await tick(SUCCESSOR_POLL_MS);
  expect(reload).not.toHaveBeenCalled();
  await tick(SUCCESSOR_POLL_MS);
  expect(probe).toHaveBeenCalledTimes(3);
  expect(reload).toHaveBeenCalledOnce();
  await tick(SUCCESSOR_POLL_MS * 3);
  expect(probe).toHaveBeenCalledTimes(3);
});

test("a successor that never comes ends the wait honestly, with reload and dismiss", async () => {
  const probe = vi.fn(async () => "down" as const);
  const reload = vi.fn();
  render(
    <InstallGate
      reading={MACHINE_SEEDS.disconnected}
      fixture={false}
      probe={probe}
      reload={reload}
    />,
  );
  await settle();
  await tick(SUCCESSOR_WAIT_MS);
  expect(screen.getByRole("dialog").textContent).toContain(
    "The new host has not answered in 10 minutes",
  );
  const calls = probe.mock.calls.length;
  await tick(SUCCESSOR_POLL_MS * 5);
  expect(probe).toHaveBeenCalledTimes(calls);
  expect(reload).not.toHaveBeenCalled();
  act(() => screen.getByRole("button", { name: "dismiss" }).click());
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("probeSuccessor reads a refusal by the old service or a new version as the successor", async () => {
  const { probeSuccessor } = await import("#/host/install");
  const answer = (response: Response | Error) =>
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => (response instanceof Error ? Promise.reject(response) : response)),
    );
  answer(
    Response.json(
      { error: { code: "runtime.owner-mismatch", message: "Owner changed" } },
      { status: 403 },
    ),
  );
  expect(await probeSuccessor("0.7.0")).toBe("successor");
  answer(
    Response.json({ error: { code: "identity.host", message: "Invalid host" } }, { status: 403 }),
  );
  expect(await probeSuccessor("0.7.0")).toBe("down");
  answer(Response.json({ version: "0.7.1", features: { peApi: 1, nativeAdapter: 2 } }));
  expect(await probeSuccessor("0.7.0")).toBe("successor");
  answer(Response.json({ version: "0.7.0", features: { peApi: 1, nativeAdapter: 2 } }));
  expect(await probeSuccessor("0.7.0")).toBe("same");
  answer(new TypeError("fetch failed"));
  expect(await probeSuccessor("0.7.0")).toBe("down");
});
