import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { randomUUID } from "node:crypto";
import { Effect } from "effect";
import ts from "typescript";
import { expect, test, vi } from "vite-plus/test";
import { HOST_CONTEXT_HEADER, HOST_RUNTIME_SERVICE_HEADER } from "@pe/host-contracts/contracts";
import { ActionJournal } from "../src/action-journal.ts";
import { RevitBridge } from "../src/bridge.ts";
import { makeCallRoute } from "../src/call-route.ts";
import { CaptureStore } from "../src/captures-route.ts";
import { mintContext } from "../src/control.ts";
import { hostOwnership } from "../src/host-ownership.ts";
import { crossingOf } from "./callers.ts";
import { sdkSessions } from "./native-receipt-fixture.ts";
import { bootHost, serveRoutes } from "./real-server.ts";

vi.mock("../src/pe-revit-launch.ts", async (original) => ({
  ...(await original<typeof import("../src/pe-revit-launch.ts")>()),
  peRevitLauncher: () => ({ cmd: process.execPath, args: [] }),
}));

type Answer = { status: number; code: string | undefined; text: string };
const send = async (
  url: string,
  method: string,
  headers: Record<string, string>,
  body?: unknown,
): Promise<Answer> => {
  const response = await fetch(url, {
    method,
    headers: { "content-type": "application/json", ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let code: string | undefined;
  try {
    code = (JSON.parse(text) as { refusal?: { code?: string } }).refusal?.code;
  } catch {}
  return { status: response.status, code, text };
};
const token = (value: string) => ({ [HOST_CONTEXT_HEADER]: value });
const browser = (base: string, path: string) => ({
  [HOST_RUNTIME_SERVICE_HEADER]: hostOwnership.serviceName,
  origin: base,
  "sec-fetch-site": "same-origin",
  referer: `${base}${path}`,
});

/**
 * The rule (ADR 0017 D2 carriage): a door reads its caller once, before its first suspension, and
 * passes it down. The caller lives in AsyncLocalStorage, and an Effect fiber resumed by a socket or
 * bridge callback runs outside it; a read there used to come back anonymous (acceptance F1).
 */
test("no door reads its caller after a suspension", () => {
  const src = join(import.meta.dirname, "..", "src");
  const late: string[] = [];
  const files = (readdirSync(src, { recursive: true }) as string[]).filter((f) =>
    f.endsWith(".ts"),
  );
  for (const file of files) {
    const text = readFileSync(join(src, file), "utf8");
    if (!text.includes("currentCaller(")) continue;
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "currentCaller"
      ) {
        let fn: ts.Node | undefined = node.parent;
        while (fn && !ts.isFunctionLike(fn)) fn = fn.parent;
        let suspended = false;
        const scan = (inner: ts.Node): void => {
          if (inner !== fn && ts.isFunctionLike(inner)) return;
          if (
            (ts.isAwaitExpression(inner) || ts.isYieldExpression(inner)) &&
            inner.getStart() < node.getStart()
          )
            suspended = true;
          ts.forEachChild(inner, scan);
        };
        if (fn) ts.forEachChild(fn, scan);
        if (suspended) {
          const { line } = source.getLineAndCharacterOfPosition(node.getStart());
          late.push(`${relative(src, join(src, file))}:${line + 1}`);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  expect(late).toEqual([]);
});

/**
 * F1 (acceptance 2026-10-13): every caller reached `/actions` as anonymous on the real host. Only
 * a real Node server reproduces that; `toWebHandler` and direct `admit()` calls do not.
 */
test("/actions sees each principal's real carriage through the real HTTP server", async () => {
  const host = await bootHost();
  try {
    const destination = {
      kind: "document",
      ref: { session: "session-carriage", openId: "carriage-open-id" },
    };
    const post = async (headers: Record<string, string>) => {
      const answer = await send(`${host.base}/actions`, "POST", headers, {
        id: randomUUID(),
        kind: "operation",
        key: "revit.apply.parameter-values",
        destination,
        input: { edits: [{ elementId: 1, parameterName: "View Name" }], dryRun: true },
      });
      return answer.code ?? `admitted:${answer.status}`;
    };
    // Control: nobody stays nobody.
    expect(await post({})).toBe("context.missing");
    expect(await post(token(host.terminal))).not.toBe("context.missing");
    expect(await post(token(mintContext({ kind: "pea", thread: "t-carriage" })))).toBe(
      "grant.required",
    );
    expect(await post(token(mintContext({ kind: "external-mcp", label: "ext" })))).toBe(
      "grant.context-cannot-hold",
    );
    expect(await post(browser(host.base, "/open"))).not.toBe("context.missing");
    expect(await post(browser(host.base, "/pages/carriage/"))).toBe("page.use-page-door");
  } finally {
    await host.close();
  }
}, 30_000);

/**
 * ADR 0017 D2, "anonymous loopback is read-only": machine administration (the approval guard,
 * providers, automatic updates, the share switch) is a person's act. Pea, a Page, an MCP client and
 * an anonymous process are refused before the door runs; the owner's terminal and browser pass.
 */
test("administration doors refuse every principal except a human", async () => {
  const host = await bootHost();
  try {
    const doors: [string, string, unknown][] = [
      ["PUT", "/pe/access", { guarded: "not-a-boolean" }],
      ["POST", "/pe/providers", {}],
      ["DELETE", "/pe/providers/nobody", undefined],
      ["POST", "/pe/providers/nobody/open-login", undefined],
      ["POST", "/host/update/automatic", { enabled: "not-a-boolean" }],
      ["POST", "/host/update", { planId: "not-a-plan" }],
      ["PUT", "/pe/share", {}],
    ];
    for (const [method, path, body] of doors) {
      const at = (headers: Record<string, string>) =>
        send(`${host.base}${path}`, method, headers, body);
      const door = `${method} ${path}`;
      expect((await at({})).code, door).toBe("context.missing");
      for (const headers of [
        token(mintContext({ kind: "pea", thread: "t-admin" })),
        token(mintContext({ kind: "external-mcp", label: "ext" })),
        browser(host.base, "/pages/carriage/"),
      ]) {
        const refused = await at(headers);
        expect([refused.status, refused.code], door).toEqual([403, "human.only"]);
      }
      for (const headers of [token(host.terminal), browser(host.base, "/settings")]) {
        const reached = await at(headers);
        expect(reached.status, `${door}: ${reached.text}`).not.toBe(403);
      }
    }
    // The unguarded switch itself: anonymous loopback can no longer turn the approval guard off.
    expect((await send(`${host.base}/pe/access`, "PUT", {}, { guarded: false })).status).toBe(403);
    expect(
      JSON.parse((await send(`${host.base}/pe/access`, "GET", {})).text) as { guarded: boolean },
    ).toEqual({ guarded: true });
  } finally {
    await host.close();
  }
}, 30_000);

/**
 * Every caller-reading door outside `/actions`: each sees its caller after its body arrived on the
 * socket. A lost caller would show as `context.missing` for the human.
 */
test("the harness, Page and route-state doors carry their caller through the real HTTP server", async () => {
  const host = await bootHost();
  const pea = token(mintContext({ kind: "pea", thread: "t-doors" }));
  const human = token(host.terminal);
  const page = browser(host.base, "/pages/carriage/");
  const at = (method: string, path: string, headers: Record<string, string>, body?: unknown) =>
    send(`${host.base}${path}`, method, headers, body);
  const humanReached = (answer: Answer) => {
    expect(answer.code, answer.text).not.toBe("context.missing");
    expect(answer.code, answer.text).not.toBe("human.only");
  };
  try {
    // POST /pe/scope/:thread/revoke: human-only.
    expect((await at("POST", "/pe/scope/t-doors/revoke", {})).code).toBe("context.missing");
    expect((await at("POST", "/pe/scope/t-doors/revoke", pea)).code).toBe("human.only");
    humanReached(await at("POST", "/pe/scope/t-doors/revoke", human));
    // PUT /pe/scope/self: Pea's own thread comes from its context, never a path.
    const self = await at("PUT", "/pe/scope/self", pea, { kind: "none" });
    expect(self.text).not.toMatch(/answers only a Pea harness context/);
    // PUT /pe/pages/:slug/binding: a person binds; a Page never binds itself.
    const binding = "/pe/pages/carriage/binding";
    expect((await at("PUT", binding, {}, { kind: "none" })).code).toBe("context.missing");
    expect((await at("PUT", binding, page, { kind: "none" })).status).toBe(403);
    const bound = await at("PUT", binding, human, { kind: "none" });
    expect(bound.status, bound.text).toBe(200);
    // POST /pages/:slug/act: the Page or a person; Pea would borrow a binding.
    const act = "/pages/carriage/act";
    expect((await at("POST", act, {}, { key: "x" })).code).toBe("context.missing");
    expect((await at("POST", act, pea, { key: "x" })).code).toBe("page.binding-not-yours");
    humanReached(await at("POST", act, human, { key: "x" }));
    humanReached(await at("POST", act, page, { key: "x" }));
    // POST /pages/:slug/events: each row's origin is the caller that carried it.
    for (const headers of [human, page, pea])
      expect((await at("POST", "/pages/carriage/events", headers, { n: 1 })).status).toBe(201);
    const state = JSON.parse((await at("GET", "/pages/carriage/state", {})).text) as {
      events: { origin: string }[];
    };
    expect(state.events.map((row) => row.origin)).toEqual([
      "human",
      "page:@pages/carriage",
      "agent",
    ]);
    // POST /pe/route-state/:route/:verb: the author is the carried caller.
    const write = "/pe/route-state/families/apply";
    expect((await at("POST", write, {}, {})).code).toBe("context.missing");
    expect((await at("POST", write, page, {})).code).toBe("page.use-page-door");
    humanReached(await at("POST", write, human, {}));
  } finally {
    await host.close();
  }
}, 30_000);

const bridgeA = (onInvoke: (key: string) => unknown) =>
  ({
    list: Effect.succeed([
      {
        sessionId: "bridge-a",
        connected: true,
        lane: hostOwnership.lane,
        sourceRoot: hostOwnership.sourceRoot,
        serviceName: hostOwnership.serviceName,
        processId: 42,
        processStartUtcUnixMs: 1000,
        state: {
          openDocuments: [
            {
              openId: "open-a",
              address: "C:/HVAC.rvt",
              title: "HVAC.rvt",
              isFamilyDocument: false,
            },
          ],
        },
      },
    ]),
    invoke: (key: string) =>
      Effect.promise(async () => {
        // A macrotask hop, as a real bridge answer arrives on a socket callback.
        await new Promise((resolve) => setTimeout(resolve, 5));
        return onInvoke(key);
      }),
  }) as unknown as RevitBridge["Service"];
const scoped = { "x-pe-bridge-session-id": "bridge-a", "x-pe-open-document-id": "open-a" };

/** `/call` reads the caller after the body and the bridge answer: a capture's origin is the caller. */
test("/call attributes a view-image capture to the caller it was carried by", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pe-host-carriage-call-"));
  writeFileSync(join(dir, "L1.png"), "png-l1");
  const store = new CaptureStore(join(dir, "store"));
  const server = await serveRoutes(
    makeCallRoute(undefined, undefined, { captureStore: store, sdk: sdkSessions }),
    bridgeA((key) =>
      key === "host.ops.catalog"
        ? {
            value: {
              operations: [{ key: "revit.context.view-image", intent: "Read", needs: "document" }],
            },
            target: null,
          }
        : {
            value: {
              view: { kind: "View", elementId: 7, label: "Floor Plan: L1" },
              filePath: join(dir, "L1.png"),
              byteSize: 6,
              pixelSize: 1500,
              registrationRefusal: "NoCrop",
            },
            target: { session: "bridge-a", document: "C:/HVAC.rvt" },
          },
    ),
  );
  try {
    for (const caller of [
      mintContext({ kind: "human", via: "cli" }),
      mintContext({ kind: "pea", thread: "t-carriage" }),
    ]) {
      const answer = await send(
        `${server.base}/call`,
        "POST",
        { ...token(caller), ...scoped },
        {
          key: "revit.context.view-image",
          request: {},
        },
      );
      expect(answer.status, answer.text).toBe(200);
    }
    const origins = readFileSync(join(dir, "store", "receipts.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => (JSON.parse(line) as { origin: string }).origin);
    expect(origins).toEqual(["human", "agent"]);
  } finally {
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  }
}, 30_000);

/** `/actions/<control>` and `/families/readings` judge the caller that sent the body. */
test("action controls and the Families reading judge their real caller", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pe-host-carriage-controls-"));
  const owner = new ActionJournal(join(dir, "attempts.json"));
  const admitted = await owner.admit(
    {
      id: "carriage-original",
      kind: "operation",
      key: "revit.context.view-image",
      destination: { kind: "document", ref: { session: "bridge-a", openId: "open-a" } },
      input: {},
      bases: {},
      ...crossingOf("human"),
    },
    async () => ({}),
    async () => ({}),
  );
  await owner.wait(admitted.id);
  const server = await serveRoutes(
    makeCallRoute(owner, undefined, { sdk: sdkSessions }),
    bridgeA((key) =>
      key === "host.ops.catalog"
        ? {
            value: {
              operations: [
                {
                  key: "revit.matrix.loaded-families",
                  intent: "Read",
                  needs: "document",
                  actor: "human",
                },
              ],
            },
            target: null,
          }
        : { value: {}, target: null },
    ),
  );
  const human = token(mintContext({ kind: "human", via: "cli" }));
  const pea = token(mintContext({ kind: "pea", thread: "t-controls" }));
  try {
    for (const verb of ["cancel", "recover"]) {
      const control = (headers: Record<string, string>) =>
        send(`${server.base}/actions/${verb}`, "POST", headers, { id: admitted.id });
      expect((await control({})).code, verb).toBe("context.missing");
      expect((await control(pea)).code, verb).toBe("human.only");
      const reached = await control(human);
      expect(reached.code, reached.text).toBeUndefined();
    }
    const families = (headers: Record<string, string>) =>
      send(
        `${server.base}/families/readings`,
        "POST",
        { ...headers, ...scoped },
        {
          work: { binding: "workspace", route: "families", target: null, work: "production" },
          filter: { categoryNames: ["Ducts"], familyNames: [], placementScope: "AllLoaded" },
        },
      );
    expect((await families({})).text).toMatch(/anonymous calls are refused/);
    expect((await families(pea)).text).toMatch(/pea calls are refused/);
    expect((await families(human)).text).toMatch(/Families Work belongs to another document/);
  } finally {
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  }
}, 30_000);
