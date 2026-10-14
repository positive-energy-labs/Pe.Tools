import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Effect, Layer } from "effect";
import { expect, test } from "vite-plus/test";
import { HOST_CONTEXT_HEADER, HOST_RUNTIME_SERVICE_HEADER } from "@pe/host-contracts/contracts";
import { ActionJournal } from "../src/action-journal.ts";
import { RevitBridge } from "../src/bridge.ts";
import { makeCallRoute } from "../src/call-route.ts";
import { mintContext } from "../src/control.ts";
import { hostOwnership } from "../src/host-ownership.ts";
import { pagesRoute } from "../src/pages-route.ts";
import { sdkSessions } from "./native-receipt-fixture.ts";
import { serveRoutes } from "./real-server.ts";

/**
 * Acceptance round 4c §3: the route-prefs Page, pinned by a person to a document the person opened,
 * pressed "read routing preferences" (`pe.script(READ)`, ReadOnly by default) and the host refused
 * it as a write. Rule: a script whose requested mode is ReadOnly (the contract default) is a read at
 * every door; reads never need a grant (ADR 0017 D8). NoTransaction and WriteTransaction stay writes.
 */
const MODEL = "C:/Jobs/HVAC.rvt";
const doc = { session: "bridge-a", openId: "open-a" };
const census = "Result(new { types = 2 });";
type Sent = { key: string; request: Record<string, unknown>; openId: string | null };

function humanRevit(sent: Sent[]) {
  return {
    list: Effect.succeed([
      {
        sessionId: doc.session,
        connected: true,
        lane: hostOwnership.lane,
        sourceRoot: hostOwnership.sourceRoot,
        serviceName: hostOwnership.serviceName,
        processId: 42,
        processStartUtcUnixMs: 1000,
        state: {
          openDocuments: [
            { openId: doc.openId, address: MODEL, title: "HVAC", isFamilyDocument: false },
          ],
        },
      },
    ]),
    invoke: (key: string, request: Record<string, unknown>, _s: string, openId: string | null) =>
      Effect.promise(async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        if (key === "host.ops.catalog")
          return {
            value: {
              operations: [
                {
                  key: "scripting.execute",
                  intent: "Mutate",
                  needs: "document",
                  actor: "any",
                  requestSchemaJson: JSON.stringify({ type: "object" }),
                },
              ],
            },
            target: null,
          };
        sent.push({ key, request, openId });
        return { value: { status: "Succeeded", data: { types: 2 } }, target: null };
      }),
  } as unknown as RevitBridge["Service"];
}

async function serve() {
  const dir = mkdtempSync(join(tmpdir(), "pe-host-readonly-script-"));
  const pages = join(dir, "pages");
  mkdirSync(join(pages, "route-prefs"), { recursive: true });
  writeFileSync(join(pages, "route-prefs", "index.html"), "<!doctype html><title>rp</title>");
  const sent: Sent[] = [];
  const server = await serveRoutes(
    Layer.mergeAll(
      makeCallRoute(new ActionJournal(join(dir, "attempts.json")), undefined, {
        sdk: sdkSessions,
      }),
      pagesRoute(
        () => pages,
        () => join(dir, "pods"),
      ),
    ),
    humanRevit(sent),
  );
  const send = async (
    path: string,
    headers: Record<string, string>,
    body: unknown,
    put = false,
  ) => {
    const response = await fetch(`${server.base}${path}`, {
      method: put ? "PUT" : "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    const json = JSON.parse(text) as {
      refusal?: { code: string; door: string };
      state?: string;
      id?: string;
    };
    return { status: response.status, json, text };
  };
  /** What pe.js does after an act: poll the receipt until it settles. */
  const settle = async (id: string) => {
    for (let i = 0; i < 200; i++) {
      const [row] = (await (
        await fetch(`${server.base}/actions?id=${encodeURIComponent(id)}`)
      ).json()) as { state: string; result?: unknown }[];
      if (row && row.state !== "running") return row;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw Error(`action ${id} never settled`);
  };
  return {
    sent,
    send,
    settle,
    page: {
      [HOST_RUNTIME_SERVICE_HEADER]: hostOwnership.serviceName,
      origin: server.base,
      "sec-fetch-site": "same-origin",
      referer: `${server.base}/pages/route-prefs/`,
    },
    async close() {
      await server.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
const as = (caller: Parameters<typeof mintContext>[0]) => ({
  [HOST_CONTEXT_HEADER]: mintContext(caller),
});
const script = (permissionMode?: string) => ({
  scriptContent: census,
  ...(permissionMode ? { permissionMode } : {}),
  timeoutSeconds: 120,
});

test("a human-pinned Page reads a human document with a ReadOnly script and writes nothing without a grant", async () => {
  const host = await serve();
  try {
    const bound = await host.send(
      "/pe/pages/route-prefs/binding",
      as({ kind: "human", via: "cli" }),
      { kind: "pinned", address: MODEL },
      true,
    );
    expect(bound.status, bound.text).toBe(200);

    // pe.script(READ): pe.do posts the read to the page's call door first. ReadOnly explicit and
    // the contract default (no mode) are both reads, answered at once on the bound document.
    for (const mode of ["ReadOnly", undefined]) {
      const read = await host.send("/pages/route-prefs/call", host.page, {
        key: "scripting.execute",
        request: script(mode),
      });
      expect(read.status, read.text).toBe(200);
      expect(read.json).toEqual({ status: "Succeeded", data: { types: 2 } });
    }
    // The mode reaches Revit unchanged: the ReadOnly policy and rollback guard judge the script.
    expect(host.sent.map((one) => [one.request.permissionMode, one.openId])).toEqual([
      ["ReadOnly", doc.openId],
      [undefined, doc.openId],
    ]);

    // The same read through the page's act door (a package script key always acts) is admitted too.
    const acted = await host.send("/pages/route-prefs/act", host.page, {
      key: "scripting.execute",
      input: script("ReadOnly"),
    });
    expect(acted.status, acted.text).toBeLessThan(300);
    expect(await host.settle(acted.json.id!)).toMatchObject({
      state: "succeeded",
      result: { status: "Succeeded", data: { types: 2 } },
    });

    // NoTransaction and WriteTransaction are writes: no acquisition, no grant, refused before Revit.
    const before = host.sent.length;
    for (const mode of ["NoTransaction", "WriteTransaction"]) {
      const write = await host.send("/pages/route-prefs/act", host.page, {
        key: "scripting.execute",
        input: script(mode),
      });
      expect([write.status, write.json.refusal?.code], write.text).toEqual([403, "grant.required"]);
      const call = await host.send("/pages/route-prefs/call", host.page, {
        key: "scripting.execute",
        request: script(mode),
      });
      expect(call.status, call.text).toBe(409);
    }
    expect(host.sent.length).toBe(before);
  } finally {
    await host.close();
  }
}, 30_000);

test("Pea and an external MCP client read a human document with a ReadOnly script at /actions", async () => {
  const host = await serve();
  try {
    for (const caller of [
      as({ kind: "pea", thread: "t-read" }),
      as({ kind: "external-mcp", label: "ext" }),
    ]) {
      const admit = (mode?: string) =>
        host.send("/actions", caller, {
          id: randomUUID(),
          kind: "operation",
          key: "scripting.execute",
          destination: { kind: "document", ref: doc },
          input: script(mode),
        });
      for (const mode of ["ReadOnly", undefined]) {
        const read = await admit(mode);
        expect(read.status, read.text).toBeLessThan(300);
        expect(await host.settle(read.json.id!)).toMatchObject({
          state: "succeeded",
          result: { status: "Succeeded", data: { types: 2 } },
        });
      }
      const write = await admit("NoTransaction");
      expect(write.status, write.text).toBe(403);
      expect(["grant.required", "grant.context-cannot-hold"]).toContain(write.json.refusal?.code);
    }
  } finally {
    await host.close();
  }
}, 30_000);
