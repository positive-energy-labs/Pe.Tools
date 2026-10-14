// @vitest-environment jsdom
/** The composer ladder: provider › model › one rung per trait, read whole in its trigger. */
import { useEffect } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import type { Provider, Reading } from "@pe/agent-contracts";

const wb = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
vi.mock("#/workbench/provider", () => ({ useWorkbench: () => wb.current }));
vi.mock("#/navigation/state", () => ({ useDestination: () => vi.fn() }));

const { GrantChip, HeadLadder } = await import("./head-chips");
const { useThreadScope } = await import("./scope");

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const claude: Provider = {
  id: "claude",
  harness: "claude",
  name: "Claude",
  auth: { kind: "subscription" },
  readiness: { state: "ready" },
  models: [{ modelId: "opus", name: "Opus 5.5" }],
  traits: [
    {
      id: "effort",
      name: "Effort",
      kind: "select",
      options: [
        { id: "low", name: "Low" },
        { id: "high", name: "High" },
      ],
      current: "high",
    },
    { id: "fast", name: "Fast mode", kind: "boolean", current: false },
  ],
  probedAt: null,
};

function mount(traits: Record<string, string | boolean>) {
  const setDraft = vi.fn();
  wb.current = {
    chat: {},
    currentThreadId: null,
    threads: [],
    providers: { list: [claude] },
    draft: { providerId: "claude", modelId: "opus", traits },
    setDraft,
  };
  render(<HeadLadder />);
  return { setDraft, trigger: screen.getByRole("button", { name: "Choose model" }) };
}

test("the trigger reads the whole path as a framed control", () => {
  const { trigger } = mount({ fast: true });
  expect(trigger.textContent).toContain("Opus 5.5 · high · fast");
  expect(trigger.getAttribute("data-list-trigger")).toBe("control");
});

test("an off toggle is left out of the trigger but its rung still says it", () => {
  const { trigger } = mount({ fast: false });
  expect(trigger.textContent).toContain("Opus 5.5 · high");
  expect(trigger.textContent).not.toContain("fast");
  fireEvent.click(trigger);
  expect(screen.getByRole("button", { name: "not fast" })).toBeTruthy();
});

test("it always opens on the model rung, even when every rung is bound", () => {
  const { trigger } = mount({ fast: true });
  fireEvent.click(trigger);
  expect(screen.getByRole("option", { name: "Opus 5.5" })).toBeTruthy();
  expect(screen.queryByRole("option", { name: "not fast" })).toBeNull();
});

test("picking a model writes the draft and advances to effort", () => {
  const { setDraft, trigger } = mount({ fast: true });
  fireEvent.click(trigger);
  fireEvent.click(screen.getByRole("option", { name: "Opus 5.5" }));
  expect(setDraft).toHaveBeenLastCalledWith({
    providerId: "claude",
    modelId: "opus",
    traits: { fast: true },
  });
  expect(screen.getByRole("option", { name: "Low" })).toBeTruthy();
});

test("picking effort writes the draft and closes the picker", () => {
  const { setDraft, trigger } = mount({ fast: true });
  fireEvent.click(trigger);
  fireEvent.click(screen.getByRole("button", { name: "high" }));
  fireEvent.click(screen.getByRole("option", { name: "Low" }));
  expect(setDraft).toHaveBeenLastCalledWith({
    providerId: "claude",
    modelId: "opus",
    traits: { fast: true, effort: "low" },
  });
  expect(screen.queryByRole("listbox")).toBeNull();
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
