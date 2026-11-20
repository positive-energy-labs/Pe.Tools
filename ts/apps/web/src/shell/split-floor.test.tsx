// @vitest-environment jsdom
import { useSyncExternalStore } from "react";
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, expect, test } from "vite-plus/test";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { KeyScopeHost } from "@pe/kit/keys";
import { workFingerprintSchema } from "@pe/agent-contracts";
import { SPLIT_FLOOR } from "../../../../packages/kit/src/components/lang/pane-resize";
import { module as ductLoss } from "../duct-loss/route";
import { TypedChrome } from "./typed-shell";
import { mountTypedRoute } from "./typed-mount";
import { createWorkFeedClient } from "./work-feed-client";

afterEach(cleanup);

/** The shell declares no floor of its own: a route split that names none holds the kit's, on both
 *  sides. Duct Loss declares neither split's floor; the shell once restated 80px for every axis,
 *  which let the wheel be crushed to a sliver beside 320px of inputs. */
test("a route split with no declared floor mounts at the kit floor, not a shell number", async () => {
  const mount = mountTypedRoute(
    ductLoss,
    {
      address: { read: () => new URLSearchParams(), write() {}, subscribe: () => () => {} },
      fixture: null,
      target: { kind: "host" },
      work: { address: null, open: null },
      custody: { current: () => true },
      memory: () => ({}),
    },
    workFingerprintSchema.parse(`builtin-closure:${"a".repeat(64)}`),
    {
      work: createWorkFeedClient(
        { subscribe: () => () => {}, dirty() {} },
        {
          write: async () => {
            throw Error("Calculator must not write Work");
          },
          submit: async () => {
            throw Error("Calculator must not run native commands");
          },
        },
      ),
      sources: { "duct-loss.result": { kind: "use", open: () => () => {} } },
    },
  );
  function Journey() {
    useSyncExternalStore(mount.subscribe, mount.revision, mount.revision);
    return (
      <KeyScopeHost id="split-floor">
        <TypedChrome mount={mount} document={<span>Duct Loss</span>} />
      </KeyScopeHost>
    );
  }
  const router = createRouter({
    routeTree: createRootRoute({ component: Journey }),
    history: createMemoryHistory({ initialEntries: ["/duct-loss"] }),
  });
  const view = render(<RouterProvider router={router} />);
  try {
    const floors = (id: string) => {
      const node = [...view.container.querySelectorAll<HTMLElement>("[data-layout-split]")].find(
        (node) => JSON.parse(node.dataset.layoutSplit!)[0] === id,
      );
      return node
        ? [Number(node.dataset.paneMinSize), Number(node.dataset.paneMinOtherSize)]
        : null;
    };
    await waitFor(() => expect(floors("top")).not.toBeNull());
    expect(floors("top")).toEqual([SPLIT_FLOOR.horizontal, SPLIT_FLOOR.horizontal]);
    expect(floors("calc")).toEqual([SPLIT_FLOOR.vertical, SPLIT_FLOOR.vertical]);
  } finally {
    view.unmount();
    mount.dispose();
  }
}, 30_000);
