// @vitest-environment jsdom
import { RegistryContext } from "@effect/atom-react";
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { emptyChatState } from "#/workbench/chat-state";
import { afterEach, expect, test, vi } from "vite-plus/test";

const workbench = vi.hoisted(() => ({ value: undefined as unknown }));

vi.mock("#/workbench/provider", () => ({ useWorkbench: () => workbench.value }));
vi.mock("#/chat/control-chips", () => ({ ControlChips: () => null }));
vi.mock("#/components/master-table/cells", () => ({ StateDot: () => null }));

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
    chat: emptyChatState(),
    sendPrompt: vi.fn(async () => undefined),
    cancel: vi.fn(),
    newThread: vi.fn(),
    forkThread,
    isRunning: false,
  };

  render(
    <RegistryContext.Provider value={registry}>
      <Composer
        setMode={vi.fn()}
        handle={
          {
            actions: {
              send: { label: "send", says: "", refusal: null, count: null, run: vi.fn() },
            },
          } as never
        }
      />
    </RegistryContext.Provider>,
  );
  fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });

  expect(forkThread).toHaveBeenCalledOnce();
  store.dispose();
});
