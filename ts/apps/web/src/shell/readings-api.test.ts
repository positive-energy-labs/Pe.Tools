import { afterEach, expect, test, vi } from "vite-plus/test";
import { ductsBodySource } from "./readings-api";
import { callOp, callCompose} from "../host/catalog-client";
import { DUCTS_BODY_VERSION_HEADER, readingKey } from "@pe/agent-contracts";
import { demandContext } from "./readings-use";
import { peReadings } from "../host/resource-stream";
const fetched = vi.hoisted(() => ({ host: vi.fn() }));
vi.mock("../host/runtime", () => ({ hostFetch: fetched.host }));
afterEach(() => fetched.host.mockReset());
const signal = new AbortController().signal;
const answer = (value: unknown) =>
  fetched.host.mockResolvedValue(new Response(JSON.stringify(value)));
test("native reads keep exact document scope and refuse a payload outside the catalog schema", async () => {
  answer({});
  await expect(
    callOp(
      { signal, target: { kind: "document", ref: { session: "s", openId: "d" } } },
      "revit.detail.data-tables",
      {},
    ),
  ).rejects.toThrow();
  expect(fetched.host).toHaveBeenCalledWith(
    "/call",
    expect.objectContaining({
      headers: expect.objectContaining({
        "x-pe-bridge-session-id": "s",
        "x-pe-open-document-id": "d",
      }),
      signal,
    }),
  );
});
test("TS-owned operations decode through their catalog schema too", async () => {
  answer({ content: "{}", sha256: "hash", bytesBase64: "e30=" });
  await expect(
    callOp({ signal }, "pod.member.read", { pod: "p", path: "settings/a.json" }),
  ).resolves.toMatchObject({ content: "{}", sha256: "hash", bytesBase64: "e30=" });
  answer({ content: 7 });
  await expect(
    callOp({ signal }, "pod.member.read", { pod: "p", path: "settings/a.json" }),
  ).rejects.toThrow();
});
test("compositions decode at their declared route, retaining GET and cancellation", async () => {
  answer({ captures: [] });
  await expect(callCompose({ signal }, "captures.list", {})).resolves.toEqual({ captures: [] });
  expect(fetched.host).toHaveBeenCalledWith("/captures", expect.objectContaining({ signal }));
  answer({ captures: [42] });
  await expect(callCompose({ signal }, "captures.list", {})).rejects.toThrow();
});

test("Ducts retained-body republication keeps the original body without a refetch", async () => {
  let envelope!: Parameters<typeof peReadings.subscribe>[1];
  const stop = vi.fn();
  const subscription = vi.spyOn(peReadings, "subscribe").mockImplementation((_request, deliver) => { envelope = deliver; return stop; });
  const request = { kind: "ducts-tables", session: "s", ids: [] } as const;
  const deliver = vi.fn();
  const controller = new AbortController();
  const body = Promise.withResolvers<Response>();
  const decoded = Promise.withResolvers<void>();
  fetched.host.mockReturnValueOnce(body.promise);
  const response = Response.json({ folder: "tables", tables: {}, missing: [], unsupported: {} }, { headers: {
    [DUCTS_BODY_VERSION_HEADER]: "v1", "x-pe-resolved-session": "s", "x-pe-native-request-id": "native-1",
  } });
  try {
    const release = await ductsBodySource({ request: () => ({ ...request, ids: [] }), decode: value => { decoded.resolve(); return value; }, absent: null }).open(demandContext({ kind: "session", session: "s" }, 1, {}, controller.signal), deliver);
    const frame = { kind: "snapshot" as const, key: readingKey({ ...request, ids: [] }), value: { revision: "v1", state: "ready", version: "v1", session: "s", target: null } };
    envelope(frame);
    envelope({ ...frame, value: { ...frame.value, state: "stale" } });
    body.resolve(response); await decoded.promise;
    expect(deliver).toHaveBeenLastCalledWith({ kind: "stale" });
    envelope(frame);
    await vi.waitFor(() => expect(deliver).toHaveBeenCalledWith(expect.objectContaining({ kind: "complete" })));
    envelope({ ...frame, stale: true });
    expect(deliver).toHaveBeenLastCalledWith({ kind: "stale" });
    envelope(frame);
    expect(deliver).toHaveBeenLastCalledWith(expect.objectContaining({ kind: "complete" }));
    envelope({ ...frame, value: { ...frame.value, state: "stale" } });
    expect(deliver).toHaveBeenLastCalledWith({ kind: "stale" });
    envelope(frame);
    expect(deliver).toHaveBeenLastCalledWith(expect.objectContaining({ kind: "complete" }));
    expect(fetched.host).toHaveBeenCalledOnce();
    controller.abort(); release?.(); expect(stop).toHaveBeenCalledOnce();
  } finally { controller.abort(); subscription.mockRestore(); }
});
