import { runInNewContext } from "node:vm";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, expectTypeOf, it } from "vite-plus/test";
import { createPeClient, peRoutes, matchPeRoute, servePeRoute, peClientScript } from "./pe-api.ts";

describe("the declared host door", () => {
  it("refuses an undeclared method/path before a handler can run", async () => {
    let called = false;
    const response = await servePeRoute(
      new Request("http://host/pe/threads/t/typo", { method: "POST" }),
      async () => {
        called = true;
        return Response.json({});
      },
    );
    expect(response.status).toBe(404);
    expect(called).toBe(false);
    expect(await response.json()).toMatchObject({ error: { code: "route.not-found" } });
  });
  it("derives the client, validates input, and preserves structured errors", async () => {
    const client = createPeClient("http://host", async (url, init) =>
      servePeRoute(new Request(url, init), async () =>
        Response.json({ error: "No pending question" }, { status: 409 }),
      ),
    );
    await expect(
      client.call("thread.question", {
        params: { id: "t" },
        body: { requestId: "q", action: "decline" },
      }),
    ).rejects.toMatchObject({ status: 409, message: "No pending question" });
    expect(matchPeRoute("POST", "/pe/threads/t/question")?.id).toBe("thread.question");
  });
  it("access-085: every route has schemas, principal, permission and a unique method/path", () => {
    const signatures = Object.values(peRoutes).map((r) => `${r.method} ${r.path}`);
    expect(new Set(signatures).size).toBe(signatures.length);
    for (const route of Object.values(peRoutes)) {
      expect(route.input).toBeDefined();
      expect(route.output).toBeDefined();
      expect(route.error).toBeDefined();
      expect(route.principal).toBeDefined();
      expect(route.permission).toBeDefined();
    }
  });
  it("access-084: administration and grant policy are declared on the route", () => {
    expect(peRoutes["provider.login"].permission).toBe("admin");
    expect(peRoutes["plugin.update"].permission).toBe("admin");
    // One capability, one path: turning a Pod off is plugin.update; there is no DELETE door.
    expect("plugin.remove" in peRoutes).toBe(false);
    expect(matchPeRoute("DELETE", "/pe/plugins/pod:sample")).toBeUndefined();
    expect(peRoutes["plugins.list"].permission).toBe("read");
    expect(peRoutes["thread.export"].permission).toBe("read");
    expect(peRoutes["scope.set"].permission).toBe("grant");
    expect(peRoutes["page.act"].principal).toBe("human-or-page");
  });
});

it("client types exclude undeclared paths and require the declared request", () => {
  const client = createPeClient();
  const compileOnly = () => {
    // @ts-expect-error A URL is not a declared route id.
    void client.call("/pe/undeclared", {});
    // @ts-expect-error The question contract requires a request id.
    void client.call("thread.question", { params: { id: "t" }, body: { action: "decline" } });
    // @ts-expect-error A thread call must name its path parameter.
    void client.call("thread.get", {});
  };
  expectTypeOf(compileOnly).toBeFunction();
  expectTypeOf<ReturnType<typeof client.call<"threads.list">>>().toEqualTypeOf<
    Promise<import("./harness-thread.ts").HarnessThreadSummary[]>
  >();
});

it("Pages executes the same serialized client with encoded path parameters", async () => {
  const seen: string[] = [];
  const client = runInNewContext(peClientScript(), {
    pe: {
      fetch: async (url: string) => {
        seen.push(url);
        return Response.json({});
      },
    },
    Headers,
    URLSearchParams,
  });
  await client.call("page.state", { params: { slug: "a b" } });
  expect(seen).toEqual(["/pages/a%20b/state"]);
  expect(() => client.url("missing", {})).toThrow("Unknown declared route");
});

it("host registrations cannot add a Pe route outside the table", () => {
  const host = join(import.meta.dirname, "../../../apps/host/src");
  for (const file of ["app.ts", "pe-routes.ts", "share.ts", "pages-route.ts"]) {
    const source = readFileSync(join(host, file), "utf8");
    expect(source).not.toMatch(/(?:router\.add|HttpRouter\.add)\([^\n]*["']\/pe\//);
  }
  for (const file of ["harness/threads.ts", "harness/providers.ts"]) {
    const source = readFileSync(join(host, file), "utf8");
    for (const match of source.matchAll(
      /(?:case |declared.id === )"((?:thread|threads|scope|provider|providers|access)\.[^"]+)"/g,
    )) {
      expect(Object.hasOwn(peRoutes, match[1]!)).toBe(true);
    }
  }
});

it("dynamic callers can consume declared streams and assets without JSON decoding", async () => {
  const client = createPeClient(
    "http://host",
    async () => new Response("data: []\n\n", { headers: { "content-type": "text/event-stream" } }),
  );
  const result = await client.invoke("resources.stream", {});
  expect(result).toBeInstanceOf(Response);
  expect(await (result as Response).text()).toBe("data: []\n\n");
});

it("the server refuses invalid input before dispatch and invalid output before publication", async () => {
  let called = false;
  const invalid = await servePeRoute(
    new Request("http://host/pe/threads/t/question", { method: "POST", body: "{}" }),
    async () => {
      called = true;
      return Response.json({ ok: true });
    },
  );
  expect(called).toBe(false);
  expect(await invalid.json()).toMatchObject({ error: { code: "route.input" } });
  const output = await servePeRoute(new Request("http://host/pe/threads"), async () =>
    Response.json({}),
  );
  expect(output.status).toBe(500);
  expect(await output.json()).toMatchObject({ error: { code: "route.output" } });
});

it("every action control is in the HTTP contract", async () => {
  const { actionControls } = await import("./semantic-actions.ts");
  for (const key of Object.keys(actionControls).filter((key) => key !== "action.read"))
    expect(Object.hasOwn(peRoutes, key)).toBe(true);
});

it("an empty Page text update crosses the contract", async () => {
  const answer = await servePeRoute(
    new Request("http://host/pages/test/text", { method: "PUT", body: "" }),
    async (request) => {
      expect(await request.text()).toBe("");
      return new Response(null, { status: 204 });
    },
  );
  expect(answer.status).toBe(204);
});

it("route consumers cannot recreate Pe paths beside the contract", () => {
  const root = join(import.meta.dirname, "../../../apps/host");
  for (const file of [
    "src/plugins-handler.ts",
    "src/thread-export.ts",
    "src/resource-adapters.ts",
    "src/demo-owner.ts",
    "src/pages-route.ts",
    "tests/schedule-test-fixture.ts",
  ]) {
    expect(readFileSync(join(root, file), "utf8"), file).not.toMatch(/\/pe\//);
  }
});

it("admission metadata: one explicit permission per route, and share stays local", () => {
  for (const route of Object.values(peRoutes)) {
    expect(typeof route.permission).toBe("string");
    expect(typeof route.localOnly).toBe("boolean");
  }
  expect(peRoutes["providers.add"]).toMatchObject({
    principal: "human",
    permission: "admin",
    localOnly: false,
  });
  expect(peRoutes["share.set"]).toMatchObject({
    principal: "human",
    permission: "admin",
    localOnly: true,
  });
  expect(peRoutes["page.bind"]).toMatchObject({
    principal: "human-or-pea",
    permission: "human-or-pea",
    localOnly: false,
  });
  expect(peRoutes["scope.revoke"]).toMatchObject({ principal: "human", permission: "human" });
});
