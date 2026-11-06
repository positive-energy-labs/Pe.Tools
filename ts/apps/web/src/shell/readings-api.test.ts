import { afterEach, expect, test, vi } from "vite-plus/test";
import { callOp, callCompose, opSource, composeSource, ductsBodySource } from "./readings-api";
import { BODY_RECEIPT_HEADER, DUCTS_BODY_VERSION_HEADER, readingKey } from "@pe/agent-contracts";
import { demandContext } from "./readings-use";
import { peReadings } from "../readings";
import { ductsSources } from "../ducts/sources";
import { ductsInputsSchema } from "@pe/agent-contracts";
import { EMPTY_SNAPSHOT } from "../ducts/sheet/scoped-snapshot";
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

test("native and ordinary HTTP sources carry only the producing response header", async () => {
  const context = demandContext({ kind: "host" }, 1, {}, signal);
  const delivered = vi.fn();
  fetched.host.mockResolvedValueOnce(Response.json({ content: "{}", sha256: "hash", bytesBase64: "e30=" }, { headers: { [BODY_RECEIPT_HEADER]: "native-body" } }));
  await opSource({ key: "pod.member.read", request: () => ({ pod: "p", path: "x" }), absent: null }).open(context, delivered);
  expect(delivered).toHaveBeenLastCalledWith(expect.objectContaining({ kind: "complete", bodyReceipts: ["native-body"] }));
  fetched.host.mockResolvedValueOnce(Response.json({ kind: "legs", target: { session: "s", openId: "d" }, basis: "b", pathId: "p", legs: [] }, { headers: { [BODY_RECEIPT_HEADER]: "sheet-body" } }));
  await composeSource({ key: "ducts.sheet", input: () => ({ body: { target: { session: "s", openId: "d" }, mode: "fan", unitId: 1, portIndex: 0 } }), absent: null }).open(context, delivered);
  expect(delivered).toHaveBeenLastCalledWith(expect.objectContaining({ kind: "complete", bodyReceipts: ["sheet-body"] }));
  fetched.host.mockResolvedValueOnce(Response.json({ doc: {}, revision: 0 }, { headers: { [BODY_RECEIPT_HEADER]: "work-body" } }));
  await composeSource({ key: "work.get", input: () => ({ params: { route: "fans" } }), absent: null }).open(context, delivered);
  expect(delivered).toHaveBeenLastCalledWith(expect.objectContaining({ kind: "complete", bodyReceipts: ["work-body"] }));
  expect(fetched.host.mock.calls.at(-1)![1]).toMatchObject({ method: "GET" });
  fetched.host.mockResolvedValueOnce(Response.json({ captures: [] }));
  await composeSource({ key: "captures.list", input: () => ({}), absent: null }).open(context, delivered);
  expect(delivered).toHaveBeenLastCalledWith(expect.objectContaining({ kind: "complete", bodyReceipts: undefined }));
});

test("Ducts retained-body republication keeps the original receipt without a body refetch", async () => {
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
    [BODY_RECEIPT_HEADER]: "original-native-body", [DUCTS_BODY_VERSION_HEADER]: "v1", "x-pe-resolved-session": "s", "x-pe-native-request-id": "native-1",
  } });
  try {
    const release = await ductsBodySource({ request: () => ({ ...request, ids: [] }), decode: value => { decoded.resolve(); return value; }, absent: null }).open(demandContext({ kind: "session", session: "s" }, 1, {}, controller.signal), deliver);
    const frame = { kind: "snapshot" as const, key: readingKey({ ...request, ids: [] }), value: { revision: "v1", state: "ready", version: "v1", session: "s", target: null }, bodyReceipts: ["envelope-is-not-body"] };
    envelope(frame);
    envelope({ ...frame, value: { ...frame.value, state: "stale" } });
    body.resolve(response); await decoded.promise;
    expect(deliver).toHaveBeenLastCalledWith({ kind: "stale" });
    envelope(frame);
    await vi.waitFor(() => expect(deliver).toHaveBeenCalledWith(expect.objectContaining({ kind: "complete", bodyReceipts: ["original-native-body"] })));
    envelope({ ...frame, stale: true });
    expect(deliver).toHaveBeenLastCalledWith({ kind: "stale" });
    envelope(frame);
    expect(deliver).toHaveBeenLastCalledWith(expect.objectContaining({ kind: "complete", bodyReceipts: ["original-native-body"] }));
    envelope({ ...frame, value: { ...frame.value, state: "stale" } });
    expect(deliver).toHaveBeenLastCalledWith({ kind: "stale" });
    envelope(frame);
    expect(deliver).toHaveBeenLastCalledWith(expect.objectContaining({ kind: "complete", bodyReceipts: ["original-native-body"] }));
    expect(fetched.host).toHaveBeenCalledOnce();
    controller.abort(); release?.(); expect(stop).toHaveBeenCalledOnce();
  } finally { controller.abort(); subscription.mockRestore(); }
});

test.each([null, "1:inputs", "2:worksheet"])("a multi-fan sheet carries every contributing body, or none when %s is missing", async missing => {
  const target = { session: "s", openId: "d" };
  const resolved = (value: unknown) => ({ value, source: "default", units: null, version: null, status: "valid" });
  const inputs = ductsInputsSchema.parse({ terminals: {}, units: {}, components: {}, rulings: { joins: [], ends: [] }, tables: {}, assignments: {}, fittingDrops: {}, criteria: {
    velocityLimitFpm: { supply: resolved(900), return: resolved(900) }, allowanceInWg: { supply: resolved(0), return: resolved(0) },
    terminalDropInWg: resolved(0), autoJoinGapIn: resolved(0), healBoxIn: resolved(0), splitPolicy: resolved("even"),
  } });
  const claims: string[] = [];
  fetched.host.mockImplementation(async (url, init) => {
    expect(url).toBe("/pe/ducts/sheet");
    const request = JSON.parse(init.body);
    const kind = request.detail?.kind ?? "overview";
    const claim = `${request.unitId}:${kind}`; claims.push(claim);
    const base = { kind, target, basis: `basis-${request.unitId}` };
    const value = kind === "overview" ? { ...base, mode: "fan", fan: { unitId: request.unitId, portIndex: 0, mark: claim, ratedEspInWg: null, inletPortIndex: null, dischargePortIndex: 0, flowCfm: null }, totals: null,
      paths: { supply: { paths: [], rest: 0 }, return: { paths: [], rest: 0 } }, blockers: [], assumedBlockers: [],
      next: { hint: "", legs: [], elements: { kind: "elements" }, inputs: { kind: "inputs" }, worksheet: { kind: "worksheet" } } }
      : kind === "inputs" ? { ...base, inputs, firm: { version: "v", path: "firm", present: true }, ends: [], fittings: [], tableTitles: {}, notes: [], blockers: [] }
      : kind === "elements" ? { ...base, walkedElementIds: [], beyond: [] }
      : { ...base, limits: { supplyFpm: 900, returnFpm: 900, source: "firm" }, supply: { runs: [], sections: [], worstKnownInWg: null, elementSections: {} }, return: { runs: [], sections: [], worstKnownInWg: null, elementSections: {} }, legs: {} };
    return Response.json(value, { headers: claim === missing ? {} : { [BODY_RECEIPT_HEADER]: claim } });
  });
  const rows = [1, 2].map(unitId => ({ unitId, uniqueId: `fan-${unitId}`, portIndex: 0, mark: `F-${unitId}`, kind: "other", side: "supply", ratedEspInWg: null }));
  const deliver = vi.fn();
  const source = ductsSources()["ducts.sheet"]!;
  if (source.kind === "derive") throw Error("Sheet must use its body sources");
  await source.open(demandContext({ kind: "document", ref: target }, 1, { fans: { rows }, fan: ["fan-1@0", "fan-2@0"] }, signal), deliver);
  expect(claims).toEqual(["1:overview", "1:inputs", "1:elements", "1:worksheet", "2:overview", "2:inputs", "2:elements", "2:worksheet"]);
  expect(deliver).toHaveBeenLastCalledWith(expect.objectContaining({ kind: "complete", value: expect.objectContaining({ opened: expect.any(Array) }), bodyReceipts: missing ? undefined : claims }));
});

test.each([false, true])("multi-system acquisition unions every native body (missing second claim=%s)", async missing => {
  const controller = new AbortController();
  let bodies = 0;
  const subscription = vi.spyOn(peReadings, "subscribe").mockImplementation((request, deliver) => {
    if (request.kind !== "ducts-snapshot") throw Error("Unexpected source");
    deliver({ kind: "snapshot", key: readingKey(request), value: { revision: `v${bodies + 1}`, version: `v${bodies + 1}`, session: "s", target: { session: "s", openId: "d" }, state: "ready" } });
    return () => {};
  });
  fetched.host.mockImplementation(async () => {
    bodies++;
    return Response.json({ ...EMPTY_SNAPSHOT, document: { ...EMPTY_SNAPSHOT.document, readAt: "2026-11-06T00:00:00Z" } }, { headers: {
      ...(missing && bodies === 2 ? {} : { [BODY_RECEIPT_HEADER]: `body-${bodies}` }), [DUCTS_BODY_VERSION_HEADER]: `v${bodies}`,
      "x-pe-resolved-session": "s", "x-pe-resolved-open-id": "d", "x-pe-native-request-id": `native-${bodies}`,
    } });
  });
  const deliver = vi.fn();
  try {
    const source = ductsSources()["ducts.networks"]!;
    if (source.kind === "derive") throw Error("Networks must acquire its native bodies");
    await source.open(demandContext({ kind: "document", ref: { session: "s", openId: "d" } }, 1, {
      system: "all", roster: { ...EMPTY_SNAPSHOT, systems: Array.from({ length: 18 }, (_, i) => ({ id: i + 1, name: `system-${i + 1}` })) },
    }, controller.signal), deliver);
    expect(fetched.host).toHaveBeenCalledTimes(2);
    expect(deliver).toHaveBeenLastCalledWith(expect.objectContaining({ kind: "complete", bodyReceipts: missing ? undefined : ["body-1", "body-2"] }));
  } finally { controller.abort(); subscription.mockRestore(); }
});
