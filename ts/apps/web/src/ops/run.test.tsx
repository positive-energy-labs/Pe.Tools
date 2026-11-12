// @vitest-environment jsdom
import { useSyncExternalStore } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { KeyScopeHost } from "@pe/kit/keys";
import { workFingerprintSchema } from "@pe/agent-contracts";
import { hostOpCatalog } from "@pe/host-contracts/catalog";
import { oneName } from "../route/typed-route";
import { TypedChrome } from "../shell/typed-shell";
import * as mounts from "../shell/typed-mount";
import type { UseSource } from "../shell/source-contract";
import { module as ops } from "./route";

const io = vi.hoisted(() => ({ fetch: vi.fn(), fault: vi.fn() }));
vi.mock("#/host/runtime", () => ({ hostFetch: io.fetch }));
vi.mock("#/host/diagnostics", () => ({ reportFault: io.fault }));

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

const KEY = "revit.detail.space-status";
/**
 * `revit.detail.space-status` as Revit answers it (gate c80e644a, native-acknowledged in 183 ms).
 * Status builds no world, so `Stamp.BuiltUtc` is C#'s `default(DateTime)`; `spelling` is how the
 * bridge serializer wrote it.
 */
const answer = (builtUtc: string) => ({
  stamp: {
    hostDocumentKey: "chadds-r4",
    epoch: 12,
    frame: "host-internal-ft",
    builtUtc,
    sources: [],
    fresh: false,
    resolved: { sources: [], categories: [], kinds: ["Solid", "Mesh"], layers: [], excludedElementIds: [] },
  },
  built: false,
  pendingIds: 0,
  categories: [],
  levels: [{ name: "Level 1", elevationFt: 0 }],
  ms: 1.5,
});

function journey() {
  const entry = hostOpCatalog.find((op) => op.key === KEY)!;
  const source: UseSource = {
    kind: "use",
    open(_ctx, deliver) {
      deliver({
        kind: "complete",
        revision: 1,
        value: {
          key: "ops", generation: 0, version: 1, state: "current",
          value: {
            data: { catalog: { operations: [entry] }, receipts: [], receipt: [] },
            evaluation: "ops-test", inputs: "ops-test",
            coverage: { requested: [], covered: [], refused: [], unknown: [] },
            origin: {}, trace: [], freshness: "current",
          },
        },
      });
      return () => {};
    },
  };
  const mount = mounts.mountTypedRoute(ops, {
    address: { read: () => new URLSearchParams(), write() {}, subscribe: () => () => {} },
    fixture: null, target: { kind: "document", ref: { session: "s", openId: "chadds-r4" } },
    work: { address: null, open: null }, custody: { current: () => true }, memory: () => ({}),
  }, workFingerprintSchema.parse(`builtin-closure:${"a".repeat(64)}`), { sources: { "ops.workspace": source } });
  function Journey() {
    useSyncExternalStore(mount.subscribe, mount.revision, mount.revision);
    return <KeyScopeHost id="ops-run"><TypedChrome mount={mount} document={<span>Chadds-r4</span>} /></KeyScopeHost>;
  }
  const root = createRootRoute({ component: Journey });
  const router = createRouter({ routeTree: root, history: createMemoryHistory({ initialEntries: ["/ops"] }) });
  const view = render(<RouterProvider router={router} />);
  return { mount, close: () => { view.unmount(); mount.dispose(); } };
}
// The pane body is a lazy chunk; a cold import under a parallel run outlasts the 1 s default.
const WAIT = { timeout: 20_000 };
const runButton = () => screen.findByRole("button", { name: /Run operation read/ }, WAIT);
const pane = () => screen.getByText(KEY).closest("[data-slot='pane']") as HTMLElement;
const outsidePanes = () => {
  const outside = document.body.cloneNode(true) as HTMLElement;
  outside.querySelectorAll("[data-slot='pane']").forEach((node) => node.remove());
  return outside;
};

/*
 * Gate c80e644a, /ops (a): the band drew a second "Run read" beside the pane's. The band holds no
 * request (the pane's form does), so its press parsed `{}` and printed a zod issue list at `op`.
 */
test("the band draws no verb whose input only the pane holds; the pane's Run is the one door", async () => {
  const f = journey();
  try {
    f.mount.page.subject(oneName(KEY));
    const run = await runButton();
    expect(pane().contains(run)).toBe(true);
    const band = outsidePanes();
    expect([...band.querySelectorAll("button")].map((b) => b.textContent)).not.toContain("Run read");
    expect(band.textContent).not.toContain("Receipt control");
  } finally { f.close(); }
}, 60_000);

/*
 * Gate c80e644a, /ops (b) and fix line 4: Revit answered, the client's catalog schema refused
 * `stamp.builtUtc`, and the person read the zod issue list with its regex. A refused answer is one
 * failure line in the pane; the issue list goes to the diagnostics log.
 */
test("an answer the catalog schema refuses draws one failure line, and its detail goes to the log", async () => {
  // The zone-less spelling Newtonsoft gave an Unspecified-kind DateTime before the producer fix.
  io.fetch.mockImplementation(async () => new Response(JSON.stringify(answer("0001-01-01T00:00:00"))));
  const f = journey();
  try {
    f.mount.page.subject(oneName(KEY));
    fireEvent.click(await runButton());
    const line = await within(pane()).findByText("Read refused", {}, WAIT);
    expect(line.parentElement!.textContent).toContain("stamp.builtUtc");
    for (const dump of ["invalid_format", "pattern", "[{", '"code"'])
      expect(document.body.textContent, dump).not.toContain(dump);
    expect(io.fault).toHaveBeenCalledWith(
      expect.objectContaining({ code: "action.failed", routeCode: "ops", readingKind: "ops.read" }),
      expect.objectContaining({ issues: [expect.objectContaining({ path: ["stamp", "builtUtc"] })] }),
    );
  } finally { f.close(); }
}, 60_000);

test("space-status decodes once its unbuilt stamp carries the UTC designator", async () => {
  io.fetch.mockImplementation(async () => new Response(JSON.stringify(answer("0001-01-01T00:00:00Z"))));
  const f = journey();
  try {
    f.mount.page.subject(oneName(KEY));
    fireEvent.click(await runButton());
    expect(await within(pane()).findByText(/raw response/, {}, WAIT)).toBeTruthy();
    expect(within(pane()).queryByText("Read refused")).toBeNull();
    expect(io.fault).not.toHaveBeenCalled();
  } finally { f.close(); }
}, 60_000);
