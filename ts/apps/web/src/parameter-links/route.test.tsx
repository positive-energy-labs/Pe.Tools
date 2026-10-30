// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { createMemoryHistory, createRouter, RouterContextProvider } from "@tanstack/react-router";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import {
  actionReceiptSchema,
  familyCaptureSchema,
  stagedParameterProfile,
  type ParameterLinksDocument,
} from "@pe/agent-contracts";
import { Input } from "@pe/kit/lang/input";
import { EvaluationView } from "./Evaluation";
import { routeFromGraph, type MountBody, type RouteAdapters } from "#/shell/mount";
import { subscriptionSource } from "#/shell/readings-use";
import { Route as root } from "../routes/__root";
import { parameterLinksBinding, parameterLinksGraph, type ParameterLinksPage } from "./graph";
import { parameterLinksOptionsSource } from "./sources";
import { ParameterLinksHostFixture } from "./host.fixture";

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
  // Work atoms are app-owned and retained; every graph-owned acquisition must release.
  expect(
    [...host.subscriptions].filter((subscription) => subscription.request.kind !== "work"),
  ).toEqual([]);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

type Body = MountBody<ParameterLinksPage, ParameterLinksDocument>;
test.todo(
  "kernel gap: one Preview invocation CAS-saves the unsaved buffer before evaluating; conflict retains it and never reads",
);
test.todo(
  "kernel gap: a hosted graph uses its thread target and never projects Page into the containing chat URL",
);
test.todo(
  "kernel gap: a production links source receives the structured WorkKey without decoding its opaque identity",
);
/** Fixture bodies exercise the graph before product cutover; the production editor stays intact. */
function FixtureProfile({ owner, page, verbs }: Body) {
  const work = owner.snapshot().work;
  const profile = page.buffer?.profile ?? (work ? stagedParameterProfile(work.doc) : null);
  return (
    <>
      <Input
        aria-label="fixture definition id"
        value={profile?.definitions[0]?.id ?? ""}
        onChange={(event) => {
          if (!profile || !work) return;
          owner.view.setPage({
            buffer: {
              revision: page.buffer?.revision ?? work.handle.revision,
              profile: {
                ...profile,
                definitions: profile.definitions.map((definition, index) =>
                  index === 0 ? { ...definition, id: event.target.value } : definition,
                ),
              },
            },
          });
        }}
      />
      {verbs(undefined)}
      <div role="group" aria-label="profile proposal">
        {verbs("profile")}
      </div>
    </>
  );
}
function FixtureEvaluation({ owner }: Body) {
  const captures = owner.readings.get("links").value as
    | ReturnType<typeof familyCaptureSchema.array>["_output"]
    | undefined;
  const reading = captures?.[0]?.reading;
  return (
    <EvaluationView
      evaluation={reading?.kind === "parameter-links" ? (reading.value.evaluation ?? null) : null}
    />
  );
}
async function mounted(search = "") {
  const wrap = vi.fn((_owner, children) => children);
  const adapters: RouteAdapters<ParameterLinksPage, ParameterLinksDocument> = {
    binding: parameterLinksBinding,
    sources: {
      // Full WorkKey is fixture-owned. Production acquisition awaits structured kernel source scope.
      "parameter-links.links": subscriptionSource({
        request: () => ({ kind: "family-readings", work: host.key }),
        decode: (value) => familyCaptureSchema.array().parse(value),
        resources: host.resources,
      }),
      "parameter-links.receipts": subscriptionSource({
        request: () => ({ kind: "receipts", work: host.key }),
        decode: (value) => actionReceiptSchema.array().parse(value),
        resources: host.resources,
      }),
      "parameter-links.options": parameterLinksOptionsSource(host.resources),
    },
    cell: (row, scope) =>
      row === "profile" && scope.work
        ? { type: "cell:profile", id: "profile", path: ["profile"], work: scope.work.handle.key }
        : null,
    verbDepends: { apply: ["links"] },
    bodies: { profile: FixtureProfile, evaluation: FixtureEvaluation },
    wrap,
  };
  const route = routeFromGraph(parameterLinksGraph, adapters, "/parameter-links");
  const router = createRouter({
    routeTree: root.addChildren([route]),
    history: createMemoryHistory({
      initialEntries: [`/parameter-links?target=${host.target.session}${search}`],
    }),
  });
  releases.push(router.history.subscribe(router.load));
  await router.load();
  const Component = route.options.component!;
  const view = render(
    <RouterContextProvider router={router}>
      <Component />
    </RouterContextProvider>,
  );
  await view.findByLabelText("Situation");
  const owner = () => wrap.mock.calls.at(-1)![0] as Body["owner"];
  await waitFor(() => expect(owner().snapshot().work?.handle.revision).toBe(host.revision));
  await waitFor(() => expect(owner().readings.get("links").status).toBe("ready"));
  return { view, router, owner, situation: within(view.getByLabelText("Situation")) };
}
async function readyButton(scope: ReturnType<typeof within>, name: string) {
  return waitFor(() => {
    const button = scope.getByRole("button", { name, exact: true });
    expect(button.getAttribute("aria-disabled")).not.toBe("true");
    return button;
  });
}

test("a CAS race refuses save and keeps the exact local buffer without evaluating it", async () => {
  const { view, owner } = await mounted();
  fireEvent.change(view.getByLabelText("fixture definition id"), {
    target: { value: "local-change" },
  });
  const buffer = structuredClone(owner().view.read().page.buffer);
  host.conflictOnWrite = true;
  fireEvent.click(await readyButton(within(view.container), "save draft"));
  await waitFor(() => expect(owner().results.get("save")?.state).toBe("stale"));
  expect(host.writeRequests[0]?.expectedRevision).toBe(1);
  expect(host.doc.profile.edit?.value.definitions[0]?.id).toBe("supply-flow");
  expect(owner().view.read().page.buffer).toEqual(buffer);
  expect((view.getByLabelText("fixture definition id") as HTMLInputElement).value).toBe(
    "local-change",
  );
  expect(host.writes).toEqual([]);
  await act(async () => {
    await owner().control("preview").run();
  });
  expect(host.reads).toEqual([]);
});

test("a suggestion preview cannot arm Apply even after taking the profile; edit Preview arms its own reading id", async () => {
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
  fireEvent.click(await readyButton(situation, "preview Pea's suggestion"));
  await waitFor(() => expect(owner().results.get("previewProposal")?.state).toBe("done"));
  expect(host.captures[0]?.reading).toMatchObject({
    kind: "parameter-links",
    value: { subject: "suggestion" },
  });
  expect(owner().control("apply").refusal).toContain("suggestion preview");
  await act(async () => {
    await owner().control("apply").run();
  });
  expect(host.actions).toEqual([]);
  const row = view.getByRole("group", { name: "profile proposal" });
  fireEvent.click(await readyButton(within(row), "take"));
  await waitFor(() => expect(host.doc.profile.edit?.value.definitions[0]?.reducer).toBe("max"));
  expect(owner().control("apply").refusal).toContain("suggestion preview");
  fireEvent.click(await readyButton(situation, "preview"));
  await waitFor(() => expect(owner().results.get("preview")?.state).toBe("done"));
  const id = host.captures[0]!.id;
  await waitFor(() => expect(owner().control("apply").refusal).toBeNull());
  await act(async () => {
    await owner().control("apply").run();
  });
  expect(owner().results.get("apply")).toMatchObject({ state: "done", kind: "command" });
  expect(host.actions[0]?.input).toMatchObject({ readingId: id });
  expect(host.reads.map((request) => request.input)).toEqual([
    { evaluate: true, subject: "suggestion" },
    { evaluate: true, subject: "edit" },
  ]);
  expect(
    host.reads.every((request) => JSON.stringify(request.target) === JSON.stringify(host.target)),
  ).toBe(true);
});

test("Apply requires an evaluated reading id and a fresh basis matching the saved profile", async () => {
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
  fireEvent.change(view.getByLabelText("fixture definition id"), {
    target: { value: "changed-after-preview" },
  });
  expect(owner().control("apply").refusal).toContain("unsaved local edits");
  fireEvent.click(await readyButton(within(view.container), "save draft"));
  await waitFor(() => expect(owner().results.get("save")?.state).toBe("done"));
  expect(owner().control("apply").refusal).toContain("Preview this draft");
  expect(host.actions).toEqual([]);
});

test("option demand follows the unsaved profile and preserves exact document and compatibility filters", async () => {
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
  await act(async () => {
    owner().view.setPage({
      buffer: {
        revision: host.revision,
        profile: {
          ...host.profile,
          definitions: host.profile.definitions.map((definition) => ({
            ...definition,
            sourceCategoryId: -2000151,
          })),
        },
      },
    });
  });
  await waitFor(() =>
    expect(host.optionRequests.some((request) => request.context?.CategoryId === "-2000151")).toBe(
      true,
    ),
  );
  expect(host.writes).toEqual([]);
  expect(host.reads).toEqual([]);
  expect(view.getByLabelText("fixture definition id")).toBeTruthy();
});
