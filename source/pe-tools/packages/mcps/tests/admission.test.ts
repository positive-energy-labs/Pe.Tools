import { expect, test } from "vite-plus/test";
import { admissionDestination, runCapability } from "../src/shared/admission.ts";
import { ScriptingTools } from "../src/shared/scripting.ts";
import { cli } from "gunshi";
import { PeaCliCommands } from "../src/pea/PeaCliCommands.ts";

/**
 * A fake host serving exactly the two endpoints a mutation needs: the generated operation
 * catalog and `/actions`. `/call` is left unrouted, so any surviving raw-mutation dispatch fails
 * here — that is the w5-revit defect this file pins.
 */
const operations = [
  { key: "scripting.workspace.bootstrap", intent: "Mutate", needs: "nothing" },
  { key: "scripting.execute", intent: "Mutate", needs: "nothing" },
  { key: "pod.import", intent: "Mutate", needs: "nothing" },
  { key: "pod.export", intent: "Mutate", needs: "nothing" },
  { key: "op.cancel", intent: "Mutate", needs: "nothing" },
];

/**
 * Like the real `/ops` (`apps/host/src/ops-catalog.ts`): native keys only under a session
 * selector, and a session whose bridge does not answer yields a 200 carrying `bridgeCatalogError`.
 */
function fakeHost(options: { session?: string; bridgeDown?: boolean } = {}) {
  const submitted: unknown[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: Request | string | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.endsWith("/ops")) {
      const selected = (init?.headers as Record<string, string> | undefined)?.[
        "x-pe-bridge-session-id"
      ];
      if (!selected)
        return Response.json({
          operations: [],
          bridgeCatalogError: "Select a session for native operations",
        });
      if (options.bridgeDown)
        return Response.json({ operations: [], bridgeCatalogError: "bridge request timed out" });
      return Response.json({ operations });
    }
    if (url.endsWith("/call")) {
      const { key } = JSON.parse(String(init?.body)) as { key: string };
      if (key !== "bridge.sessions.summary")
        throw new Error(`fake host refuses raw dispatch of '${key}' on /call`);
      return Response.json({ sessionId: options.session ?? null, openDocumentCount: 0 });
    }
    if (url.endsWith("/actions") && init?.method === "POST") {
      const { input: request, ...attempt } = JSON.parse(String(init.body)) as Record<
        string,
        unknown
      >;
      submitted.push({ ...attempt, input: request });
      return Response.json({
        ...attempt,
        request,
        state: "succeeded",
        result: { ok: attempt.key },
        steps: [],
        preparation: { state: "unprepared" },
        recovery: [],
        startedAt: new Date(0).toISOString(),
        publication: { state: "unrequested" },
      });
    }
    throw new Error(`fake host has no route for ${init?.method ?? "GET"} ${url}`);
  }) as typeof fetch;
  return { submitted, restore: () => void (globalThis.fetch = original) };
}

const tools = (session?: string) =>
  new ScriptingTools({
    hostBaseUrl: "http://host.test",
    bridgeSessionId: session,
    actor: "agent",
    workspaceKey: "demo-pod",
  });

test("every mutating pea script verb builds the exact /actions admission", async () => {
  const host = fakeHost({ session: "session-catalog" });
  try {
    const pea = tools();
    await pea.bootstrap({});
    await pea.execute({ sourcePath: "src/SampleScript.cs" });
    await pea.importPod({ archivePath: "a.zip" });
    await pea.exportPod({ pod: "demo-pod", archivePath: "b.zip" });
    await pea.cancel({ requestId: "request-1" });
    expect(
      host.submitted.map((admission) => {
        const { id: _id, ...rest } = admission as Record<string, unknown>;
        return rest;
      }),
    ).toEqual([
      {
        kind: "operation",
        key: "scripting.workspace.bootstrap",
        actor: "agent",
        destination: { kind: "session", session: "session-catalog" },
        input: { workspaceKey: "demo-pod" },
        bases: {},
      },
      {
        kind: "operation",
        key: "scripting.execute",
        actor: "agent",
        destination: { kind: "session", session: "session-catalog" },
        input: { sourcePath: "src/SampleScript.cs", workspaceKey: "demo-pod" },
        bases: {},
      },
      {
        kind: "operation",
        key: "pod.import",
        actor: "agent",
        destination: { kind: "session", session: "session-catalog" },
        input: { archivePath: "a.zip" },
        bases: {},
      },
      {
        kind: "operation",
        key: "pod.export",
        actor: "agent",
        destination: { kind: "session", session: "session-catalog" },
        input: { pod: "demo-pod", archivePath: "b.zip" },
        bases: {},
      },
      {
        kind: "operation",
        key: "op.cancel",
        actor: "agent",
        destination: { kind: "session", session: "session-catalog" },
        input: { requestId: "request-1" },
        bases: {},
      },
    ]);
  } finally {
    host.restore();
  }
});

test("an explicit session selector outranks the one the catalog answered from", async () => {
  const host = fakeHost({ session: "session-catalog" });
  try {
    await tools("session-explicit").bootstrap({});
    expect((host.submitted[0] as { destination: unknown }).destination).toEqual({
      kind: "session",
      session: "session-explicit",
    });
  } finally {
    host.restore();
  }
});

test("the catalog, not the caller, says whether a key is an operation or a workflow", async () => {
  const host = fakeHost({ session: "session-catalog" });
  try {
    await runCapability(
      "family.capture",
      { target: {} },
      {
        hostBaseUrl: "http://host.test",
        actor: "agent",
        openDocumentId: "open-1",
      },
    );
    expect(host.submitted[0]).toMatchObject({
      kind: "workflow",
      key: "family.capture",
      destination: { kind: "document", ref: { session: "session-catalog", openId: "open-1" } },
    });
  } finally {
    host.restore();
  }
});

test("a mutation with no session, no actor, or no catalog row refuses before it POSTs", async () => {
  const host = fakeHost();
  try {
    await expect(tools().bootstrap({})).rejects.toThrow("none is connected to http://host.test");
    await expect(
      runCapability("family.capture", {}, { hostBaseUrl: "http://host.test", actor: "agent" }),
    ).rejects.toThrow("none is connected or named");
    await expect(
      new ScriptingTools({
        hostBaseUrl: "http://host.test",
        bridgeSessionId: "s",
        workspaceKey: "demo-pod",
      }).exportPod({
        pod: "p",
        archivePath: "b.zip",
      }),
    ).rejects.toThrow("initiating actor");
    await expect(
      runCapability("pod.nonesuch", {}, { hostBaseUrl: "http://host.test", actor: "agent" }),
    ).rejects.toThrow("none is connected");
    expect(host.submitted).toEqual([]);
  } finally {
    host.restore();
  }
});

test("a document destination needs the exact open lifetime, never an active-document fallback", () => {
  expect(() =>
    admissionDestination("family.capture", "family-document", { bridgeSessionId: "s" }),
  ).toThrow("exact open family-document");
  // Host-local keys run on the host even when a session is connected.
  expect(admissionDestination("pod.list", "nothing", { bridgeSessionId: "s" })).toEqual({
    kind: "host",
  });
});

test("a read key never enters admission; it stays on /call", async () => {
  const host = fakeHost({ session: "session-catalog" });
  try {
    await expect(tools().listPods()).rejects.toThrow("refuses raw dispatch of 'pod.list'");
    expect(host.submitted).toEqual([]);
  } finally {
    host.restore();
  }
});

/** `pea host operations call`, driven through Gunshi exactly as a user types it. */
async function peaCall(args: string[]) {
  const command = new PeaCliCommands({ hostBaseUrl: "http://host.test" }).hostCommand();
  const printed: string[] = [];
  const log = console.log;
  console.log = (line: unknown) => void printed.push(String(line));
  try {
    await cli(["operations", "call", ...args], command, { subCommands: command.subCommands });
  } finally {
    console.log = log;
  }
  return printed;
}

test("a native key with no --bridge-session-id reads the catalog of the connected session", async () => {
  const host = fakeHost({ session: "session-live" });
  try {
    await peaCall([
      "--key",
      "scripting.workspace.bootstrap",
      "--actor",
      "agent",
      "--request",
      "{}",
    ]);
    await tools().bootstrap({});
    expect(host.submitted).toMatchObject([
      { kind: "operation", destination: { kind: "session", session: "session-live" } },
      { kind: "operation", destination: { kind: "session", session: "session-live" } },
    ]);
  } finally {
    host.restore();
  }
});

test("a native key with no session names how to pick one", async () => {
  const host = fakeHost();
  try {
    await expect(peaCall(["--key", "scripting.execute", "--actor", "agent"])).rejects.toThrow(
      /'scripting.execute' runs in a Revit session and none is connected.*--bridge-session-id.*pea host status/,
    );
    expect(host.submitted).toEqual([]);
  } finally {
    host.restore();
  }
});

test("an unreachable catalog and an unknown key are two refusals with two causes", async () => {
  const down = fakeHost({ session: "session-live", bridgeDown: true });
  try {
    await expect(
      peaCall(["--key", "scripting.execute", "--actor", "agent", "--bridge-session-id", "s-down"]),
    ).rejects.toThrow("catalog of session 's-down' is unreachable: bridge request timed out");
  } finally {
    down.restore();
  }
  const up = fakeHost({ session: "session-live" });
  try {
    // The down answer was not cached: the same session now serves its catalog.
    await peaCall([
      "--key",
      "scripting.execute",
      "--actor",
      "agent",
      "--bridge-session-id",
      "s-down",
    ]);
    await expect(peaCall(["--key", "pod.nonesuch", "--actor", "agent"])).rejects.toThrow(
      "'pod.nonesuch' is not in the operation catalog of session 'session-live'",
    );
    expect(up.submitted).toHaveLength(1);
  } finally {
    up.restore();
  }
  const original = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new TypeError("fetch failed");
  }) as typeof fetch;
  try {
    // A dead host is a transport error that names the URL, not "no session".
    await expect(peaCall(["--key", "scripting.execute", "--actor", "agent"])).rejects.toThrow(
      "POST http://host.test/call failed: TypeError: fetch failed",
    );
  } finally {
    globalThis.fetch = original;
  }
});

test("operations call admits schedule.grid.push as a workflow with its bases", async () => {
  const host = fakeHost({ session: "session-live" });
  try {
    await peaCall([
      "--key",
      "schedule.grid.push",
      "--actor",
      "human",
      "--open-document-id",
      "open-1",
      "--request",
      JSON.stringify({ bases: { captureId: "c".repeat(64) } }),
    ]);
    expect(host.submitted).toMatchObject([
      {
        kind: "workflow",
        key: "schedule.grid.push",
        actor: "human",
        destination: { kind: "document", ref: { session: "session-live", openId: "open-1" } },
        input: {},
        bases: { captureId: "c".repeat(64) },
      },
    ]);
  } finally {
    host.restore();
  }
});
