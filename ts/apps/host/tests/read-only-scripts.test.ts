import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Effect, Layer } from "effect";
import { expect, test, vi } from "vite-plus/test";
import { HOST_CONTEXT_HEADER, HOST_RUNTIME_SERVICE_HEADER } from "@pe/host-contracts/contracts";
import { ActionJournal } from "../src/action-journal.ts";
import { RevitBridge } from "../src/bridge.ts";
import { makeCallRoute } from "../src/call-route.ts";
import { RunConsents, type ConsentEvent } from "../src/run-consent.ts";
import { bindControl, mintContext } from "../src/control.ts";
import { hostOwnership } from "../src/host-ownership.ts";
import { pagesRoute } from "../src/pages-route.ts";
import { sdkSessions } from "./native-receipt-fixture.ts";
import { serveRoutes } from "./real-server.ts";

/**
 * Acceptance round 4c §3: the route-prefs Page, pinned by a person to a document the person opened,
 * pressed "read routing preferences" (`pe.script(READ)`, ReadOnly by default) and the host refused
 * it as a write. Counsel's rule: a ReadOnly (or default-mode) script is a read only under a person's
 * consent, a human caller or a Page whose binding a human set. 2026-10-14 (items 9, 10): Pea joins
 * them on an exact target, because the rollback guard contains the target; it does not contain a
 * sibling's commit, so the K9 census still refuses beside an ungranted sibling. An external MCP
 * client and a Page bound by Pea keep it a write that needs a grant or an acquisition.
 */
const MODEL = "C:/Jobs/HVAC.rvt";
const doc = { session: "bridge-a", openId: "open-a" };
const census = "Result(new { types = 2 });";
type Sent = { key: string; request: Record<string, unknown>; openId: string | null };
const other = {
  openId: "open-other",
  address: "C:/Jobs/Other.rvt",
  title: "Other",
  isFamilyDocument: false,
};

function humanRevit(sent: Sent[], openDocuments: (typeof other)[], onCatalog: () => void) {
  return {
    list: Effect.sync(() => [
      {
        sessionId: doc.session,
        connected: true,
        lane: hostOwnership.lane,
        sourceRoot: hostOwnership.sourceRoot,
        serviceName: hostOwnership.serviceName,
        processId: 42,
        processStartUtcUnixMs: 1000,
        state: {
          openDocuments: [...openDocuments],
        },
      },
    ]),
    invoke: (key: string, request: Record<string, unknown>, _s: string, openId: string | null) =>
      Effect.promise(async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        if (key === "host.ops.catalog") {
          onCatalog();
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
                { key: "model.census", intent: "Read", needs: "document", actor: "any" },
              ],
            },
            target: null,
          };
        }
        sent.push({ key, request, openId });
        return { value: { status: "Succeeded", data: { types: 2 } }, target: null };
      }),
  } as unknown as RevitBridge["Service"];
}

async function serve(onCatalog?: (documents: (typeof other)[]) => void) {
  const dir = mkdtempSync(join(tmpdir(), "pe-host-readonly-script-"));
  const pages = join(dir, "pages");
  mkdirSync(join(pages, "route-prefs"), { recursive: true });
  writeFileSync(join(pages, "route-prefs", "index.html"), "<!doctype html><title>rp</title>");
  const sent: Sent[] = [];
  const openDocuments = [
    { openId: doc.openId, address: MODEL, title: "HVAC", isFamilyDocument: false },
  ];
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
    humanRevit(sent, openDocuments, () => onCatalog?.(openDocuments)),
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
      error?: { code: string; details?: { refusal?: { code: string } } };
      state?: string;
      id?: string;
      effects?: import("@pe/agent-contracts").Footprint;
    };
    return { status: response.status, json, text };
  };
  /** What pe.js does after an act: poll the receipt until it settles. */
  const settle = async (id: string) => {
    for (let i = 0; i < 200; i++) {
      const [row] = (await (
        await fetch(`${server.base}/actions?id=${encodeURIComponent(id)}`, {
          headers: {
            [HOST_CONTEXT_HEADER]: mintContext({ kind: "human", via: "cli" }),
            [HOST_RUNTIME_SERVICE_HEADER]: hostOwnership.serviceName,
          },
        })
      ).json()) as { state: string; result?: unknown; consent?: unknown }[];
      if (row && row.state !== "running" && row.state !== "waiting") return row;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw Error(`action ${id} never settled`);
  };
  return {
    sent,
    openDocuments,
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
    const settled = await host.settle(acted.json.id!);
    expect(settled, JSON.stringify(settled)).toMatchObject({
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
      expect([write.status, write.json.error?.details?.refusal?.code], write.text).toEqual([
        403,
        "grant.required",
      ]);
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

const peaCall = (thread: string) => ({
  ...as({ kind: "pea", thread }),
  "x-pe-bridge-session-id": doc.session,
  "x-pe-open-document-id": doc.openId,
});

test("item 9: Pea reads an ungranted human document by exact target; a write there is refused", async () => {
  const host = await serve();
  try {
    const read = await host.send("/call", peaCall("t-op"), { key: "model.census", request: {} });
    expect(read.status, read.text).toBe(200);
    expect(host.sent.map((one) => [one.key, one.openId])).toEqual([["model.census", doc.openId]]);
    const write = await host.send("/actions", as({ kind: "pea", thread: "t-op" }), {
      id: randomUUID(),
      key: "scripting.execute",
      target: { kind: "document", ref: doc },
      input: script("WriteTransaction"),
    });
    expect([write.status, write.json.refusal?.code], write.text).toEqual([403, "run.none"]);
    expect(host.sent).toHaveLength(1);
  } finally {
    await host.close();
  }
}, 30_000);

test("Pea script modes all cross the same root-run consent and raw script dispatch refuses", async () => {
  const host = await serve();
  const events: ConsentEvent[] = [],
    run = { thread: "script-turn", turn: randomUUID() },
    runs = new RunConsents((_, event) => events.push(event));
  runs.open(run);
  bindControl({ runs });
  const headers = as({ kind: "pea", thread: run.thread, run, root: run });
  try {
    let decision: unknown;
    for (const mode of ["ReadOnly", undefined, "NoTransaction", "WriteTransaction"]) {
      const act = await host.send("/actions", headers, {
        id: randomUUID(),
        key: "scripting.execute",
        target: { kind: "document", ref: doc },
        input: script(mode),
      });
      expect(act.status, act.text).toBeLessThan(300);
      if (!decision) {
        expect(act.json.state).toBe("waiting");
        expect(host.sent).toEqual([]);
        await vi.waitFor(() =>
          expect(events.some((e) => e.kind === "permission_request")).toBe(true),
        );
        const ask = events.find((e) => e.kind === "permission_request")!;
        if (ask.kind === "permission_request") runs.decide(run.thread, ask.requestId, "allow_now");
      }
      const row = await host.settle(act.json.id!);
      expect(row.state, JSON.stringify(row)).toBe("succeeded");
      if (!decision) decision = row.consent;
      else expect(row.consent).toEqual(decision);
      const raw = await host.send(
        "/call",
        { ...headers, "x-pe-bridge-session-id": doc.session, "x-pe-open-document-id": doc.openId },
        { key: "scripting.execute", request: script(mode) },
      );
      expect(raw.status, raw.text).toBe(409);
    }
    expect(events.filter((event) => event.kind === "permission_request")).toHaveLength(1);
    expect(host.sent).toHaveLength(4);
  } finally {
    runs.closeAll();
    await host.close();
  }
}, 30000);

test("Pea script footprint includes every sibling and Stop prevents dispatch", async () => {
  const host = await serve();
  host.openDocuments.push(other);
  const run = { thread: "siblings", turn: randomUUID() },
    runs = new RunConsents(() => {});
  runs.open(run);
  bindControl({ runs });
  const headers = as({ kind: "pea", thread: run.thread, run, root: run });
  try {
    const raw = await host.send(
      "/call",
      { ...headers, "x-pe-bridge-session-id": doc.session, "x-pe-open-document-id": doc.openId },
      { key: "scripting.execute", request: script("ReadOnly") },
    );
    expect(raw.status).toBe(409);
    const act = await host.send("/actions", headers, {
      id: randomUUID(),
      key: "scripting.execute",
      target: { kind: "document", ref: doc },
      input: script("ReadOnly"),
    });
    expect(act.json.state, act.text).toBe("waiting");
    expect(act.json.effects).toEqual(
      expect.arrayContaining([
        { kind: "document", ref: doc },
        { kind: "document", ref: { session: doc.session, openId: other.openId } },
      ]),
    );
    runs.close(run, "stopped");
    expect((await host.settle(act.json.id!)).state).toBe("cancelled");
    expect(host.sent).toEqual([]);
  } finally {
    runs.closeAll();
    await host.close();
  }
}, 30000);

test("an external MCP client cannot read a human document with a ReadOnly script", async () => {
  const host = await serve();
  try {
    const caller = as({ kind: "external-mcp", label: "ext" });
    for (const mode of ["ReadOnly", undefined, "NoTransaction"]) {
      const admit = await host.send("/actions", caller, {
        id: randomUUID(),
        key: "scripting.execute",
        target: { kind: "document", ref: doc },
        input: script(mode),
      });
      expect([admit.status, admit.json.refusal?.code], admit.text).toEqual([
        403,
        "grant.context-cannot-hold",
      ]);
      // `/call` never dispatches it either: for external MCP a script stays a mutation.
      const call = await host.send(
        "/call",
        { ...caller, "x-pe-bridge-session-id": doc.session, "x-pe-open-document-id": doc.openId },
        { key: "scripting.execute", request: script(mode) },
      );
      expect(call.status, call.text).toBe(409);
    }
    expect(host.sent).toEqual([]);
  } finally {
    await host.close();
  }
}, 30_000);

test("an anonymous local process cannot read a human document with a ReadOnly script", async () => {
  const host = await serve();
  try {
    for (const mode of ["ReadOnly", undefined]) {
      const call = await host.send(
        "/call",
        {
          [HOST_RUNTIME_SERVICE_HEADER]: hostOwnership.serviceName,
          "x-pe-bridge-session-id": doc.session,
          "x-pe-open-document-id": doc.openId,
        },
        { key: "scripting.execute", request: script(mode) },
      );
      expect(call.status, call.text).toBe(403);
      expect(call.text).toContain("context.missing");
    }
    expect(host.sent).toEqual([]);
  } finally {
    await host.close();
  }
}, 30_000);

test("a human pin consents only to its document: an ungranted sibling refuses ReadOnly at call and act", async () => {
  const host = await serve();
  host.openDocuments.push(other);
  try {
    expect(
      (
        await host.send(
          "/pe/pages/route-prefs/binding",
          as({ kind: "human", via: "cli" }),
          { kind: "pinned", address: MODEL },
          true,
        )
      ).status,
    ).toBe(200);
    for (const mode of ["ReadOnly", undefined]) {
      const call = await host.send("/pages/route-prefs/call", host.page, {
        key: "scripting.execute",
        request: script(mode),
      });
      expect(call.status, call.text).toBe(403);
      expect(call.text).toContain("script.ungranted-documents");
      expect(call.text).toContain(other.openId);
      expect(host.sent).toEqual([]);
      const act = await host.send("/pages/route-prefs/act", host.page, {
        key: "scripting.execute",
        input: script(mode),
      });
      expect(act.status, act.text).toBe(403);
      expect(act.text).toContain("script.ungranted-documents");
      expect(act.text).toContain(other.openId);
      expect(host.sent).toEqual([]);
    }
  } finally {
    await host.close();
  }
}, 30_000);

test("a Page ReadOnly call rechecks siblings after its catalog read and before dispatch", async () => {
  const host = await serve((documents) => {
    if (!documents.some((one) => one.openId === other.openId)) documents.push(other);
  });
  try {
    expect(
      (
        await host.send(
          "/pe/pages/route-prefs/binding",
          as({ kind: "human", via: "cli" }),
          { kind: "pinned", address: MODEL },
          true,
        )
      ).status,
    ).toBe(200);
    const call = await host.send("/pages/route-prefs/call", host.page, {
      key: "scripting.execute",
      request: script("ReadOnly"),
    });
    expect(call.status, call.text).toBe(403);
    expect(call.json.error?.code).toBe("script.ungranted-documents");
    expect(host.sent).toEqual([]);
  } finally {
    await host.close();
  }
}, 30_000);

test("a Page Pea bound, now on a human document, cannot read it with a ReadOnly script", async () => {
  const host = await serve();
  // Pea pins its own acquired document; the acquisition then ends (a handover) and the person owns it.
  let acquired = true;
  bindControl({ acquired: (ref) => (acquired && ref.openId === doc.openId ? "acq-1" : null) });
  try {
    const bound = await host.send(
      "/pe/pages/route-prefs/binding",
      as({ kind: "pea", thread: "t-pin" }),
      { kind: "pinned", address: MODEL },
      true,
    );
    expect(bound.status, bound.text).toBe(200);
    acquired = false;
    for (const mode of ["ReadOnly", undefined]) {
      const call = await host.send("/pages/route-prefs/call", host.page, {
        key: "scripting.execute",
        request: script(mode),
      });
      expect(call.status, call.text).toBe(409);
      const act = await host.send("/pages/route-prefs/act", host.page, {
        key: "scripting.execute",
        input: script(mode),
      });
      expect([act.status, act.json.error?.details?.refusal?.code], act.text).toEqual([
        403,
        "grant.required",
      ]);
    }
    expect(host.sent).toEqual([]);
  } finally {
    bindControl({ acquired: () => null });
    await host.close();
  }
}, 30_000);

test("a human-pinned Page's ReadOnly script can run beside a sibling it has write authority for", async () => {
  const host = await serve();
  host.openDocuments.push(other);
  bindControl({
    acquired: (ref) =>
      ref.session === doc.session && ref.openId === other.openId ? "acq-other" : null,
  });
  try {
    expect(
      (
        await host.send(
          "/pe/pages/route-prefs/binding",
          as({ kind: "human", via: "cli" }),
          { kind: "pinned", address: MODEL },
          true,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await host.send("/pages/route-prefs/call", host.page, {
          key: "scripting.execute",
          request: script("ReadOnly"),
        })
      ).status,
    ).toBe(200);
    const act = await host.send("/pages/route-prefs/act", host.page, {
      key: "scripting.execute",
      input: script("ReadOnly"),
    });
    expect(await host.settle(act.json.id!)).toMatchObject({ state: "succeeded" });
    expect(host.sent.map((one) => one.openId)).toEqual([doc.openId, doc.openId]);
  } finally {
    bindControl({ acquired: () => null });
    await host.close();
  }
}, 30_000);
