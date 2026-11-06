// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vite-plus/test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DocumentPicker, PlaceRouteShell } from "./application-route-shell";
import * as Atom from "effect/reactivity/Atom";
import { machineFixture } from "../../../../packages/agent-contracts/tests/machine-fixture";
import { podsData } from "../pods/neutral";
import type { AdmittedRoute } from "../../../../packages/agent-contracts/src/route-kernel-admission";
import type { PlaceInput } from "./admitted-place";
import type { PanePlace } from "./admitted-pane";
const inventory = vi.hoisted(() => ({
  state: "ready",
  observation: {
    sessions: [
      {
        connected: true,
        sessionId: "bridge-one",
        processId: 1,
        sdkSessionId: "ke277",
        openDocumentCount: 2,
        openDocuments: [
          { openId: "project-one", title: "Project A", isFamilyDocument: false },
          { openId: "family-one", title: "Family A", isFamilyDocument: true },
        ],
      },
    ],
  },
}));
const composed = vi.hoisted(() => ({ inputs: [] as PlaceInput[] }));
vi.mock("./admitted-sources", () => ({ admittedSources: () => ({}) }));
vi.mock("./admitted-chrome", async () => ({
  RouteDocument: (await import("react")).createContext(null),
}));
vi.mock("./admitted-mount", () => ({ createRouteShell: () => ({}) }));
vi.mock("./source-route-services", () => ({ sourceRouteServices: () => ({}) }));
vi.mock("./admitted-pane", () => ({
  AdmittedPlaceBoundary: () => null,
  AdmittedPlacePane: ({ input }: { input: PlaceInput }) => {
    composed.inputs.push(input);
    return <output>{JSON.stringify(input.target)}</output>;
  },
}));
vi.mock("./readings-hooks", async (original) => ({
  ...(await original<typeof import("./readings-hooks")>()),
  useInventory: () => inventory,
  readingAtom: (request: { kind: string }) =>
    Atom.make(
      request.kind === "inventory" ? inventory : { state: "ready", observation: machineFixture() },
    ),
}));
afterEach(cleanup);

test("choosing a document pins one exact lifetime, preserving this Place's subject and history", async () => {
  const write = vi.fn();
  const place = {
    fixture: null,
    address: { read: () => new URLSearchParams("system=SA&thread=chat"), write },
  } as unknown as PanePlace;
  render(<DocumentPicker place={place} target={null} needs="project" enabled />);
  fireEvent.click(screen.getByRole("button", { name: "Choose a document" }));
  expect(screen.queryByText("Family A")).toBeNull();
  fireEvent.click(await screen.findByText("Project A"));
  expect(write).toHaveBeenCalledOnce();
  const [search, mode] = write.mock.calls[0]!;
  expect(mode).toBe("push");
  expect(search.get("system")).toBe("SA");
  expect(search.get("thread")).toBe("chat");
  expect(JSON.parse(search.get("target"))).toEqual({
    kind: "open",
    ref: { session: "bridge-one", openId: "project-one" },
  });
});

test("an optional Pods document pin reaches the mounted source scope instead of host authority", () => {
  const target = { kind: "open", ref: { session: "bridge-one", openId: "project-one" } };
  const place = {
    fixture: null,
    current: () => true,
    memory: () => ({}),
    address: {
      read: () => new URLSearchParams({ target: JSON.stringify(target) }),
      subscribe: () => () => {},
    },
  } as unknown as PanePlace;
  render(<PlaceRouteShell route={{ data: podsData } as unknown as AdmittedRoute} place={place} />);
  expect(composed.inputs.at(-1)?.target).toEqual({ kind: "document", ref: target.ref });
});

test.each([
  null,
  JSON.stringify({ kind: "open", ref: { session: "bridge-one", openId: "closed" } }),
  JSON.stringify({ kind: "open", ref: { session: "foreign-bridge", openId: "project-one" } }),
  '{"invalid"',
])("optional browsing preserves host only when no pin exists: %s", (pin) => {
  composed.inputs.length = 0;
  const place = {
    fixture: null,
    current: () => true,
    memory: () => ({}),
    address: {
      read: () => new URLSearchParams(pin ? { target: pin } : {}),
      subscribe: () => () => {},
    },
  } as unknown as PanePlace;
  render(<PlaceRouteShell route={{ data: podsData } as unknown as AdmittedRoute} place={place} />);
  if (pin === null) expect(composed.inputs.at(-1)?.target).toEqual({ kind: "host" });
  else expect(composed.inputs.every((input) => input.target === null)).toBe(true);
});

test("changing the exact optional document retires the old source custody", () => {
  composed.inputs.length = 0;
  let search = new URLSearchParams({
    target: JSON.stringify({ kind: "open", ref: { session: "bridge-one", openId: "project-one" } }),
  });
  const place = {
    fixture: null,
    current: () => true,
    memory: () => ({}),
    address: { read: () => search, subscribe: () => () => {} },
  } as unknown as PanePlace;
  const route = { data: podsData } as unknown as AdmittedRoute;
  const view = render(<PlaceRouteShell route={route} place={place} />);
  const first = composed.inputs.at(-1)!;
  expect(first.custody.current()).toBe(true);
  search = new URLSearchParams({
    target: JSON.stringify({ kind: "open", ref: { session: "bridge-one", openId: "family-one" } }),
  });
  view.rerender(<PlaceRouteShell route={route} place={place} />);
  expect(first.custody.current()).toBe(false);
  expect(composed.inputs.at(-1)?.target).toEqual({
    kind: "document",
    ref: { session: "bridge-one", openId: "family-one" },
  });
});
