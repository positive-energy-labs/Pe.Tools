import { elementSubject } from "@pe/ducts-domain/work-subject";
import { mkdtemp,stateFixture } from "../../../../tests/isolated-home/storage.ts";
import { snapshot as workSnapshot } from "../ducts/test-fixture";
// @vitest-environment jsdom
import { workFingerprintSchema } from "@pe/agent-contracts";
import { observeResources } from "@pe/runtime";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect,test,vi } from "vite-plus/test";
import { fixture } from "../../../host/tests/host-read-graph.test-support";
import { mountTypedRoute } from "../shell/typed-mount";
import { createWorkFeedClient } from "../shell/work-feed-client";

// Recorded harness events enter the same consumers as the conversation and its context ledger.
import { RegistryContext } from "@effect/atom-react";
import { harnessEventSchema } from "@pe/agent-contracts";
import { emptyChatState,selectBreakdown,type ChatMessage } from "@pe/agent-contracts/chat-state";
import { Pane,PaneFaultProvider } from "@pe/kit/lang/pane";
import { TooltipProvider } from "@pe/kit/lang/tooltip";
import { act,cleanup,fireEvent,render,screen,within } from "@testing-library/react";
import * as Atom from "effect/reactivity/Atom";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createElement,Fragment } from "react";
import { createPeRoutes } from "../../../host/src/pe-routes";
import { AssetReel,threadAssets } from "../chat/asset-reel";
import { DIAGNOSTICS_MAX_PENDING,reportFault } from "../host/diagnostics";
import { SettingsBody } from "../machine/body";
import { MACHINE_SEEDS } from "../machine/open-examples";
import { TranscriptContext } from "../workbench/provider/thread-summary";
import { useTranscript } from "../workbench/provider/use-workbench";
import { CurrentThreadViewOwner } from "../workbench/thread-view";
import { useCacheView } from "../workbench/world/cap";
import { SessionStrip } from "../workbench/world/lane";

function UsageLedger() {
  const { breakdown, turns } = useTranscript((state) => ({
    breakdown: selectBreakdown(state), turns: state.events.filter((event) => event.kind === "prompt").length,
  }));
  return createElement(SessionStrip, { breakdown, cache: useCacheView(breakdown, turns), sendNumber: turns });
}

test("JP3 reopen a thread's ordered assets and read corrected usage without inventing a send", async () => {
  await openRecordedGuidanceAfterRefusal();
  await sendFeedbackWhileDeliveryWaits();
  const registry = AtomRegistry.make();
  const source = Atom.make(emptyChatState());
  const at = "2026-11-07T00:00:00Z";
  const prompt = harnessEventSchema.parse({ kind: "prompt", seq: 1, turnId: "one", at, text: "Size the feeder" });
  const usage = (seq: number, used: number) => harnessEventSchema.parse({
    kind: "update", seq, turnId: "one", at,
    update: { sessionUpdate: "usage_update", used, size: 200000 },
  });
  const messages: ChatMessage[] = [
    { id: "u1", role: "user", running: false, parts: [
      { type: "image", image: "data:image/png;base64,AA==", name: "panel.png" },
      { type: "file", name: "feeder.txt", mimeType: "text/plain", size: 9 },
    ] },
    { id: "a1", role: "assistant", running: false, parts: [{ type: "tool-call", call: {
      id: "capture", title: "capture_view", status: "completed", args: {}, target: "Views/Panel",
      images: ["data:image/png;base64,AA==", "data:image/png;base64,AQ=="],
    } }] },
  ];
  const show = () => render(createElement(RegistryContext.Provider, { value: registry },
    createElement(TooltipProvider, null,
      createElement(TranscriptContext.Provider, { value: source },
        createElement(CurrentThreadViewOwner, { registry, threadKey: "jp-thread", children:
          createElement(Fragment, null, createElement(UsageLedger),
            createElement(AssetReel, { assets: threadAssets(messages), onMention() {} })) })))));
  let view = show();
  try {
    expect(screen.getByText(/nothing sent to the model yet/), "H22: an empty thread invents no usage").toBeTruthy();
    await act(async () => registry.set(source, { ...emptyChatState(), providerId: "codex", events: [prompt, usage(2, 9400)] }));
    expect(screen.getByText("9.4k loaded"), "H22: the visible context ledger follows the turn event").toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Inspect" }));
    expect(screen.getByText("send #1")).toBeTruthy();
    await act(async () => registry.set(source, { ...emptyChatState(), providerId: "codex", events: [prompt, usage(2, 9400), usage(3, 10000)] }));
    expect(screen.getByText("10.0k loaded"), "H22: corrected usage replaces the prior total").toBeTruthy();
    expect(screen.getByText("send #1"), "H22: correction is not another send").toBeTruthy();
    const names = () => within(screen.getByRole("group", { name: "Assets in this thread" }))
      .getAllByRole("button").map((button) => button.getAttribute("aria-label")).filter((name) => name && !name.startsWith("Copy "));
    expect(names(), "H21: attachments and captures keep their transcript order").toEqual([
      "2 captures", "2 files", "0 model", "panel.png", "feeder.txt", "Panel 1", "Panel 2",
    ]);
    fireEvent.click(screen.getByRole("button", { name: "2 captures" }));
    expect(screen.queryByRole("button", { name: "feeder.txt" })).toBeNull();
    view.unmount(); view = show();
    expect(names(), "H21: reopening the reel retains every ordered asset").toContain("feeder.txt");
    expect(screen.getByText("10.0k loaded"), "H22: reopening retains the corrected usage").toBeTruthy();
  } finally { view.unmount(); registry.dispose(); cleanup(); }
});

test("JP4 inspect a pane fault during an outage", async () => {
  let view: ReturnType<typeof render> | undefined;
  try {
    vi.useFakeTimers();
    let down = true;
    const batches: unknown[] = [];
    vi.stubGlobal("fetch", async (_url: unknown, init?: RequestInit) => {
      batches.push(JSON.parse(String(init?.body)));
      if (down) throw TypeError("Failed to fetch");
      return Response.json({ ok: true });
    });
    function BrokenPane(): never { throw Error("C:/Users/private/secret.rvt"); }
    view = render(createElement(Fragment, null,
      createElement(PaneFaultProvider, { onFault: (error) => reportFault({ code: "pane.failed" }, error), children:
        createElement(Pane, { children: createElement(BrokenPane) }) }),
      createElement(SettingsBody, { reading: MACHINE_SEEDS.disconnected, fixture: true, shell: "web" })));
    // Add enough recorded stream faults to exercise the same visible overflow state.
    await act(async () => {
      for (let i = 0; i < DIAGNOSTICS_MAX_PENDING + 2; i++) reportFault({ code: "stream.failed", readingKind: "private text with spaces" });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText(/diagnostics unreachable/).textContent, "H24: Settings discloses bounded-buffer loss while offline").toMatch(/64 waiting.*dropped/);
    expect(JSON.stringify(batches), "H24: approved diagnostic facts exclude local exception text and unapproved labels").not.toMatch(/secret|private text/);
    down = false;
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); await vi.advanceTimersByTimeAsync(10); });
    expect(screen.getByText(/diagnostics delivered/), "H24: recovered delivery is visible").toBeTruthy();
    expect(JSON.stringify(batches), "H24: recovery reports the outage and dropped facts").toContain("host.unreachable");
  } finally {
    view?.unmount(); cleanup();
    vi.useRealTimers(); vi.unstubAllGlobals();
  }
});

import { withInvocationContext } from "@pe/runtime/context";
import { createRequire } from "node:module";
import { receiptGoldenEnvelope } from "../../../../packages/agent-contracts/tests/receipt-fixture";
import { createReceiptExport } from "../../../host/src/receipt-export";

async function sendFeedbackWhileDeliveryWaits() {
  const dir = await mkdtemp(resolve(tmpdir(), "jp-feedback-"));
  const stamp = receiptGoldenEnvelope.stamp!;
  const journal = journalAt(resolve(dir, "journal.json"), Date.now, () => stamp);
  const request = Promise.withResolvers<Response>();
  let sends = 0;
  // Load the host's actual SDK dependency; the only recorded boundary is its network transport.
  const { PostHog } = createRequire(resolve(process.cwd(), "../host/package.json"))("posthog-node");
  const client = new PostHog("explicit-test-key", {
    disableCompression: true, disableGeoip: true, flushInterval: 0, fetchRetryCount: 0,
    enableExceptionAutocapture: false, requestTimeout: 60000,
    fetch: () => { sends++; return request.promise; },
  });
  const telemetry = createReceiptExport({ journal, root: stateFixture(dir), client, deadlineMs: 50,
    stamps: { host: { ...stamp, component: "host" }, web: { ...stamp, component: "web" } } });
  const routes = createPeRoutes({ registrations: [], store: { getState: async () => null, setState: async () => {} }, heads: { observe: () => () => {} }, telemetry });
  const post = (path: string, body?: unknown) => withInvocationContext({ caller: { kind: "human", via: "local" } }, () => routes.fetch(new Request(`http://host${path}`, {
    method: "POST", headers: { "content-type": "application/json", "x-pe-web-build": stamp.build },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })));
  const note = { comment: "keep the complete ordered note", url: "https://private/model", selector: "#feeder", component: "Worksheet", components: ["Worksheet", "Pane"], html: "<p>private feedback</p>",
    rect: { x: 1, y: 2, width: 3, height: 4 }, viewport: { width: 800, height: 600, dpr: 1 }, picture: "data:image/png;base64,AA==", picture_error: null };
  try {
    const response = await post("/pe/feedback", note);
    expect(response.status, "H21: human feedback crosses the real HTTP door").toBe(200);
    const receipt = await response.json() as { feedbackId: string; delivery: string };
    expect(receipt.delivery, "H21: kept feedback is uncertain while its delivery remains on the wire").toBe("uncertain");
    const [saved] = await journal.read({ kinds: ["feedback"] });
    if (saved?.body.kind !== "feedback") throw Error("Feedback was not kept");
    expect(JSON.parse(await readFile(saved.body.localRef.path, "utf8")).feedback,
      "H21: feedback retains every explicit field before delivery").toEqual(note);
    expect((await (await post(`/pe/feedback/${receipt.feedbackId}/deliver`)).json()).delivery,
      "H21: retrying status cannot invent failure while the first send waits").toBe("uncertain");
    expect(sends, "H21: polling delivery never duplicates content").toBe(1);
    request.resolve(Response.json({}));
    await vi.waitFor(async () => expect((await (await post(`/pe/feedback/${receipt.feedbackId}/deliver`)).json()).delivery,
      "H21: the same receipt settles delivered").toBe("accepted"));
    expect(await journal.read({ kinds: ["feedback"] }), "H21: one feedback keeps one receipt").toHaveLength(1);
  } finally { request.resolve(Response.json({})); await telemetry.close(); await rm(dir, { recursive: true, force: true }); }
}

import { RecordedSourceChip,RemoteDeviceGate,useLocalDevice } from "../machine/devices";
async function openRecordedGuidanceAfterRefusal() {
  let attempt = 0;
  vi.stubGlobal("fetch", async () => Response.json({ version: "jp", features: { peApi: 1, nativeAdapter: 2 } }, {
    headers: { "x-pe-source": ++attempt === 1 ? "not json" : JSON.stringify({
      kind: "recording", at: null, build: "recorded", catalog: "recorded", coverage: ["native"],
      truncated: { at: 3, stoppedAt: 1, site: "occurrence", op: "ducts.snapshot.walk", reason: "full" },
    }) },
  }));
  function Access() {
    return createElement(Fragment, null, createElement("output", null, `Local authority: ${useLocalDevice()}`), createElement(RecordedSourceChip));
  }
  const view = render(createElement(RemoteDeviceGate, { name: "Pea", guidance: createElement("p", null, "Public guide"), children: createElement(Access) }));
  try {
    await screen.findByRole("alert");
    expect(screen.getByText("Public guide"), "B08: guidance survives refused host provenance").toBeTruthy();
    expect(screen.queryByText(/Local authority/), "B08: refused provenance cannot reveal protected content").toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry host connection" }));
    await screen.findByText("Local authority: false");
    expect(screen.getByText(/Recorded.*read only.*partial/), "B08: canonical recording admission is explicit and read only").toBeTruthy();
    expect(attempt, "B08: recording admission never asks a live device door").toBe(2);
  } finally { view.unmount(); vi.unstubAllGlobals(); }
}
// H29 exercises the surviving sealed-Plan authority through the real HTTP action handler.
test("JZ H29 human-only RPC and forged, foreign and stale review reuse refuse", async () => {
  const { nativeFixture } = await import("../../../host/tests/fans-work-fixture");
  const { pea } = await import("../../../host/tests/callers");
  const f = await nativeFixture();
  try {
    for (const caller of [pea("review-owner"), { kind: "external-mcp" as const, label: "foreign", context: "jz-external" }]) {
      const response = await f.post("/call", { key: "rhvac.launch", request: { path: "review.r10" } }, caller);
      expect(response.status, "H29: RPC refuses non-human binding").toBe(403);
      expect(await response.json()).toMatchObject({ notDispatched: true });
    }
    const staged = await f.saved.apply(f.key, "ducts", "human", [
      { path: ["writeIntent", "edit"], value: { value: { groups: ["group:g1"] } } },
    ], 0);
    expect(staged.ok).toBe(true);
    if (!staged.ok) throw Error("Stage refused");
    const work = { key: f.key, revision: staged.revision };
    const plan = await f.post("/actions", { id: "jz-plan", key: "sheet.plan", target: f.target, input: { work } });
    expect(plan.ok).toBe(true);
    const preview = await f.journal.wait("jz-plan");
    expect(preview.state, JSON.stringify(preview)).toBe("succeeded");
    if (preview.state !== "succeeded") throw Error(JSON.stringify(preview));
    const foreign = await f.post("/actions", { id: "jz-foreign", key: "sheet.apply", target: f.target,
      input: { work } }, { kind: "human", via: "cli", login: "review-thief" });
    expect(foreign.ok).toBe(true);
    const refused = await f.journal.wait("jz-foreign");
    expect(refused.state, "H29: another caller cannot borrow the human Plan").not.toBe("succeeded");
    expect(JSON.stringify(refused)).toContain("preview.caller");
    expect(f.dispatched.filter(row => row.key === "ducts.apply")).toEqual([]);
    const forged = await f.post("/actions", { id: "jz-forged", key: "sheet.apply", target: f.target,
      input: { work, seal: { forged: true }, reviewTicket: "invented" } }, pea("forger"));
    expect(forged.status, "H29: strict admission rejects invented seal and ticket fields").toBe(409);
    const changed = await f.saved.apply(f.key, "ducts", "human", [
      { path: ["writeIntent", "edit"], value: { value: { groups: ["group:g2"] } } },
    ], staged.revision);
    expect(changed.ok).toBe(true);
    const stale = await f.post("/actions", { id: "jz-stale", key: "sheet.apply", target: f.target, input: { work } });
    expect(stale.ok).toBe(true);
    expect((await f.journal.wait("jz-stale")).state, "H29: changed Work withdraws the old review").not.toBe("succeeded");
    expect(f.dispatched.filter(row => row.key === "ducts.apply"), "H29: no refused attempt writes native").toEqual([]);
  } finally { await f.close(); }
}, 60_000);




import { readingKey } from "@pe/agent-contracts";
import { resourceSnapshot } from "@pe/runtime";
import { machineFixture } from "../../../../packages/agent-contracts/tests/machine-fixture";
import { hostResourceObserver } from "../../../host/src/resource-adapters";
import { journalAt } from "../../../host/tests/effect-test";
import { OpenBody } from "../open/mount";
import { module as openRoute } from "../open/route";
const openNavigation = vi.hoisted(() => ({ bypass: false }));
vi.mock("../navigation/state", async original => {
  const real = await original<typeof import("../navigation/state")>();
  return { ...real, useDestination: () => openNavigation.bypass ? () => true : real.useDestination() };
});


test("JZ Open machine census: sampling drift lists documents; content conflict never claims absence", async () => {
  openNavigation.bypass = true;
  let samples = 0, conflict = false;
  const seed = machineFixture([{ session: "running", documents: [{
    openId: "doc", title: "Running model", address: "C:/Models/Running.rvt", isFamilyDocument: false, isActive: true,
  }] }]);
  const machine = { ...seed, revit: { ...seed.revit, sessions: seed.revit.sessions!.map(session => ({
    ...session, documents: [{ sessionId: "sdk-0", openId: "doc", title: "Running model", path: "C:/Models/Running.rvt",
      isModified: false, isActive: true, isFamily: false, window: null, isWorkshared: null, isDetached: null,
      isCloud: null, centralPath: null, region: null, projectGuid: null, modelGuid: null, persistence: null }],
  })) } };
  const machineObserver = hostResourceObserver(undefined, undefined, undefined, undefined, undefined, {
    current: () => machine,
    refresh: async () => machine, fresh: async () => machine, acquisitions: () => [],
    observe(accept) {
      const value = { ...structuredClone(machine), observedAtUtc: new Date(++samples * 1000).toISOString(),
        revit: { ...machine.revit, sessions: conflict && samples % 2 === 0 ? [] : machine.revit.sessions } };
      accept(value);
      return () => {};
    },
  });
  const host = await fixture(false, { resourceObserver: (request, publish, after) => {
    if (request.kind === "machine") return machineObserver(request, publish, after);
    publish(resourceSnapshot(readingKey(request), { value: request.kind === "sdk" ? { result: { recents: [] } } : [] }));
    return () => {};
  } });
  const work = createWorkFeedClient({ subscribe: observeResources(host.workspace, { observe: () => () => {} }), dirty() {} }, {
    write: (key, write) => host.workspace.write(key, key.route, "human", write, async () => []), submit: () => { throw Error("No native actions"); },
  });
  let packet: unknown;
  const read = async (subscription: string) => {
    const response = await host.probe({ read: "open.documents", args: { target: { kind: "host" } }, subscription, generation: 1 });
    expect(response.status).toBe(200);
    return response.json();
  };
  const mounts: ReturnType<typeof mountTypedRoute>[] = [];
  const draw = async () => {
    const mount = mountTypedRoute(openRoute, {
      target: { kind: "host" }, fixture: null, work: { address: null, open: null },
      address: { read: () => new URLSearchParams(), write() {}, subscribe: () => () => {} },
      memory: () => ({}), custody: { current: () => true },
    }, workFingerprintSchema.parse(`builtin-closure:${"a".repeat(64)}`), { work, sources: { "open.documents": {
      kind: "use", open(_ctx, deliver) { deliver({ kind: "complete", revision: 1, value: packet }); return () => {}; },
    } } });
    mounts.push(mount); mount.subscribe(() => {});
    return render(createElement(TooltipProvider, null, mount.draw("documents", (ctx: import("../machine/open-fields").OpenContext) => createElement(OpenBody, { ctx })) as React.ReactNode));
  };
  try {
    packet = await read("stable");
    expect(packet, JSON.stringify(packet)).toMatchObject({ state: "current" });
    let view = await draw();
    expect(screen.getAllByText("Running model").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/sdk-0/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/no Revit is running/i)).toBeNull();
    view.unmount();
    samples = 0; conflict = true;
    packet = await read("conflict");
    expect(packet).toMatchObject({ state: "refresh-needed", value: null, reason: "The machine input changed while this was being read." });
    view = await draw();
    expect(screen.getByText("The machine input changed while this was being read.")).toBeTruthy();
    expect(screen.queryByText(/no Revit is running/i)).toBeNull();
    expect(screen.queryByText(/0 of 0/)).toBeNull();
    view.unmount();
    conflict = false;
    expect(await read("retry")).toMatchObject({ state: "current" });
  } finally { openNavigation.bypass = false; mounts.forEach(mount => mount.dispose()); cleanup(); await host.close(); }
}, 60_000);


test("JZ route-neutral Plan refusal preserves the reason and holds Apply through HTTP", async () => {
  const { nativeFixture } = await import("../../../host/tests/fans-work-fixture");
  const f = await nativeFixture();
  try {
    const reason = "Shared type cannot scope this authored flow";
    f.planRefusal.reason = reason;
    const fans = await f.saved.apply({ ...f.key, route: "fans" }, "fans", "human", [
      { path: ["flows", elementSubject(workSnapshot.nodes.find(node => node.id === 4)!), "edit"], value: { value: 321 } },
      { path: ["calculation", "terminalFlow", "edit"], value: { value: { kind: "balanced-design", source: "test" } } },
    ], 0);
    if (!fans.ok) throw Error(JSON.stringify(fans));
    const staged = await f.saved.apply(f.key, "ducts", "human", [
      { path: ["writeIntent", "edit"], value: { value: { groups: ["group:g1"] } } },
    ], 0);
    if (!staged.ok) throw Error(JSON.stringify(staged));
    const input = { work: { key: f.key, revision: staged.revision } };
    expect((await f.post("/actions", { id: "jz-refusal-plan", key: "sheet.plan", target: f.target, input })).ok).toBe(true);
    const plan = await f.journal.wait("jz-refusal-plan");
    expect(plan.state, JSON.stringify(plan)).toBe("succeeded");
    if (plan.state !== "succeeded") throw Error(JSON.stringify(plan));
    expect(plan.result).toMatchObject({ planRefusal: expect.stringContaining(reason), planRefusalCode: "ducts.plan-refused" });
    expect((await f.post("/actions", { id: "jz-refusal-apply", key: "sheet.apply", target: f.target, input })).ok).toBe(true);
    const apply = await f.journal.wait("jz-refusal-apply");
    expect(apply.state, JSON.stringify(apply)).toBe("failed");
    expect(JSON.stringify(apply)).toContain(reason);
    expect(JSON.stringify(apply)).toContain("ducts.plan-refused");
    expect(f.dispatched.filter(row => row.key === "ducts.apply")).toEqual([]);
  } finally { await f.close(); }
}, 60_000);


test("JZ upload retains BlobRef before command admission and rejects inline intent", async () => {
  const { nativeFixture } = await import("../../../host/tests/fans-work-fixture");
  const { bindWork } = await import("@pe/agent-contracts");
  const f = await nativeFixture();
  try {
    const upload = { fileName: "spec.pdf", base64: Buffer.from("%PDF-jz-immutable").toString("base64") };
    const response = await f.post("/actions/blobs", upload);
    expect(response.status, await response.clone().text()).toBe(200);
    const source = await response.json();
    expect(await (await f.post("/actions/blobs", upload)).json()).toEqual(source);
    expect((await f.post("/actions/blobs", { ...upload, base64: "invalid!" })).status).toBe(400);
    expect((await f.post("/actions/blobs", upload, { kind: "external-mcp", label: "upload", context: "jz" })).status).toBe(403);
    expect(source).toMatchObject({ fileName: "spec.pdf", size: 17, digest: expect.stringMatching(/^[0-9a-f]{64}$/) });
    const key = bindWork("family", null);
    const started = await f.saved.start(key, {}, "human");
    if (!started.ok) throw Error(JSON.stringify(started));
    const input = { member: { pod: "absent", path: "settings/family/F.json" }, work: { key, revision: started.revision }, source };
    expect((await f.post("/actions", { id: "jz-inline", key: "family.attach-spec", target: { kind: "host" }, input: { ...input, source: upload } })).status).toBe(409);
    expect((await f.journal.list(undefined, "jz-inline"))).toEqual([]);
    const admitted = await f.post("/actions", { id: "jz-blob", key: "family.attach-spec", target: { kind: "host" }, input });
    expect(admitted.ok, await admitted.clone().text()).toBe(true);
    const row = await f.journal.wait("jz-blob");
    // The intentionally absent member refuses execution after immutable input admission.
    expect(row.state).toBe("failed");
    expect(row.input.source).toEqual(source);
    expect(JSON.stringify(row)).not.toMatch(/"(?:base64|bytesBase64)"/);
  } finally { await f.close(); }
}, 60_000);


test("JZ cold HTTP action inspection discards old journal rows without conversion", async () => {
  const { nativeFixture } = await import("../../../host/tests/fans-work-fixture");
  const { readFile, writeFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const first = await nativeFixture();
  let bytes: string;
  try {
    const staged = await first.saved.apply(first.key, "ducts", "human", [
      { path: ["writeIntent", "edit"], value: { value: { groups: ["group:g1"] } } },
    ], 0);
    if (!staged.ok) throw Error(JSON.stringify(staged));
    await first.post("/actions", { id: "jz-old-row", key: "sheet.plan", target: first.target, input: { work: { key: first.key, revision: staged.revision } } });
    expect((await first.journal.wait("jz-old-row")).state).toBe("succeeded");
    bytes = (await readFile(join(first.dir, "actions.jsonl"), "utf8")).replace(/^.*?\n/, '{"version":7}\n');
  } finally { await first.close(); }
  const cold = await nativeFixture();
  try {
    await writeFile(join(cold.dir, "actions.jsonl"), bytes, "utf8");
    const response = await cold.request(new Request("http://fixture/actions?id=jz-old-row"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
    expect(cold.dispatched).toEqual([]);
  } finally { await cold.close(); }
}, 60_000);
