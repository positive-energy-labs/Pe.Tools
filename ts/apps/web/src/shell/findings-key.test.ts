// @vitest-environment jsdom
import { expect, test, vi } from "vite-plus/test";
import { addressSchema, podMemberCode, settingsRouteState, workFingerprintSchema } from "@pe/agent-contracts";
import { subjectCode, uniqueIdSchema } from "../../../../packages/agent-contracts/src/subject-ref.ts";
import { module as pods } from "../pods/route";
import { mountTypedRoute } from "./typed-mount";
import { createFixtureWorkDoor } from "./fixture-work-door";

const io = vi.hoisted(() => ({ fault: vi.fn() }));
vi.mock("../host/diagnostics", async (original) => ({ ...(await original<object>()), reportFault: io.fault }));

const ref = { pod: "share-ducts", path: "settings/checks.json" };
const basis = { member: ref, rawContent: "{}", sha256: "f".repeat(64) };
const address = addressSchema.parse("C:/models/a.rvt");
type Call = { name: string; query: Record<string, string> };
type Port = NonNullable<NonNullable<Parameters<typeof mountTypedRoute>[3]>["findings"]>;

/** /pods at a picked member on one document: the route's Work is keyed by the member, the findings by the document. */
function mountPods(answer: (call: Call, nth: number) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const findings: Port = { async response(name: string, input: { query?: object }) {
    calls.push({ name, query: { ...input.query } });
    return answer(calls.at(-1)!, calls.length);
  } };
  const mount = mountTypedRoute(pods, {
    address: { read: () => new URLSearchParams(), write() {}, subscribe: () => () => {} },
    fixture: null, target: { kind: "host" }, work: { address, open: null }, custody: { current: () => true },
    memory: () => ({ member: { kind: "ids", ids: [podMemberCode(ref)] } }),
  }, workFingerprintSchema.parse(`builtin-closure:${"a".repeat(64)}`), {
    work: createFixtureWorkDoor(settingsRouteState, { basis, fields: {} }), sources: {}, findings,
  });
  return { mount, calls };
}
const work = (findings: Record<string, unknown> = {}) => Response.json({ revision: 3, doc: { findings } });
const one = { id: "f1", subject: subjectCode({ keyKind: "UniqueId", key: uniqueIdSchema.parse("9e9fb89e-a9db-4d9a-8f35-b8fbc2303423-00d3da72") }), kind: "note", text: "late", by: "person", at: "2026-11-11T12:00:00.000Z", place: {} };

/* purge-2 c103cdbc: undo and the own-findings count used the route's member key, a findings Work the host never wrote. */
test("on a member-keyed route the pane read, undo and the own-findings count address one findings Work: the document's", async () => {
  const { mount, calls } = mountPods(({ name }) => (name === "work.get" ? work() : Response.json({ ok: true })));
  try {
    await vi.waitFor(() => expect(mount.owner()?.handle).toBeTruthy());
    mount.findings();
    expect(await mount.undoFinding()).toBeNull();
    await mount.ownFindingsLeft();
    expect(calls.map((call) => call.name)).toContain("work.history");
    expect(calls.filter((call) => JSON.stringify(call.query) !== JSON.stringify({ target: address }))).toEqual([]);
  } finally { mount.dispose(); }
});

test("an older findings read that answers late does not overwrite a newer one", async () => {
  let late!: (response: Response) => void;
  // 1 = the pane's first read (held); 2, 3 = undo's revision read and its history write; 4 = the re-read undo asks for.
  const { mount } = mountPods((call, nth) =>
    nth === 1 ? new Promise<Response>((resolve) => { late = resolve; })
      : call.name === "work.get" ? work() : Response.json({ ok: true }));
  try {
    await vi.waitFor(() => expect(mount.owner()?.handle).toBeTruthy());
    mount.findings();
    expect(await mount.undoFinding()).toBeNull();
    await vi.waitFor(() => expect(late).toBeTruthy());
    late(work({ f1: one }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(mount.findings()).toEqual([]);
  } finally { mount.dispose(); }
});

test("a findings read the host fails is a reported fault, not silence", async () => {
  io.fault.mockClear();
  const { mount } = mountPods(() => new Response("down", { status: 500 }));
  try {
    mount.findings();
    await vi.waitFor(() => expect(io.fault).toHaveBeenCalledWith(
      { code: "reading.failed", routeCode: "pods", readingKind: "findings" }, expect.anything()));
  } finally { mount.dispose(); }
  io.fault.mockClear();
  const thrown = mountPods(() => Promise.reject(Error("socket closed")));
  try {
    thrown.mount.findings();
    await vi.waitFor(() => expect(io.fault).toHaveBeenCalledWith(
      { code: "reading.failed", routeCode: "pods", readingKind: "findings" }, expect.objectContaining({ message: "socket closed" })));
  } finally { thrown.mount.dispose(); }
});
