import { afterEach, expect, test, vi } from "vite-plus/test";
import { Effect } from "effect";
import { z } from "zod";
import { readingRequestSchema, type Machine } from "@pe/agent-contracts";
import type { ResourceObserver } from "@pe/runtime";
import { machineFixture } from "../../../packages/agent-contracts/tests/machine-fixture.ts";
import { buildCapabilities, createCapabilityCatalogSource } from "../../../packages/mcps/src/pea/capabilities.ts";
import { fixture } from "./host-read-graph.test-support.ts";
import { sessionView } from "./effect-test.ts";
import { replay } from "./sdk-replay.ts";
import { read } from "../src/reads/evaluator.ts";
import { registeredReads } from "../src/reads/routes.ts";
import { resources } from "../src/builtin-read-handles.ts";
import { hostResourceObserver } from "../src/resource-adapters.ts";
import { listBridgeSessions } from "../src/local-ops.ts";
import type { HostSessionInventory } from "../src/session-inventory.ts";

const sdk = vi.hoisted(() => ({ answer: (_args: readonly string[]): string => { throw Error("Unexpected SDK launch"); } }));
// Only process I/O is recorded. SDK argv, envelope validation and reading owner stay real.
vi.mock("../src/host-child.ts", async original => {
  const real = await original<typeof import("../src/host-child.ts")>();
  const { Effect } = await import("effect");
  return { ...real, runHostChild: (_command: string, args: readonly string[]) => Effect.sync(() => ({ stdout: sdk.answer(args), stderr: "", output: "" })) };
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
const instant = (n: number) => new Date(Date.UTC(2026, 10, 8, 0, n)).toISOString();
const seed = machineFixture([{ session: "running", documents: [] }]);
const machineAt = (n: number): Machine => ({ ...seed, observedAtUtc: instant(n) });

async function surface(observer: ResourceObserver, list?: HostSessionInventory["Service"]["list"]) {
  const definition = read("test.resource-content", {
    input: readingRequestSchema, output: z.unknown(),
    run: (ctx, args) => ctx.read(args.kind === "capabilities" ? resources.capabilities : args.kind === "inventory" ? resources.inventory : resources.recents, args),
  });
  const unregister = registeredReads.register({ probe: definition });
  const host = await fixture(false, { resourceObserver: observer, list });
  let sequence = 0;
  return {
    async post(args: z.infer<typeof readingRequestSchema>) {
      const response = await host.probe({ read: definition.name, args, subscription: `resource-${++sequence}`, generation: 1 });
      expect(response.status).toBe(200);
      return response.json();
    },
    async close() { unregister(); await host.close(); },
  };
}

test("capabilities HTTP version ignores TTL and embedded-machine samples, but fences changed capabilities", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  let samples = 0, mode: "catalog" | "machine" | "content" = "catalog";
  const native = buildCapabilities({ ops: [], availabilityKnown: true, routes: [], packages: [], skills: [] })
    .find(row => row.kind === "op" && row.availability?.state === "unavailable");
  if (!native) throw Error("Fixture needs one publicly discoverable native operation");
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.endsWith("/ops")) return Response.json({ operations: mode === "content" && samples === 2 ? [{ key: native.key.slice(3) }] : [] });
    if (url.includes("/instances/readings?read=recents")) return Response.json({ result: { recents: [] } });
    throw Error(`Unexpected catalogue transport ${url}`);
  });
  const catalog = createCapabilityCatalogSource({ hostBaseUrl: "http://recorded", registrations: [],
    machine: async () => machineAt(mode === "machine" ? samples : 0),
    content: async () => ({ packages: [], skills: [], diagnostics: [] }),
  });
  const observed: unknown[] = [];
  const observer = hostResourceObserver(undefined, undefined, undefined, "http://host", async () => {
    ++samples;
    vi.setSystemTime(instant(mode === "machine" ? 0 : samples));
    const value = await catalog.read(); observed.push(value);
    return Response.json(value);
  });
  const http = await surface(observer);
  try {
    for (const drift of ["catalog", "machine"] as const) {
      mode = drift; samples = 0; observed.length = 0; catalog.invalidate();
      const packet = await http.post({ kind: "capabilities" });
      expect.soft(packet, `${drift}: ${JSON.stringify(packet)}`).toMatchObject({ state: "current" });
      expect(observed).toHaveLength(2);
      // SDK extensions can be stripped by contract decoding; sampling evidence must stay exact.
      const original = observed[0] as { at: string; machine: { observedAtUtc: string } };
      expect.soft(packet.value?.data, "sampling evidence still reaches the HTTP consumer").toMatchObject({
        at: original.at, machine: { observedAtUtc: original.machine.observedAtUtc },
      });
      expect(observed[0]).not.toEqual(observed[1]);
    }
    mode = "content"; samples = 0; observed.length = 0; catalog.invalidate();
    expect(await http.post({ kind: "capabilities" })).toMatchObject({ state: "refresh-needed", value: null,
      reason: expect.stringMatching(/capabilities.*changed during evaluation/) });
    expect(observed[0]).toMatchObject({ capabilities: expect.arrayContaining([
      expect.objectContaining({ key: native.key, availability: { state: "unavailable" } }),
    ]) });
    expect(observed[1]).toMatchObject({ capabilities: expect.arrayContaining([
      expect.objectContaining({ key: native.key, availability: { state: "available" } }),
    ]) });
  } finally { await http.close(); }
}, 60_000);

test("SDK HTTP versions ignore session/document/holdings sampling and request ids; doctor polls preserve genuine diagnoses", async () => {
  let samples = 0, changed = false, variant = "sessions-observation";
  const bodies: unknown[] = [];
  sdk.answer = args => {
    const n = ++samples;
    const verb = variant.startsWith("sessions") ? "session-list" : variant === "documents" ? "doc-list" : "doctor";
    expect(args).toContain("--json");
    const envelope = JSON.parse(replay(verb, {}, verb === "doctor" ? "none" : "ok"));
    if (variant === "sessions-observation") envelope.result.sessions[0].observedAtUtc = instant(n);
    if (variant === "sessions-request") envelope.result.requestId = `poll-${n}`;
    if (variant === "documents") envelope.resolved.observedAtUtc = instant(n);
    if (changed && n === 2) {
      if (verb === "session-list") envelope.result.sessions = [];
      else if (verb === "doc-list") envelope.result.documents = [];
      else envelope.result.checks[0].ok = !envelope.result.checks[0].ok;
    }
    bodies.push(envelope); return JSON.stringify(envelope);
  };
  const owner = {
    current: () => {
      const n = ++samples;
      const row = seed.revit.sessions![0]!;
      return { ...machineAt(n), revit: { ...seed.revit, sessions: [{ ...row,
        documents: [{ sessionId: "sdk-0", openId: "doc", title: "Model", path: null,
          isModified: false, isActive: true, isFamily: false, window: null, isWorkshared: null,
          isDetached: null, isCloud: null, centralPath: null, region: null, projectGuid: null, modelGuid: null, persistence: null }],
        holdingsLeg: { observedAtUtc: instant(n), attemptedAtUtc: instant(n), error: null },
        holdings: [{ openId: "doc", title: "Model", holdings: { empty: true, unsaved: false, workshared: true,
          savedNotSynced: null, elements: [], worksets: changed && n === 2 ? ["HVAC"] : [] } }],
      }] } };
    },
    refresh: async () => seed, fresh: async () => seed, acquisitions: () => [], observe: () => () => {},
  };
  const http = await surface(hostResourceObserver(undefined, undefined, undefined, undefined, undefined, owner));
  try {
    const firstSession = seed.revit.sessions![0]!.row;
    if (!("process" in firstSession) || !firstSession.process) throw Error("Fixture needs a process");
    for (const name of ["sessions-observation", "sessions-request", "documents", "doctor", "holdings"]) {
      variant = name; samples = 0; changed = false; bodies.length = 0;
      const request = name === "holdings" ? { kind: "sdk" as const, read: "holdings" as const, section: "worksets" as const,
        session: { id: "sdk-0" }, processStartUtc: firstSession.process.processStartUtc, openId: "doc", limit: 50 }
        : { kind: "sdk" as const, read: name.startsWith("sessions") ? "sessions" as const : name === "documents" ? "documents" as const : "doctor" as const };
      const packet = await http.post(request);
      expect(samples, "the actual SDK reading owner reacquired at final validation").toBe(2);
      expect.soft(packet, `${name}: ${JSON.stringify(packet)}`).toMatchObject({ state: "current" });
      if (name === "holdings") expect.soft(packet.value?.data).toMatchObject({ observedAtUtc: instant(1),
        leg: { observedAtUtc: instant(1), attemptedAtUtc: instant(1) } });
      if (name !== "holdings") {
        expect.soft(packet.value?.data).toEqual(bodies[0]);
        if (name === "doctor") expect(bodies[0], "doctor's named contract has no sampling clock/request field").toEqual(bodies[1]);
        else expect(bodies[0]).not.toEqual(bodies[1]);
      }
      samples = 0; changed = true;
      expect(await http.post(request), name).toMatchObject({ state: "refresh-needed", value: null,
        reason: expect.stringMatching(/sdk.*changed during evaluation/) });
    }
  } finally { await http.close(); }
}, 60_000);

test("inventory HTTP version ignores a new equal bridge observation, but fences document and incarnation changes", async () => {
  let samples = 0, change: "none" | "document" | "incarnation" = "none";
  const bodies: unknown[] = [];
  // The inventory's owner is HostSessionInventory (a138a6e1), for a graph read as for the stream: the
  // resource adapter refuses it ("Host does not own 'inventory'", gate c80e644a /bind), so it is never asked.
  const http = await surface(hostResourceObserver(), () => {
    const n = ++samples;
    const view = sessionView({ connected: true, sessionId: "running", processId: 42,
      processStartUtcUnixMs: change === "incarnation" && n === 2 ? 2000 : 1000,
      state: { activeDocumentTitle: change === "document" && n === 2 ? "Other" : "Model",
        activeDocumentObservedAtUnixMs: n * 1000, openDocuments: [{ openId: "doc", title: "Model" }] } });
    return Effect.map(listBridgeSessions(Effect.succeed([view])), value => { bodies.push(value); return value; });
  });
  try {
    const packet = await http.post({ kind: "inventory" });
    expect(samples).toBe(2); expect(bodies[0]).not.toEqual(bodies[1]);
    expect.soft(packet, JSON.stringify(packet)).toMatchObject({ state: "current" });
    expect.soft(packet.value?.data).toEqual(bodies[0]);
    for (const content of ["document", "incarnation"] as const) {
      change = content; samples = 0;
      expect(await http.post({ kind: "inventory" }), content).toMatchObject({ state: "refresh-needed", value: null,
        reason: expect.stringMatching(/inventory.*changed during evaluation/) });
    }
  } finally { await http.close(); }
}, 60_000);
