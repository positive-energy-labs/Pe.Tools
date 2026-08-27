// @vitest-environment jsdom
import { RegistryContext } from "@effect/atom-react";
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createWorkbenchState } from "@pe/agent-contracts";
import { afterEach, expect, test, vi } from "vite-plus/test";

const workbench = vi.hoisted(() => ({ value: undefined as unknown }));

vi.mock("#/workbench/provider", () => ({ useWorkbench: () => workbench.value }));
vi.mock("#/components/control-chips", () => ({ ControlChips: () => null }));

import { Composer } from "./composer";
import { createChatPageStore } from "#/workbench/store";

afterEach(cleanup);

test("/fork dispatches the native provider verb", () => {
  const registry = AtomRegistry.make();
  const store = createChatPageStore({
    registry,
    search: { mode: "threads", prompt: "/fork", patch: async () => undefined },
  });
  const forkThread = vi.fn(async () => undefined);
  workbench.value = {
    store,
    debug: { state: createWorkbenchState() },
    sendPrompt: vi.fn(async () => undefined),
    cancel: vi.fn(),
    newThread: vi.fn(),
    forkThread,
    isRunning: false,
  };

  render(
    <RegistryContext.Provider value={registry}>
      <Composer setMode={vi.fn()} />
    </RegistryContext.Provider>,
  );
  fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });

  expect(forkThread).toHaveBeenCalledOnce();
  store.dispose();
});
