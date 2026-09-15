import { test, expect, vi } from "vite-plus/test";
import { Context, Effect, Layer } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/unstable/http";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { turnContextKey } from "@pe/agent-contracts";
import {
  peDo,
  configurePeaProductToolContext,
} from "../../../packages/mcps/src/pea/capability-tools.ts";
import { buildCapabilities } from "../../../packages/mcps/src/pea/capabilities.ts";
import { createRouteRegistrations } from "../../../packages/mcps/src/pea/routes.ts";
import { ActionJournal } from "../src/action-journal.ts";
import { RevitBridge } from "../src/bridge.ts";
import { makeCallRoute } from "../src/call-route.ts";
import { opsCatalogRoute } from "../src/ops-catalog.ts";
import { productUserContentRootPath } from "../src/product-paths.ts";
import { sdkSessions } from "./native-receipt-fixture.ts";

test("actual pod:key Pea caller uses public script admission with frozen A/override B/A; reconstruction and lost acceptance retain original partial reply without live discovery", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pod-consumer-"));
  const oldRoot = process.env.PE_TOOLS_DOCUMENTS_ROOT;
  process.env.PE_TOOLS_DOCUMENTS_ROOT = dir;
  configurePeaProductToolContext({ hostBaseUrl: "http://pod-consumer" });
  const workspace = join(productUserContentRootPath(), "workspaces", "sample");
  await mkdir(join(workspace, "src"), { recursive: true });
  const manifest = {
    id: "sample",
    name: "Sample",
    entrypoints: [{ id: "main", sourcePath: "src/Main.cs" }],
  };
  await writeFile(join(workspace, "pod.json"), JSON.stringify(manifest));
  await writeFile(join(workspace, "src/Main.cs"), "// authored pod source");
  const journal = join(dir, "journal.json");
  let owner = new ActionJournal(journal),
    gone = false,
    lost = false;
  const effects: { session: string; openId: string; requestId: string }[] = [];
  const operations = [
    {
      key: "scripting.execute",
      intent: "Mutate" as const,
      needs: "document" as const,
      requestSchemaJson: '{"type":"object"}',
    },
    { key: "scripting.pod.list", intent: "Read" as const, needs: "nothing" as const },
  ];
  const pods = {
    workspacesRootPath: workspace,
    pods: [{ workspaceKey: "sample", isValid: true, manifest }],
  };
  const sessions = ["A", "B"].map((sessionId) => ({
    connected: true,
    sessionId,
    processId: 42,
    processStartUtcUnixMs: 1000,
    state: {
      openDocuments: [
        {
          openId: `open-${sessionId}`,
          title: sessionId,
          address: `C:/${sessionId}.rvt`,
          isFamilyDocument: false,
        },
      ],
    },
  }));
  const bridge = {
    list: Effect.sync(() => (gone ? [] : sessions)),
    invoke: (
      key: string,
      input: { workspaceKey: string; sourcePath: string },
      session: string,
      openId: string,
      requestId: string,
    ) =>
      Effect.promise(async () => {
        if (gone) throw Error("native catalogue unavailable");
        if (key === "host.ops.catalog") {
          expect(openId).toBeNull();
          return { value: { operations } };
        }
        if (key === "scripting.pod.list") {
          expect(openId).toBeNull();
          return { value: pods };
        }
        effects.push({ session, openId, requestId });
        expect(
          await readFile(
            join(productUserContentRootPath(), "workspaces", input.workspaceKey, input.sourcePath),
            "utf8",
          ),
        ).toBe("// authored pod source");
        return {
          value: {
            success: false,
            diagnostics: [{ message: "native partial/refusal payload retained" }],
          },
        };
      }),
  } as unknown as RevitBridge["Service"];
  const registrations = createRouteRegistrations({ hostBaseUrl: "http://pod-consumer" });
  const makeWeb = () =>
    HttpRouter.toWebHandler(
      Layer.mergeAll(
        makeCallRoute(owner, undefined, { sdk: sdkSessions }),
        opsCatalogRoute(() => Effect.die("not navigation")),
        HttpRouter.add("GET", "/pe/capabilities", () =>
          Effect.sync(() =>
            HttpServerResponse.jsonUnsafe({
              at: new Date().toISOString(),
              bridgeSessionId: "A",
              sessions: [],
              sources: {},
              capabilities: buildCapabilities({
                ops: operations,
                routes: registrations.map(({ spec }) => spec),
                pods: pods as never,
                skills: [],
              }),
            }),
          ),
        ),
      ).pipe(Layer.provideMerge(Layer.succeed(RevitBridge, bridge))),
      { disableLogger: true },
    );
  let web = makeWeb();
  const paths: string[] = [];
  vi.stubGlobal("fetch", async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    paths.push(url.pathname);
    if (gone && (url.pathname === "/ops" || url.pathname === "/pe/capabilities"))
      throw Error("discovery gone");
    const response = await web.handler(new Request(url, init), Context.empty() as never);
    if (!lost && url.pathname === "/actions" && init?.method === "POST") {
      lost = true;
      throw Error("lost accepted reply");
    }
    return response;
  });
  const turn = {
    id: "55555555-5555-4555-8555-555555555555",
    thread: "pod-thread",
    defaultTarget: { kind: "open" as const, ref: { session: "A", openId: "open-A" } },
    revision: 7,
  };
  const run = (id: string, target?: { kind: "open"; ref: { session: string; openId: string } }) =>
    peDo.execute!(
      {
        key: "pod:sample.main",
        input: {},
        timeoutSeconds: 5,
        ...(target ? { target } : {}),
      } as never,
      { agent: { toolCallId: id }, requestContext: { [turnContextKey]: turn } } as never,
    );
  try {
    expect(registrations.some(({ spec }) => spec.route === "pods")).toBe(false);
    for (const [id, target] of [
      ["pod-A1", undefined],
      ["pod-B", { kind: "open", ref: { session: "B", openId: "open-B" } }],
      ["pod-A2", undefined],
    ] as const) {
      const result = await run(id, target);
      expect(result, JSON.stringify(result)).toMatchObject({
        ok: true,
        result: { action: { id, kind: "operation" }, response: { success: false } },
      });
    }
    expect(effects.map(({ session, openId }) => [session, openId])).toEqual([
      ["A", "open-A"],
      ["B", "open-B"],
      ["A", "open-A"],
    ]);
    const original = (await owner.list(undefined, "pod-B"))[0];
    await web.dispose();
    owner = new ActionJournal(journal);
    web = makeWeb();
    gone = true;
    await rm(workspace, { recursive: true, force: true });
    expect(await run("pod-B")).toMatchObject({
      ok: true,
      result: { action: { id: "pod-B" }, response: { success: false } },
    });
    expect((await owner.list(undefined, "pod-B"))[0]).toEqual(original);
    expect(effects).toHaveLength(3);
    expect(paths.some((path) => path.includes("route-state"))).toBe(false);
  } finally {
    await web.dispose();
    vi.unstubAllGlobals();
    configurePeaProductToolContext({});
    if (oldRoot === undefined) delete process.env.PE_TOOLS_DOCUMENTS_ROOT;
    else process.env.PE_TOOLS_DOCUMENTS_ROOT = oldRoot;
    await rm(dir, { recursive: true, force: true });
  }
}, 15000);
