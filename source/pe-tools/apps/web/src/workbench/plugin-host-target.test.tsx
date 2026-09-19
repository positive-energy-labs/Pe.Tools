// @vitest-environment jsdom
/**
 * K3 targeting (spec §7b; no runtime caution, by construction): a hosted view's target is the thread
 * head's. Split from the lifetime test so its Readings subscribe fresh.
 */
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";

import { peReadings } from "#/readings";
import { CHAT_PLUGIN_ROUTES, type ChatPluginRoute } from "./chat-plugins";
import { useChatPluginHost } from "./route-panes";

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
// Parameter Links runs the real route kernel: its target must come from the thread head.
vi.mock("#/routes/parameter-links", async () => {
  const { defineRoute, useRoute } = await import("#/route");
  const manifest = defineRoute({ key: "hosted-target", name: "Hosted target", needs: "project" });
  return {
    ParameterLinksRouteContent: (props: { thread: string }) => {
      seen.props["parameter-links"] = props;
      const handle = useRoute(manifest, props);
      const ref =
        handle.resolution.kind === "resolved" && handle.resolution.target.kind === "document"
          ? handle.resolution.target.ref
          : null;
      return <p data-testid="resolved">{ref ? `${ref.session}/${ref.openId}` : "unresolved"}</p>;
    },
  };
});
vi.mock("#/routes/families", () => ({ FamiliesRouteContent: seen.stub("families") }));

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

test("every hosted view takes the Chat thread and no target; the thread head resolves it", async () => {
  const accept = new Map<string, Parameters<typeof peReadings.subscribe>[1]>();
  const requests: unknown[] = [];
  vi.spyOn(peReadings, "subscribe").mockImplementation((request, next) => {
    requests.push(request);
    accept.set(request.kind, next);
    return () => {};
  });
  const answer = (kind: string, value: unknown) =>
    act(() => accept.get(kind)?.({ kind: "snapshot", key: kind, value } as never));
  const view = render(<Pane />);
  for (const route of CHAT_PLUGIN_ROUTES) view.rerender(<Pane plugin={route} />);
  await act(async () => {});

  for (const route of CHAT_PLUGIN_ROUTES) {
    // Instances acts on sessions, not a document; its `target` is its own session selection.
    if (route === "instances") continue;
    const props = seen.props[route]!;
    expect(props, route).not.toHaveProperty("target");
    expect(props.thread, route).toBe("thread-1");
  }

  // Parameter Links is open in the pane: its document is exactly the thread head's.
  view.rerender(<Pane plugin="parameter-links" />);
  answer("inventory", {
    sessions: [
      {
        connected: true,
        sessionId: "A",
        openDocumentCount: 1,
        openDocuments: [
          {
            openId: "doc-A",
            title: "Tower",
            address: "C:/demo/tower.rvt",
            isFamilyDocument: false,
          },
        ],
      },
    ],
  });
  answer("thread-head", {
    defaultTarget: { kind: "open", ref: { session: "A", openId: "doc-A" } },
    revision: 1,
  });
  expect(requests).toContainEqual({ kind: "thread-head", thread: "thread-1" });
  expect(screen.getByTestId("resolved").textContent).toBe("A/doc-A");
});
