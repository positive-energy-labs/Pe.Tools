import { Context, Effect, Layer } from "effect";
import { HttpRouter } from "effect/unstable/http";
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
import { expect, test, vi } from "vite-plus/test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ActionJournal } from "../../../host/src/action-journal";
import { RevitBridge } from "../../../host/src/bridge";
import { makeCallRoute } from "../../../host/src/call-route";
import { opsCatalogRoute } from "../../../host/src/ops-catalog";
import { createOpsStore, type OpsPageSeed } from "./store";
import { opsRefusal, type HostOperationCatalogEntry } from "./manifest";
import { readAction } from "../../../../packages/mcps/src/shared/takeoff-action-client";

test("host-only Ops uses actual catalogue/router/journal; two page seeds isolate drafts and original receipt survives lost response/remount/catalog loss", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ops-journal-"));
  const journal = join(dir, "actions.json");
  let owner = new ActionJournal(journal),
    launches = 0;
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const native = vi.fn(() => Effect.die("No native catalogue or execution without selection"));
  const bridge = { list: Effect.succeed([]), invoke: native } as unknown as RevitBridge["Service"];
  const makeWeb = () =>
    HttpRouter.toWebHandler(
      Layer.mergeAll(
        makeCallRoute(owner, undefined, {
          launchShell: async () => {
            launches++;
            await held;
          },
        }),
        opsCatalogRoute(() => Effect.die("not navigation")),
      ).pipe(Layer.provideMerge(Layer.succeed(RevitBridge, bridge))),
      { disableLogger: true },
    );
  let web = makeWeb();
  let lost = false,
    catalogGone = false;
  const paths: string[] = [];
  vi.stubGlobal("fetch", async (input: string, init?: RequestInit) => {
    const url = new URL(input, "http://ops");
    // The read caller emits existing analytics; keep this owner proof local and offline.
    if (url.origin !== "http://ops") return new Response(null, { status: 204 });
    paths.push(url.pathname);
    if (catalogGone && url.pathname === "/ops") throw Error("catalogue disappeared");
    const response = await web.handler(new Request(url, init), Context.empty() as never);
    if (!lost && url.pathname === "/actions" && init?.method === "POST") {
      lost = true;
      throw Error("lost acceptance reply");
    }
    return response;
  });
  const registry = AtomRegistry.make();
  let seed: OpsPageSeed | undefined;
  const a = createOpsStore({
    registry,
    hostBaseUrl: "http://ops",
    onSeed: (value) => {
      seed = value;
    },
  });
  const b = createOpsStore({ registry, hostBaseUrl: "http://ops" });
  let restored: ReturnType<typeof createOpsStore> | undefined;
  try {
    const catalogue = await (await fetch("http://ops/ops")).json();
    const host = catalogue.operations.find(
      (row: HostOperationCatalogEntry) => row.key === "host.shell.open",
    );
    expect(host).toBeDefined();
    expect(native).not.toHaveBeenCalled();
    // The manifest answers readiness directly now; the Product/ActionButton indirection is deleted.
    expect(opsRefusal(host, undefined, {})).toBeNull();
    await a.actions.setBindings({ bound: { op: host.key } }, { target: "host" });
    a.actions.setArgs("pane A");
    b.actions.setArgs("pane B");
    const run = a.actions.run({ opKey: host.key, request: () => ({ path: dir }), target: "host" });
    await vi.waitFor(() => expect(launches).toBe(1));
    expect(seed?.actionId).toBeTruthy();
    b.actions.setArgs("pane B edited during action");
    a.dispose();
    restored = createOpsStore({
      registry,
      initial: seed,
      hostBaseUrl: "http://ops",
    });
    expect(registry.get(restored.atoms.args)).toBe("pane A");
    expect(registry.get(b.atoms.args)).toBe("pane B edited during action");
    expect(registry.get(restored.atoms.actionId)).toBe(seed!.actionId);
    expect((await readAction(seed!.actionId!, "http://ops"))?.state).toBe("running");
    await restored.actions.run({
      opKey: "bridge.sessions.list",
      request: () => undefined,
      target: "host",
    });
    expect(registry.get(restored.atoms.actionId)).toBe(seed!.actionId);
    expect(launches).toBe(1);
    // A Refusal is RETURNED, never thrown.
    expect(
      (
        await restored.actions.run({
          opKey: host.key,
          request: () => ({ path: dir }),
          target: "host",
        })
      )?.message,
    ).toContain("original action");
    release();
    await run;
    await web.dispose();
    owner = new ActionJournal(journal);
    web = makeWeb();
    catalogGone = true;
    const receipt = await readAction(seed!.actionId!, "http://ops");
    expect(receipt).toMatchObject({
      state: "succeeded",
      kind: "operation",
      destination: { kind: "host" },
      result: { opened: true },
      publication: { state: "unrequested" },
    });
    expect(launches).toBe(1);
    expect(
      paths.every((path) => path === "/ops" || path === "/actions" || path === "/call"),
      JSON.stringify(paths),
    ).toBe(true);
    expect(native).not.toHaveBeenCalled();
  } finally {
    release();
    a.dispose();
    b.dispose();
    restored?.dispose();
    registry.dispose();
    vi.unstubAllGlobals();
    await web.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});

test("Ops demands exact native session and lifetime only for the selected operation", () => {
  const native = {
    key: "revit.apply.schedule",
    intent: "Mutate",
    needs: "document",
  } as HostOperationCatalogEntry;
  expect(opsRefusal(native, undefined, {})).toMatch(/exact Revit session/);
  expect(opsRefusal(native, "controlled", { session: "B" })).toMatch(/exact open document/);
  expect(opsRefusal(native, "controlled", { session: "B", openId: "original" })).toBeNull();
  expect(opsRefusal(native, "observed", { session: "B", openId: "original" })).toMatch(
    /controlled/,
  );
});
