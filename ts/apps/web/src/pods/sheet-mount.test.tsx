// @vitest-environment jsdom
import { useSyncExternalStore } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test } from "vite-plus/test";
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { KeyScopeHost } from "@pe/kit/keys";
import { podMemberCode, settingsRouteState, workFingerprintSchema } from "@pe/agent-contracts";
import { module as pods } from "./route";
import { TypedChrome } from "../shell/typed-shell";
import { mountTypedRoute } from "../shell/typed-mount";
import { createFixtureWorkDoor } from "../shell/fixture-work-door";
import type { UseSource } from "../shell/source-contract";

afterEach(cleanup);

const ref = { pod: "share-ducts", path: "settings/checks.json" };
const saved = '{"maxSystems":25,"names":["Elbow","Tee"],"limits":{"depth":3}}';
const basis = { member: ref, rawContent: saved, sha256: "f".repeat(64) };
/** `fields` is the member's staged Work: a top-level key the sheet shows, and keys it has no cell for. */
const author = (fields: Record<string, unknown>) => ({
  scope: { ...ref, runs: "member" as const },
  member: { member: ref, content: saved, sha256: basis.sha256 },
  work: { basis, fields },
  draft: saved, composition: null, schemaRef: null, runs: [], unresolved: [], assumed: [], next: null, inputs: [],
  result: { kind: "complete" as const, value: "settings/checks.json is ready to run" },
});
const publication = (key: string, data: unknown) => ({
  key, generation: 0, version: 1, state: "current", value: {
    data, evaluation: key, inputs: key, coverage: { requested: [], covered: [], unknown: [], refused: [] },
    origin: {}, trace: [], freshness: "current",
  },
});
const source = (key: string, data: unknown): UseSource => ({
  kind: "use",
  open(_ctx, deliver) { deliver({ kind: "complete", revision: 1, value: publication(key, data) }); return () => {}; },
});

/** /pods at a picked member, mounted as the shell mounts it: the kernel draws its sheet pane. */
function mountPods(fields: Record<string, unknown> = {}) {
  const mount = mountTypedRoute(pods, {
    address: { read: () => new URLSearchParams(), write() {}, subscribe: () => () => {} },
    fixture: null, target: { kind: "host" }, work: { address: null, open: null }, custody: { current: () => true },
    memory: () => ({ member: { kind: "ids", ids: [podMemberCode(ref)] } }),
  }, workFingerprintSchema.parse(`builtin-closure:${"a".repeat(64)}`), {
    work: createFixtureWorkDoor(settingsRouteState, { basis, fields }),
    sources: {
      "pods.author": source("pods.author", author(fields)),
      "pods.roster": source("pods.roster", { pods: [] }),
    },
  });
  function Journey() {
    useSyncExternalStore(mount.subscribe, mount.revision, mount.revision);
    return <KeyScopeHost id="pods-sheet"><TypedChrome mount={mount} document={<span>Pods</span>} /></KeyScopeHost>;
  }
  const router = createRouter({ routeTree: createRootRoute({ component: Journey }), history: createMemoryHistory({ initialEntries: ["/pods"] }) });
  const view = render(<RouterProvider router={router} />);
  return { mount, close() { view.unmount(); mount.dispose(); } };
}

/* purge-2 integrity 2: the sheet pane the kernel adds had no read, so the mount gave it "No read declared". */
test("the /pods sheet pane draws the picked member's cells from the core read", async () => {
  const pods = mountPods();
  try {
    await waitFor(() => expect(pods.mount.value()).toMatchObject({ current: true }));
    expect(await screen.findByText("maxSystems")).toBeTruthy();
    expect(screen.getByText("names")).toBeTruthy();
    expect(screen.queryByText("Pick a member on the left to edit its Work")).toBeNull();
  } finally { pods.close(); }
}, 30_000);
