import { fixtureTimeline } from "../shell/fixture-work-door";
import { timelineReceipts } from "../../../host/src/reads/work-timeline";
import { refusalOf, valueOf } from "@pe/web-kernel/route/typed-route";
import { elementSubject } from "@pe/ducts-domain/work-subject";
import { host as placesHost, seedPlaces } from "../workbench/places.test-support";
// @vitest-environment jsdom
import { stableFanKey } from "@pe/ducts-web/calc/model";
import { useState, useSyncExternalStore } from "react";
import {
  journey as takeoffJourney,
  Drawing as TakeoffDrawing,
} from "../takeoff/adoption.test.fixture";
import { adoptionData } from "@pe/agent-contracts/takeoff-read";
import { createPortal } from "react-dom";
import {
  act,
  cleanup,
  fireEvent,
  render as renderView,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { StandaloneBand } from "../shell/band.test-support";
import { afterEach, expect, test, vi } from "vite-plus/test";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { route, scrollBody } from "@pe/web-kernel/route/typed-route";
import { module as fans } from "@pe/fans-web/route";
import { module as ducts } from "@pe/duct-systems-web/route";
import { TypedChrome, TypedShell } from "../shell/typed-shell";
import * as mounts from "../shell/typed-mount";
import { planned } from "../shell/typed-mount";
import {
  familiesRouteState,
  address,
  workFingerprintSchema,
  type WorkJournalDoor,
} from "@pe/agent-contracts";
import { ReviewSurface } from "../shell/review-surface";
import { RouteVisibility } from "@pe/web-kernel/route/activity";

import { createWorkFeedClient } from "../shell/work-feed-client";
import type { UseSource } from "@pe/web-kernel/shell/source-contract";
import { KeyScopeHost } from "@pe/kit/keys";
import { module as families } from "../families/route";

import { createPeClient } from "@pe/agent-contracts/pe-api";
import { routeInput } from "./host";
import userEvent from "@testing-library/user-event";
import { createServer } from "node:http";
import { RecordedPoints } from "../shell/history-rail";
import { historySnapshotSchema } from "../shell/history";
import { ref, path } from "../../../host/tests/host-read-graph.test-support";
import { publicationSource } from "../host/publication-source";
import { hostEventSource } from "../host/event-source.test-support";
import { routeRegistry } from "./registry";

const render = (node: import("react").ReactNode) => renderView(node, { wrapper: StandaloneBand });

test("JZ Families History offers published values and marks ambiguous publications Unavailable", async () => {
  const browserHref = window.location.href;
  window.history.replaceState({}, "", "/families");
  const j = await takeoffJourney({ route: "families" });
  const fetchHttp = globalThis.fetch;
  const server = createServer(async (req, res) => {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const response = await j.host.request(
        new Request(`http://host${req.url}`, {
          method: req.method,
          headers: req.headers as Record<string, string>,
          ...(chunks.length ? { body: Buffer.concat(chunks) } : {}),
        }),
      );
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      res.writeHead(500);
      res.end(String(error));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const request = (url: string, init?: RequestInit) => fetchHttp(new URL(url, base), init);
  vi.stubGlobal("fetch", request);
  const pose = {
    instance: "families:history-journey",
    route: "families",
    page: {},
    href: "/families",
  };
  const publish = async (subscription: string) => {
    j.host.holdPublication(subscription);
    const response = await request("/pe/reads/value", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-pe-history-page": encodeURIComponent(JSON.stringify(pose)),
      },
      body: JSON.stringify({
        read: "families.view",
        args: { target: ref, readId: "" },
        subscription,
        generation: 1,
      }),
    });
    expect(response.status, await response.clone().text()).toBe(200);
    return response.json();
  };
  const mountsToClose: mounts.TypedMount[] = [];
  const { Stream, streams, fetch: streamFetch } = hostEventSource(j.host.request);
  vi.stubGlobal("fetch", streamFetch);
  vi.stubGlobal("EventSource", Stream);
  const workListeners = new Set<(state: any) => void>();
  const refreshWork = async () => {
    const response = await createPeClient(base, request).response("work.get", {
      params: { route: "families" },
      query: { target: path },
    });
    expect(response.status, await response.clone().text()).toBe(200);
    const state = await response.json();
    for (const deliver of workListeners)
      deliver({
        kind: "ready",
        snapshot: { handle: state.handle, revision: state.revision, value: state.doc },
        history: { acks: [], from: state.revision + 1 },
      });
  };
  const writeScope = async () => {
    const state = await j.host.workspace.viewUncaptured(j.key, "families");
    const doc = familiesRouteState.schema.parse(state!.doc);
    const categoryNames = doc.scope.edit?.value.categoryNames.length ? [] : ["Air Terminal Tags"];
    const response = await createPeClient(base, request).response("work.apply", {
      params: { route: "families" },
      query: { target: path },
      body: {
        kind: "apply",
        press: crypto.randomUUID(),
        expectedRevision: state!.revision,
        patches: [
          {
            path: ["scope", "edit"],
            value: { value: { categoryNames, familyNames: [], placementScope: "AllLoaded" } },
          },
        ],
      },
    });
    const result = await response.json();
    expect(result, JSON.stringify(result)).toMatchObject({ ok: true });
    await refreshWork();
    return categoryNames;
  };
  try {
    await j.ready();
    const address = { read: () => new URLSearchParams(), write() {}, subscribe: () => () => {} };
    const lifecyclePose = { ...pose, instance: "families:hide-show" };
    const requests: { subscription: string; generation: number; release: boolean }[] = [];
    const source = publicationSource({
      async read(ctx, publication, release) {
        const response = await request("/pe/reads/value", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-pe-history-page": encodeURIComponent(JSON.stringify(ctx.historyPose)),
          },
          body: JSON.stringify({
            read: "families.view",
            args: { target: ref, ...(ctx.args as object) },
            ...publication,
            release,
          }),
        });
        expect(response.status, await response.clone().text()).toBe(200);
        requests.push({ ...publication, release });
        return response.json();
      },
    });
    const feed = createWorkFeedClient(
      { subscribe: () => () => {}, dirty() {} },
      {
        write: (key, write) =>
          j.host.workspace.write(key, key.route, "human", write, async () => []),
        submit() {
          throw Error("This lifecycle journey writes through HTTP");
        },
      },
    );
    // Work observations come from HTTP inspection; publication invalidations use host SSE above.
    const work: WorkJournalDoor = {
      ...feed,
      open: () => ({
        subscribe(deliver) {
          workListeners.add(deliver);
          void refreshWork();
          return () => {
            workListeners.delete(deliver);
          };
        },
      }),
    };
    const live = mounts.mountTypedRoute(
      families,
      {
        address,
        fixture: null,
        publicationInstance: lifecyclePose.instance,
        target: { kind: "document", ref },
        work: { address: path, open: ref },
        custody: { current: () => true },
        memory: () => ({}),
      },
      routeRegistry.families!.fingerprint,
      { work, sources: { "families.view": source } },
    );
    mountsToClose.push(live);
    const firstStop = live.subscribe(() => {});
    await waitFor(() => expect(live.value().state === "ready").toBe(true));
    const earlier = await j.host.history("", { kind: "captured", document: path });
    const originalBinding = earlier.history.publications.find(
      (b: any) => b.instance === lifecyclePose.instance,
    );
    await waitFor(() => expect(streams.size).toBeGreaterThan(0));
    firstStop();
    live.release();
    await waitFor(() => expect(requests.filter((r) => r.release)).toHaveLength(1));
    live.subscribe(() => {});
    await waitFor(() => expect(live.value().state === "ready").toBe(true));
    await waitFor(() =>
      expect(new Set(requests.filter((r) => !r.release).map((r) => r.subscription)).size).toBe(2),
    );
    await writeScope();
    // A point records what the host has published, including a Value awaiting refresh after a write.
    // No Revit: the write receipt boundary asks History to snapshot the open subscriptions.
    j.host.reads.history!.afterWrite(ref, "lifecycle-write");
    const afterShow = await j.host.history(`?document=${encodeURIComponent(path)}`);
    const reopened = afterShow.points.find((p: any) => p.reason.receipt === "lifecycle-write");
    const bindings = reopened.history.publications.filter(
      (b: any) => b.instance === lifecyclePose.instance,
    );
    expect(
      bindings,
      "hide/show must retire the first subscription before a later point",
    ).toHaveLength(1);
    expect(bindings[0].subscription).not.toBe(originalBinding.subscription);
    expect(
      afterShow.unavailable.some(
        (item: any) => item.point === reopened.id && item.instance === lifecyclePose.instance,
      ),
    ).toBe(false);
    const old = await j.host.history(`?at=${earlier.id}`);
    expect(
      old.point.history.publications.find((b: any) => b.instance === lifecyclePose.instance),
    ).toEqual(originalBinding);
    live.release();
    await waitFor(() => expect(requests.filter((r) => r.release)).toHaveLength(2));
    const first = await publish("first");
    const good = await j.host.history("", { kind: "captured", document: path });
    await writeScope();
    const second = await publish("second");
    expect(second.version).not.toBe(first.version);
    // No Revit: inject the native completion notification at the host's receipt boundary.
    j.host.reads.history!.afterWrite(ref, "history-journey-write");
    const listed = await j.host.history(`?document=${encodeURIComponent(path)}`);
    const bad = listed.points.find(
      (point: any) => point.reason.receipt === "history-journey-write",
    );
    expect(bad).toBeTruthy();
    expect(
      bad.history.publications.filter((binding: any) => binding.instance === pose.instance),
    ).toHaveLength(2);
    render(<RecordedPoints document={path} route="families" address={address} compare={false} />);
    const badRow = await waitFor(() => {
      const link = document.querySelector(`[data-point="${bad.id}:${pose.instance}"]`);
      expect(link).not.toBeNull();
      return link!;
    });
    expect(badRow.getAttribute("href")).toBeNull();
    expect(badRow.getAttribute("aria-disabled")).toBe("true");
    expect(badRow.closest("[data-key]")!.textContent).toContain(
      "Unavailable: Ambiguous pane at this point",
    );
    // Every enabled menu entry is opened through the host's HTTP replay door and typed mount.
    const available = listed.points.flatMap((point: any) =>
      point.history.poses
        .filter(
          (pose: any) =>
            pose.route === "families" &&
            !listed.unavailable.some(
              (item: any) => item.point === point.id && item.instance === pose.instance,
            ),
        )
        .map((pose: any) => ({ point, pose })),
    );
    expect(available.map(({ point }: any) => point.id)).toContain(good.id);
    for (const { point, pose: recordedPose } of available) {
      cleanup();
      render(<RecordedPoints document={path} route="families" address={address} compare={false} />);
      const option = await waitFor(() => {
        const link = document.querySelector<HTMLAnchorElement>(
          `[data-point="${point.id}:${recordedPose.instance}"]`,
        );
        expect(link?.getAttribute("href")).toBeTruthy();
        return link!;
      });
      const picked = option.getAttribute("href")!;
      expect(new URL(picked, base).searchParams.get("atInstance")).toBe(recordedPose.instance);
      cleanup();
      const opened = await request(
        `/pe/history?at=${new URL(picked, base).searchParams.get("at")}`,
      );
      const history = historySnapshotSchema.parse(await opened.json());
      const source: UseSource = {
        kind: "use",
        open(ctx, deliver) {
          void request("/pe/reads/value", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-pe-history-point": history.point.id,
              "x-pe-history-page": encodeURIComponent(JSON.stringify(recordedPose)),
            },
            body: JSON.stringify({
              read: "families.view",
              args: { target: ref, ...(ctx.args as object) },
              subscription: "replay",
              generation: 1,
            }),
          }).then(async (response) => {
            expect(response.status, await response.clone().text()).toBe(200);
            deliver({ kind: "complete", value: await response.json(), revision: 1 });
          });
          return () => {};
        },
      };
      const mounted = mounts.mountTypedRoute(
        families,
        {
          address,
          fixture: null,
          history,
          publicationInstance: recordedPose.instance,
          readOnly: true,
          target: { kind: "document", ref },
          work: { address: path, open: ref },
          custody: { current: () => true },
          memory: () => recordedPose.page,
        },
        workFingerprintSchema.parse(`builtin-closure:${"a".repeat(64)}`),
        { sources: { "families.view": source } },
      );
      mountsToClose.push(mounted);
      function Recorded() {
        useSyncExternalStore(mounted.subscribe, mounted.revision, mounted.revision);
        return <TypedChrome mount={mounted} document={<span>Recorded Families</span>} />;
      }
      const router = createRouter({
        routeTree: createRootRoute({ component: Recorded }),
        history: createMemoryHistory({ initialEntries: [picked] }),
      });
      render(<RouterProvider router={router} />);
      expect(await screen.findByRole("option", { name: "Air Terminal Tags" })).toBeTruthy();
      const binding = point.history.publications.find(
        (b: any) => b.instance === recordedPose.instance && b.read === "families.view",
      );
      expect(mounted.value().publication!.evaluation).toBe(binding.evaluation);
      if (recordedPose.instance === pose.instance)
        expect(valueOf(mounted.value())).toEqual(first.value.data);
    }
  } finally {
    cleanup();
    for (const mounted of mountsToClose) mounted.dispose();
    for (const stream of streams) stream.close();
    vi.unstubAllGlobals();
    window.history.replaceState({}, "", browserHref);
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await j.close();
  }
}, 60000);

test("JZ numeric cells refuse bounds and fractional integers without changing Work, then commit exactly", async () => {
  const { TakeoffEditCell } = await import("../takeoff/proposals");
  const { NumberCell } = await import("@pe/kit/table/cells");
  const f = await createWitness(closes);
  // Velocity limit supply is /ducts design data (ruling 2026-11-10): its sheet draws on the /ducts mount.
  const ducts = f.owner.native;
  await waitFor(() => expect(ducts.work()).not.toBeNull());
  function Journey() {
    useSyncExternalStore(ducts.subscribe, ducts.revision, ducts.revision);
    const [people, setPeople] = useState(3);
    const [bounded, setBounded] = useState(1);
    return (
      <>
        {f.owner.read("design") as import("react").ReactNode}
        <section aria-label="Takeoff occupants">
          <TakeoffEditCell
            roomId="numeric-entry-room"
            field="people"
            value={people}
            digits={0}
            integer
            cell={undefined}
            wire={{
              segment: "edits",
              revision: null,
              write: async () => {
                throw Error("No transition requested");
              },
            }}
            onPatch={setPeople}
          />
          <output aria-label="Committed occupants">{people}</output>
        </section>
        <section aria-label="Bounded number">
          <NumberCell value={bounded} max={10} onCommit={setBounded} />
          <output aria-label="Committed bounded value">{bounded}</output>
        </section>
      </>
    );
  }
  const router = createRouter({
    routeTree: createRootRoute({ component: Journey }),
    history: createMemoryHistory({ initialEntries: ["/duct-systems"] }),
  });
  const user = userEvent.setup();
  render(<RouterProvider router={router} />);
  const friction = await screen.findByRole("textbox", { name: "Velocity limit supply" });
  const before = structuredClone(f.saved.get("duct-systems"));
  const revision = ducts.work()!.revision;
  await user.click(friction);
  await user.keyboard("{Control>}a{/Control}-0.1{Enter}");
  await waitFor(() =>
    expect(friction.closest(".dl-cell")?.getAttribute("aria-busy")).not.toBe("true"),
  );
  expect.soft(f.saved.get("duct-systems")).toEqual(before);
  expect.soft(ducts.work()!.revision).toBe(revision);
  expect.soft(friction.closest("[data-sheet-cell]")?.textContent).toContain("at least 0");
  await user.click(screen.getByRole("textbox", { name: "Velocity limit supply" }));
  await user.keyboard("{Control>}a{/Control}0.123456789{Enter}");
  await waitFor(() => expect(ducts.owner()?.doc.criteria?.velocitySupplyFpm?.edit).toBeDefined());
  expect.soft(ducts.owner()?.doc.criteria?.velocitySupplyFpm?.edit?.value).toBe(0.123456789);
  expect
    .soft(
      (
        f.saved.get("duct-systems") as {
          doc: { criteria?: { velocitySupplyFpm?: { edit?: { value: number } } } };
        }
      ).doc.criteria?.velocitySupplyFpm?.edit?.value,
    )
    .toBe(0.123456789);
  const occupants = within(screen.getByRole("region", { name: "Takeoff occupants" }));
  await user.click(occupants.getByRole("textbox"));
  await user.keyboard("{Control>}a{/Control}2.7{Enter}");
  expect.soft(occupants.getByLabelText("Committed occupants").textContent).toBe("3");
  expect.soft(occupants.queryByText(/whole number/)).not.toBeNull();
  await user.click(occupants.getByRole("textbox"));
  await user.keyboard("{Control>}a{/Control}7{Enter}");
  expect.soft(occupants.getByLabelText("Committed occupants").textContent).toBe("7");
  const bounded = within(screen.getByRole("region", { name: "Bounded number" }));
  await user.click(bounded.getByRole("textbox"));
  await user.keyboard("{Control>}a{/Control}11{Enter}");
  expect.soft(bounded.getByLabelText("Committed bounded value").textContent).toBe("1");
  expect.soft(bounded.queryByText(/at most 10/)).not.toBeNull();
  await user.click(bounded.getByRole("textbox"));
  await user.keyboard("{Control>}a{/Control}0.987654321{Enter}");
  expect.soft(bounded.getByLabelText("Committed bounded value").textContent).toBe("0.987654321");
});

test("JZ DuctLoss numeric drafts refuse negatives without changing the URL and recover by keyboard", async () => {
  const { module: ductLoss } = await import("../duct-loss/route");
  const { InputsBody } = await import("../duct-loss/route.tsx");
  const { solve } = await import("@pe/ducts-domain/duct-loss-math");
  let search = new URLSearchParams({ cfm: "0", length: "100" });
  const mount = mounts.mountTypedRoute(
    ductLoss,
    {
      address: {
        read: () => new URLSearchParams(search),
        write: (next) => {
          search = new URLSearchParams(next);
        },
        subscribe: () => () => {},
      },
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
      // Only the host reading is a fixture; the page, address codec and input events are production.
      sources: {
        "duct-loss.result": {
          kind: "use",
          open(_ctx, deliver) {
            deliver({
              kind: "complete",
              value: {
                key: "numeric-entry",
                generation: 1,
                version: 1,
                state: "current",
                value: {
                  data: {
                    result: solve({
                      shape: "round",
                      a: 12,
                      b: 8,
                      cfm: 0,
                      length: 100,
                      roughness: 0.0003,
                      density: 0.075,
                    }),
                    error: null,
                  },
                  evaluation: "numeric-entry",
                  inputs: "numeric-entry",
                  coverage: { requested: [], covered: [], unknown: [], refused: [] },
                  origin: { kind: "fixture" },
                  works: [],
                  trace: [],
                  freshness: "current",
                },
              },
              revision: 1,
            });
            return () => {};
          },
        },
      },
    },
  );
  function Journey() {
    useSyncExternalStore(mount.subscribe, mount.revision, mount.revision);
    return mount.draw("inputs", (ctx) => (
      <InputsBody ctx={ctx as never} />
    )) as import("react").ReactNode;
  }
  const user = userEvent.setup();
  try {
    render(<Journey />);
    const airflow = screen.getByLabelText(/airflow/) as HTMLInputElement;
    for (const [input, key, prior] of [
      [airflow, "cfm", "0"],
      [screen.getByLabelText(/length/), "length", "100"],
    ] as const) {
      await user.click(input);
      await user.keyboard("{Control>}a{/Control}-");
      expect.soft((input as HTMLInputElement).value).toBe("-");
      expect.soft(search.get(key)).toBe(prior);
      await user.keyboard("1{Enter}");
      expect.soft(search.get(key)).toBe(prior);
      expect.soft(screen.queryByRole("alert")?.textContent).toContain("at least 0");
      expect.soft((input as HTMLInputElement).value).toBe("-1");
      expect.soft(input.getAttribute("aria-invalid")).toBe("true");
      await user.keyboard("{Control>}a{/Control}-{Backspace}5{Enter}");
      expect.soft((input as HTMLInputElement).value).toBe("5");
      expect.soft(search.get(key)).toBe("5");
    }
    await user.click(airflow);
    await user.keyboard("{Control>}a{/Control}01");
    expect(airflow.value).toBe("01");
    await user.tab();
    expect(airflow.value).toBe("1");
    expect(search.get("cfm")).toBe("1");
    for (const draft of ["", ".", "1."]) {
      await user.click(airflow);
      await user.keyboard("{Control>}a{/Control}{Backspace}");
      if (draft) await user.keyboard(draft);
      expect(airflow.value).toBe(draft);
      expect(search.get("cfm")).toBe("1");
      await user.keyboard("{Enter}");
      if (draft !== "1.") expect(screen.getByRole("alert").textContent).toContain("Enter a number");
    }
    await user.click(airflow);
    await user.keyboard("{Control>}a{/Control}0{Enter}");
    expect(search.get("cfm")).toBe("0");
    const diameter = screen.getByLabelText(/^diameter/, { selector: "input" }) as HTMLInputElement;
    await user.click(diameter);
    await user.keyboard("{Control>}a{/Control}0{Enter}");
    expect(screen.getByRole("alert").textContent).toContain("greater than 0");
    expect(mount.page.read().a).toBe(12);
  } finally {
    cleanup();
    mount.dispose();
  }
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

test("JZ Fans undo after apply: public write journey leaves an honest toolbar refusal", async () => {
  const { nativeFixture } = await import("../../../host/tests/fans/fans-work-fixture.ts");
  const { closedFan, recordedTables } = await import("@pe/fans-host/tests/closed-fan.fixture");
  const { observeResources } = await import("@pe/runtime");
  const { TimelineButtons } = await import("../shell/situation-band");
  const { withInvocationContext } = await import("@pe/runtime/context");
  const { peRouteUrl } = await import("@pe/agent-contracts/pe-api");
  // The write is minted only from a complete claim, so the journey's fan is the closed fixture fan (unit 100, terminal 3).
  const closed = closedFan(100),
    tables = recordedTables();
  const f = await nativeFixture(
    "real",
    (_key, input) => closedFan(100, { requiredEsp: input.slots?.requiredEsp }),
    null,
    { native: (key) => (key === "ducts.tables" ? tables : undefined) },
  );
  const human = { kind: "human" as const, via: "local" as const };
  const stage = async (route: string, patches: unknown[], label: string) => {
    const response = await withInvocationContext({ caller: human }, () =>
      f.api.fetch(
        new Request(
          peRouteUrl("work.apply", routeInput(route, { ...f.key, route }), "http://fixture"),
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              kind: "apply",
              expectedRevision: 0,
              press: crypto.randomUUID(),
              label,
              patches,
            }),
          },
        ),
      ),
    );
    expect(response.status, await response.clone().text()).toBe(200);
    const body = await response.json();
    expect(body.ok, JSON.stringify(body)).toBe(true);
    return body;
  };
  const read = observeResources(f.saved, undefined, f.observeHostResource);
  const connected = createWorkFeedClient(
    { subscribe: read, dirty() {} },
    {
      write: (key, write) => f.saved.write(key, key.route, "human", write, async () => []),
      submit: async (command) => {
        const response = await f.post("/actions", command);
        expect(response.ok, await response.clone().text()).toBe(true);
        return f.journal.wait(command.id);
      },
    },
  );
  const work: WorkJournalDoor = {
    ...connected,
    open: (scope) => ({
      subscribe(deliver) {
        return f.saved.observeFeed(
          scope.key,
          (state: any) =>
            deliver(
              state
                ? {
                    kind: "ready",
                    history: state.history,
                    snapshot: { handle: state.handle, revision: state.revision, value: state.doc },
                  }
                : { kind: "absent" },
            ),
          (ack) => deliver({ kind: "ack", ack }),
          (error) => {
            throw error;
          },
        );
      },
    }),
  };
  const mount = mounts.mountTypedRoute(
    fans,
    {
      target: f.target,
      fixture: null,
      work: { address: null, open: f.target.ref },
      address: { read: () => new URLSearchParams(), write() {}, subscribe: () => () => {} },
      custody: { current: () => true },
      memory: () => ({}),
    },
    routeRegistry.fans!.fingerprint,
    {
      work,
      timeline: fixtureTimeline(
        f.saved,
        () => timelineReceipts(f.journal),
        (changed) => f.journal.subscribe({ kinds: ["action"] }, changed),
      ),
      sources: {
        "fans.calc": {
          kind: "use",
          async open(ctx, deliver) {
            const packet = await fans.spec.core?.source.provide?.("scene", ctx.args);
            if (!packet) throw Error("Missing current Fans fixture");
            deliver({ kind: "complete", revision: 1, value: packet });
            return () => {};
          },
        },
      },
    },
  );
  const view = render(<TimelineButtons owner={mount} />);
  try {
    const staged = await stage(
      "fans",
      [
        {
          path: ["writeIntent", "edit"],
          value: { value: { walk: { unitId: 100, portIndex: 0 } } },
        },
        {
          path: ["flows", elementSubject(closed.nodes.find((node) => node.id === 3)!), "edit"],
          value: { value: 250 },
        },
      ],
      "Edit fan airflow",
    );
    await screen.findByRole("button", { name: "Undo Edit fan airflow" });
    const command = async (id: string, commandKey: string) => {
      const response = await f.post("/actions", {
        id,
        key: commandKey,
        target: f.target,
        input: { work: { key: { ...f.key, route: "fans" }, revision: staged.revision } },
      });
      expect(response.ok, await response.clone().text()).toBe(true);
      const receipt = await f.journal.wait(id);
      expect(receipt, JSON.stringify(receipt)).toMatchObject({ state: "succeeded" });
    };
    await command("undo-plan", "sheet.plan");
    await command("undo-apply", "sheet.apply");
    expect(f.native.get(3)).toBe(250);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Undo" }).getAttribute("aria-disabled")).toBe(
        "true",
      ),
    );
    const undo = screen.getByRole("button", { name: "Undo" });
    fireEvent(window, Object.assign(new Event("pointermove"), { movementX: 1 }));
    await userEvent.setup().hover(undo);
    await screen.findByText(/Cannot undo.*undo-apply.*already consumed/);
    fireEvent.click(undo);
    expect(f.native.get(3)).toBe(250);
    expect(screen.getByRole("button", { name: "Redo" }).getAttribute("aria-disabled")).toBe("true");
  } finally {
    view.unmount();
    mount.dispose();
    await f.close();
  }
}, 30_000);
import { createFixtureWorkDoor } from "../shell/fixture-work-door";

test("JM H17 browse an optional host route without a pin, then refuse malformed document pins", async () => {
  const module = route({
    ...families.spec,
    needs: "host",
    optionalTarget: "document",
    edits: undefined,
    core: undefined,
    subject: undefined,
    goal: undefined,
    query: undefined,
    fields: {},
    picture: undefined,
    title: undefined,
    verbs: {},
    band: [],
    reads: {},
    panes: {
      main: {
        title: "Optional document",
        purpose: "Inspect exact target authority",
        body: "scroll",
        draw: (ctx) =>
          scrollBody(
            <p role="status">
              {ctx.target?.kind === "host" ? "Host browsing" : "Pinned document"}
            </p>,
          ),
      },
    },
    layout: { kind: "pane", id: "main" },
  });
  const stamp = workFingerprintSchema.parse(`builtin-closure:${"a".repeat(64)}`);
  let search = new URLSearchParams();
  const listeners = new Set<() => void>();
  const address = {
    read: () => new URLSearchParams(search),
    write(next: URLSearchParams) {
      search = next;
      listeners.forEach((f) => f());
    },
    subscribe(f: () => void) {
      listeners.add(f);
      return () => {
        listeners.delete(f);
      };
    },
  };
  const root = createRootRoute({
    component: () => <TypedShell module={module} fingerprint={stamp} address={address} />,
  });
  const router = createRouter({
    routeTree: root,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  render(<RouterProvider router={router} />);
  await screen.findByText("Host browsing");
  address.write(new URLSearchParams({ target: "not JSON" }));
  await waitFor(() =>
    expect(
      screen.queryByText("Host browsing"),
      "H17: a bad pin never falls back to host authority",
    ).toBeNull(),
  );
  expect(
    screen.queryByText("Pinned document"),
    "H17: unresolved pin grants no document authority",
  ).toBeNull();
});

test("JZ B04 read a long review, dismiss with Escape and return to its opener", async () => {
  function Journey() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button onClick={() => setOpen(true)}>Review airflows</button>
        {open && (
          <ReviewSurface
            label="Update airflows"
            sentence="Change Supply"
            rows={Array.from({ length: 200 }, (_, i) => `Change ${i}`)}
            enabled
            confirm={() => {
              throw Error("Escape must not commit");
            }}
            cancel={() => setOpen(false)}
          />
        )}
      </>
    );
  }
  const view = render(<Journey />);
  const opener = screen.getByRole("button", { name: "Review airflows" });
  opener.focus();
  fireEvent.click(opener);
  const commit = await screen.findByRole("button", { name: "Commit Update airflows" });
  expect(view.container.contains(commit), "B04: review is portalled").toBe(false);
  const footer = commit.closest(".shrink-0");
  expect(footer, "Commit stays outside the scrollable change list").not.toBeNull();
  expect(footer!.previousElementSibling?.className).toContain("overflow-y-auto");
  expect(commit.textContent).toContain("Commit Update airflows");
  expect(screen.getByText("Change 199"), "B04: final change is present").toBeTruthy();
  commit.focus();
  expect(document.activeElement).toBe(commit);
  fireEvent.keyDown(commit, { key: "Escape", code: "Escape" });
  await waitFor(() =>
    expect(screen.queryByRole("button", { name: "Commit Update airflows" })).toBeNull(),
  );
  await waitFor(() =>
    expect(document.activeElement, "B04: dismissal restores prior focus").toBe(opener),
  );
  // Scroll reach and footer visibility require Driver layout evidence; jsdom cannot establish either.
});

test("JZ B02 undo follows focus between typed routes, portal and hidden pane; text keeps native undo", async () => {
  const live = mounts.mountTypedRoute;
  const owners: mounts.TypedMount[] = [];
  vi.spyOn(mounts, "mountTypedRoute").mockImplementation((...args) => {
    const owner = live(...args);
    owners.push(owner);
    return owner;
  });
  const make = (key: string) =>
    route({
      ...fans.spec,
      key,
      name: key,
      needs: "browser",
      core: undefined,
      subject: undefined,
      goal: undefined,
      query: undefined,
      reads: {},
      edits: undefined,
      verbs: {},
      band: [],
      fields: {},
      picture: undefined,
      title: undefined,
      panes: {
        main: {
          title: key,
          purpose: "Focus ownership",
          body: "scroll",
          draw: () =>
            scrollBody(
              <>
                <button>{key} focus</button>
                <textarea aria-label={`${key} text`} />
                {createPortal(<button>{key} portal</button>, document.body)}
              </>,
            ),
        },
      },
      layout: { kind: "pane", id: "main" },
    });
  const a = make("jz-a"),
    b = make("jz-b");
  const stamp = workFingerprintSchema.parse(`builtin-closure:${"a".repeat(64)}`);
  const address = () => ({
    read: () => new URLSearchParams(),
    write: () => {},
    subscribe: () => () => {},
  });
  const addressA = address(),
    addressB = address();
  function Journey() {
    const [hidden, setHidden] = useState(false);
    return (
      <>
        <button onClick={() => setHidden(true)}>Hide B</button>
        <TypedShell module={a} fingerprint={stamp} address={addressA} />
        <RouteVisibility.Provider value={!hidden}>
          <div hidden={hidden}>
            <TypedShell module={b} fingerprint={stamp} address={addressB} />
          </div>
        </RouteVisibility.Provider>
      </>
    );
  }
  const root = createRootRoute({ component: Journey });
  const router = createRouter({
    routeTree: root,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  render(<RouterProvider router={router} />);
  await screen.findByRole("button", { name: "jz-b focus" });
  expect(owners).toHaveLength(2);
  const undo = owners.map((owner) => vi.spyOn(owner, "stepTimeline"));
  const press = (node: HTMLElement) => {
    node.focus();
    const native = fireEvent.keyDown(node, { key: "z", code: "KeyZ", ctrlKey: true });
    fireEvent.keyUp(node, { key: "z", code: "KeyZ", ctrlKey: true });
    return native;
  };
  press(screen.getByRole("textbox", { name: "jz-a text" }));
  expect(
    undo.map((spy) => spy.mock.calls.length),
    "B02: browser retains text undo",
  ).toEqual([0, 0]);
  press(screen.getByRole("button", { name: "jz-a focus" }));
  expect(
    undo.map((spy) => spy.mock.calls.length),
    "B02: only the focused route receives undo",
  ).toEqual([1, 0]);
  press(screen.getByRole("button", { name: "jz-b portal" }));
  expect(
    undo.map((spy) => spy.mock.calls.length),
    "B02: portal belongs to B",
  ).toEqual([1, 1]);
  fireEvent.click(screen.getByRole("button", { name: "Hide B" }));
  press(screen.getByRole("button", { name: "jz-a focus" }));
  expect(
    undo.map((spy) => spy.mock.calls.length),
    "B02: hidden B cannot steal undo",
  ).toEqual([2, 1]);
});

import type { DuctSnapshot } from "@pe/ducts-domain/types";
import { inputsFor } from "@pe/ducts-domain/test-inputs";
import { SheetPane } from "./slots/sheet/pane.tsx";
import { fansCalc } from "@pe/fans-web/calc";

// Plan reviews seal model inputs, never browser pane visibility or Page pose.
import { useEffect, useReducer } from "react";
import rawMuas from "@pe/fans-domain/calc/fixtures/muas-local-20261102.json";
import { VOCABULARY } from "@pe/ducts-domain/calc/scoped-snapshot";
// The saved capture predates the required `vocabulary` and the P2-B coverage field `walk.unreadPeers`.
const realMuas = { ...rawMuas, vocabulary: VOCABULARY, walk: { ...rawMuas.walk, unreadPeers: [] } };
import { createWitness } from "../../../../tests/e2e/fans-witness.test-support.ts";
import type { ReceiptFeedState } from "../../../../packages/agent-contracts/src/work-journal-door";
import { TypedWrite } from "../shell/typed-shell";
import type { ReadingDelivery } from "@pe/web-kernel/shell/source-contract";
const native = vi.hoisted(() => ({ submit: vi.fn(), retained: [] as unknown[] }));
vi.mock("../../../../packages/mcps/src/shared/takeoff-action-client", async (actual) => ({
  ...(await actual<object>()),
  submitAction: native.submit,
}));

const closes: (() => void)[] = [];
afterEach(() => {
  cleanup();
  closes
    .splice(0)
    .reverse()
    .forEach((close) => close());
});

// CB4-F01: replay the recorded MUAS walk through Work, Plan and the shared review DOM.
// Native responses use the new DTO; they certify presentation, not a Revit read.
test("JZ Fans native before: stage, Plan, inspect method and unset pressure; unreadable holds Apply", async () => {
  for (const unreadable of [false, true]) {
    const capture = structuredClone(realMuas);
    let deliverRead: ReadingDelivery | undefined;
    native.submit.mockImplementation(async () => {
      const input = f.inputs.get("fans:sheet.plan") as { work: unknown };
      return {
        id: "native-before-plan",
        state: "succeeded",
        result: {
          previewOnly: true,
          derivedRequest: {
            components: [{ id: 14607308, inWg: 0.03980584344921083, source: "damper CD9-1" }],
            equipmentFlows: [{ id: 14577391, cfm: 1000, source: "Work" }],
          },
          takenAt: "2026-11-07T19:06:18.171Z",
          seal: {
            caller: { kind: "human", via: "local" },
            requestHash: "sealed",
            work: { handle: input.work },
            documentMark: {
              session: "fixture",
              openId: "fans",
              observedSince: null,
              changedAt: null,
            },
            incarnation: {},
            dependencies: "exact",
          },
          value: {
            previewOnly: true,
            writes: [
              {
                id: 14607308,
                kind: "component",
                outcome: unreadable ? "refused" : "planned",
                elementLabel: 'Mechanical Damper 10"',
                uniqueId: "cd545b04-afd3-4993-836f-9b3d8116003a-00dee3cc",
                parameter: "Specific Loss",
                scope: "instance",
                before: unreadable ? null : "unset",
                after: unreadable ? null : "0.0398 in-wg",
                reason: unreadable ? "Revit refused the read: element is inaccessible" : null,
                changes: unreadable
                  ? null
                  : [
                      { parameter: "Loss Method", before: "ashrae-table", after: "specific-loss" },
                      { parameter: "Specific Loss", before: "unset", after: "0.0398 in-wg" },
                    ],
                reportedPressureDropInWg: unreadable ? null : 0.025,
              },
              {
                id: 14577391,
                kind: "equipment-flow",
                outcome: "planned",
                elementLabel: "MUAS-1",
                uniqueId: "78fb66ed-41aa-47c4-907e-6ccf601ad7b3-00de62f1",
                parameter: "PE_M_Fan_AirFlowDesign",
                scope: "instance",
                before: "880 cfm",
                after: "1000 cfm",
              },
            ],
            counts: {
              planned: unreadable ? 1 : 2,
              refused: unreadable ? 1 : 0,
              written: 0,
              unchanged: 0,
            },
            storeRevision: 0,
            systemsAfter: null,
          },
        },
      };
    });
    const f = await createWitness(closes, new Map(), {
      "fans.calc-detail-snapshot": {
        kind: "use",
        open(_ctx, deliver) {
          deliverRead = deliver;
          deliver({ kind: "complete", value: capture, revision: 1 });
        },
      },
    });
    await vi.waitFor(() => expect(f.fans.work()).not.toBeNull());
    await f.ws.apply(
      f.fans.workBasis()!.token.scope.identity.work!,
      "fans",
      "human",
      [
        {
          path: ["writeIntent"],
          value: { edit: { value: { walk: { unitId: 14577391, portIndex: 2 } } } },
        },
        {
          path: [
            "equipmentFlows",
            elementSubject(realMuas.nodes.find((node) => node.id === 14577391)!),
            "edit",
          ],
          value: { value: 1000 },
        },
      ],
      f.fans.work()!.revision,
    );
    await vi.waitFor(() =>
      expect(
        f.fans.work()!.value.equipmentFlows[
          elementSubject(realMuas.nodes.find((node) => node.id === 14577391)!)
        ]?.edit?.value,
      ).toBe(1000),
    );
    f.fans.refresh("value");
    for (const id of ["value"])
      await vi.waitFor(() =>
        expect(f.fans.readingStatus(id).snapshot).toMatchObject({ state: "ready" }),
      );
    function WriteReview() {
      const [, changed] = useReducer((n) => n + 1, 0);
      useEffect(() => f.fans.subscribe(changed), []);
      return <TypedWrite mount={f.typed} id="losses" />;
    }
    render(<WriteReview />);
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "plan Write to Revit" })),
    );
    await waitFor(() => expect(f.fans.review("losses")?.cells?.length).toBeGreaterThan(0));
    const reviewTrigger = screen.getByRole("button", { name: /Write to Revit.*planned/ });
    if (reviewTrigger.getAttribute("aria-expanded") !== "true")
      await act(async () => fireEvent.click(reviewTrigger));
    const rows = [...document.querySelectorAll("[data-write-cell]")].map((row) => row.textContent!);
    if (unreadable) {
      expect
        .soft(
          rows.some(
            (row) =>
              row.includes('Mechanical Damper 10"') &&
              row.includes("14607308") &&
              row.includes("Specific Loss") &&
              row.includes("element is inaccessible"),
          ),
        )
        .toBe(true);
      expect
        .soft(
          screen.queryByRole("button", { name: "Write to Revit" }),
          "unreadable native target holds the entire intent",
        )
        .toBeNull();
    } else {
      for (const words of [
        ['Mechanical Damper 10"', "14607308", "Loss Method", "ASHRAE table", "Specific Loss"],
        [
          'Mechanical Damper 10"',
          "14607308",
          "Specific Loss",
          "unset",
          "0.0398 in-wg",
          "reported effective pressure",
          "0.025 in-wg",
        ],
        ["MUAS-1", "14577391", "PE_M_Fan_AirFlowDesign", "instance", "880 cfm", "1000 cfm"],
      ])
        expect
          .soft(
            rows.some((row) => words.every((word) => row.includes(word))),
            words.join(" / "),
          )
          .toBe(true);
      expect.soft(rows).toHaveLength(3);
      expect
        .soft(screen.getByRole("button", { name: "Write to Revit" }).hasAttribute("disabled"))
        .toBe(false);
      const write = Promise.withResolvers<unknown>();
      native.submit.mockImplementationOnce(() => write.promise);
      fireEvent.click(screen.getByRole("button", { name: "Write to Revit" }));
      try {
        await waitFor(() =>
          expect(native.submit).toHaveBeenLastCalledWith(
            expect.objectContaining({ key: "sheet.apply" }),
          ),
        );
        expect(screen.queryByText("Apply is held: Plan the current Work first")).toBeNull();
        expect(screen.getByText("Applying…")).toBeTruthy();
        const previous = f.typed.value();
        expect(previous).toHaveProperty("value");
        const raced = deliverRead!;
        await act(async () =>
          raced({
            kind: "document-changed",
          }),
        );
        expect(f.typed.value()).toMatchObject({
          state: "refreshing",
          reason: "Applying changes. The view will refresh when the write finishes.",
          value: "value" in previous ? previous.value : undefined,
        });
        expect(screen.queryByText(/changed since plan/)).toBeNull();
      } finally {
        await act(async () =>
          write.resolve({ id: "native-write", state: "succeeded", result: {} }),
        );
      }
      expect(screen.getByText("Write to Revit sent")).toBeTruthy();
      await waitFor(() => expect(f.typed.value().state).toBe("ready"));
      const refreshed = f.typed.value();
      await act(async () => deliverRead!({ kind: "document-changed" }));
      expect(f.typed.value()).toMatchObject({
        state: "refreshing",
        reason: "The document changed. Refreshing…",
        value: "value" in refreshed ? refreshed.value : undefined,
      });
      await act(async () => deliverRead!({ kind: "complete", value: capture, revision: 2 }));
      expect(f.typed.value().state).toBe("ready");
      await act(async () => deliverRead!({ kind: "failure", error: "Offline" }));
      expect(f.typed.value()).toMatchObject({ state: "stale", reason: "Offline" });
    }
    cleanup();
    closes
      .splice(0)
      .reverse()
      .forEach((close) => close());
  }
});

test.each([false, true])(
  "JZ Plan pane/pose: pending Fans review stays Apply-eligible without Work revisions (oversized reading: %s)",
  async (large) => {
    native.retained.length = 0;
    const capture = structuredClone(realMuas);
    if (large) capture.document.title = "large-model-evidence".repeat(65536);
    const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
    if (large) expect(bytes(capture)).toBeGreaterThan(1024 * 1024);
    let plan!: (result: unknown) => void;
    const snapshots: ReadingDelivery[] = [];
    const snapshot: ReadingDelivery = (frame) => snapshots.forEach((deliver) => deliver(frame));
    native.submit.mockImplementation(
      () =>
        new Promise((resolve) => {
          plan = resolve;
        }),
    );
    const receiptSubscribers = new Set<(state: ReceiptFeedState) => void>();
    const receipts: WorkJournalDoor["receipts"] = () => ({
      subscribe(deliver) {
        receiptSubscribers.add(deliver);
        return () => {
          receiptSubscribers.delete(deliver);
        };
      },
    });
    const f = await createWitness(
      closes,
      new Map(),
      {
        "fans.calc-detail-snapshot": {
          kind: "use",
          open(_ctx, deliver) {
            snapshots.push(deliver);
            deliver({ kind: "complete", value: capture, revision: 1 });
          },
        },
      },
      undefined,
      receipts,
    );
    await vi.waitFor(() => expect(f.fans.work()).not.toBeNull());
    const key = f.fans.workBasis()!.token.scope.identity.work!;
    await f.ws.apply(
      key,
      "fans",
      "pea",
      [
        {
          path: ["writeIntent"],
          value: { edit: { value: { walk: { unitId: 14577391, portIndex: 2 } } } },
        },
        {
          path: [
            "equipmentFlows",
            elementSubject(realMuas.nodes.find((node) => node.id === 14577391)!),
            "edit",
          ],
          value: { value: 925, ref: "test" },
        },
      ],
      f.fans.work()!.revision,
    );
    await vi.waitFor(() => expect(f.fans.work()!.value.writeIntent).toBeTruthy());
    f.fans.refresh("value");
    for (const id of ["value"])
      await vi.waitFor(() => {
        const snapshot = f.fans.readingStatus(id).snapshot;
        if (snapshot.state === "refused") throw Error(`${id}: ${refusalOf(snapshot)}`);
        expect(snapshot).toMatchObject({ state: "ready" });
      });
    function Write() {
      const [, changed] = useReducer((n) => n + 1, 0);
      useEffect(() => f.fans.subscribe(changed), []);
      return <TypedWrite mount={f.typed} id="losses" />;
    }
    render(<Write />);
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "plan Write to Revit" })),
    );
    // The native mount retains handles and hash dependencies; it never serializes a Value into a token.
    expect(bytes(f.fans.workBasis())).toBeLessThan(2048);
    expect(plan).toBeTypeOf("function");
    // /fans owns no /ducts Work (ruling 2026-11-10): its plan carries its own handle; the host reads /ducts.
    const input = f.inputs.get("fans:sheet.plan") as { work: unknown; readWorks?: object };
    expect(input.work).toMatchObject({ key: { route: "fans" } });
    expect(Object.keys(input.readWorks ?? {})).toEqual([]);
    // H1: a plan the host refuses after invoke returned shows its reason, arms nothing, and retries clean.
    const refusedText = "Fans Work belongs to another document";
    await act(async () => plan({ id: "plan-refused", state: "refused", error: refusedText }));
    expect(document.querySelector("[data-write-outcome=refused]")?.textContent).toBe(refusedText);
    expect(screen.queryByRole("button", { name: "Write to Revit" })).toBeNull();
    const trigger = screen.getByRole("button", { name: "plan Write to Revit" });
    await act(async () => fireEvent.click(trigger));
    await act(async () => fireEvent.click(trigger));
    expect(f.fans.reviewRefusal("losses")).toBeNull();
    expect(document.body.textContent).not.toContain(refusedText);
    const stagedRevision = f.fans.work()!.revision;
    const beforeSwitch = f.typed.value().publication!.evaluation;
    const beforeReads = f.calls.get("fans:fans.calc");
    // The shell releases the retained typed mount while another pane is expanded.
    await act(async () => {
      f.typed.release();
      f.typed.subscribe(() => {})();
      f.typed.page.pose({ layers: [] });
    });
    expect(f.fans.work()!.revision).toBe(stagedRevision);
    expect(f.calls.get("fans:fans.calc")).toBeGreaterThan(beforeReads!);
    await waitFor(() => expect(f.typed.value().state === "ready").toBe(true));
    expect(f.typed.value().publication!.evaluation).toBe(beforeSwitch);
    await act(async () =>
      plan({
        id: "plan-retention",
        state: "succeeded",
        result: {
          previewOnly: true,
          takenAt: "2026-11-05T00:00:00Z",
          derivedRequest: { equipmentFlows: [{ id: 14577391, cfm: 925, source: "test" }] },
          seal: {
            caller: { kind: "human", via: "local" },
            requestHash: "sealed",
            work: { handle: input.work },
            documentMark: {
              session: "fixture",
              openId: "fans",
              observedSince: null,
              changedAt: null,
            },
            incarnation: {},
            dependencies: "exact",
          },
          response: {
            writes: [
              {
                id: 14577391,
                kind: "equipment-flow",
                outcome: "planned",
                before: "880 cfm",
                after: "925 cfm",
              },
            ],
            counts: { planned: 1, written: 0, refused: 0, unchanged: 0 },
          },
        },
      }),
    );
    expect(f.fans.review("losses")).toMatchObject({
      stale: false,
      // Amendment 2 item 1: the review author is the Work cell's host-stamped `by`, and Pea staged this cell.
      cells: [{ before: "880 cfm", author: "pea" }],
    });
    expect(f.fans.review("losses")!.rows[0]).toContain("MUAS-1");
    expect(planned(f.typed.verb("losses")).read()?.preview).toBeTruthy();
    const reviewTrigger = screen.getByRole("button", { name: /Write to Revit.*planned/ });
    if (reviewTrigger.getAttribute("aria-expanded") !== "true")
      await act(async () => fireEvent.click(reviewTrigger));
    expect(
      (await screen.findByRole("button", { name: "Write to Revit" })).hasAttribute("disabled"),
    ).toBe(false);
    expect(document.querySelector("[data-write-cell]")?.textContent).toContain("925 cfm");
    expect(f.fans.work()!.revision).toBe(stagedRevision);
    // New naming evidence must revoke the old before/after review rather than silently re-present it.
    const moved = structuredClone(capture);
    moved.document.title = "changed model evidence";
    act(() => {
      f.fans.refresh("value");
      snapshot({ kind: "complete", value: moved, revision: 2 });
    });
    expect(f.fans.review("losses")).toMatchObject({ stale: true, rows: [], cells: [] });
    expect(() => f.fans.confirm("losses")).toThrow(/stale/i);
  },
);

test("JZ B03 people choose named subjects in pending Families scope", pendingFamiliesChoice);

/** Retained Families publication + ready Work reproduce the Driver's post-Start refresh. */
async function pendingFamiliesChoice() {
  const doc = familiesRouteState.schema.parse({});
  const catalogue = {
    summary: {
      totalFamilies: 1,
      placedFamilies: 0,
      unplacedFamilies: 1,
      totalTypes: 1,
      totalPlacedInstances: 0,
      truncated: false,
    },
    families: [
      {
        familyId: 1,
        familyUniqueId: "air-tag",
        familyName: "Air Terminal Tag",
        categoryName: "Air Terminal Tags",
        typeCount: 1,
        placedInstanceCount: 0,
        types: [{ typeName: "Standard" }],
      },
    ],
    issues: [],
  };
  // Only this retained publication boundary is replayed. Schedules below retains its real host HTTP reads/actions.
  const packet = families.spec.core!.output.parse({
    key: "b03-families",
    generation: 1,
    version: 1,
    state: "current",
    value: {
      data: {
        familiesWork: doc,
        catalog: catalogue,
        categories: ["Air Terminal Tags"],
        observation: null,
        rows: [],
        facts: {},
        params: [],
        pivotRows: [],
        pivotFamilies: [],
        outcomes: [],
        activeReadId: null,
        editRefusal: "Read these families before editing",
      },
      evaluation: "b03-families",
      inputs: "b03-families",
      coverage: { requested: [], covered: [], unknown: [], refused: [] },
      origin: { kind: "fixture", name: "post-start-families" },
      works: [],
      trace: [],
      freshness: "current",
    },
  });
  const release = Promise.withResolvers<void>();
  let hold = false;
  const tasks = new Set<Promise<void>>();
  const source: UseSource = {
    kind: "use",
    open(ctx, deliver) {
      const task = (hold ? release.promise : Promise.resolve()).then(() => {
        if (!ctx.signal.aborted) deliver({ kind: "complete", value: packet, revision: 1 });
      });
      tasks.add(task);
      void task.finally(() => tasks.delete(task));
      return () => {};
    },
  };
  let search = new URLSearchParams();
  const mount = mounts.mountTypedRoute(
    families,
    {
      address: {
        read: () => new URLSearchParams(search),
        write: (next) => {
          search = new URLSearchParams(next);
        },
        subscribe: () => () => {},
      },
      fixture: null,
      target: { kind: "document", ref: { session: "b03-families", openId: "project" } },
      work: { address: address("C:/Models/B03-Families.rvt"), open: null },
      custody: { current: () => true },
      memory: () => ({}),
    },
    workFingerprintSchema.parse(`builtin-closure:${"a".repeat(64)}`),
    {
      work: createFixtureWorkDoor(familiesRouteState, doc),
      sources: { "families.view": source },
    },
  );
  function Journey() {
    useSyncExternalStore(mount.subscribe, mount.revision, mount.revision);
    return (
      <KeyScopeHost id="b03-families">
        <TypedChrome mount={mount} document={<span>Families after Start</span>} />
      </KeyScopeHost>
    );
  }
  const root = createRootRoute({ component: Journey });
  const router = createRouter({
    routeTree: root,
    history: createMemoryHistory({ initialEntries: ["/families"] }),
  });
  const view = render(<RouterProvider router={router} />);
  try {
    await screen.findByRole("option", { name: "Air Terminal Tags" });
    await waitFor(() => expect(mount.work()).not.toBeNull());
    await waitFor(() => expect(mount.value().state === "ready").toBe(true));
    hold = true;
    await act(async () => mount.refresh());
    expect(mount.value(), "B03 Families: pending refresh retains named choices").toMatchObject({
      state: "refreshing",
    });
    const before = { work: mount.work(), page: mount.page.read(), url: search.toString() };
    const category = screen.getByRole("option", { name: "Air Terminal Tags" });
    const member = screen.getByRole("option", { name: "Air Terminal Tag" });
    expect
      .soft(
        category.getAttribute("aria-disabled"),
        "B03 Families: pending category is visibly disabled, not a swallowed choice",
      )
      .toBe("true");
    expect
      .soft(
        member.getAttribute("aria-disabled"),
        "B03 Families: the same refusal governs family choices",
      )
      .toBe("true");
    expect
      .soft(
        screen.queryByText("Family scope unavailable"),
        "B03 Families: scope refusal is visible before interaction",
      )
      .not.toBeNull();
    const group = screen.getByRole("group", { name: "Family scope" });
    expect
      .soft(group.textContent, "B03 Families: scope refusal names the pending Reading")
      .toContain("Reading...");
    await act(async () => {
      fireEvent.click(category);
      fireEvent.click(member);
    });
    expect(
      { work: mount.work(), page: mount.page.read(), url: search.toString() },
      "B03 Families: a refused choice commits nothing",
    ).toEqual(before);
    expect(
      familiesRouteState.schema.parse(mount.work()?.value).scope.edit,
      "B03 Families: no category was queued secretly",
    ).toBeUndefined();
    await act(async () => {
      release.resolve();
    });
    await waitFor(() => expect(mount.value().state === "ready").toBe(true));
    expect(
      screen.getByRole("option", { name: "Air Terminal Tags" }).getAttribute("aria-disabled"),
      "B03 Families: current basis re-enables scope choices",
    ).not.toBe("true");
    expect(familiesRouteState.schema.parse(mount.work()?.value).scope.edit).toBeUndefined();
  } finally {
    release.resolve();
    view.unmount();
    mount.dispose();
    await Promise.all(tasks);
  }
}
test("JZ H01 H17 saved takeoff choice preserves authored Work and live Initialize while History captures", async () => {
  const j = await takeoffJourney();
  try {
    await j.ready();
    expect(
      (await j.host.journal.list()).some(
        (row) => row.key === "work.start" && row.state === "succeeded",
      ),
      "ordinary Start crossed the real /actions handler",
    ).toBe(true);
    const originalWork = j.mount.owner()!.handle;
    expect(originalWork).toBeTruthy();
    render(<TakeoffDrawing mount={j.mount} />);
    fireEvent.click(screen.getByRole("button", { name: "Choose views" }));
    fireEvent.click(await screen.findByRole("option", { name: "Zoning plan" }));
    await waitFor(() => expect(j.mount.value().state === "ready").toBe(true), { timeout: 20000 });
    await waitFor(() => expect(j.mount.owner()?.ready || j.mount.owner()?.absent).toBe(true));
    expect(
      j.mount.owner()!.handle,
      "H01: view choice cannot select another Work through serialized Page fields",
    ).toEqual(originalWork);
    await j.ready();
    const capture = adoptionData.parse(valueOf(j.mount.value())).captures[0]!;
    fireEvent.click(screen.getByRole("button", { name: "Choose capture" }));
    const option = (await screen.findAllByRole("option")).find((row) =>
      row.textContent?.includes(capture.capturedAt),
    );
    expect(option, "choose this exact saved capture").toBeTruthy();
    fireEvent.click(option!);
    await waitFor(() => expect(j.mount.value().state === "ready").toBe(true), { timeout: 20000 });
    await waitFor(() => expect(j.mount.owner()?.ready || j.mount.owner()?.absent).toBe(true));
    expect(screen.getByText(/Archived takeoff/)).toBeTruthy();
    expect(j.mount.owner()!.handle, "H01: a saved-evidence id cannot select another Work").toEqual(
      originalWork,
    );
    expect(j.host.inputs.source).toMatchObject({ capturing: true });
    fireEvent.click(screen.getByRole("button", { name: "live" }));
    await j.ready();
    await screen.findByRole("checkbox", { name: "Select Office zone in Zoning plan" });
    expect(j.mount.owner()!.handle).toEqual(originalWork);
    expect(
      (screen.getByRole("button", { name: "initialize" }) as HTMLButtonElement).disabled,
      "H17: live readiness uses the current document and its original Work",
    ).toBe(false);
    expect(valueOf(j.mount.value()).initialize.refusal).toBeNull();
    expect(j.host.inputs.source).toMatchObject({ capturing: true });
    expect(j.host.inputs.lane.kind).toBe("live");
    if (j.host.inputs.lane.kind === "live")
      expect(j.host.inputs.lane.captureStore!.capture.truncated(), "zero capture stops").toBeNull();
  } finally {
    await j.close();
  }
}, 60000);
// Only the conversation/reading boundaries are recorded. RouteDock, Activity, typed Family,
// Work feeds, file persistence and the Host view HTTP handler remain production owners.
const conversation = vi.hoisted(() => ({ value: null as unknown }));
vi.mock("../workbench/provider", () => ({ useWorkbench: () => conversation.value }));
vi.mock("../chat/chat-shell", () => ({ ChatShell: () => null }));

test.each(["takeoffs", "families"] as const)(
  "JZ kernel Start on %s after read release settles while Reading or after it",
  async (route) => {
    const { gate } = await import("../../../host/tests/host-read-graph.test-support");
    for (const phase of ["settled", "reading"] as const) {
      const catalogue = phase === "reading" ? gate() : undefined;
      const j = await takeoffJourney({
        catalogue,
        start: false,
        ...(route === "families" ? { route } : {}),
      });
      function Journey() {
        useSyncExternalStore(j.mount.subscribe, j.mount.revision, j.mount.revision);
        return (
          <KeyScopeHost id={`start-${route}`}>
            <TypedChrome mount={j.mount} document={<span>Project document</span>} />
          </KeyScopeHost>
        );
      }
      const root = createRootRoute({ component: Journey });
      const router = createRouter({
        routeTree: root,
        history: createMemoryHistory({ initialEntries: [`/${route}`] }),
      });
      render(<RouterProvider router={router} />);
      try {
        const start = await screen.findByRole("button", { name: "Start" });
        const retainedStart = j.mount.startAction()!;
        if (!catalogue)
          await waitFor(() => expect(j.mount.value().state === "ready").toBe(true), {
            timeout: 20000,
          });
        else
          expect(j.mount.value()).toMatchObject({
            state: expect.stringMatching(/^(reading|refreshing)$/),
          });
        // Resource release alone leaves the selected Place's Start authority intact.
        await act(async () => {
          j.mount.release();
        });
        expect(j.mount.available()).toBe(true);
        fireEvent.click(start);
        catalogue?.release.resolve();
        await waitFor(() => expect(j.mount.owner()?.ready).toBe(true));
        await act(async () => {
          const stop = j.mount.subscribe(() => {});
          stop();
        });
        await j.ready();
        const receipts = (await j.host.journal.list()).filter((row) => row.key === "work.start");
        expect(receipts).toHaveLength(1);
        expect(receipts[0]!.state).toBe("succeeded");
        expect(screen.queryByRole("button", { name: "Start" })).toBeNull();
        if (route === "takeoffs") expect(valueOf(j.mount.value()).initialize.refusal).toBeNull();
        else {
          const category = await screen.findByRole("option", { name: "Air Terminal Tags" });
          expect(category.getAttribute("aria-disabled")).toBeNull();
          fireEvent.click(category);
          await j.ready();
          await waitFor(() =>
            expect(j.mount.owner()?.doc.scope.edit?.value.categoryNames).toEqual([
              "Air Terminal Tags",
            ]),
          );
        }
        j.mount.dispose();
        await expect(retainedStart.run()).rejects.toThrow("Place is not writable");
        expect(retainedStart.failure).toBe("Place is not writable");
        expect(
          (await j.host.journal.list()).filter((row) => row.key === "work.start"),
        ).toHaveLength(1);
      } finally {
        await j.close();
      }
    }
  },
  60000,
);

test("JZ saved Takeoffs capture explains its empty snapshot and returns to live candidates", async () => {
  const j = await takeoffJourney();
  try {
    await j.ready();
    render(<TakeoffDrawing mount={j.mount} />);
    const capture = adoptionData.parse(valueOf(j.mount.value())).captures[0]!;
    fireEvent.click(screen.getByRole("button", { name: "Choose capture" }));
    const option = (await screen.findAllByRole("option")).find((row) =>
      row.textContent?.includes(capture.capturedAt),
    );
    fireEvent.click(option!);
    await waitFor(() => expect(j.mount.value().state === "ready").toBe(true), { timeout: 20000 });
    expect(screen.getByText(/Archived takeoff/)).toBeTruthy();
    expect(screen.getByText("No adopted zones in this saved takeoff")).toBeTruthy();
    expect(screen.getByText(/This capture stores takeoff data, not a view image/)).toBeTruthy();
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.queryByRole("button", { name: "initialize" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "live" }));
    await j.ready();
    fireEvent.click(screen.getByRole("button", { name: "Choose views" }));
    fireEvent.click(await screen.findByRole("option", { name: "Zoning plan" }));
    await screen.findByRole("checkbox", { name: "Select Office zone in Zoning plan" });
  } finally {
    await j.close();
  }
}, 60000);
test("JZ E8-12 close Home clears a capacity refusal and permits another Place", async () => {
  const [
    { createRoute },
    { RegistryContext },
    { appAtomRegistry },
    { RouteDock },
    { createChatPageStore },
  ] = await Promise.all([
    import("@tanstack/react-router"),
    import("@effect/atom-react"),
    import("../shell/owner"),
    import("../workbench/route-panes"),
    import("../workbench/store"),
  ]);
  await import("../routes/__root");
  vi.spyOn(await import("../navigation/surface-host"), "useSurfaceHost").mockReturnValue({
    surface: "web",
  } as never);
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  await seedPlaces(
    Array.from({ length: 12 }, (_, i) => ({
      id: `aaaaaaaa-0000-4000-8000-${String(i).padStart(12, "0")}`,
      route: "home",
      link: "/",
      at: new Date().toISOString(),
    })),
  );
  const store = createChatPageStore({
    registry: appAtomRegistry,
    search: { patch: async () => {} },
  });
  conversation.value = { store, threads: [] };
  const module = route({
    ...families.spec,
    key: "home",
    address: "/",
    name: "Home",
    needs: "browser",
    core: undefined,
    subject: undefined,
    goal: undefined,
    query: undefined,
    reads: {},
    edits: undefined,
    verbs: {},
    band: [],
    fields: {},
    picture: undefined,
    title: undefined,
    panes: {
      main: {
        title: "Home",
        purpose: "Place capacity",
        body: "scroll",
        draw: () => scrollBody(<p>Home body</p>),
      },
    },
    layout: { kind: "pane", id: "main" },
  });
  const root = createRootRoute({
    component: () => (
      <RegistryContext.Provider value={appAtomRegistry}>
        <RouteDock renderRoute={(body) => body}>{null}</RouteDock>
      </RegistryContext.Provider>
    ),
  });
  const router = createRouter({
    routeTree: root.addChildren([
      createRoute({
        getParentRoute: () => root,
        path: "/",
        component: () => (
          <TypedShell
            module={module}
            fingerprint={workFingerprintSchema.parse(`builtin-closure:${"a".repeat(64)}`)}
          />
        ),
      }),
    ]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  try {
    await router.load();
    render(<RouterProvider router={router} />);
    await screen.findByText("Home body");
    fireEvent.click(screen.getByRole("button", { name: "Open another Place on this route" }));
    await screen.findByText("This machine keeps 12 Places; close one first.");
    fireEvent.click(screen.getAllByRole("button", { name: "Close Home" })[11]!);
    await waitFor(() => expect(placesHost.read()).toHaveLength(11));
    expect(screen.queryByText("This machine keeps 12 Places; close one first.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open another Place on this route" }));
    await waitFor(() => expect(placesHost.read()).toHaveLength(12));
  } finally {
    cleanup();
    sessionStorage.clear();
    vi.unstubAllGlobals();
    conversation.value = null;
  }
});

test("JZ E8-03 a typed Fans refused Plan explains the atomic Apply hold at the action area", async () => {
  const capture = structuredClone(realMuas) as unknown as DuctSnapshot;
  Object.assign(capture.nodes.find((node) => node.id === 14577391)!, { flowParameter: null });
  capture.slots = { ...capture.slots!, fanFlow: "PE_M_Fan_AirFlowDesign" };
  // Controlled native-input twins exercise label disambiguation; this is not a native-model claim.
  const damper = capture.nodes.find((node) => node.id === 14607308)!;
  Object.assign(damper, { partType: "Damper" });
  capture.nodes.push({
    ...structuredClone(damper),
    id: 99999991,
    uniqueId: "fixture-other-damper",
    levelId: 30,
    connectors: [],
  });
  const f = await createWitness(closes, new Map(), {
    "fans.calc-detail-snapshot": {
      kind: "use",
      open(_ctx, deliver) {
        deliver({ kind: "complete", value: capture, revision: 1 });
      },
    },
  });
  await vi.waitFor(() => expect(f.fans.work()).not.toBeNull());
  const key = f.fans.workBasis()!.token.scope.identity.work!;
  await f.ws.apply(
    key,
    "fans",
    "human",
    [
      {
        path: ["writeIntent"],
        value: { edit: { value: { walk: { unitId: 14577391, portIndex: 2 } } } },
      },
      {
        path: [
          "equipmentFlows",
          elementSubject(realMuas.nodes.find((node) => node.id === 14577391)!),
          "edit",
        ],
        value: { value: 925, ref: "test" },
      },
    ],
    f.fans.work()!.revision,
  );
  f.fans.refresh("value");
  await vi.waitFor(() => expect(f.typed.value().state === "ready").toBe(true));
  const reason = "MUAS-1: missing PE_M_Fan_AirFlowDesign; add the missing parameter";
  native.submit.mockImplementation(async () => ({
    id: "atomic-hold",
    state: "succeeded",
    result: {
      previewOnly: true,
      planRefusal: reason,
      seal: {
        caller: { kind: "human", via: "local" },
        requestHash: "atomic-hold",
        work: { handle: (f.inputs.get("fans:sheet.plan") as { work: unknown }).work },
        documentMark: { session: "fixture", openId: "fans", observedSince: null, changedAt: null },
        incarnation: null,
        dependencies: "exact",
      },
      value: {
        writes: [
          { id: 14577391, kind: "equipment-flow", outcome: "refused", before: null, reason },
          {
            id: 14607308,
            kind: "component",
            outcome: "planned",
            parameter: "Specific Loss",
            before: "unset",
            after: "0.0398 in-wg",
          },
          { kind: "store", outcome: "planned", before: "absent", after: "revision 1" },
        ],
        counts: { refused: 1, planned: 2, written: 0, unchanged: 0 },
      },
    },
  }));
  function Write() {
    const [, changed] = useReducer((n) => n + 1, 0);
    useEffect(() => f.fans.subscribe(changed), []);
    return <TypedWrite mount={f.typed} id="losses" />;
  }
  render(<Write />);
  fireEvent.click(screen.getByRole("button", { name: "plan Write to Revit" }));
  await screen.findByRole("button", { name: /Write to Revit.*planned/ });
  const trigger = screen.getByRole("button", { name: /Write to Revit.*planned/ });
  if (trigger.getAttribute("aria-expanded") !== "true") fireEvent.click(trigger);
  expect(screen.queryByRole("button", { name: "Write to Revit" })).toBeNull();
  const explanation = screen.getByRole("status");
  expect(explanation.textContent).toBe(`Apply is held: ${reason}`);
  expect(explanation.parentElement?.textContent).toContain("Esc");
  expect(screen.getByText("Computed losses written back")).toBeTruthy();
  expect(screen.getByText("Pe loss record")).toBeTruthy();
  expect(document.body.textContent).toContain("unset");
  expect(document.body.textContent).toContain("14607308");
  expect(document.body.textContent).toMatch(/damper/i);
  expect(document.body.textContent).toContain("Level 2/Upper Level");
  cleanup();
  // The recorded adapter has no unit rows; prepare the native input model before rendering.
  const nativeInputs = inputsFor(capture);
  const slot = { ...fansCalc, bindings: { equipmentFlows: fansCalc.bindings.equipmentFlows } };
  function MissingFlow({ ctx }: { ctx: any }) {
    const data = ctx.value.value;
    if (!data.open) throw Error("The native Fan must be open");
    const value = {
      ...ctx.value,
      value: { ...data, calcView: { ...data.calcView, inputs: nativeInputs } },
    };
    return <SheetPane ctx={{ draw: { ...ctx, value }, slot }} />;
  }
  render(f.typed.draw("calc-inputs", (ctx) => <MissingFlow ctx={ctx} />) as React.ReactElement);
  expect(
    document.querySelector('[data-body="locked"]'),
    "The missing native parameter locks the actual typed cell before Plan",
  ).not.toBeNull();
  expect(document.body.innerHTML).toContain("PE_M_Fan_AirFlowDesign");
});

// The declared roster is the route's sole subject-choice surface, even on another pane.
test.each(["Fans", "Ducts"] as const)(
  "JZ C042 %s subject-list declaration suppresses the header chooser across panes",
  async (name) => {
    const { useAdmittedSubject } = await import("@pe/web-kernel/shell/subject");
    const read = fans.spec.core!;
    const declared =
      name === "Fans" ? fans.spec.panes["calc-roster"] : ducts.spec.panes["e-systems"];
    function Roster({ ctx }: { ctx: any }) {
      const subject = useAdmittedSubject()!;
      const first = fans.spec.subject!.options(ctx.value.value)[0]!;
      return (
        <section aria-label="Fan subject list">
          <button onClick={() => subject.add([first.id])}>{first.label}</button>
        </section>
      );
    }
    for (const pane of ["detail", "roster"] as const) {
      const module = route({
        ...fans.spec,
        needs: "browser",
        edits: undefined,
        verbs: {},
        band: [],
        reads: {},
        subject: { ...fans.spec.subject!, pane: "roster", read },
        panes: {
          roster: {
            subjectList: declared.subjectList,
            title: "Fan list",
            purpose: "Choose the subject",
            read: { ...read },
            body: "scroll",
            draw: (ctx) => scrollBody(<Roster ctx={ctx} />),
          },
          detail: {
            title: "Detail",
            purpose: "Inspect the subject",
            read: { ...read },
            body: "scroll",
            draw: () => scrollBody(<p>Subject detail</p>),
          },
        },
        layout: { kind: "pane", id: pane },
      });
      const mount = mounts.mountTypedRoute(
        module,
        {
          target: { kind: "host" },
          fixture: "layout",
          work: { address: null, open: null },
          address: { read: () => new URLSearchParams(), write() {}, subscribe: () => () => {} },
          custody: { current: () => true },
          memory: () => ({}),
        },
        workFingerprintSchema.parse(`builtin-closure:${"a".repeat(64)}`),
      );
      const router = createRouter({
        routeTree: createRootRoute({
          component: () => <TypedChrome mount={mount} document={<span>Recorded Fans</span>} />,
        }),
        history: createMemoryHistory({ initialEntries: ["/"] }),
      });
      const view = render(<RouterProvider router={router} />);
      try {
        if (pane === "detail") await screen.findByText("Subject detail");
        else await screen.findByRole("region", { name: "Fan subject list" });
        expect(
          screen.queryByRole("button", { name: "Choose fan" }),
          "One subject capability has one choice path",
        ).toBeNull();
        if (pane === "roster") {
          const first = fans.spec.subject!.options(valueOf(mount.value()))[0]!;
          fireEvent.click(screen.getByRole("button", { name: first.label }));
          expect(mount.page.read().fan).toEqual({ kind: "ids", ids: [first.id] });
        }
      } finally {
        view.unmount();
        mount.dispose();
        cleanup();
      }
    }
  },
);

test("JZ audit named subject choices preserve all none add and toggle without raw ids", async () => {
  const {
    fixture,
    ref,
    path: documentPath,
  } = await import("../../../host/tests/host-read-graph.test-support");
  const { typedSubjectDoor } = await import("../shell/typed-mount");
  const host = await fixture(true),
    tasks = new Set<Promise<unknown>>();
  const roster = fans.spec.subject!.read!;
  const module = route({
    ...fans.spec,
    core: roster,
    edits: undefined,
    verbs: {},
    band: [],
    subject: { ...fans.spec.subject!, pane: "detail" },
    panes: {
      detail: {
        title: "Subject choices",
        purpose: "Choose named subjects",
        body: "scroll",
        draw: () => scrollBody(<p>Subject choice surface</p>),
      },
    },
    layout: { kind: "pane", id: "detail" },
  });
  let seq = 0,
    search = new URLSearchParams(),
    moves = 0;
  const unknown = stableFanKey({ uniqueId: "unknown-roster-audit", portIndex: 0 });
  const source: UseSource = {
    kind: "use",
    open(ctx, deliver) {
      const generation = ++seq;
      const task = host.send(generation, [], undefined, `subject-${generation}`).then((value) => {
        if (!ctx.signal.aborted) deliver({ kind: "complete", value, revision: generation });
      });
      tasks.add(task);
      void task.finally(() => tasks.delete(task));
      return () => {};
    },
  };
  const mount = mounts.mountTypedRoute(
    module,
    {
      target: { kind: "document", ref },
      fixture: null,
      work: { address: documentPath, open: ref },
      memory: () => ({ fan: { kind: "ids", ids: [unknown] } }),
      custody: { current: () => true },
      address: {
        read: () => new URLSearchParams(search),
        write(next) {
          search = next;
          moves++;
        },
        subscribe: () => () => {},
      },
    },
    workFingerprintSchema.parse(`builtin-closure:${"a".repeat(64)}`),
    { sources: { "fans.calc": source } },
  );
  const router = createRouter({
    routeTree: createRootRoute({
      component: () => <TypedChrome mount={mount} document={<span>Recorded subjects</span>} />,
    }),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  let view: ReturnType<typeof render> | undefined;
  try {
    await Promise.allSettled([...tasks]);
    view = render(<RouterProvider router={router} />);
    await screen.findByRole("button", { name: "Choose fan" });
    expect(document.body.textContent).not.toContain(unknown);
    expect(screen.getByText(/outside the current roster/)).toBeTruthy();
    const options = module.spec.subject!.options(valueOf(mount.value(roster)));
    expect(options.length).toBeGreaterThan(1);
    fireEvent.click(screen.getByRole("button", { name: "No fan" }));
    expect(mount.page.read().fan).toEqual({ kind: "ids", ids: [] });
    expect(moves).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: "All fan" }));
    expect(mount.page.read().fan).toEqual({ kind: "all" });
    expect(moves).toBe(2);
    const door = typedSubjectDoor(mount)!;
    act(() => door.add([options[0]!.id]));
    expect(mount.page.read().fan).toEqual({ kind: "all" });
    expect(moves).toBe(2);
    act(() => door.clear());
    expect(moves).toBe(3);
    act(() => door.add([options[0]!.id]));
    act(() => door.add([options[0]!.id, options[1]!.id]));
    expect(mount.page.read().fan).toEqual({ kind: "ids", ids: [options[0]!.id, options[1]!.id] });
    act(() => door.toggle(options[0]!.id));
    expect(mount.page.read().fan).toEqual({ kind: "ids", ids: [options[1]!.id] });
    expect(document.body.textContent).toContain(options[1]!.label);
    expect(document.body.textContent).not.toContain(String(options[1]!.id));
    expect(seq, "Subject selection does not enumerate subjects into extra roster reads").toBe(1);
  } finally {
    view?.unmount();
    mount.dispose();
    await Promise.allSettled(tasks);
    await host.close();
    cleanup();
  }
}, 60_000);

test("JZ audit optional document pins retain exact source authority and retire replaced custody", async () => {
  const resources = await import("../host/resource-state");
  const Atom = await import("effect/reactivity/Atom");
  const { machineFixture } =
    await import("../../../../packages/agent-contracts/tests/machine-fixture");
  const observed = {
    state: "ready",
    observation: {
      sessions: [
        {
          connected: true,
          sessionId: "bridge-one",
          processId: 1,
          sdkSessionId: "audit",
          openDocumentCount: 2,
          openDocuments: [
            { openId: "project-one", title: "Project A", isFamilyDocument: false },
            { openId: "family-one", title: "Family A", isFamilyDocument: true },
          ],
        },
      ],
    },
  };
  const inventory = Atom.make(observed),
    machine = Atom.make({ state: "ready", observation: machineFixture() });
  const atoms = vi
    .spyOn(resources, "readingAtom")
    .mockImplementation(((request: { kind: string }) =>
      request.kind === "inventory" ? inventory : machine) as typeof resources.readingAtom);
  const created: mounts.TypedMount[] = [];
  const original = mounts.mountTypedRoute;
  const factory = vi.spyOn(mounts, "mountTypedRoute").mockImplementation((...args) => {
    const m = original(...args);
    created.push(m);
    return m;
  });
  const module = route({
    ...families.spec,
    needs: "host",
    optionalTarget: "document",
    edits: undefined,
    core: undefined,
    subject: undefined,
    goal: undefined,
    query: undefined,
    reads: {},
    verbs: {},
    band: [],
    fields: {},
    picture: undefined,
    title: undefined,
    panes: {
      main: {
        title: "Optional document",
        purpose: "Inspect exact document authority",
        body: "scroll",
        draw: (ctx) =>
          scrollBody(
            <p>
              {ctx.target?.kind === "document"
                ? `Pinned ${ctx.target.ref.session}/${ctx.target.ref.openId}`
                : ctx.target?.kind === "host"
                  ? "Host browsing"
                  : "No authority"}
            </p>,
          ),
      },
    },
    layout: { kind: "pane", id: "main" },
  });
  let search = new URLSearchParams();
  const listeners = new Set<() => void>();
  const address = {
    read: () => new URLSearchParams(search),
    write(next: URLSearchParams) {
      search = next;
      listeners.forEach((f) => f());
    },
    subscribe(f: () => void) {
      listeners.add(f);
      return () => {
        listeners.delete(f);
      };
    },
  };
  const router = createRouter({
    routeTree: createRootRoute({
      component: () => (
        <TypedShell
          module={module}
          fingerprint={workFingerprintSchema.parse(`builtin-closure:${"a".repeat(64)}`)}
          address={address}
        />
      ),
    }),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  const view = render(<RouterProvider router={router} />);
  const pin = (ref: { session: string; openId: string }) =>
    new URLSearchParams({ target: JSON.stringify({ kind: "open", ref }) });
  try {
    await screen.findByText("Host browsing");
    await act(async () => address.write(pin({ session: "bridge-one", openId: "project-one" })));
    await screen.findByText("Pinned bridge-one/project-one");
    const first = created.at(-1)!;
    expect(first.target()).toEqual({
      kind: "document",
      ref: { session: "bridge-one", openId: "project-one" },
    });
    await act(async () => address.write(pin({ session: "bridge-one", openId: "family-one" })));
    await screen.findByText("Pinned bridge-one/family-one");
    expect(first.available(), "Old exact source custody is retired").toBe(false);
    expect(first.target()).toEqual({
      kind: "document",
      ref: { session: "bridge-one", openId: "project-one" },
    });
    for (const params of [
      pin({ session: "bridge-one", openId: "closed" }),
      pin({ session: "foreign", openId: "project-one" }),
      new URLSearchParams({ target: "{invalid" }),
    ]) {
      await act(async () => address.write(params));
      expect(
        screen.queryByText("Host browsing"),
        "An invalid pin never becomes host authority",
      ).toBeNull();
      expect(screen.queryByText("Pinned bridge-one/family-one")).toBeNull();
    }
    await act(async () => address.write(new URLSearchParams()));
    await screen.findByText("Host browsing");
  } finally {
    view.unmount();
    created.forEach((m) => m.dispose());
    factory.mockRestore();
    atoms.mockRestore();
    cleanup();
  }
});

test("JZ Plan refusal marker holds a valid sealed ancillary-only review at the typed action", async () => {
  const f = await createWitness(closes, new Map(), {
    "fans.calc-detail-snapshot": {
      kind: "use",
      open(_ctx, deliver) {
        deliver({ kind: "complete", value: structuredClone(realMuas), revision: 1 });
      },
    },
  });
  await vi.waitFor(() => expect(f.fans.work()).not.toBeNull());
  await f.ws.apply(
    f.fans.workBasis()!.token.scope.identity.work!,
    "fans",
    "human",
    [
      {
        path: ["writeIntent"],
        value: { edit: { value: { walk: { unitId: 14577391, portIndex: 2 } } } },
      },
      {
        path: [
          "equipmentFlows",
          elementSubject(realMuas.nodes.find((node) => node.id === 14577391)!),
          "edit",
        ],
        value: { value: 925, ref: "test" },
      },
    ],
    f.fans.work()!.revision,
  );
  f.fans.refresh("value");
  await vi.waitFor(() => expect(f.typed.value().state === "ready").toBe(true));
  const reason = "MUAS-1: required airflow parameter is missing; add the missing parameter";
  native.submit.mockClear();
  native.submit.mockImplementation(async () => ({
    id: "marker-only-plan",
    state: "succeeded",
    result: {
      previewOnly: true,
      planRefusal: reason,
      seal: {
        caller: { kind: "human", via: "local" },
        requestHash: "marker-only-plan",
        work: { handle: (f.inputs.get("fans:sheet.plan") as { work: unknown }).work },
        documentMark: { session: "fixture", openId: "fans", observedSince: null, changedAt: null },
        incarnation: null,
        dependencies: "exact",
      },
      // No refused native row can accidentally supply the shell's refusal. Only the Plan marker holds Apply.
      value: {
        writes: [{ kind: "store", outcome: "planned", before: "absent", after: "revision 1" }],
        counts: { refused: 0, planned: 1, written: 0, unchanged: 0 },
      },
    },
  }));
  function Write() {
    const [, changed] = useReducer((n) => n + 1, 0);
    useEffect(() => f.fans.subscribe(changed), []);
    return <TypedWrite mount={f.typed} id="losses" />;
  }
  render(<Write />);
  fireEvent.click(screen.getByRole("button", { name: "plan Write to Revit" }));
  const trigger = await screen.findByRole("button", { name: /Write to Revit.*planned/ });
  if (trigger.getAttribute("aria-expanded") !== "true") fireEvent.click(trigger);
  const apply = screen.getByRole("button", { name: "Write to Revit" });
  expect.soft(screen.queryByRole("status")?.textContent).toBe(`Apply is held: ${reason}`);
  expect.soft(apply.getAttribute("aria-disabled")).toBe("true");
  expect(document.body.textContent).toContain("Pe loss record");
  expect(native.submit).toHaveBeenCalledTimes(1);
  await act(async () => {
    fireEvent.click(apply);
  });
  expect(
    native.submit,
    "A valid seal and ancillary planned write cannot authorize a refused Plan",
  ).toHaveBeenCalledTimes(1);
});
