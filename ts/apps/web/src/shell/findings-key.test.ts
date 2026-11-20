// @vitest-environment jsdom
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vite-plus/test";
import {
  addressSchema,
  podMemberCode,
  settingsRouteState,
  workFingerprintSchema,
} from "@pe/agent-contracts";
import { findingsWork } from "@pe/agent-contracts/slots";
import { RouteWorkspace } from "@pe/runtime";
import {
  subjectCode,
  uniqueIdSchema,
} from "../../../../packages/agent-contracts/src/subject-ref.ts";
import { fixtureNative } from "../../../host/tests/fixture-native";
import { approvedPea } from "../../../host/tests/callers";
import { module as pods } from "../pods/route";
import { workReadings } from "../route/slots/findings/readings.test-support";
import { mountTypedRoute } from "./typed-mount";
import { createFixtureWorkDoor } from "./fixture-work-door";

const io = vi.hoisted(() => ({ fault: vi.fn() }));
vi.mock("../host/diagnostics", async (original) => ({
  ...(await original<object>()),
  reportFault: io.fault,
}));

const ref = { pod: "share-ducts", path: "settings/checks.json" };
const basis = { member: ref, rawContent: "{}", sha256: "f".repeat(64) };
const address = addressSchema.parse("C:/model.rvt");
const port = subjectCode({
  keyKind: "UniqueId",
  key: uniqueIdSchema.parse("9e9fb89e-a9db-4d9a-8f35-b8fbc2303423-00d3da72"),
  sub: { port: 1 },
});
type Ports = NonNullable<Parameters<typeof mountTypedRoute>[3]>;
/** /pods keeps its member Work and reads the document findings independently (B41). */
function mountPods(readings: NonNullable<Ports["readings"]>) {
  return mountTypedRoute(
    pods,
    {
      address: { read: () => new URLSearchParams(), write() {}, subscribe: () => () => {} },
      fixture: null,
      target: { kind: "host" },
      work: { address, open: null },
      custody: { current: () => true },
      memory: () => ({ member: { kind: "ids", ids: [podMemberCode(ref)] } }),
    },
    workFingerprintSchema.parse(`builtin-closure:${"a".repeat(64)}`),
    {
      work: createFixtureWorkDoor(settingsRouteState, { basis, fields: {} }),
      sources: {},
      readings,
      timeline: {
        open(_works, deliver) {
          deliver(null, "Member Work has no document Timeline (B41)");
          return () => {};
        },
        async step() {
          return { message: "Member Work has no document Timeline (B41)" };
        },
      },
    },
  );
}
const memory = () => {
  let saved: unknown = null;
  return new RouteWorkspace({
    registrations: [{ spec: findingsWork }],
    store: {
      getState: async () => structuredClone(saved),
      setState: async ({ value }) => void (saved = structuredClone(value)),
    },
  });
};

/*
 * F2's falsifier: the browser reads findings from the host's `work` Reading. Only the native process
 * is a fixture; the action journal, the registry and the Work are real. Mutant "the mount reads once"
 * (the old `readFindings` load, re-run only after this Place's own write) leaves the list empty.
 */
test("a findings.say through the host as Pea appears in a mounted route's findings with no person action", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pe-findings-reading-"));
  // The native fixture's journal is a stored kind, so its folder sits under a machine `state` root.
  const native = await fixtureNative(join(dir, "state", "native"));
  const socket = await native.connect();
  const host = memory();
  const post = native.actions({ workspace: host });
  const mount = mountPods(workReadings(host));
  try {
    let notified = 0;
    mount.subscribe(() => void notified++);
    expect(mount.findings()).toEqual([]);
    const before = notified;
    const response = await post(
      {
        id: "pea-says",
        key: "findings.say",
        target: { kind: "document", ref: socket.target },
        input: { subject: port, kind: "claim", text: "port 1 static reads low" },
      },
      approvedPea("findings-reading"),
    );
    expect(response.status, await response.clone().text()).toBeLessThan(400);
    expect(await native.journal.wait("pea-says")).toMatchObject({ state: "succeeded" });
    await vi.waitFor(() =>
      expect(mount.findings()).toEqual([
        expect.objectContaining({
          subject: port,
          kind: "claim",
          text: "port 1 static reads low",
          said: expect.objectContaining({ by: "pea" }),
        }),
      ]),
    );
    expect(notified, "the arrival redraws the route").toBeGreaterThan(before);
    // No person action and no reload: the mount asked the Pe client for nothing.
  } finally {
    mount.dispose();
    await native.close();
    await rm(dir, { recursive: true, force: true });
  }
}, 60_000);

test("a member-keyed route reads the document findings without adding them to its Timeline (B41)", async () => {
  const seen: unknown[] = [];
  const mount = mountPods(workReadings(memory(), seen));
  try {
    await vi.waitFor(() => expect(mount.owner()?.handle).toBeTruthy());
    mount.findings();
    mount.findings();
    expect(seen).toEqual([
      { kind: "work", binding: "address", route: "findings", target: address },
    ]);
    expect(await mount.stepTimeline("undo")).toEqual({
      message: "Member Work has no document Timeline (B41)",
    });
  } finally {
    mount.dispose();
  }
});

test("a findings Reading the host fails, or a findings Work that does not decode, is a reported fault, not silence", async () => {
  for (const frame of [
    { kind: "failure", key: "", error: "socket closed" },
    { kind: "snapshot", key: "", value: { doc: { findings: { f1: { id: "f1", by: "person" } } } } },
  ]) {
    io.fault.mockClear();
    const mount = mountPods({
      subscribe: (_request, listener) => {
        queueMicrotask(() => listener(frame as never));
        return () => {};
      },
    });
    try {
      expect(mount.findings()).toEqual([]);
      await vi.waitFor(() =>
        expect(io.fault).toHaveBeenCalledWith(
          { code: "reading.failed", routeCode: "pods", readingKind: "findings" },
          expect.anything(),
        ),
      );
      expect(mount.findings()).toEqual([]);
    } finally {
      mount.dispose();
    }
  }
});
