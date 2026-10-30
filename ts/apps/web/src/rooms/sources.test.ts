// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vite-plus/test";
import type { RevitContextViewImage } from "@pe/host-contracts/generated";
import { graphFieldPolicy } from "@pe/agent-contracts";
import type { ReadingContext, ReadingPublication } from "#/shell/readings";
import { DEMO_PLAN, DEMO_ROOMS, DEMO_VIEW } from "./demo";
import { roomsGraph, roomsPageSchema } from "./graph";
import { planOf, roomsSnapshotSource } from "./sources";

afterEach(() => vi.unstubAllGlobals());

test("Pea's Rooms lease keeps view, stage, focus, layers and selection with the person", () => {
  for (const key of ["view", "stage", "focus", "layers", "show", "card", "selected"] as const)
    expect(graphFieldPolicy(roomsGraph.fields[key]).agent).toBe(false);
  expect(graphFieldPolicy(roomsGraph.fields.viewport).agent).toBe("set");
});

test("a plan draws only a paired URL and finite two-dimensional native registration", () => {
  const response: RevitContextViewImage.Res.Response = {
    view: { kind: "View", documentKey: "rooms", label: DEMO_VIEW },
    filePath: "rooms.png",
    byteSize: 1,
    width: 800,
    height: 480,
    registration: {
      ...DEMO_PLAN.registration,
      imageSha256: "fixture-image",
      topLeft: [0, 24],
      topRight: [40, 24],
      bottomLeft: [0, 0],
    },
    imageUrl: "/captures/rooms.png",
    registrationRefusal: null,
  };
  expect(planOf(response)).toEqual({
    plan: { href: "/captures/rooms.png", registration: response.registration },
  });
  expect(
    planOf({ ...response, registration: null, imageUrl: null, registrationRefusal: "NoCrop" }),
  ).toEqual({ refusal: "NoCrop" });
  expect(() => planOf({ ...response, imageUrl: null })).toThrow("apart");
  expect(() => planOf({ ...response, registration: null })).toThrow("apart");
  expect(() =>
    planOf({ ...response, registration: { ...response.registration!, topLeft: [0, 0, 1] } }),
  ).toThrow("model XY");
  expect(() =>
    planOf({ ...response, registration: { ...response.registration!, topLeft: [NaN, 0] } }),
  ).toThrow("model XY");
});

test("overlapping focus refreshes cannot deliver an older snapshot or publish after retirement", async () => {
  const pending: ((value: Response) => void)[] = [];
  vi.stubGlobal("fetch", () => new Promise<Response>((resolve) => pending.push(resolve)));
  const controller = new AbortController();
  const context: ReadingContext = {
    target: { kind: "document", ref: { session: "rooms", openId: "document-A" } },
    workKey: "rooms/target:model",
    workRevision: 1,
    work: {},
    page: roomsPageSchema.parse({ view: DEMO_VIEW }),
    attempt: {
      target: { kind: "document", ref: { session: "rooms", openId: "document-A" } },
      workKey: "rooms/target:model",
      generation: 1,
    },
    trigger: { kind: "demand" },
    args: null,
    inputs: {},
    signal: controller.signal,
  };
  const publications: ReadingPublication[] = [];
  const release = await roomsSnapshotSource().open(context, (value) => publications.push(value));
  expect(pending).toHaveLength(1);
  window.dispatchEvent(new Event("focus"));
  expect(pending).toHaveLength(2);
  pending[1]!(Response.json(DEMO_ROOMS));
  await vi.waitFor(() =>
    expect(publications.filter((value) => value.kind === "complete")).toHaveLength(1),
  );
  pending[0]!(Response.json({ levels: [], regions: [] }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(publications.filter((value) => value.kind === "complete")).toEqual([
    { kind: "complete", value: DEMO_ROOMS, revision: 1 },
  ]);
  window.dispatchEvent(new Event("focus"));
  expect(pending).toHaveLength(3);
  controller.abort();
  release?.();
  pending[2]!(Response.json({ levels: [], regions: [] }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(publications.filter((value) => value.kind === "complete")).toHaveLength(1);
  window.dispatchEvent(new Event("focus"));
  expect(pending).toHaveLength(3);
});
