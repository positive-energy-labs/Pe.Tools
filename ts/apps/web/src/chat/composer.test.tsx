// @vitest-environment jsdom
/** The chat composer opens while you write and, in the tray, rests again once a send goes. */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { emptyChatState } from "@pe/agent-contracts/chat-state";
import type { ChatHandle } from "./composer-head";

const mount = vi.hoisted(() => ({ current: "compact" }));
vi.mock("#/workbench/provider", () => ({
  useWorkbench: () => ({
    chat: emptyChatState(),
    providers: {},
    config: {},
    currentThreadId: "t1",
    threads: [],
    draft: {},
  }),
}));
vi.mock("#/navigation/surface-host", () => ({
  useSurfaceHost: () => ({ shell: { mount: mount.current } }),
}));
vi.mock("#/route/situation-verbs", () => ({
  SituationAction: ({ name, action }: { name: string; action: { run: () => unknown } }) => (
    <button type="button" onClick={() => void action.run()}>
      {name}
    </button>
  ),
}));

const { ThreadComposer } = await import("./composer");

afterEach(cleanup);

function compose() {
  const run = vi.fn(async () => undefined);
  const absent = { state: "absent" };
  const handle = {
    actions: { send: { run, refusal: null }, stop: {}, fork: {} },
    readings: { machine: absent, capabilities: absent },
  } as unknown as ChatHandle;
  render(<ThreadComposer handle={handle} pickers={() => null} />);
  const area = screen.getByRole("textbox", { name: "Message" }) as HTMLTextAreaElement;
  const box = area.closest<HTMLElement>("[data-compose]")!;
  return { run, area, box };
}

async function sendDraft(area: HTMLTextAreaElement) {
  fireEvent.change(area, { target: { value: "read the schedule" } });
  await act(async () => {
    fireEvent.keyDown(area, { key: "Enter" });
  });
  await act(() => new Promise((done) => setTimeout(done)));
}

test("a tray send rests the composer at one line and gives focus back to the page", async () => {
  mount.current = "compact";
  const { run, area, box } = compose();
  expect(box.hasAttribute("data-open")).toBe(true);
  await sendDraft(area);
  expect(run).toHaveBeenCalledOnce();
  expect(document.activeElement).not.toBe(area);
  expect(box.hasAttribute("data-open")).toBe(false);
});

test("outside the tray a send keeps the draft open for the next line", async () => {
  mount.current = "page";
  const { run, area, box } = compose();
  await sendDraft(area);
  expect(run).toHaveBeenCalledOnce();
  expect(document.activeElement).toBe(area);
  expect(box.hasAttribute("data-open")).toBe(true);
});
