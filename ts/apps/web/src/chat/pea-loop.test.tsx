// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, test } from "vite-plus/test";
import { RegistryContext } from "@effect/atom-react";
import * as Atom from "effect/reactivity/Atom";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { emptyChatState, selectBreakdown } from "@pe/agent-contracts/chat-state";
import { harnessEventSchema } from "@pe/agent-contracts";
import { CurrentThreadViewOwner } from "#/workbench/thread-view";
import { useCacheView } from "#/workbench/world/cap";
import { TranscriptContext } from "#/workbench/provider/thread-summary";
import { useTranscript } from "#/workbench/provider/use-workbench";

afterEach(cleanup);

test("a streamed turn keeps the production chat projection bounded", async () => {
  const registry = AtomRegistry.make();
  const source = Atom.make(emptyChatState());
  let renders = 0;
  const mounted = renderHook(
    () => {
      if (++renders > 80) throw Error("Pea projection render loop");
      return useTranscript((state) => ({
        id: state.id,
        prompts: state.events.filter((event) => event.kind === "prompt"),
      }));
    },
    {
      wrapper: ({ children }) => (
        <RegistryContext.Provider value={registry}>
          <TranscriptContext.Provider value={source}>{children}</TranscriptContext.Provider>
        </RegistryContext.Provider>
      ),
    },
  );
  await act(async () =>
    registry.set(source, { ...emptyChatState(), id: "2bd43c60", providerId: "codex" }),
  );
  expect(mounted.result.current.id).toBe("2bd43c60");
  const projected = mounted.result.current;
  mounted.rerender();
  expect(mounted.result.current).toBe(projected);
  expect(renders).toBeLessThan(10);
  mounted.unmount();
  registry.dispose();
});

test("the real chat breakdown and cache snapshot settle after a Codex usage event", async () => {
  const registry = AtomRegistry.make();
  const source = Atom.make(emptyChatState());
  let renders = 0;
  const mounted = renderHook(
    () => {
      if (++renders > 80) throw Error("Pea cache render loop");
      const chat = useTranscript((state) => ({
        breakdown: selectBreakdown(state),
        userTurns: state.events.filter((event) => event.kind === "prompt").length,
      }));
      const cache = useCacheView(chat.breakdown, chat.userTurns);
      return { chat, cache };
    },
    {
      wrapper: ({ children }) => (
        <RegistryContext.Provider value={registry}>
          <TranscriptContext.Provider value={source}>
            <CurrentThreadViewOwner registry={registry} threadKey="2bd43c60">
              {children}
            </CurrentThreadViewOwner>
          </TranscriptContext.Provider>
        </RegistryContext.Provider>
      ),
    },
  );
  const usage = harnessEventSchema.parse({
    kind: "update",
    seq: 1,
    turnId: "turn-1",
    at: "2026-11-05T00:00:00Z",
    update: { sessionUpdate: "usage_update", used: 9400, size: 200000 },
  });
  await act(async () =>
    registry.set(source, { ...emptyChatState(), providerId: "codex", events: [usage] }),
  );
  expect(mounted.result.current.chat.breakdown?.totalTokens).toBe(9400);
  const prompt = harnessEventSchema.parse({
    kind: "prompt",
    seq: 2,
    turnId: "turn-2",
    at: usage.at,
    text: "Read the Fans Work",
  });
  const nextUsage = harnessEventSchema.parse({
    ...usage,
    seq: 3,
    turnId: "turn-2",
    update: { sessionUpdate: "usage_update", used: 10000, size: 200000 },
  });
  await act(async () =>
    registry.set(source, {
      ...emptyChatState(),
      providerId: "codex",
      events: [usage, prompt, nextUsage],
    }),
  );
  expect(mounted.result.current.chat.breakdown?.totalTokens).toBe(10000);
  expect(mounted.result.current.chat.userTurns).toBe(1);
  expect(mounted.result.current.cache.hasBaseline).toBe(true);
  expect(renders).toBeLessThan(15);
  mounted.unmount();
  registry.dispose();
});
