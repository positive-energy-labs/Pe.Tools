// @vitest-environment jsdom
import { cp, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { expect, test, vi } from "vite-plus/test";
import { observeResources } from "@pe/runtime";
import { bindWork, routeFingerprint, workKey } from "@pe/agent-contracts";
import { fixture } from "../../../host/tests/host-read-graph.test-support";
import { createPackageLifecycle } from "../../../host/src/package-lifecycle";
import { listPackages } from "../../../host/src/packages";
import { createPodRoutes } from "../../../host/src/pod-routes";
import { fileRouteDocumentStore } from "../../../host/src/route-document-store";
import { registeredReads } from "../../../host/src/reads/routes";
import { loadPodRoute } from "./pod-module";
import { createPodRouteLoader } from "./pod-loader";
import { registerTypedRoute } from "../shell/route-registration";
import { publicRoutes } from "./route-discovery";
import { mountTypedRoute } from "../shell/typed-mount";
import { createWorkFeedClient } from "../shell/work-feed-client";
import type { UseSource } from "../shell/source-contract";

const evaluate = (bytes: Uint8Array) =>
  import(/* @vite-ignore */ `data:text/javascript;base64,${Buffer.from(bytes).toString("base64")}`);

// The published example supplies executable bytes. Only the native boundary is recorded.
async function podJourney() {
  const host = await fixture(true);
  await host.send(0, []); // Initialize the same HTTP/Work owner used by the Fans journeys.
  const root = resolve(host.dir, "Pods");
  const pod = resolve(root, "snowdon-circuits");
  await cp(resolve(process.cwd(), "../../../examples/pods/snowdon-circuits"), pod, {
    recursive: true,
    filter: (source) => !source.split(/[\\/]/).includes("node_modules"),
  });
  const lifecycle = createPackageLifecycle({
    packages: () => listPackages(root), decisionsPath: resolve(host.dir, "enabled.json"),
  });
  const routes = createPodRoutes(lifecycle, {
    workspace: host.workspace, trustPath: resolve(host.dir, "trust.json"),
  });
  const [row] = await routes.list();
  if (!row) throw Error("Published Snowdon is absent");
  // Recorded authored Work, as in pod-admission.test.tsx. Starting Work is not this story.
  const key = bindWork(row.workRoute, null);
  await fileRouteDocumentStore(resolve(host.dir, "work")).setState({
    targetKey: workKey(key), route: key.route,
    value: { version: 1, schemaVersion: 2, revision: 7,
      doc: { version: 2, inputs: { size: "10", length: 175, amps: 20, voltage: 208, phase: "3" } }, history: [] },
  });
  const name = `${row.workRoute}.calculation`;
  const pending = new Set<Promise<unknown>>();
  const mounts: ReturnType<typeof mountTypedRoute>[] = [];
  const listeners = new Set<() => void>();
  let generation = 0;
  const source: UseSource = {
    kind: "use",
    open(ctx, deliver) {
      let closed = false;
      const refresh = () => {
        const task = host.probe({ read: name, args: ctx.args,
          subscription: `jp-${++generation}`, generation,
        }).then(async (response) => {
          const packet = await response.json();
          if (!closed && !ctx.signal.aborted)
            deliver({ kind: "complete", value: packet, revision: generation });
        });
        pending.add(task);
        void task.finally(() => pending.delete(task));
      };
      listeners.add(refresh);
      refresh();
      return () => { closed = true; listeners.delete(refresh); };
    },
  };
  const stopWork = host.workspace.subscribeUncaptured(() => listeners.forEach((notify) => notify()));
  const work = createWorkFeedClient({
    subscribe: observeResources(host.workspace, { observe: () => () => {} }), dirty() {},
  }, {
    write: (key, write) => host.workspace.write(key, key.route, "human", write),
    submit: () => { throw Error("This Pod has no native action"); },
  });
  const loader = createPodRouteLoader(async (entry) => {
    const loaded = await loadPodRoute(entry, await routes.bundle(entry.key, entry.fingerprint), evaluate);
    return registerTypedRoute(loaded.module, loaded.fingerprint);
  });
  return {
    host, pod, lifecycle, routes, row, name, loader,
    async mount() {
      const current = (await routes.list())[0]!;
      const loaded = await loadPodRoute(current, await routes.bundle(current.key, current.fingerprint), evaluate);
      const mount = mountTypedRoute(loaded.module, {
        target: { kind: "host" }, fixture: null,
        work: { address: null, open: null },
        address: { read: () => new URLSearchParams(), write() {}, subscribe: () => () => {} },
        memory: () => ({}), custody: { current: () => true },
      }, loaded.fingerprint, { work, sources: { [name]: source } });
      mounts.push(mount);
      mount.subscribe(() => {});
      await vi.waitFor(() => expect(mount.value()).toMatchObject({ current: true }), { timeout: 20_000 });
      return mount;
    },
    async close() {
      mounts.forEach((mount) => mount.dispose());
      loader.dispose(); stopWork();
      await Promise.allSettled([...pending]);
      routes.close(); await lifecycle.close(); await host.close();
    },
  };
}

test("JP1 discover, trust and use Snowdon, withdraw it, then reopen the trusted worksheet", async () => {
  const j = await podJourney();
  try {
    expect(j.row.trusted, "H16: discovery is not consent to execute").toBe(false);
    await expect(j.routes.bundle(j.row.key, j.row.fingerprint), "H16: untrusted bytes are unavailable").rejects.toThrow("trust");
    await j.loader.sync(await j.routes.list());
    expect(publicRoutes.typed(j.row.workRoute), "H16: discovery does not register browser code").toBeNull();
    expect((await j.host.probe({ read: j.name, args: {}, subscription: "untrusted", generation: 0 })).ok,
      "H16: untrusted Pod has no executable HTTP read").toBe(false);
    await j.routes.trust(j.row.key, j.row.fingerprint, true);
    await j.loader.sync(await j.routes.list());
    const mount = await j.mount();
    expect(publicRoutes.typed(j.row.workRoute), "H16: verified bytes enter discovery").not.toBeNull();
    expect(String(mount.draw("calculation")), "H16: verified host calculation reaches the typed pane over HTTP").toContain("Copper voltage-drop worksheet");
    const inputs = { size: "10", length: 300, amps: 20, voltage: 208, phase: "3" };
    expect(await mount.draw("calculation", (ctx) => ctx.cells.edit(inputs, { label: "Size the feeder" })),
      "H16: admitted Pod edits its own Work").toBeNull();
    await vi.waitFor(() => expect(String(mount.draw("calculation"))).toContain('"length": 300'));
    await j.lifecycle.setEnabled("pod:snowdon-circuits", false);
    await j.loader.sync(await j.routes.list());
    expect(publicRoutes.typed(j.row.workRoute), "H16: withdrawal retires browser registration").toBeNull();
    expect(registeredReads.reads.has(j.name), "H16: withdrawal retires host registration").toBe(false);
    expect((await j.host.probe({ read: j.name, args: {}, subscription: "withdrawn", generation: 0 })).ok,
      "H16: withdrawn host code cannot execute through HTTP").toBe(false);
    await j.lifecycle.setEnabled("pod:snowdon-circuits", true);
    await j.loader.sync(await j.routes.list());
    const reopened = await j.mount();
    expect(String(reopened.draw("calculation")), "H16: unchanged trusted publication reopens durable Work").toContain('"length": 300');
    expect((await j.host.workspace.read(bindWork(j.row.workRoute, null), j.row.workRoute))?.doc).toMatchObject({ inputs });
  } finally { await j.close(); }
}, 60_000);

test("JP2 reject tampered deliveries and replaced Pod bytes until their new publication is trusted", async () => {
  const j = await podJourney();
  try {
    await j.routes.trust(j.row.key, j.row.fingerprint, true);
    const trusted = (await j.routes.list())[0]!;
    const envelope = await j.routes.bundle(trusted.key, trusted.fingerprint);
    await j.loader.sync([trusted]);
    const mount = await j.mount();
    const before = mount.value();
    for (const client of ["web", "host"]) {
      const corrupt = structuredClone(envelope);
      corrupt.artifact.executables.find((entry) => entry.client === client)!.members[0]!.bytes.push(32);
      await expect(loadPodRoute(trusted, corrupt, evaluate), `H16: ${client} bytes are checked before evaluation`).rejects.toThrow("differ");
    }
    const foreign = { ...trusted, workRoute: "pod.foreign.worksheet" };
    await expect(loadPodRoute(foreign, envelope, evaluate), "H16: foreign inventory cannot borrow this publication").rejects.toThrow("identity");
    expect(mount.value(), "H16: refused delivery cannot replace the admitted pane").toEqual(before);
    // A verified browser delivery also contains host bytes. Importing it must not execute them.
    const hostTrap = structuredClone(envelope);
    const hostMember = hostTrap.artifact.executables.find((entry) => entry.client === "host")!.members[0]!;
    hostMember.bytes.push(...new TextEncoder().encode("\nthrow Error('JP host code executed in browser loader');"));
    (hostTrap.artifact.artifact.executables as { client: string; members: { sha256: string }[] }[])
      .find((entry) => entry.client === "host")!.members[0]!.sha256 =
      createHash("sha256").update(Uint8Array.from(hostMember.bytes)).digest("hex");
    hostTrap.artifact.fingerprint = await routeFingerprint(hostTrap.artifact.artifact);
    hostTrap.fingerprint = `pod-bytes:${hostTrap.artifact.fingerprint}`;
    await expect(loadPodRoute({ ...trusted, fingerprint: hostTrap.fingerprint }, hostTrap, evaluate),
      "H16: importing verified browser code does not execute its host entry").resolves.toMatchObject({ fingerprint: hostTrap.fingerprint });
    // Publish a valid new closure, rather than only corrupting a transport envelope.
    const wire = structuredClone(envelope.artifact);
    const member = wire.executables.find((entry) => entry.client === "web")!.members[0]!;
    member.bytes.push(...new TextEncoder().encode("\n// JP replacement publication"));
    (wire.artifact.executables as { client: string; members: { sha256: string }[] }[]).find((entry) => entry.client === "web")!.members[0]!.sha256 =
      createHash("sha256").update(Uint8Array.from(member.bytes)).digest("hex");
    wire.fingerprint = await routeFingerprint(wire.artifact);
    const fingerprint = `pod-bytes:${wire.fingerprint}`;
    const manifestPath = resolve(j.pod, "pod.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.routes[0].fingerprint = fingerprint;
    await writeFile(resolve(j.pod, j.row.artifact), JSON.stringify(wire));
    await writeFile(manifestPath, JSON.stringify(manifest));
    await j.lifecycle.refresh();
    const [replacement] = await j.routes.list();
    expect(replacement?.trusted, "H16: a new digest cannot inherit old trust").toBe(false);
    await j.loader.sync(await j.routes.list());
    expect(publicRoutes.typed(j.row.workRoute), "H16: replacement withdraws the old browser closure").toBeNull();
    expect(registeredReads.reads.has(j.name), "H16: replacement withdraws the old host closure").toBe(false);
    await expect(j.routes.bundle(j.row.key, j.row.fingerprint), "H16: stale fingerprint cannot fetch replacement code").rejects.toThrow();
    await j.routes.trust(j.row.key, fingerprint, true);
    await j.loader.sync(await j.routes.list());
    await vi.waitFor(() => expect(mount.owner(j.row.workRoute)?.ready,
      "H16: the old mounted admission cannot silently adopt replacement authority").toBe(false));
    expect(await mount.draw("calculation", (ctx) => ctx.cells.edit(
      { size: "10", length: 999, amps: 20, voltage: 208, phase: "3" }, { label: "Stale Pod edit" })),
      "H16: an old mounted Pod cannot write replacement Work").toMatchObject({ code: "unavailable" });
    const replaced = await j.mount();
    expect(String(replaced.draw("calculation")), "H16: explicit trust admits the replacement publication").toContain("Copper voltage-drop worksheet");
  } finally { await j.close(); }
}, 60_000);

// Recorded harness events enter the same consumers as the conversation and its context ledger.
import { createElement, Fragment } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { RegistryContext } from "@effect/atom-react";
import * as Atom from "effect/reactivity/Atom";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { emptyChatState, selectBreakdown, type ChatMessage } from "@pe/agent-contracts/chat-state";
import { harnessEventSchema, type RouteGraph, type SettingField } from "@pe/agent-contracts";
import { CurrentThreadViewOwner } from "../workbench/thread-view";
import { TranscriptContext } from "../workbench/provider/thread-summary";
import { useTranscript } from "../workbench/provider/use-workbench";
import { SessionStrip } from "../workbench/world/lane";
import { useCacheView } from "../workbench/world/cap";
import { AssetReel, threadAssets } from "../chat/asset-reel";
import { TooltipProvider } from "@pe/kit/lang/tooltip";
import { z } from "zod";
import { field } from "../../../../packages/agent-contracts/src/route-field";
import { createSettingsOwner } from "../shell/settings";
import { GraphSettingsFields } from "../shell/settings-fields";
import { createRouteSettings } from "../../../host/src/route-settings";
import { createPeRoutes } from "../../../host/src/pe-routes";
import { SettingsBody } from "../machine/body";
import { MACHINE_SEEDS } from "../design-system/open-examples";
import { reportFault, DIAGNOSTICS_MAX_PENDING } from "../host/diagnostics";
import { Pane, PaneFaultProvider } from "@pe/kit/lang/pane";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

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

test("JP4 save rendered settings through delayed HTTP and inspect a pane fault during an outage", async () => {
  const dir = await mkdtemp(resolve(tmpdir(), "jp-settings-"));
  const fields = { word: { ...field(z.string().trim().min(1).default("acknowledged"), {}), role: "setting", label: "Parameter name" } } satisfies Record<string, SettingField>;
  const settings = createRouteSettings(dir, { "jp-settings": fields });
  const routes = createPeRoutes({ registrations: [], heads: { observe: () => () => {} },
    store: { getState: async () => null, setState: async () => {} }, routeSettings: settings });
  const url = "http://host/pe/route-settings/jp-settings";
  let readHold: ReturnType<typeof Promise.withResolvers<void>> | undefined;
  let readEntered: ReturnType<typeof Promise.withResolvers<void>> | undefined;
  let writeHold: ReturnType<typeof Promise.withResolvers<void>> | undefined;
  let failSave = false;
  const owner = createSettingsOwner(fields, {
    async read() { const response = await routes.fetch(new Request(url)); const saved = await response.json(); readEntered?.resolve(); await readHold?.promise; return saved; },
    async write(patch, expectedRevision) {
      if (failSave) throw Error("host unavailable");
      const response = await routes.fetch(new Request(url, { method: "POST", body: JSON.stringify({ patch, expectedRevision }) }));
      const saved = await response.json(); await writeHold?.promise; return saved;
    },
    subscribe: (notify) => settings.subscribe(notify),
  });
  const graph = { key: "jp-settings", name: "Worksheet", fields } as unknown as RouteGraph<any, any>;
  const drawSettings = () => render(createElement(GraphSettingsFields, { graph, owner }));
  let view = drawSettings();
  try {
    await vi.waitFor(() => expect((screen.getByRole("textbox", { name: "Parameter name" }) as HTMLInputElement).disabled).toBe(false));
    const edit = (text: string) => { const input = screen.getByRole("textbox", { name: "Parameter name" }); fireEvent.change(input, { target: { value: text } }); fireEvent.blur(input); };
    edit("");
    await vi.waitFor(() => expect(screen.getByRole("button", { name: "Read settings again" })).toBeTruthy());
    expect(settings.read("jp-settings").revision, "H28: invalid input does not reach saved settings").toBe(0);
    readHold = Promise.withResolvers<void>();
    readEntered = Promise.withResolvers<void>();
    const hydrate = owner.refresh();
    await readEntered.promise;
    writeHold = Promise.withResolvers<void>();
    edit("newer name");
    await vi.waitFor(() => expect(settings.read("jp-settings").revision).toBe(1));
    readHold.resolve(); await hydrate; readHold = undefined;
    expect((screen.getByRole("textbox", { name: "Parameter name" }) as HTMLInputElement).disabled,
      "H28: late hydration cannot unlock a pending save").toBe(true);
    writeHold.resolve(); writeHold = undefined;
    await vi.waitFor(() => expect((screen.getByRole("textbox", { name: "Parameter name" }) as HTMLInputElement).value).toBe("newer name"));
    await vi.waitFor(() => expect(owner.read().values.word, "H28: late hydration cannot replace acknowledged newer settings").toBe("newer name"));
    await owner.refresh();
    readHold = Promise.withResolvers<void>(); readEntered = Promise.withResolvers<void>();
    const late = owner.refresh(); await readEntered.promise;
    edit("newest name");
    await vi.waitFor(() => expect(owner.read().values.word).toBe("newest name"));
    readHold.resolve(); await late; readHold = undefined;
    expect(owner.read().values.word, "H28: a late older HTTP body cannot overwrite a newer acknowledged save").toBe("newest name");
    await owner.refresh(); // Settle the store notification read before testing the next independent outage.
    failSave = true; edit("lost save");
    await vi.waitFor(() => expect(screen.getByText("host unavailable")).toBeTruthy());
    view.unmount(); view = drawSettings();
    expect((screen.getByRole("textbox", { name: "Parameter name" }) as HTMLInputElement).value,
      "H28: reopen after failure retains the last acknowledged value").toBe("newest name");
    view.unmount();
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
    readHold?.resolve(); writeHold?.resolve(); view.unmount(); cleanup();
    vi.useRealTimers(); vi.unstubAllGlobals(); await rm(dir, { recursive: true, force: true });
  }
});

import { createRequire } from "node:module";
import { ActionJournal } from "../../../host/src/action-journal";
import { createReceiptExport } from "../../../host/src/receipt-export";
import { receiptGoldenEnvelope } from "../../../../packages/agent-contracts/tests/receipt-fixture";
import { withInvocationContext } from "@pe/runtime/context";

async function sendFeedbackWhileDeliveryWaits() {
  const dir = await mkdtemp(resolve(tmpdir(), "jp-feedback-"));
  const stamp = receiptGoldenEnvelope.stamp!;
  const journal = new ActionJournal(resolve(dir, "journal.json"), Date.now, () => stamp);
  const request = Promise.withResolvers<Response>();
  let sends = 0;
  // Load the host's actual SDK dependency; the only recorded boundary is its network transport.
  const { PostHog } = createRequire(resolve(process.cwd(), "../host/package.json"))("posthog-node");
  const client = new PostHog("explicit-test-key", {
    disableCompression: true, disableGeoip: true, flushInterval: 0, fetchRetryCount: 0,
    enableExceptionAutocapture: false, requestTimeout: 60000,
    fetch: () => { sends++; return request.promise; },
  });
  const telemetry = createReceiptExport({ journal, root: dir, client, deadlineMs: 50,
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

import { RemoteDeviceGate, RecordedSourceChip, useLocalDevice } from "../machine/devices";
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
  const { nativeFixture } = await import("../../../host/tests/fans-native.fixture");
  const { pea } = await import("../../../host/tests/callers");
  const f = await nativeFixture();
  try {
    for (const caller of [pea("review-owner"), { kind: "external-mcp" as const, label: "foreign", context: "jz-external" }]) {
      const response = await f.post("/call", { key: "rhvac.launch", request: { path: "review.r10" } }, caller);
      expect(response.status, "H29: RPC refuses non-human binding").toBe(403);
      expect(await response.json()).toMatchObject({ notDispatched: true });
    }
    const staged = await f.saved.apply(f.key, "ducts", "human", [
      { path: ["writeIntent", "edit"], value: { value: { groups: ["g1"] } } },
    ], 0);
    expect(staged.ok).toBe(true);
    if (!staged.ok) throw Error("Stage refused");
    const work = { key: f.key, revision: staged.revision };
    const plan = await f.post("/actions", { id: "jz-plan", key: "ducts.plan-losses", target: f.target, input: { work } });
    expect(plan.ok).toBe(true);
    const preview = await f.journal.wait("jz-plan");
    expect(preview.state, JSON.stringify(preview)).toBe("succeeded");
    if (preview.state !== "succeeded") throw Error(JSON.stringify(preview));
    const foreign = await f.post("/actions", { id: "jz-foreign", key: "ducts.apply-losses", target: f.target,
      input: { work } }, { kind: "human", via: "cli", login: "review-thief" });
    expect(foreign.ok).toBe(true);
    const refused = await f.journal.wait("jz-foreign");
    expect(refused.state, "H29: another caller cannot borrow the human Plan").not.toBe("succeeded");
    expect(JSON.stringify(refused)).toContain("preview.caller");
    expect(f.dispatched.filter(row => row.key === "ducts.apply")).toEqual([]);
    const forged = await f.post("/actions", { id: "jz-forged", key: "ducts.apply-losses", target: f.target,
      input: { work, seal: { forged: true }, reviewTicket: "invented" } }, pea("forger"));
    expect(forged.status, "H29: strict admission rejects invented seal and ticket fields").toBe(409);
    const changed = await f.saved.apply(f.key, "ducts", "human", [
      { path: ["writeIntent", "edit"], value: { value: { groups: ["g2"] } } },
    ], staged.revision);
    expect(changed.ok).toBe(true);
    const stale = await f.post("/actions", { id: "jz-stale", key: "ducts.apply-losses", target: f.target, input: { work } });
    expect(stale.ok).toBe(true);
    expect((await f.journal.wait("jz-stale")).state, "H29: changed Work withdraws the old review").not.toBe("succeeded");
    expect(f.dispatched.filter(row => row.key === "ducts.apply"), "H29: no refused attempt writes native").toEqual([]);
  } finally { await f.close(); }
}, 60_000);
