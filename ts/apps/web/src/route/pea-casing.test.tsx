// @vitest-environment jsdom
import { stableFanKey } from "../ducts/sheet/model";
import { systemCode } from "../ducts/identity";
import { useSyncExternalStore } from "react";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { emptyThreadHead, workFingerprintSchema } from "@pe/agent-contracts";
import { machineFixture } from "../../../../packages/agent-contracts/tests/machine-fixture";
import { RouteViewStore } from "@pe/runtime";
import { route, namesOf, type TypedRoute } from "./typed-route";
import { module as ducts } from "../ducts/route";
import { module as fans } from "../fans/route";
import { mountTypedRoute } from "../shell/typed-mount";
import { useRouteViewBridge } from "./view-bridge";
import { peReadings } from "../host/resource-stream";
import { peDo } from "../../../../packages/mcps/src/pea/capability-tools";
import { buildCapabilities } from "../../../../packages/mcps/src/pea/capabilities";
import { fakeRuntimeHost } from "../../../../packages/mcps/tests/runtime-host-fixture";
import { createPeClient } from "@pe/agent-contracts/pe-api";
import { fixture, ref } from "../../../host/tests/host-read-graph.test-support";
import { peClient } from "../host/pe-client";

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

test.each(["ducts", "fans"] as const)("Pea resolves %s subject names through the mounted typed view", async key => {
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  fakeRuntimeHost("http://127.0.0.1:19999");
  vi.stubEnv("PE_CONTEXT", "casing-context");
  // Retain the production fields and subject options. Native roster delivery is the only data adapter.
  const options = { edits: undefined, commands: {}, reads: {}, panes: {}, picture: undefined, title: undefined, layout: { kind: "pane", id: "unused" } } as const;
  const module: TypedRoute = key === "ducts"
    ? route({ ...ducts.spec, ...options, core: ducts.spec.subject!.read! })
    : route({ ...fans.spec, ...options, core: fans.spec.subject!.read! });
  const roster = module.spec.subject!.read!;
  const field = module.spec.subject!.field;
  let search = new URLSearchParams();
  const host = await fixture(true);
  const packet = key === "fans" ? await host.send(0, []) : await (await host.probe({
    read: "ducts.roster", args: { target: ref }, subscription: "casing-roster", generation: 1,
  })).json();
  let rosterData: any = structuredClone(packet.value!.data);
  if (key === "ducts") rosterData.systems = [{ ...rosterData.systems[0], name: "SA 19" }];
  else rosterData.rows = [{ ...rosterData.rows[0], mark: "MUAS-1" }];
  const fanIdentity = key === "fans" ? stableFanKey(rosterData.rows[0]) : "";
  const fanPort = key === "fans" ? rosterData.rows[0].portIndex : 0;
  const mount = mountTypedRoute(module, {
    target: null, fixture: null, work: { address: null, open: null }, memory: () => ({}), custody: { current: () => true },
    address: { read: () => search, write: next => { search = next; }, subscribe: () => () => {} },
  }, workFingerprintSchema.parse(`builtin-closure:${"a".repeat(64)}`), {
    sources: { [roster.key]: { kind: "use", open(_ctx, deliver) {
      deliver({ kind: "complete", revision: 1, value: { ...packet, value: { ...packet.value, data: rosterData } } });
    } } },
  });
  const registered = { key, title: module.spec.name, address: `/${key}`, fields: module.data.fields };
  const store = new RouteViewStore(() => [registered]);
  vi.spyOn(peReadings, "subscribe").mockImplementation((_reading, deliver) => store.subscribe(event => deliver({ kind: "event", value: event } as never)));
  const transport: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), "http://127.0.0.1:19999");
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (url.pathname === "/pe/scope/self") return Response.json({ ...emptyThreadHead, thread: "casing", revision: 1 });
    if (url.pathname === "/pe/capabilities") return Response.json({ at: new Date().toISOString(), machine: machineFixture([]), sources: { catalog: "ok" }, diagnostics: [],
      capabilities: buildCapabilities({ ops: [], routes: [], packages: [], skills: [], admittedRoutes: () => [registered] }) });
    const action = url.pathname.split("/").at(-1);
    if (init?.method === "PUT") return Response.json(store.publish(body));
    if (action === "ack") return Response.json(store.ack(body));
    if (action === "set") {
      const result = await store.set(body.thread, key, body.instance, body.revision, body.patch) as { ok: boolean };
      return Response.json(result, { status: result.ok ? 200 : 409 });
    }
    if (init?.method === "DELETE") { store.remove(action!); return Response.json({ ok: true }); }
    if (action === key) return Response.json(store.select("casing", key));
    throw Error(`Unexpected transport ${url}`);
  };
  vi.stubGlobal("fetch", transport);
  vi.spyOn(peClient, "call").mockImplementation(createPeClient("", transport).call);
  function Surface() {
    useSyncExternalStore(mount.subscribe, mount.revision, mount.revision);
    useRouteViewBridge({ route: key, codec: mount.attention, thread: "casing", surface: "route", visible: true,
      page: mount.page.read(), context: {}, facts: {}, apply: patch => {
        mount.move(patch as Record<string, unknown>, "push");
        return { ok: true, moved: true, receipt: { current: () => true, rendered: page => page === mount.page.read() } };
      } });
    return <output>{JSON.stringify(mount.page.read()[field])}</output>;
  }
  const router = createRouter({ routeTree: createRootRoute({ component: Surface }), history: createMemoryHistory({ initialEntries: [`/${key}`] }) });
  const call = async (name: string) => {
    const lease = store.select("casing", key) as any;
    let result: any;
    await act(async () => { void peDo.execute!({ key: `route:${key}.set-view`, input: { instance: lease.instance, revision: lease.revision, [field]: name } } as never, { agent: { toolCallId: "casing" } } as never).then(value => { result = value; }); });
    await waitFor(() => expect(result).toBeDefined());
    return result;
  };
  try {
    render(<RouterProvider router={router} />);
    await waitFor(() => expect(store.select("casing", key)).toHaveProperty("instance"));
    const exact = key === "ducts" ? "SA 19" : `MUAS-1 / port ${fanPort}`;
    const identity = key === "ducts" ? systemCode(exact) : fanIdentity;
    const lower = await call(exact.toLowerCase());
    expect(lower, JSON.stringify(lower)).toMatchObject({ ok: true, result: { outcome: "rendered" } });
    expect(mount.page.read()[field]).toEqual({ kind: "ids", ids: [identity] });
    // A fan identity carries a port sub, so it is not a plain name: the ids equality above proves it.
    if (key === "ducts") expect(namesOf(mount.page.read()[field])).toEqual(["SA 19"]);
    // Add a differently-cased twin: exact spelling wins; a third casing must refuse the whole move.
    rosterData = key === "ducts" ? { ...rosterData, systems: [rosterData.systems[0], { ...rosterData.systems[0], id: 999999, name: exact.toLowerCase() }] } : {
      ...rosterData, rows: [rosterData.rows[0], { ...rosterData.rows[0], mark: "muas-1", uniqueId: "other-fan" }],
    };
    await act(async () => mount.refresh(roster));
    expect(await call(exact)).toMatchObject({ ok: true, result: { outcome: "rendered" } });
    const before = mount.page.read();
    expect(await call(key === "ducts" ? "Sa 19" : `Muas-1 / port ${fanPort}`)).toMatchObject({ ok: false, result: { outcome: "refused", refusal: { message: expect.stringContaining("Ambiguous") } } });
    expect(mount.page.read()).toBe(before);
  } finally { cleanup(); mount.dispose(); await host.close(); }
});
