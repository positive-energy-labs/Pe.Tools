import { browserActionSays } from "@pe/agent-contracts";
// @vitest-environment jsdom
/**
 * K3 lifetime invariants of the Chat plugin pane (crusade-authority-k3-lifetime.md): the pane is
 * page state in the Chat URL, never navigation, never a turn event; closing it mid-action is not
 * cancel, and the action's outcome is in the route's page log on reopen.
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import type { ZodType } from "zod";

import { peReadings } from "#/readings";
import type { ChatPluginRoute } from "./chat-plugins";
import { useChatPluginHost } from "./route-panes";
import { createChatPageStore, type ChatSearch } from "./store";

const plan = vi.hoisted(() => ({ release: () => {}, mounts: 0, unmounts: 0, runs: 0 }));
// Each stub records the props the host handed its route view.
const seen = vi.hoisted(() => {
  const props: Record<string, Record<string, unknown>> = {};
  return {
    props,
    stub: (name: string) => (p: Record<string, unknown>) => {
      props[name] = p;
      return null;
    },
  };
});
vi.mock("#/route/schedules/live", () => ({ LiveScheduleGridWorkspace: seen.stub("schedules") }));
vi.mock("#/route/family/live", () => ({ FamilyRouteView: seen.stub("family") }));
vi.mock("#/routes/pods", () => ({ PodsRouteContent: seen.stub("pods") }));
vi.mock("#/takeoff/pane", () => ({ TakeoffsPane: seen.stub("takeoffs") }));
vi.mock("#/instances/route", () => ({ InstancesPage: seen.stub("instances") }));
vi.mock("#/routes/parameter-links", () => ({
  ParameterLinksRouteContent: seen.stub("parameter-links"),
}));
vi.mock("#/routes/families", async () => {
  const { useContext, useEffect } = await import("react");
  const { z } = await import("zod");
  const { defineRoute, useRoute } = await import("#/route");
  const { ChatHosted, useChatPlanIntent } = await import("#/route/situation");
  const manifest = defineRoute({
    key: "families",
    name: "Hosted plan",
    actions: {
      plan: {
        label: "plan",
        says: browserActionSays.memberOpen,
        needs: "host",
        actor: "any",
        input: z.void() as unknown as ZodType<never>,
        dirties: [],
        ready: () => null,
        run: () => {
          plan.runs += 1;
          return new Promise<void>((resolve) => (plan.release = resolve));
        },
      },
    },
  });
  return {
    FamiliesRouteContent: function Families({ thread }: { thread: string }) {
      seen.props.families = { thread };
      const handle = useRoute(manifest, { thread });
      const hosted = useContext(ChatHosted);
      useChatPlanIntent(handle, handle.actions.plan);
      useEffect(() => {
        plan.mounts += 1;
        return () => void (plan.unmounts += 1);
      }, []);
      return (
        <div data-hosted={hosted}>
          <button type="button" onClick={() => void handle.actions.plan.run()}>
            plan
          </button>
          {handle.log.map((line, index) => (
            <p key={index}>{`${line.label} · ${line.says}`}</p>
          ))}
        </div>
      );
    },
  };
});

afterEach(cleanup);

function Pane({ plugin }: { plugin?: ChatPluginRoute }) {
  const host = useChatPluginHost(plugin, "thread-1");
  return (
    <>
      {plugin ? <div data-testid="pane" ref={host.slot} /> : null}
      {host.kept}
    </>
  );
}

test("open → plan → close → reopen: one mount, the outcome in the page log, only Chat-URL patches", async () => {
  vi.spyOn(peReadings, "subscribe").mockImplementation(() => () => {});
  // The Chat URL: `setPlugin` is the one entry, and all it may do is patch plugin and focus.
  const patches: Partial<ChatSearch>[] = [];
  let url: Partial<ChatSearch> = { mode: "threads", thread: "thread-1" };
  const view = render(<Pane />);
  const store = createChatPageStore({
    registry: AtomRegistry.make(),
    search: {
      mode: "threads",
      patch: async (partial) => {
        patches.push(partial);
        url = { ...url, ...partial };
        view.rerender(<Pane plugin={url.plugin} />);
      },
    },
  });

  await act(async () => store.actions.setPlugin("families", ["Neck Width"]));
  expect(url.focus).toBe('["Neck Width"]');
  // Plan (and `open ›`) opens the pane unscoped: the group focus is cleared.
  await act(async () => store.actions.setPlugin("families"));
  expect(url.focus).toBeUndefined();
  const pane = await screen.findByTestId("pane");
  expect(pane.querySelector("[data-hosted=true]")).not.toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "plan" }));
  await act(async () => store.actions.setPlugin(undefined));
  expect(screen.queryByTestId("pane")).toBeNull();
  // The action finishes while the pane is closed: closing was not cancel.
  await act(async () => plan.release());
  await act(async () => store.actions.setPlugin("families"));
  expect((await screen.findByTestId("pane")).textContent).toContain("plan · ran");
  expect([plan.mounts, plan.unmounts]).toEqual([1, 0]);

  // Every pane event was a Chat-URL patch of plugin and focus: no route change, no thread
  // change, no composer draft. The store holds no session, so no event here can send a message
  // (the new-turn trigger), cancel, or answer a parked ask; `askExpiryTriggers` stays untouched.
  for (const patch of patches) expect(Object.keys(patch).sort()).toEqual(["focus", "plugin"]);
  expect(url.thread).toBe("thread-1");
});

test("the head's plan opens the pane unscoped and the hosted route runs its own plan once", async () => {
  vi.spyOn(peReadings, "subscribe").mockImplementation(() => () => {});
  const registry = AtomRegistry.make();
  const patches: Partial<ChatSearch>[] = [];
  let url: Partial<ChatSearch> = { mode: "threads", focus: '["Neck Width"]' };
  function Intent({ store }: { store: ReturnType<typeof createChatPageStore> }) {
    const pending = useAtomValue(store.atoms.planIntent);
    const host = useChatPluginHost(
      url.plugin,
      "thread-1",
      pending
        ? {
            route: pending.route,
            take: () => store.actions.takePlan(pending.route),
            refused: () => {},
          }
        : null,
    );
    return (
      <>
        {url.plugin ? <div data-testid="pane" ref={host.slot} /> : null}
        {host.kept}
      </>
    );
  }
  const store = createChatPageStore({
    registry,
    search: {
      mode: "threads",
      patch: async (partial) => {
        patches.push(partial);
        url = { ...url, ...partial };
        view.rerender(
          <RegistryContext.Provider value={registry}>
            <Intent store={store} />
          </RegistryContext.Provider>,
        );
      },
    },
  });
  const view = render(
    <RegistryContext.Provider value={registry}>
      <Intent store={store} />
    </RegistryContext.Provider>,
  );
  const runs = plan.runs;
  await act(async () => store.actions.planIn("families"));
  expect(url).toMatchObject({ plugin: "families", focus: undefined });
  await vi.waitFor(() => expect(plan.runs).toBe(runs + 1));
  // Taken once: a re-render or remount never runs it again, and nothing but plugin/focus moved.
  await act(async () => store.actions.setPlugin("families"));
  expect(plan.runs).toBe(runs + 1);
  expect(registry.get(store.atoms.planIntent)).toBeNull();
  for (const patch of patches) expect(Object.keys(patch).sort()).toEqual(["focus", "plugin"]);
  await act(async () => plan.release());
});
