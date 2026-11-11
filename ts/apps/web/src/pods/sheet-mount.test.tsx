// @vitest-environment jsdom
import { useSyncExternalStore } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test } from "vite-plus/test";
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { KeyScopeHost } from "@pe/kit/keys";
import { podMemberCode, settingsCandidate, settingsRouteState, workFingerprintSchema } from "@pe/agent-contracts";
import { sheetCells } from "../route/slots/sheet/index.ts";
import { module as pods } from "./route";
import { TypedChrome } from "../shell/typed-shell";
import { mountTypedRoute } from "../shell/typed-mount";
import { createFixtureWorkDoor } from "../shell/fixture-work-door";
import type { UseSource } from "../shell/source-contract";

afterEach(cleanup);

const ref = { pod: "share-ducts", path: "settings/checks.json" };
const saved = '{"maxSystems":25,"names":["Elbow","Tee"],"limits":{"depth":3,"old":1}}';
const basis = { member: ref, rawContent: saved, sha256: "f".repeat(64) };
/** `fields` is the member's staged Work: a top-level key the sheet shows, and keys it has no cell for. */
const author = (fields: Record<string, never>) => ({
  scope: { ...ref, runs: "member" as const },
  member: { member: ref, content: saved, sha256: basis.sha256 },
  work: { basis, fields },
  // The draft is the host's own candidate: the saved bytes with every staged edit applied (pods/host.ts).
  draft: settingsCandidate(saved, fields), composition: null, schemaRef: null, runs: [], unresolved: [], assumed: [], next: null, inputs: [],
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
function mountPods(fields: Record<string, never> = {}) {
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

/*
 * purge-2 integrity 3: "Save staged member" writes every staged edit, and a cell reads only its own
 * top-level key. What /family or Pea staged beneath a key, at the root, or as a delete is named.
 */
const hiddenEdits = {
  "/maxSystems": { edit: { value: 26, by: "human" } },
  "/limits/depth": { edit: { value: 4, by: "pea" } },
  "/limits/old": { edit: { delete: true, by: "pea" } },
  "/names": { edit: { delete: true, by: "pea" } },
  "": { edit: { value: saved, by: "pea" } },
} as unknown as Record<string, never>;
const sheetNote = "Save also writes staged edits these cells do not show: /limits/depth, delete /limits/old, delete /names, the whole file as raw text";

test("staged edits no cell shows are named: beneath a key on its row, and every one on the sheet's note", () => {
  const slot = pods.spec.sheet!;
  const read = author(hiddenEdits);
  const cells = sheetCells(slot, { rows: [], work: read.work, model: [], read });
  expect(cells.map((c) => [c.label, c.value, c.source, c.note])).toEqual([
    ["maxSystems", 26, "work", undefined],
    ["limits", { depth: 3, old: 1 }, "model", "Save also writes beneath this key: /limits/depth, delete /limits/old"],
  ]);
  expect(slot.note?.(read)).toBe(sheetNote);
  // A sheet whose every staged edit has its own cell says nothing more.
  expect(slot.note?.(author({ "/maxSystems": hiddenEdits["/maxSystems"]! }))).toBeNull();
});

test("the /pods sheet pane draws that note above the cells Save will write past", async () => {
  const pods = mountPods(hiddenEdits);
  try {
    expect(await screen.findByText("limits")).toBeTruthy();
    expect(screen.getByRole("note").textContent).toBe(sheetNote);
  } finally { pods.close(); }
}, 30_000);
