// @vitest-environment jsdom
import { RegistryContext } from "@effect/atom-react";
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { CHAT_SEEDS } from "#/chat/seeds";
import { selectMessages, selectToolCalls } from "./chat-state";
import { createChatPageStore } from "./store";

const workbench = vi.hoisted(() => ({ value: undefined as unknown }));
vi.mock("#/workbench/provider", () => ({ useWorkbench: () => workbench.value }));

import { Moments } from "./moments";

afterEach(cleanup);

const state = CHAT_SEEDS.diagram.work;

test("a rejected tool call is a failed call, with its validation message as the error", () => {
  const failed = selectToolCalls(state).find((call) => call.id === "diagram-bad");
  expect(failed?.status).toBe("failed");
  expect(failed?.status === "failed" && failed.error).toContain('edges.3.to: no node "VAV-9"');
});

test("the seed's succeeded diagram call draws under its marker; the failed one draws nothing", async () => {
  const registry = AtomRegistry.make();
  const store = createChatPageStore({
    registry,
    search: { mode: "threads", patch: async () => undefined },
  });
  workbench.value = { store, resolveApproval: vi.fn() };
  const { container } = render(
    <RegistryContext.Provider value={registry}>
      <Moments messages={selectMessages(state)} register={() => {}} />
    </RegistryContext.Provider>,
  );
  const ok = container.querySelector<HTMLElement>("[data-tool-id='diagram-ok']")!;
  const bad = container.querySelector<HTMLElement>("[data-tool-id='diagram-bad']")!;
  await waitFor(() => expect(ok.querySelector("[data-diagram] svg")).toBeTruthy());
  expect(ok.querySelector("[role='group']")?.getAttribute("aria-label")).toBe("AHU-1 supply air");
  expect(ok.textContent).toContain("AHU-1 supply air");
  expect(bad.querySelector("[data-code-pane], [data-diagram]")).toBe(null);
  expect(bad.textContent).toContain("err");
});
