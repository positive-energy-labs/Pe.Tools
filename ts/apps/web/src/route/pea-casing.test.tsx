// @vitest-environment jsdom
import { stableFanKey } from "@pe/ducts-web/calc/model";
import { systemCode } from "@pe/ducts-web/identity";
import { useSyncExternalStore } from "react";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { emptyThreadHead, roomsRouteState, workFingerprintSchema } from "@pe/agent-contracts";
import { machineFixture } from "../../../../packages/agent-contracts/tests/machine-fixture";
import { RouteViewStore } from "@pe/runtime";
import { route, namesOf, type TypedRoute } from "@pe/web-kernel/route/typed-route";
import { scrollBody } from "@pe/web-kernel/route";
import { module as ducts } from "@pe/duct-systems-web/route";
import { module as fans } from "@pe/fans-web/route";
import { mountTypedRoute } from "../shell/typed-mount";
import { useRouteViewBridge } from "./view-bridge";
import { peReadings } from "../host/resource-stream";
import { peDo } from "../../../../packages/mcps/src/pea/capability-tools";
import { buildCapabilities } from "../../../../packages/mcps/src/pea/capabilities";
import { fakeRuntimeHost } from "../../../../packages/mcps/tests/runtime-host-fixture";
import { createPeClient } from "@pe/agent-contracts/pe-api";
import { fixture, ref } from "../../../host/tests/host-read-graph.test-support";
import { peClient } from "../host/pe-client";
import { module as rooms } from "../rooms/route";
import { DEMO_ROOMS, DEMO_VIEW } from "../rooms/demo";
import { roomsGoal } from "../rooms/goal";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

test.each([
  ["duct-systems", "names"],
  ["fans", "names"],
  ["rooms", "move"],
  ["fans", "cold"],
  ["fans", "active"],
  ["fans", "case"],
  ["fans", "unknown-id"],
] as const)("Pea resolves %s subjects: %s", async (key, scenario) => {
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  fakeRuntimeHost("http://127.0.0.1:19999");
  vi.stubEnv("PE_CONTEXT", "casing-context");
  // Retain the production fields and subject options. Native roster delivery is the only data adapter.
  // The kernel links layout ids to declared panes, so the one layout pane is declared and draws nothing.
  const options = {
    edits: undefined,
    commands: {},
    reads: {},
    panes: {
      unused: {
        title: "unused",
        purpose: "Casing fixture",
        body: "scroll",
        draw: () => scrollBody(null),
      },
    },
    picture: undefined,
    title: undefined,
    layout: { kind: "pane", id: "unused" },
  } as const;
  const module: TypedRoute =
    key === "duct-systems"
      ? route({ ...ducts.spec, ...options, core: ducts.spec.subject!.read! })
      : key === "rooms"
        ? route({ ...rooms.spec, ...options })
        : route({ ...fans.spec, ...options, core: fans.spec.subject!.read! });
  const roster = module.spec.subject!.read!;
  const field = module.spec.subject!.field;
  let search = new URLSearchParams();
  const host = await fixture(true);
  const packet =
    key !== "duct-systems"
      ? await host.send(0, [])
      : await (
          await host.probe({
            read: "ducts.roster",
            args: { target: ref },
            subscription: "casing-roster",
            generation: 1,
          })
        ).json();
  let rosterData: any = structuredClone(packet.value!.data);
  let deliverRoster = scenario !== "cold";
  let pendingRoster = () => {};
  if (key === "duct-systems") rosterData.systems = [{ ...rosterData.systems[0], name: "SA 19" }];
  else rosterData.rows = [{ ...rosterData.rows[0], mark: "MUAS-1" }];
  if (key === "rooms")
    rosterData = {
      ...roomsGoal(roomsRouteState.schema.parse({}), DEMO_ROOMS, null),
      snapshot: DEMO_ROOMS,
      roomsWork: roomsRouteState.schema.parse({}),
      handle: null,
      trace: null,
      traceError: null,
      plan: null,
      planError: null,
    };
  const fanIdentity = key === "fans" ? stableFanKey(rosterData.rows[0]) : "";
  const fanPort = key === "fans" ? rosterData.rows[0].portIndex : 0;
  const mount = mountTypedRoute(
    module,
    {
      target: null,
      fixture: null,
      work: { address: null, open: null },
      memory: () => ({}),
      custody: { current: () => true },
      address: {
        read: () => search,
        write: (next) => {
          search = next;
        },
        subscribe: () => () => {},
      },
    },
    workFingerprintSchema.parse(`builtin-closure:${"a".repeat(64)}`),
    {
      sources: {
        [roster.key]: {
          kind: "use",
          open(_ctx, deliver) {
            pendingRoster = () =>
              deliver({
                kind: "complete",
                revision: 1,
                value: { ...packet, value: { ...packet.value, data: rosterData } },
              });
            if (deliverRoster) pendingRoster();
          },
        },
      },
    },
  );
  const registered = {
    key,
    title: module.spec.name,
    address: `/${key}`,
    fields: module.data.fields,
  };
  const store = new RouteViewStore(() => [registered]);
  let sets = 0;
  vi.spyOn(peReadings, "subscribe").mockImplementation((_reading, deliver) =>
    store.subscribe((event) => deliver({ kind: "event", value: event } as never)),
  );
  const transport: typeof fetch = async (input, init) => {
    const url = new URL(
      input instanceof Request ? input.url : String(input),
      "http://127.0.0.1:19999",
    );
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (url.pathname === "/pe/scope/self")
      return Response.json({ ...emptyThreadHead, thread: "casing", revision: 1 });
    if (url.pathname === "/pe/capabilities")
      return Response.json({
        at: new Date().toISOString(),
        machine: machineFixture([]),
        sources: { catalog: "ok" },
        diagnostics: [],
        capabilities: buildCapabilities({
          ops: [],
          routes: [],
          packages: [],
          skills: [],
          admittedRoutes: () => [registered],
        }),
      });
    const action = url.pathname.split("/").at(-1);
    if (init?.method === "PUT") return Response.json(store.publish(body));
    if (action === "ack") return Response.json(store.ack(body));
    if (action === "set") {
      sets++;
      const result = (await store.set(
        body.thread,
        key,
        body.instance,
        body.revision,
        body.patch,
      )) as { ok: boolean };
      return Response.json(result, { status: result.ok ? 200 : 409 });
    }
    if (init?.method === "DELETE") {
      store.remove(action!);
      return Response.json({ ok: true });
    }
    if (action === key) return Response.json(store.select("casing", key));
    throw Error(`Unexpected transport ${url}`);
  };
  vi.stubGlobal("fetch", transport);
  vi.spyOn(peClient, "call").mockImplementation(createPeClient("", transport).call);
  function Surface() {
    useSyncExternalStore(mount.subscribe, mount.revision, mount.revision);
    useRouteViewBridge({
      route: key,
      codec: mount.attention,
      thread: "casing",
      surface: "route",
      visible: true,
      page: mount.page.read(),
      context: {},
      facts: {},
      apply: (patch) => {
        mount.move(patch as Record<string, unknown>, "push");
        return {
          ok: true,
          moved: true,
          receipt: { current: () => true, rendered: (page) => page === mount.page.read() },
        };
      },
    });
    return <output>{JSON.stringify(mount.page.read()[field])}</output>;
  }
  const router = createRouter({
    routeTree: createRootRoute({ component: Surface }),
    history: createMemoryHistory({ initialEntries: [`/${key}`] }),
  });
  const call = async (name: string, patch = {}) => {
    const lease = store.select("casing", key) as any;
    let result: any;
    await act(async () => {
      void peDo.execute!(
        {
          key: `route:${key}.set-view`,
          input: { instance: lease.instance, revision: lease.revision, [field]: name, ...patch },
        } as never,
        { agent: { toolCallId: "casing" } } as never,
      ).then((value) => {
        result = value;
      });
    });
    await waitFor(() => expect(result).toBeDefined(), { timeout: 6000 });
    return result;
  };
  try {
    render(<RouterProvider router={router} />);
    await waitFor(() => expect(store.select("casing", key)).toHaveProperty("instance"));
    if (scenario === "move") {
      const id = module.spec.subject!.options(rosterData)[0]!.id;
      deliverRoster = false;
      const result = await call(JSON.stringify({ kind: "ids", ids: [id] }), {
        view: JSON.stringify(DEMO_VIEW),
      });
      expect(result, JSON.stringify(result)).toMatchObject({
        ok: true,
        result: { outcome: "rendered" },
      });
      expect(mount.value(roster).state).not.toBe("ready");
      return;
    }
    const exact = key === "duct-systems" ? "SA 19" : `MUAS-1 / port ${fanPort}`;
    const identity = key === "duct-systems" ? systemCode(exact) : fanIdentity;
    if (scenario === "unknown-id") {
      const missing = "UniqueId:missing-roster-fan";
      expect(await call(JSON.stringify({ kind: "ids", ids: [missing] }))).toMatchObject({
        ok: false,
        result: {
          outcome: "refused",
          refusal: { message: `Unknown fan: ${missing}; choose an exact roster identity` },
        },
      });
      return;
    }
    if (scenario === "cold") {
      const result = call(JSON.stringify({ kind: "ids", ids: [identity] }));
      await waitFor(() => expect(sets).toBe(1));
      await act(async () => {
        pendingRoster();
      });
      expect(await result).toMatchObject({ ok: true, result: { outcome: "rendered" } });
      expect(await call("missing-cold-fan")).toMatchObject({
        ok: false,
        result: {
          outcome: "refused",
          refusal: { message: expect.stringContaining("missing-cold-fan") },
        },
      });
      return;
    }
    if (scenario === "active" || scenario === "case") {
      const missing =
        scenario === "active"
          ? "UniqueId:missing-active"
          : identity.replace(/:[a-f0-9-]+/, (key) => key.toUpperCase());
      expect(missing).not.toBe(identity);
      expect(
        await call(
          JSON.stringify({
            kind: "ids",
            ids: scenario === "active" ? [identity] : [missing],
            ...(scenario === "active" ? { active: missing } : {}),
          }),
        ),
      ).toMatchObject({
        ok: false,
        result: { outcome: "refused", refusal: { message: expect.stringContaining(missing) } },
      });
      return;
    }
    const lower = await call(exact.toLowerCase());
    expect(lower, JSON.stringify(lower)).toMatchObject({
      ok: true,
      result: { outcome: "rendered" },
    });
    expect(mount.page.read()[field]).toEqual({ kind: "ids", ids: [identity] });
    // A fan identity carries a port sub, so it is not a plain name: the ids equality above proves it.
    if (key === "duct-systems") expect(namesOf(mount.page.read()[field])).toEqual(["SA 19"]);
    // Encoded identities must resolve too: schema-valid does not mean present in this read.
    const beforeUnknown = mount.page.read();
    const missing = "UniqueId:f2f7a0d6-placeholder";
    expect(await call(JSON.stringify({ kind: "ids", ids: [missing] }))).toMatchObject({
      ok: false,
      result: { outcome: "refused", refusal: { message: expect.stringContaining(missing) } },
    });
    expect(mount.page.read()).toBe(beforeUnknown);
    expect(await call(JSON.stringify({ kind: "ids", ids: [identity] }))).toMatchObject({
      ok: true,
      result: { outcome: "rendered" },
    });
    // Add a differently-cased twin: exact spelling wins; a third casing must refuse the whole move.
    rosterData =
      key === "duct-systems"
        ? {
            ...rosterData,
            systems: [
              rosterData.systems[0],
              { ...rosterData.systems[0], id: 999999, name: exact.toLowerCase() },
            ],
          }
        : {
            ...rosterData,
            rows: [
              rosterData.rows[0],
              { ...rosterData.rows[0], mark: "muas-1", uniqueId: "other-fan" },
            ],
          };
    await act(async () => mount.refresh(roster));
    expect(await call(exact)).toMatchObject({ ok: true, result: { outcome: "rendered" } });
    const before = mount.page.read();
    expect(await call(key === "duct-systems" ? "Sa 19" : `Muas-1 / port ${fanPort}`)).toMatchObject(
      {
        ok: false,
        result: { outcome: "refused", refusal: { message: expect.stringContaining("Ambiguous") } },
      },
    );
    expect(mount.page.read()).toBe(before);
    deliverRoster = false;
    await act(async () => mount.refresh(roster));
    expect(await call(JSON.stringify({ kind: "ids", ids: [identity] }))).toMatchObject({
      ok: false,
      result: { outcome: "refused", refusal: { message: expect.stringContaining("4000 ms") } },
    });
  } finally {
    cleanup();
    mount.dispose();
    await host.close();
  }
});
