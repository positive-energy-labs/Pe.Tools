// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { createMemoryHistory, createRouter, RouterContextProvider } from "@tanstack/react-router";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { spaceElementKey } from "@pe/agent-contracts";
import {
  HOST_RPC_BRIDGE_SESSION_HEADER,
  HOST_RPC_DOCUMENT_HEADER,
} from "@pe/host-contracts/operation-types";
import { prepareElements } from "#/revit/element-target";
import { useNativeObservation } from "#/revit/observation";
import { sceneTarget } from "#/scene/scene-target";
import { FamiliesHostFixture } from "../families/host.fixture";
import { Route as root } from "../routes/__root";
import { FIXTURE_ANSWERS, FIXTURE_SCENE, fixtureSceneBytes } from "./fixture";
import { spaceAdapters, spaceRoute } from "./route";
import { spaceObservation } from "./members";
import { loadedScene } from "./sources";
import { spacePageSchema } from "./graph";
import type { ReadingState } from "#/shell/readings";
import type { ComponentProps } from "react";
import type { SpacePicture } from "./picture";

// Route chrome imports unrelated routes that other wave agents are replacing in this checkout.
vi.mock("../routes/__root", async () => {
  const { createRootRoute } = await import("@tanstack/react-router");
  return { Route: createRootRoute() };
});

// Geometry keeps its separate deterministic suite. Only the WebGL body is replaced here.
vi.mock("./picture", () => ({
  SpacePicture: (props: ComponentProps<typeof SpacePicture>) => {
    const observation = useNativeObservation();
    const first = props.meshes?.instances.find((i) => i.revitId === 201);
    const target = first ? sceneTarget(observation, first) : null;
    const prepared = target ? prepareElements(target, false) : null;
    return (
      <div aria-label="fixture picture">
        <output aria-label="native target">{prepared?.kind ?? "none"}</output>
        <button onClick={() => first && props.setPage({ selected: first.key })}>Pick duct</button>
        <button
          onClick={() =>
            props.setPage({ selected: JSON.stringify(["wrong-document", null, "foreign"]) })
          }
        >
          Pick foreign
        </button>
        {props.readout}
      </div>
    );
  },
}));

let host: FamiliesHostFixture;
let calls: { key: string; request: unknown; headers: Headers }[];
let artifacts: string[];
const releases: (() => void)[] = [];
const sceneA = "a".repeat(64),
  sceneB = "b".repeat(64);
beforeEach(() => {
  host = new FamiliesHostFixture();
  calls = [];
  artifacts = [];
  vi.stubGlobal("EventSource", host.source());
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(input instanceof Request ? input.url : String(input), "http://fixture")
      .pathname;
    if (path.includes("/space/scenes/")) {
      artifacts.push(path);
      return new Response(fixtureSceneBytes());
    }
    if (path === "/call") {
      const body = JSON.parse(typeof init?.body === "string" ? init.body : "{}");
      if (body.key.startsWith("revit.detail.space-")) {
        calls.push({ ...body, headers: new Headers(init?.headers) });
        const key = body.key.slice("revit.detail.space-".length) as keyof typeof FIXTURE_ANSWERS;
        return Response.json(
          body.key === "revit.detail.space-scene"
            ? { id: sceneB, scene: FIXTURE_SCENE.metadata.stamp }
            : FIXTURE_ANSWERS[key].response,
        );
      }
    }
    return host.fetch(input, init);
  });
});
afterEach(async () => {
  cleanup();
  for (const release of releases.splice(0)) release();
  await new Promise((resolve) => setTimeout(resolve, 450));
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function mounted(search: Record<string, string> = {}) {
  const wrap = vi.spyOn(spaceAdapters, "wrap");
  const router = createRouter({
    routeTree: root.addChildren([spaceRoute]),
    history: createMemoryHistory({
      initialEntries: [
        `/space?${new URLSearchParams({ target: host.target.session, layers: "meshes,context,cuts,levels,boxes,slice", ...search })}`,
      ],
    }),
  });
  releases.push(router.history.subscribe(router.load));
  await router.load();
  const Component = spaceRoute.options.component!;
  const view = render(
    <RouterContextProvider router={router}>
      <Component />
    </RouterContextProvider>,
  );
  await view.findByLabelText("Situation");
  await view.findByLabelText("fixture picture");
  const owner = () => wrap.mock.calls.at(-1)![0];
  await waitFor(() => expect(owner().snapshot().target.kind).toBe("document"));
  return { view, owner, router };
}
async function enabled(view: ReturnType<typeof render>, name: string) {
  return waitFor(() => {
    const button = view.getByRole("button", { name });
    expect(button.getAttribute("aria-disabled")).not.toBe("true");
    return button;
  });
}

test("restoring a scene URL loads only the artifact; answers run as explicit kernel queries", async () => {
  const proof = await mounted({ scene: sceneA });
  await waitFor(() => expect(proof.owner().readings.get("scene").status).toBe("ready"));
  expect(artifacts).toEqual([`/pe/space/scenes/${sceneA}/artifact`]);
  expect(calls).toEqual([]);
  fireEvent.change(proof.view.getByLabelText("ids"), { target: { value: "201,202" } });
  await waitFor(() => expect(proof.owner().view.read().page.ids).toEqual([201, 202]));
  expect(calls).toEqual([]);
  expect(proof.view.getByLabelText("native target").textContent).toBe("none");
  fireEvent.click(await enabled(proof.view, "read status"));
  await waitFor(() =>
    expect(proof.owner().results.get("status")).toMatchObject({
      state: "done",
      kind: "query",
      receipt: { value: { response: FIXTURE_ANSWERS.status.response } },
    }),
  );
  expect(calls.map((call) => call.key)).toEqual(["revit.detail.space-status"]);
  expect(proof.owner().view.read().page).not.toHaveProperty("status");
  expect(calls[0]!.headers.get(HOST_RPC_BRIDGE_SESSION_HEADER)).toBe(host.target.session);
  expect(calls[0]!.headers.get(HOST_RPC_DOCUMENT_HEADER)).toBe(host.target.openId);
});

test("capture admits one exact-document scene; visibility uses Page and foreign members are refused", async () => {
  const { view, owner, router } = await mounted({ ids: "201,202" });
  fireEvent.click(await enabled(view, "capture"));
  await waitFor(() => expect(owner().view.read().page.scene).toBe(sceneB));
  await waitFor(() =>
    expect(owner().readings.get("scene")).toMatchObject({
      status: "ready",
      current: true,
      value: { id: sceneB },
    }),
  );
  await waitFor(() => expect(view.getByLabelText("native target").textContent).toBe("ready"));
  fireEvent.click(view.getByRole("button", { name: "Pick foreign" }));
  expect(owner().view.read().page.selected).toBeNull();
  expect(await view.findByRole("alert")).toHaveProperty(
    "textContent",
    expect.stringContaining("not in this loaded scene"),
  );
  fireEvent.click(view.getByRole("button", { name: "Pick duct" }));
  const key = spaceElementKey(
    FIXTURE_SCENE.metadata.elements.find((e) => e.handle.elementId === 201)!.handle,
  );
  await waitFor(() => expect(owner().view.read().page.selected).toBe(key));
  fireEvent.click(await enabled(view, "hide"));
  await waitFor(() => expect(owner().view.read().page.hidden).toEqual([key]));
  await waitFor(() => expect(router.state.location.search.hidden).toEqual([key]));
  expect(calls.map((call) => call.key)).toEqual(["revit.detail.space-scene"]);
  expect(host.writes).toEqual([]);
  act(() => owner().readings.documentChanged(host.target));
  await waitFor(() => expect(view.getByLabelText("native target").textContent).toBe("none"));
  expect(owner().readings.get("scene").current).toBe(false);
  await act(async () => {
    await router.navigate({
      to: "/space",
      search: { scene: sceneA, target: host.target.session } as never,
    });
  });
  await waitFor(() => expect(owner().view.read().page.scene).toBe(sceneA));
  await waitFor(() => expect(owner().readings.get("scene").current).toBe(true));
  expect(view.getByLabelText("native target").textContent).toBe("none");
  expect(calls).toHaveLength(1);
});

test("the fixture is a graph-declared answer set and never creates a native target", async () => {
  const { view, owner } = await mounted({ fixture: "fixture" });
  await waitFor(() => expect(owner().readings.get("answers").value).toEqual(FIXTURE_ANSWERS));
  expect(view.getByLabelText("native target").textContent).toBe("none");
  expect(artifacts).toEqual([]);
  expect(calls).toEqual([]);
  expect(owner().view.read().page).not.toHaveProperty("rows");
});

test("answer parameters round-trip in the URL while the kernel keeps answer data in its receipt", async () => {
  const { view, owner, router } = await mounted({ scene: sceneA });
  await waitFor(() => expect(owner().readings.get("scene").status).toBe("ready"));
  fireEvent.change(view.getByLabelText("z1"), { target: { value: "12" } });
  await waitFor(() => expect(router.state.location.search.sliceInput).toEqual({ z0: 0, z1: 12 }));
  fireEvent.click(await enabled(view, "read slice"));
  await waitFor(() =>
    expect(owner().results.get("slice")).toMatchObject({ state: "done", kind: "query" }),
  );
  expect(calls[0]).toMatchObject({ key: "revit.detail.space-slice", request: { z0: 0, z1: 12 } });
  expect(owner().view.read().page).not.toHaveProperty("slice");
});

test("stale, wrong-scene, foreign-document and nonmember observations never authorize native targets", () => {
  const page = spacePageSchema.parse({ scene: sceneA });
  const document = host.target;
  const scene = loadedScene(sceneA, FIXTURE_SCENE);
  const read: ReadingState = {
    status: "ready",
    value: scene,
    current: true,
    complete: true,
    basis: null,
    version: 1,
  };
  const capture = { scene: sceneA, document, stamp: FIXTURE_SCENE.metadata.stamp };
  const first = FIXTURE_SCENE.meshes.instances.find((i) => i.revitId === 201)!;
  const observation = spaceObservation(page, read, document, capture);
  expect(prepareElements(sceneTarget(observation, first)!, false).kind).toBe("ready");
  for (const bad of [
    spaceObservation(page, { ...read, current: false, status: "stale" }, document, capture),
    spaceObservation({ ...page, scene: sceneB }, read, document, capture),
    spaceObservation(page, read, { ...document, openId: "other" }, capture),
    spaceObservation(page, read, document, {
      ...capture,
      stamp: { ...capture.stamp, hostDocumentKey: "wrong-scene" },
    }),
    spaceObservation(
      page,
      {
        ...read,
        value: {
          ...scene,
          metadata: { ...scene.metadata, stamp: { ...scene.metadata.stamp, fresh: false } },
        },
      },
      document,
      capture,
    ),
  ])
    expect(sceneTarget(bad, first)).toBeNull();
  const foreign = { ...first, revitId: 999, uniqueId: "foreign" };
  expect(prepareElements(sceneTarget(observation, foreign)!, false).kind).toBe("refused");
});
