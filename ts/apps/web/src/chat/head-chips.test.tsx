// @vitest-environment jsdom
/** The composer ladder: provider › model › one rung per trait, read whole in its trigger. */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import type { Provider } from "@pe/agent-contracts";

const wb = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
vi.mock("#/workbench/provider", () => ({ useWorkbench: () => wb.current }));

const { HeadLadder } = await import("./head-chips");

afterEach(cleanup);

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
