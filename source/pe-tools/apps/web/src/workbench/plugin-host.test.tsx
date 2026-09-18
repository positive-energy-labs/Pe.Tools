// @vitest-environment jsdom
/**
 * K3 lifetime invariants of the Chat plugin pane (crusade-authority-k3-lifetime.md): the pane is
 * page state in the Chat URL, never navigation, never a turn event; closing it mid-action is not
 * cancel, and the action's outcome is in the route's page log on reopen.
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
import { afterEach, expect, test, vi } from "vite-plus/test";
import type { ZodType } from "zod";

import { peReadings } from "#/readings";
import type { ChatPluginRoute } from "./chat-plugins";
import { useChatPluginHost } from "./route-panes";
import { createChatPageStore, type ChatSearch } from "./store";

const plan = vi.hoisted(() => ({ release: () => {}, mounts: 0, unmounts: 0 }));
vi.mock("#/route/schedules/live", () => ({ LiveScheduleGridWorkspace: () => null }));
vi.mock("#/route/family/live", () => ({ FamilyRouteView: () => null }));
vi.mock("#/routes/pods", () => ({ PodsRouteContent: () => null }));
vi.mock("#/routes/parameter-links", () => ({ ParameterLinksRouteContent: () => null }));
vi.mock("#/takeoff/pane", () => ({ TakeoffsPane: () => null }));
vi.mock("#/instances/route", () => ({ InstancesPage: () => null }));
vi.mock("#/routes/families", async () => {
  const { useContext, useEffect } = await import("react");
  const { z } = await import("zod");
  const { defineRoute, useRoute } = await import("#/route");
  const { ChatHosted } = await import("#/route/situation");
  const manifest = defineRoute({
    key: "hosted-plan",
    name: "Hosted plan",
    actions: {
      plan: {
        label: "plan",
        says: "plans the staged set",
        needs: "host",
        actor: "any",
        input: z.void() as unknown as ZodType<never>,
        dirties: [],
        ready: () => null,
        run: () => new Promise<void>((resolve) => (plan.release = resolve)),
      },
    },
  });
  return {
    FamiliesRouteContent: function Families({ thread }: { thread: string }) {
      const handle = useRoute(manifest, { thread });
      const hosted = useContext(ChatHosted);
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
