// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { createMemoryHistory, createRouter, RouterContextProvider } from "@tanstack/react-router";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { routeFromGraph, mountRoute, type MountBody } from "#/shell/mount";
import type { ParameterLinksDocument } from "@pe/agent-contracts";
import { Route as root } from "../routes/__root";
import { parameterLinksGraph, type ParameterLinksPage } from "./graph";
import { parameterLinksAdapters } from "./route";
import { parameterLinksSources } from "./sources";
import { ParameterLinksHostFixture } from "./host.fixture";
import { familyQueries } from "../../../../packages/mcps/src/shared/query-client";

vi.mock("../routes/__root", async () => {
  const { createRootRoute, Outlet } = await import("@tanstack/react-router");
  return { Route: createRootRoute({ component: Outlet }) };
});

let host: ParameterLinksHostFixture;
const releases: (() => void)[] = [];
beforeEach(() => {
  host = new ParameterLinksHostFixture();
  vi.stubGlobal("EventSource", host.source());
  vi.stubGlobal("fetch", host.fetch);
  vi.stubGlobal("scrollTo", vi.fn());
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(600);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1200);
});
afterEach(async () => {
  cleanup();
  for (const release of releases.splice(0)) release();
  await new Promise((resolve) => setTimeout(resolve, 450));
  expect([...host.subscriptions].filter((entry) => entry.request.kind !== "work")).toEqual([]);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

type Body = MountBody<ParameterLinksPage, ParameterLinksDocument>;
async function mounted(search = "", hosted = false) {
  const wrap = vi.fn((_owner, children) => children);
  const adapters = {
    ...parameterLinksAdapters,
    sources: parameterLinksSources(host.resources),
    wrap,
  };
  const route = routeFromGraph(parameterLinksGraph, adapters, "/parameter-links");
  const router = createRouter({
    routeTree: root.addChildren([route]),
    history: createMemoryHistory({
      initialEntries: [
        `/parameter-links?target=${hosted ? "containing-chat-target" : host.target.session}${search}`,
      ],
    }),
  });
  releases.push(router.history.subscribe(router.load));
  await router.load();
  const Component = hosted ? mountRoute(parameterLinksGraph, adapters) : route.options.component!;
  const view = render(
    <RouterContextProvider router={router}>
      <Component
        {...(hosted ? { thread: "thread-links", target: host.target.session, url: false } : {})}
      />
    </RouterContextProvider>,
  );
  await view.findByLabelText("Situation");
  const owner = () => wrap.mock.calls.at(-1)![0] as Body["owner"];
  await waitFor(() => expect(owner().snapshot().work?.handle.revision).toBe(host.revision));
  await waitFor(() => expect(owner().readings.get("links").status).toBe("ready"));
  await view.findByLabelText("definition id");
  return { view, router, owner, situation: within(view.getByLabelText("Situation")) };
}
async function readyButton(scope: ReturnType<typeof within>, name: string) {
  return waitFor(() => {
    const button = scope.getByRole("button", { name, exact: true });
    expect(button.getAttribute("aria-disabled")).not.toBe("true");
    return button;
  });
}

test("a stale Work write keeps its edit for retry", async () => {
  const { view, owner } = await mounted();
  host.conflictOnWrite = true;
  fireEvent.change(view.getByLabelText("definition id"), { target: { value: "local-change" } });
  await waitFor(() => expect(owner().results.get("edit")?.state).toBe("stale"));
  expect(host.writeRequests[0]?.expectedRevision).toBe(1);
  expect(owner().rejected()).toMatchObject({
    verb: "edit",
    request: { expectedRevision: 1, patches: host.writeRequests[0]!.patches },
  });
  expect(host.doc.profile.edit?.value.definitions[0]?.id).toBe("supply-flow");
  expect(host.writes).toEqual([]);
  // Kernel seam: retain the rejected intent without treating it as accepted Work.
  expect(view.queryByRole("button", { name: /retry/i })).not.toBeNull();
  expect(view.queryByRole("button", { name: /discard/i })).not.toBeNull();
  act(() => owner().reread());
  await waitFor(() => expect(owner().snapshot().work?.handle.revision).toBe(host.revision));
  const retry = await waitFor(() => {
    const button = view.getByRole("button", { name: /retry/i });
    expect(button.getAttribute("aria-disabled")).not.toBe("true");
    return button;
  });
  fireEvent.click(retry);
  await waitFor(() => expect(host.writes).toHaveLength(1));
  expect(host.writeRequests[1]?.expectedRevision).toBe(2);
  expect(owner().rejected()).toBeNull();
  expect(owner().journal(owner().snapshot().work!.handle.key).read().undo).toHaveLength(1);
  expect(host.doc.profile.edit?.value).toEqual({
    ...host.profile,
    definitions: [{ ...host.profile.definitions[0]!, id: "local-change" }],
  });
});

test("a stale undo stays in the journal without becoming a rejected edit", async () => {
  const { view, owner } = await mounted();
  fireEvent.change(view.getByLabelText("definition id"), { target: { value: "accepted" } });
  await waitFor(() => expect(host.writes).toHaveLength(1));
  await waitFor(() => expect(owner().busy()).toBeNull());
  host.conflictOnWrite = true;
  await act(async () => {
    await owner().restore("undo");
  });
  expect(owner().journalRefusal()).toBeTruthy();
  expect(owner().rejected()).toBeNull();
  expect(host.writes).toHaveLength(1);
});

test("discarding a stale edit leaves accepted Work untouched", async () => {
  const { view, owner } = await mounted();
  host.conflictOnWrite = true;
  fireEvent.change(view.getByLabelText("definition id"), { target: { value: "discarded" } });
  await waitFor(() => expect(owner().rejected()).not.toBeNull());
  fireEvent.click(view.getByRole("button", { name: /discard/i }));
  expect(owner().rejected()).toBeNull();
  expect(view.queryByRole("button", { name: /retry/i })).toBeNull();
  expect(host.writes).toEqual([]);
  expect(host.doc.profile.edit?.value.definitions[0]?.id).toBe("supply-flow");
});

test("an agent suggestion preview cannot arm human Apply even after take; accepted Preview arms its own reading id", async () => {
  host.doc.profile.suggestion = {
    value: {
      ...host.profile,
      definitions: host.profile.definitions.map((definition) => ({
        ...definition,
        reducer: "max",
      })),
    },
  };
  const { view, situation, owner } = await mounted();
  // An agent's read lands through the shared source, outside this human mount's invocation.
  await act(async () => {
    await familyQueries["parameter-links.read"].run(
      { evaluate: true, subject: "suggestion" },
      { target: owner().snapshot().target, work: owner().snapshot().work!.handle },
    );
  });
  expect(owner().results.get("previewProposal")).toBeUndefined();
  expect(host.captures[0]?.reading).toMatchObject({
    kind: "parameter-links",
    value: { subject: "suggestion" },
  });
  expect(view.getByText("preview of Pea's suggestion — not edit")).toBeTruthy();
  expect(owner().control("apply").refusal).toContain("suggestion preview");
  await act(async () => {
    await owner().control("apply").run();
  });
  expect(host.actions).toEqual([]);
  fireEvent.click(await readyButton(situation, "preview Pea's suggestion"));
  await waitFor(() => expect(owner().results.get("previewProposal")?.state).toBe("done"));
  fireEvent.click(
    await readyButton(within(view.getByRole("group", { name: "profile proposal" })), "take"),
  );
  await waitFor(() => expect(host.doc.profile.edit?.value.definitions[0]?.reducer).toBe("max"));
  expect(owner().control("apply").refusal).toContain("suggestion preview");
  fireEvent.click(await readyButton(situation, "preview"));
  await waitFor(() => expect(owner().results.get("preview")?.state).toBe("done"));
  const id = host.captures[0]!.id;
  await waitFor(() => expect(owner().control("apply").refusal).toBeNull());
  fireEvent.change(view.getByRole("textbox", { name: "reason for this write" }), {
    target: { value: "Reconcile reviewed links" },
  });
  fireEvent.click(await readyButton(within(view.container), "apply"));
  await waitFor(() =>
    expect(owner().results.get("apply")).toMatchObject({ state: "done", kind: "command" }),
  );
  expect(host.actions[0]?.input).toMatchObject({ readingId: id });
  expect(host.reads.map((request) => request.input)).toEqual([
    { evaluate: true, subject: "suggestion" },
    { evaluate: true, subject: "suggestion" },
    { evaluate: true, subject: "edit" },
  ]);
  expect(
    host.reads.every((request) => JSON.stringify(request.target) === JSON.stringify(host.target)),
  ).toBe(true);
});

test("Apply requires an evaluated reading id and a fresh basis matching current Work", async () => {
  host.capture(false);
  const { view, owner, situation } = await mounted();
  expect(owner().control("apply").refusal).not.toBeNull();
  await act(async () => {
    await owner().control("apply").run();
  });
  expect(host.actions).toEqual([]);
  fireEvent.click(await readyButton(situation, "preview"));
  await waitFor(() => expect(owner().results.get("preview")?.state).toBe("done"));
  await waitFor(() => expect(owner().control("apply").refusal).toBeNull());
  const retainedApply = owner().control("apply");
  fireEvent.change(view.getByLabelText("definition id"), {
    target: { value: "changed-after-preview" },
  });
  await waitFor(() => expect(owner().results.get("edit")?.state).toBe("done"));
  await waitFor(() => expect(owner().control("apply").refusal).toContain("Preview this draft"));
  await act(async () => {
    await retainedApply.run();
  });
  expect(host.actions).toEqual([]);
  expect(host.reads).toHaveLength(1);
  fireEvent.click(await readyButton(situation, "preview"));
  await waitFor(() => expect(host.reads).toHaveLength(2));
  await waitFor(() => expect(owner().control("apply").refusal).toBeNull());
  await act(async () => {
    await owner().control("apply").run();
  });
  expect(host.actions[0]?.input).toMatchObject({ readingId: host.captures[0]!.id });
});

test("production edits write Work immediately; option demand follows Work with exact document and compatibility filters", async () => {
  const { view, owner } = await mounted("&demo=does-not-exist");
  await waitFor(() =>
    expect(
      host.optionRequests.some(
        (request) => request.context?.DataTypeId === "autodesk.spec:airFlow",
      ),
    ).toBe(true),
  );
  expect(
    host.optionRequests.every(
      (request) => JSON.stringify(request.target) === JSON.stringify(host.target),
    ),
  ).toBe(true);
  expect(host.optionRequests).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        key: "parameter-identities",
        context: {
          CategoryId: "-2001140",
          ParameterScope: "instanceThenType",
          ElementUniqueIds: "terminal-1",
        },
      }),
    ]),
  );
  expect(view.queryByRole("button", { name: "save draft" })).toBeNull();
  expect(owner().view.read().page).not.toHaveProperty("buffer");
  fireEvent.change(view.getByLabelText("definition id"), { target: { value: "work-edit" } });
  await waitFor(() => expect(host.doc.profile.edit?.value.definitions[0]?.id).toBe("work-edit"));
  await waitFor(() => expect(owner().snapshot().work?.handle.revision).toBe(2));
  expect(host.writes).toHaveLength(1);
  expect(host.writeRequests[0]?.expectedRevision).toBe(1);
  await act(async () => {
    await owner().control("preview").run();
  });
  expect(host.writeRequests).toHaveLength(1);
  expect(host.reads).toHaveLength(1);
  const next = {
    ...host.doc.profile.edit!.value,
    definitions: host.doc.profile.edit!.value.definitions.map((definition) => ({
      ...definition,
      sourceCategoryId: -2000151,
    })),
  };
  await act(async () => {
    await owner().control("edit", { profile: next, expectedRevision: host.revision }).run();
  });
  await waitFor(() =>
    expect(host.optionRequests.some((request) => request.context?.CategoryId === "-2000151")).toBe(
      true,
    ),
  );
  for (const entry of host.subscriptions) {
    if (entry.request.kind === "family-readings" || entry.request.kind === "receipts")
      expect(entry.request.work).toEqual(host.key);
  }
});

test("the hosted production graph uses its binding and keeps Page out of the containing chat URL", async () => {
  const { router, owner, situation } = await mounted("&rail=folded", true);
  expect(owner().snapshot().target).toEqual({ kind: "document", ref: host.target });
  expect(owner().view.read().page.rail).toBe("open");
  const before = router.state.location.href;
  act(() => owner().view.setPage({ rail: "folded" }));
  expect(router.state.location.href).toBe(before);
  fireEvent.click(await readyButton(situation, "preview"));
  await waitFor(() => expect(host.reads).toHaveLength(1));
  expect(host.reads[0]?.target).toEqual(host.target);
});
