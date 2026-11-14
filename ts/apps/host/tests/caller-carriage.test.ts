import { serviceHeaders } from "./callers.ts";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { randomUUID } from "node:crypto";
import ts from "typescript";
import { expect, test, vi } from "vite-plus/test";
import { HOST_CONTEXT_HEADER } from "@pe/host-contracts/contracts";
import { mintBrowserContext, mintContext } from "../src/control.ts";
import { bootHost } from "./real-server.ts";

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
    code =
      (JSON.parse(text) as { error?: { code?: string }; refusal?: { code?: string } }).error
        ?.code ?? (JSON.parse(text) as { refusal?: { code?: string } }).refusal?.code;
  } catch {}
  return { status: response.status, code, text };
};
const token = (value: string) => ({ [HOST_CONTEXT_HEADER]: value });
const browser = (base: string, path: string) => ({
  cookie: mintBrowserContext({ kind: "local" }).split(";")[0]!,
  ...serviceHeaders(),
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
    const post = async (headers: Record<string, string>) => {
      const answer = await send(`${host.base}/actions`, "POST", headers, {
        id: randomUUID(),
        key: "pod.member.write",
        target: { kind: "host" },
        input: { pod: "carriage", path: "settings/carriage.json", content: "{}" },
      });
      return answer.code ?? `admitted:${answer.status}`;
    };
    // Control: nobody stays nobody.
    expect(await post({})).toBe("context.missing");
    expect(await post(token(host.terminal))).not.toBe("context.missing");
    expect(await post(token(mintContext({ kind: "pea", thread: "t-carriage" })))).toBe("run.none");
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
    // PUT /pe/scope/:thread: a human sets any thread's targets; anonymous never does.
    const none = { targets: [], expectedRevision: 0 };
    expect((await at("PUT", "/pe/scope/t-doors", {}, none)).code).toBe("context.missing");
    humanReached(await at("PUT", "/pe/scope/t-doors", human, none));
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
    const patch = { patches: [], expectedRevision: 0, press: crypto.randomUUID() };
    expect((await at("POST", write, {}, patch)).code).toBe("context.missing");
    expect((await at("POST", write, page, patch)).code).toBe("human.only");
    humanReached(await at("POST", write, human, patch));
  } finally {
    await host.close();
  }
}, 30_000);

test("operation and action failures use the declared transport envelope without losing refusal evidence", async () => {
  const host = await bootHost();
  try {
    for (const [path, body] of [
      ["/call", { key: "not.an.operation", request: {} }],
      ["/actions", {}],
    ] as const) {
      const response = await fetch(`${host.base}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      expect(response.ok).toBe(false);
      expect(await response.json()).toMatchObject({
        error: {
          code: expect.any(String),
          message: expect.any(String),
          details: expect.anything(),
        },
      });
    }
  } finally {
    await host.close();
  }
});
