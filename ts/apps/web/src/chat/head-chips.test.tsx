// @vitest-environment jsdom
/** The composer ladder: provider › model › one rung per trait, read whole in its trigger. */
import type { Reading } from "@pe/agent-contracts";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, expect, test, vi } from "vite-plus/test";

const wb = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
vi.mock("#/workbench/provider", () => ({ useWorkbench: () => wb.current }));
vi.mock("#/navigation/state", () => ({ useDestination: () => vi.fn() }));

const { GrantChip } = await import("./head-chips");
const { useThreadScope } = await import("./scope");

vi.mock("#/machine/use-machine", () => ({ useMachine: () => ({ reading: { state: "absent" } }) }));
vi.mock("#/route/shell", () => ({ useChooseTarget: () => [null, vi.fn()] }));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/* ── The grant chip counts on the host's clock ───────────────────────────────────────────── */

const HOST_NOW = "2026-10-12T12:00:00.000Z";
const lifetime = { session: "S1", openId: "A" };
const headReading = (
  grant: object | null,
  hostNow = HOST_NOW,
  grantView: object | null = null,
): Reading<unknown> => ({
  state: "ready",
  observation: {
    defaultTarget: { kind: "open", ref: lifetime },
    revision: 3,
    grant,
    lastHumanMessageAt: null,
    hostNow,
    grantView,
  },
});
const grantExpiring = (inMinutes: number, extra: object = {}) => ({
  lifetime,
  grantedAt: HOST_NOW,
  grantedVia: "local",
  expiresAt: new Date(Date.parse(HOST_NOW) + inMinutes * 60_000).toISOString(),
  revoked: null,
  ...extra,
});

function Probe({ reading }: { reading: Reading<unknown> }) {
  return <GrantChip grant={useThreadScope("t1", true, reading).grantView} />;
}
const chip = () => screen.queryByTestId("grant-chip")?.textContent ?? null;
const minutes = (n: number) => act(() => void vi.advanceTimersByTime(n * 60_000));

test("the chip keeps the host projection until the host republishes expiry", () => {
  vi.useFakeTimers({ now: Date.parse(HOST_NOW) + 3 * 86_400_000 });
  const view = render(
    <Probe reading={headReading(grantExpiring(42), HOST_NOW, { state: "rw", minutes: 42 })} />,
  );
  expect(chip()).toBe("rw · 42m");
  minutes(90);
  expect(chip()).toBe("rw · 42m");
  view.rerender(<Probe reading={headReading(grantExpiring(42), HOST_NOW, { state: "expired" })} />);
  expect(chip()).toBe("read · renews on your next message");
  view.rerender(<Probe reading={headReading(grantExpiring(42), HOST_NOW, { state: "revoked" })} />);
  expect(chip()).toBe("revoked · point the thread at it again to grant");
  expect(screen.queryByRole("button")).toBeNull();
});

test("no projection, no chip; raw grant bytes never authorize the display", () => {
  render(<Probe reading={headReading(grantExpiring(42))} />);
  expect(chip()).toBeNull();
});

test("access-062: a stale reading cannot keep painting rw from its previous value", () => {
  const ready = headReading(grantExpiring(42), HOST_NOW, { state: "rw", minutes: 42 });
  if (ready.state !== "ready") throw Error("fixture is not ready");
  render(
    <Probe reading={{ state: "stale", previous: ready.observation, reason: "disconnected" }} />,
  );
  expect(chip()).toBeNull();
});

test("a click on rw opens the grant's facts; only the labeled verb revokes", async () => {
  let revoked = 0;
  render(
    <GrantChip
      grant={{ state: "rw", minutes: 42 }}
      document="Hospital-MEP.rvt"
      onRevoke={() => revoked++}
    />,
  );
  const chip = screen.getByRole("button", {
    name: "Pea can edit Hospital-MEP.rvt for 42 more minutes",
  });
  fireEvent.click(chip);
  const verb = await screen.findByRole("button", { name: "Stop editing access" });
  expect(revoked).toBe(0);
  fireEvent.click(verb);
  expect(revoked).toBe(1);
  await waitFor(() =>
    expect(screen.queryByRole("button", { name: "Stop editing access" })).toBeNull(),
  );
});

test("a refused head write shows the door, the reason and the remedy, not an unknown outcome", async () => {
  const refusal = {
    code: "context.foreign-thread",
    door: "/pe/scope/t2",
    reason:
      "Refused at /pe/scope/t2: this context belongs to thread t1; it cannot write thread t2's head.",
    remedy: "Write /pe/scope/self.",
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json(
        { error: { code: refusal.code, message: refusal.reason, details: { refusal } } },
        { status: 403 },
      ),
    ),
  );
  function Setter() {
    const scope = useThreadScope("t2", true, headReading(null));
    useEffect(() => void scope.set(null), []);
    return <output>{scope.refusal}</output>;
  }
  render(<Setter />);
  expect(await screen.findByText(`${refusal.reason} ${refusal.remedy}`)).toBeTruthy();
  vi.unstubAllGlobals();
});
