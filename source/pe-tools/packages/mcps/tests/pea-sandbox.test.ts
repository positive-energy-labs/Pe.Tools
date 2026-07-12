import { expect, test } from "vite-plus/test";
import { presentCompactStatus } from "../src/pea/index.ts";
import {
  peSandboxInputSchema,
  presentSandboxEnvelope,
  presentSessionKind,
  sandboxRouteCall,
  unresponsiveSandboxPresentation,
} from "../src/pea/sandbox.ts";
import type { HostOpResponse } from "@pe/host-contracts/operation-types";

// Pea's presentation contract: no broker/SDK lane vocabulary in compact output.
const LANE_WORDS = /\b(rrd|lane|installed|payloadSource)\b/i;

// --- session kind presentation ------------------------------------------------------------------

test("every non-sandbox lane presents as the user's session", () => {
  expect(presentSessionKind("rrd", null)).toEqual({ kind: "user" });
  expect(presentSessionKind("dev", null)).toEqual({ kind: "user" });
  expect(presentSessionKind("installed", null)).toEqual({ kind: "user" });
  expect(presentSessionKind(null, null)).toEqual({ kind: "user" });
  expect(presentSessionKind("sandbox", "scratch")).toEqual({ kind: "sandbox", sandboxId: "scratch" });
});

test("pe_status compact output carries no lane words for any session mix", () => {
  const probe = {
    bridgeIsConnected: true,
    bridgePath: "/bridge",
    disconnectReason: null,
    hostContractVersion: 1,
    bridgeContractVersion: 1,
  } as unknown as HostOpResponse<"host.status">;
  const summary = {
    bridgeIsConnected: true,
    sessionId: "session-a",
    processId: 100,
    lane: "rrd",
    sandboxId: null,
    buildStamp: "stamp-a",
    revitVersion: "2025",
    openDocumentCount: 1,
    activeDocument: null,
    availableModules: [],
  } as unknown as HostOpResponse<"bridge.sessions.summary">;
  const sessions = [
    {
      sessionId: "session-a",
      processId: 100,
      lane: "rrd",
      sandboxId: null,
      buildStamp: "stamp-a",
      revitVersion: "2025",
      openDocumentCount: 1,
      activeDocumentTitle: "Model",
      connected: true,
      runtimeFramework: ".NET 8",
    },
    {
      sessionId: "session-b",
      processId: 200,
      lane: "sandbox",
      sandboxId: "scratch",
      buildStamp: "stamp-b",
      revitVersion: "2025",
      openDocumentCount: 0,
      activeDocumentTitle: null,
      connected: true,
      runtimeFramework: ".NET 8",
    },
  ] as unknown as HostOpResponse<"bridge.sessions.list">["sessions"];

  const compact = presentCompactStatus(probe, summary, sessions);

  expect(JSON.stringify(compact)).not.toMatch(LANE_WORDS);
  expect(compact.session).toMatchObject({ kind: "user", sessionId: "session-a" });
  expect(compact.sessions).toMatchObject([
    { kind: "user", sessionId: "session-a" },
    { kind: "sandbox", sandboxId: "scratch", sessionId: "session-b" },
  ]);
});

// --- sandbox envelope presentation ----------------------------------------------------------------

test("compact sandbox presentation drops SDK payload fields and adds a target selector", () => {
  const envelope = {
    result: {
      sandboxes: [
        {
          id: "scratch",
          state: "ready",
          detail: "SDK bridge answers with this sandbox's descriptor",
          pid: 4242,
          year: "25",
          payloadSource: "installed",
          project: null,
          installed: "Pe.App",
          generationId: "gen-1",
          buildStamp: "stamp",
          descriptor: "C:\\gen\\descriptor.json",
          startedAtUtc: "2026-07-12T00:00:00Z",
          stoppedAtUtc: null,
        },
      ],
    },
    resolved: { registryRoot: "C:\\registry" },
    diagnostics: [],
    nextSteps: [],
    guide: "sandbox",
  };

  const presented = presentSandboxEnvelope(envelope, "list");

  expect(JSON.stringify(presented)).not.toMatch(LANE_WORDS);
  expect(presented.sandboxes).toEqual([
    {
      kind: "sandbox",
      id: "scratch",
      state: "ready",
      detail: "SDK bridge answers with this sandbox's descriptor",
      pid: 4242,
      year: "25",
      buildStamp: "stamp",
      startedAtUtc: "2026-07-12T00:00:00Z",
      stoppedAtUtc: null,
      target: "sandbox:scratch",
    },
  ]);
});

test("single-sandbox verdicts (start/stop) present as one sandbox row", () => {
  const presented = presentSandboxEnvelope(
    {
      result: { id: "scratch", state: "booting", pid: 777, year: "25" },
      diagnostics: [],
      nextSteps: ["pe-revit sandbox wait --id scratch"],
    },
    "start",
  );

  expect(presented.sandboxes).toHaveLength(1);
  expect(presented.sandboxes[0]).toMatchObject({
    kind: "sandbox",
    id: "scratch",
    state: "booting",
    target: "sandbox:scratch",
  });
  expect(presented.nextSteps).toEqual(["pe-revit sandbox wait --id scratch"]);
});

// --- action → host route mapping ------------------------------------------------------------------

test("list maps to GET /sessions/sandboxes with an optional id filter", () => {
  const base = "http://127.0.0.1:5180";
  expect(sandboxRouteCall(base, peSandboxInputSchema.parse({ action: "list" }))).toMatchObject({
    method: "GET",
    url: "http://127.0.0.1:5180/sessions/sandboxes",
  });
  expect(
    sandboxRouteCall(base, peSandboxInputSchema.parse({ action: "list", id: "scratch" })).url,
  ).toBe("http://127.0.0.1:5180/sessions/sandboxes?id=scratch");
});

test("lifecycle actions map to POST bodies without any payload-source choice", () => {
  const call = sandboxRouteCall(
    "http://127.0.0.1:5180/",
    peSandboxInputSchema.parse({ action: "start", year: 25, id: "scratch", wait: true }),
  );

  expect(call).toMatchObject({ method: "POST", url: "http://127.0.0.1:5180/sessions/sandboxes" });
  // The host lane decides source vs installed; the caller never can.
  expect(call.body).toEqual({ action: "start", id: "scratch", year: "25", wait: true });

  const stop = sandboxRouteCall(
    "http://127.0.0.1:5180",
    peSandboxInputSchema.parse({ action: "stop", id: "scratch", force: true }),
  );
  expect(stop.body).toEqual({ action: "stop", id: "scratch", force: true });
});

test("client-side unresponsiveness points at pe_sandbox action=stop and stays lane-free", () => {
  const presentation = unresponsiveSandboxPresentation(
    peSandboxInputSchema.parse({ action: "wait", id: "scratch" }),
  );

  expect(JSON.stringify(presentation)).not.toMatch(LANE_WORDS);
  expect(presentation.sandboxes[0]).toMatchObject({
    kind: "sandbox",
    id: "scratch",
    state: "unresponsive",
    target: "sandbox:scratch",
  });
  expect(presentation.nextSteps[0]).toContain("pe_sandbox action=stop id=scratch");
});
