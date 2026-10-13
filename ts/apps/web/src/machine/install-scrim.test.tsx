// @vitest-environment jsdom
/**
 * The install scrim: shown while the host's receipt runs, gone once the host settles, and across
 * the host's absence it polls for the successor and reloads the page when a different build answers.
 */
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";

import { Button } from "#/components/lang/button";
import { MACHINE_SEEDS } from "#/open/seeds";

import { InstallGate, SUCCESSOR_POLL_MS, SUCCESSOR_WAIT_MS } from "./install-scrim";
import { machineOf } from "./model";

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

test("the scrim names the running leg and blocks the page while the receipt runs", () => {
  render(
    <>
      <Button label="behind">behind</Button>
      <InstallGate reading={MACHINE_SEEDS["receipt-handoff"]} fixture={false} />
    </>,
  );
  const dialog = screen.getByRole("dialog");
  expect(dialog.textContent).toContain("Updating to 0.7.1");
  expect(dialog.textContent).toContain("Installing 0.7.1");
  expect(dialog.textContent).toContain("Nothing on this page can be used");
  expect(screen.queryByRole("button", { name: "dismiss" })).toBeNull();
});

test("no scrim for a settled receipt, a waiting plan, or a frozen fixture", () => {
  const settled = machineOf(MACHINE_SEEDS["receipt-handoff"])!;
  const { rerender } = render(
    <InstallGate
      reading={{
        state: "ready",
        observation: {
          ...settled,
          update: { ...settled.update, receipt: { ...settled.update.receipt!, state: "ok" } },
        },
      }}
      fixture={false}
    />,
  );
  expect(screen.queryByRole("dialog")).toBeNull();
  rerender(<InstallGate reading={MACHINE_SEEDS["waiting-plan"]} fixture={false} />);
  expect(screen.queryByRole("dialog")).toBeNull();
  rerender(<InstallGate reading={MACHINE_SEEDS["receipt-handoff"]} fixture />);
  expect(screen.queryByRole("dialog")).toBeNull();
});

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
  answer(Response.json({ refusal: { code: "runtime.owner-mismatch" } }, { status: 403 }));
  expect(await probeSuccessor("0.7.0")).toBe("successor");
  answer(Response.json({ refusal: { code: "identity.host" } }, { status: 403 }));
  expect(await probeSuccessor("0.7.0")).toBe("down");
  answer(Response.json({ version: "0.7.1" }));
  expect(await probeSuccessor("0.7.0")).toBe("successor");
  answer(Response.json({ version: "0.7.0" }));
  expect(await probeSuccessor("0.7.0")).toBe("same");
  answer(new TypeError("fetch failed"));
  expect(await probeSuccessor("0.7.0")).toBe("down");
});

test("a leg waiting on the person shows its own words", () => {
  const running = machineOf(MACHINE_SEEDS["receipt-handoff"])!;
  const receipt = running.update.receipt!;
  const detail = "Revit is waiting for you to pick Load Once on the add-in prompt";
  render(
    <InstallGate
      reading={{
        state: "ready",
        observation: {
          ...running,
          update: {
            ...running.update,
            receipt: {
              ...receipt,
              legs: [
                ...receipt.legs,
                {
                  name: "relaunch",
                  status: "waiting",
                  detail,
                  exitCode: null,
                  observedAtUtc: "2026-10-13T02:00:00Z",
                },
              ],
            },
          },
        },
      }}
      fixture={false}
    />,
  );
  expect(screen.getByRole("dialog").textContent).toContain(detail);
});
