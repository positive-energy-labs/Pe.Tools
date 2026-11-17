// @vitest-environment jsdom
import { afterEach, expect, test } from "vite-plus/test";
import { cleanup, render, waitFor } from "@testing-library/react";
import { useSyncExternalStore } from "react";
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { workFingerprintSchema } from "@pe/agent-contracts";
import { module as chat } from "../chat/route";
import { mountTypedRoute } from "../shell/typed-mount";
import { TypedChrome } from "../shell/typed-shell";
import { StandaloneBand } from "../shell/band.test-support";
import { dockChatAddress } from "./hosted-route";

afterEach(cleanup);
test.each(["/fans?fixture=scene", "/duct-systems?fixture=navigation"])(
  "Pea beside %s reads host context rather than the tool fixture", async href => {
    let search = new URL(href, "http://pe.local").searchParams;
    const address = dockChatAddress({ read: () => search, write: next => { search = next; }, subscribe: () => () => {} });
    const mount = mountTypedRoute(chat, {
      address, fixture: address.read().get("fixture"), target: { kind: "host" },
      work: { address: null, open: null }, custody: { current: () => true }, memory: () => ({}),
    }, workFingerprintSchema.parse(`builtin-closure:${"a".repeat(64)}`), {
      sources: { "chat.context": { kind: "use", open(_ctx, deliver) {
        deliver({ kind: "failure", error: "Host context unavailable" });
        return () => {};
      } } },
    });
    function Panel() {
      useSyncExternalStore(mount.subscribe, mount.revision, mount.revision);
      return <StandaloneBand><TypedChrome mount={mount} document={null} /></StandaloneBand>;
    }
    const router = createRouter({ routeTree: createRootRoute({ component: Panel }), history: createMemoryHistory({ initialEntries: [href] }) });
    try {
      await router.load();
      render(<RouterProvider router={router} />);
      await waitFor(() => {
        expect(document.body.textContent).not.toContain("read.source.provide is not a function");
        expect(document.body.textContent).toContain("Host context unavailable");
      });
      const next = address.read();
      next.set("thread", "chosen");
      address.write(next, "replace");
      expect(search.get("fixture")).toBe(new URL(href, "http://pe.local").searchParams.get("fixture"));
      expect(search.get("thread")).toBe("chosen");
    } finally { cleanup(); mount.dispose(); }
  },
);
