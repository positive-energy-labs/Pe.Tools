// @vitest-environment jsdom
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vite-plus/test";
import { addressSchema, podMemberCode, settingsRouteState, workFingerprintSchema } from "@pe/agent-contracts";
import { findingsWork } from "@pe/agent-contracts/slots";
import { RouteWorkspace } from "@pe/runtime";
import { subjectCode, uniqueIdSchema } from "../../../../packages/agent-contracts/src/subject-ref.ts";
import { fixtureNative } from "../../../host/tests/fixture-native";
import { approvedPea } from "../../../host/tests/callers";
import { module as pods } from "../pods/route";
import { workReadings } from "../route/slots/findings/readings.test-support";
import { mountTypedRoute } from "./typed-mount";
import { createFixtureWorkDoor } from "./fixture-work-door";

const io = vi.hoisted(() => ({ fault: vi.fn() }));
vi.mock("../host/diagnostics", async (original) => ({ ...(await original<object>()), reportFault: io.fault }));

const ref = { pod: "share-ducts", path: "settings/checks.json" };
const basis = { member: ref, rawContent: "{}", sha256: "f".repeat(64) };
const address = addressSchema.parse("C:/model.rvt");
const port = subjectCode({ keyKind: "UniqueId", key: uniqueIdSchema.parse("9e9fb89e-a9db-4d9a-8f35-b8fbc2303423-00d3da72"), sub: { port: 1 } });
type Ports = NonNullable<Parameters<typeof mountTypedRoute>[3]>;
type Call = { name: string; query: Record<string, string> };

/** /pods at a picked member on one document: the route's Work is keyed by the member, the findings by the document. */
function mountPods(readings: NonNullable<Ports["readings"]>, calls: Call[] = []) {
  const findings: NonNullable<Ports["findings"]> = { async response(name: string, input: { query?: object }) {
    calls.push({ name, query: { ...input.query } });
    return name === "work.get" ? Response.json({ revision: 3, doc: { findings: {} } }) : Response.json({ ok: true });
  } };
  return mountTypedRoute(pods, {
    address: { read: () => new URLSearchParams(), write() {}, subscribe: () => () => {} },
    fixture: null, target: { kind: "host" }, work: { address, open: null }, custody: { current: () => true },
    memory: () => ({ member: { kind: "ids", ids: [podMemberCode(ref)] } }),
  }, workFingerprintSchema.parse(`builtin-closure:${"a".repeat(64)}`), {
    work: createFixtureWorkDoor(settingsRouteState, { basis, fields: {} }), sources: {}, findings, readings,
  });
}
const memory = () => {
  let saved: unknown = null;
  return new RouteWorkspace({
    registrations: [{ spec: findingsWork }],
    store: { getState: async () => structuredClone(saved), setState: async ({ value }) => void (saved = structuredClone(value)) },
  });
};

/*
 * F2's falsifier: the browser reads findings from the host's `work` Reading. Only the native process
 * is a fixture; the action journal, the registry and the Work are real. Mutant "the mount reads once"
 * (the old `readFindings` load, re-run only after this Place's own write) leaves the list empty.
 */
test("a findings.say through the host as Pea appears in a mounted route's findings with no person action", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pe-findings-reading-"));
  const native = await fixtureNative(join(dir, "native"));
  const socket = await native.connect();
  const host = memory();
  const post = native.actions({ workspace: host });
  const calls: Call[] = [];
  const mount = mountPods(workReadings(host), calls);
  try {
    let notified = 0;
    mount.subscribe(() => void notified++);
    expect(mount.findings()).toEqual([]);
    const before = notified;
    const response = await post({ id: "pea-says", key: "findings.say", target: { kind: "document", ref: socket.target },
      input: { subject: port, kind: "claim", text: "port 1 static reads low" } }, approvedPea("findings-reading"));
    expect(response.status, await response.clone().text()).toBeLessThan(400);
    expect(await native.journal.wait("pea-says")).toMatchObject({ state: "succeeded" });
    await vi.waitFor(() => expect(mount.findings()).toEqual([
      expect.objectContaining({ subject: port, kind: "claim", text: "port 1 static reads low", said: expect.objectContaining({ by: "pea" }) }),
    ]));
    expect(notified, "the arrival redraws the route").toBeGreaterThan(before);
    // No person action and no reload: the mount asked the Pe client for nothing.
    expect(calls).toEqual([]);
    expect(await mount.ownFindingsLeft()).toBe(0);
  } finally {
    mount.dispose();
    await native.close();
    await rm(dir, { recursive: true, force: true });
  }
}, 60_000);

/* purge-2 c103cdbc: undo and the own-findings count used the route's member key, a findings Work the host never wrote. */
test("on a member-keyed route the findings Reading and undo address one findings Work: the document's", async () => {
  const seen: unknown[] = [], calls: Call[] = [];
  const mount = mountPods(workReadings(memory(), seen), calls);
  try {
    await vi.waitFor(() => expect(mount.owner()?.handle).toBeTruthy());
    mount.findings();
    mount.findings();
    expect(seen, "one subscription, to the document's findings Work").toEqual([{ kind: "work", binding: "address", route: "findings", target: address }]);
    expect(await mount.undoFinding()).toBeNull();
    expect(calls.map((call) => call.name)).toContain("work.history");
    expect(calls.filter((call) => JSON.stringify(call.query) !== JSON.stringify({ target: address }))).toEqual([]);
  } finally { mount.dispose(); }
});

test("a findings Reading the host fails, or a findings Work that does not decode, is a reported fault, not silence", async () => {
  for (const frame of [{ kind: "failure", key: "", error: "socket closed" }, { kind: "snapshot", key: "", value: { doc: { findings: { f1: { id: "f1", by: "person" } } } } }]) {
    io.fault.mockClear();
    const mount = mountPods({ subscribe: (_request, listener) => { queueMicrotask(() => listener(frame as never)); return () => {}; } });
    try {
      expect(mount.findings()).toEqual([]);
      await vi.waitFor(() => expect(io.fault).toHaveBeenCalledWith(
        { code: "reading.failed", routeCode: "pods", readingKind: "findings" }, expect.anything()));
      expect(mount.findings()).toEqual([]);
      expect(await mount.ownFindingsLeft(), "unread, so the host answers an undo").toBeNull();
    } finally { mount.dispose(); }
  }
});
