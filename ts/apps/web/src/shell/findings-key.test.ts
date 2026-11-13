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
type Call = { name: string; query: Record<string, string>; works?: unknown };
type Port = NonNullable<NonNullable<Parameters<typeof mountTypedRoute>[3]>["findings"]>;

/** /pods at a picked member on one document: the route's Work is keyed by the member, the findings by the document. */
function mountPods(answer: (call: Call, nth: number) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const findings: Port = { async response(name: string, input: { query?: object; body?: unknown }) {
    const works = (input.body as { args?: { works?: unknown } } | undefined)?.args?.works;
    calls.push({ name, query: { ...input.query }, ...(works ? { works } : {}) });
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
/** The host Timeline's answer for the findings Work: one step of the person's to undo. */
const timeline = () => Response.json({ generation: 0, version: 1, state: "current", value: { evaluation: "test", coverage: { refused: [], unknown: [] }, data: { rows: [], redo: null, refusal: { undo: null, redo: null },
  undo: { work: { binding: "address", route: "findings", target: address }, revision: 3, label: "late" } } } });
const answer = ({ name }: { name: string }) =>
  name === "work.get" ? work() : name === "reads.value" ? timeline() : Response.json({ ok: true });
const one = { id: "f1", subject: subjectCode({ keyKind: "UniqueId", key: uniqueIdSchema.parse("9e9fb89e-a9db-4d9a-8f35-b8fbc2303423-00d3da72") }), kind: "note", text: "late", by: "person", at: "2026-11-11T12:00:00.000Z", place: {} };

/* purge-2 c103cdbc: undo and the own-findings count used the route's member key, a findings Work the host never wrote. */
test("on a member-keyed route the pane read addresses the document findings and Timeline undo sends every mounted Work", async () => {
  const { mount, calls } = mountPods(answer);
  try {
    await vi.waitFor(() => expect(mount.owner()?.handle).toBeTruthy());
    mount.findings();
    await vi.waitFor(() => expect(mount.timeline()?.undo).toBeTruthy());
    expect(await mount.stepTimeline("undo")).toBeNull();
    expect(calls.map((call) => call.name)).toContain("work.history");
    // The Timeline read carries its Work in the body; every keyed call names the document, not the member.
    expect(calls.filter(call => call.name === "work.get").every(call => call.query.target === address)).toBe(true);
    expect(calls.filter((call) => call.name === "reads.value").map((call) => call.works)).toContainEqual([
      expect.objectContaining({ route: "pods" }),
    ]);
  } finally { mount.dispose(); }
});

test("an older findings read that answers late does not overwrite a newer one", async () => {
  let late!: (response: Response) => void;
  // 1 = the pane's first read (held); then undo's Timeline read and its history write; then the re-read undo asks for.
  let reads = 0;
  const { mount } = mountPods(call =>
    call.name === "work.get" && ++reads === 1 ? new Promise<Response>((resolve) => { late = resolve; }) : answer(call));
  try {
    await vi.waitFor(() => expect(mount.owner()?.handle).toBeTruthy());
    mount.findings();
    await vi.waitFor(() => expect(mount.timeline()?.undo).toBeTruthy());
    expect(await mount.stepTimeline("undo")).toBeNull();
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
