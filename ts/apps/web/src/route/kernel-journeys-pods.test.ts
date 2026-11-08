// @vitest-environment jsdom
import { cp, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { expect, test, vi } from "vite-plus/test";
import { observeResources } from "@pe/runtime";
import { workFingerprintSchema, bindWork, routeFingerprint, workKey } from "@pe/agent-contracts";
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
import { createElement, Fragment, useEffect, useState } from "react";
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


import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from "@tanstack/react-router";
import { createContributionContent } from "../../../host/src/pe-routes";
import { importShippedPods } from "../../../host/src/installed-pods";
import { exportPod, installArchive } from "../../../host/src/pod-transfer";
import { createPluginsHandler } from "../../../host/src/plugins-handler";
import { PictureCaptures } from "../../../host/src/captures-route";
import { Directory } from "../navigation/directory";
import { NavigationProvider } from "../navigation/state";

import { PodRoutesProvider } from "./pod-routes";
import { Route as PodTrustRoute } from "../routes/tool.$key";
import { Members } from "../pods/drawing";

test("JP5 bootstrap replaces only unchanged imports and Home discovers the untrusted publication without reload", async () => {
  for (const modified of [false, true]) {
    const host = await fixture(true);
    const root = resolve(host.dir, "Pods"), shipped = resolve(host.dir, "shipped");
    const captures = new PictureCaptures(resolve(host.dir, "pictures"), 64 * 1024 * 1024, Date.now);
    const source = resolve(host.dir, "old", "snowdon-circuits");
    const examples = resolve(process.cwd(), "../../../examples/pods");
    const gate = Promise.withResolvers<void>();
    const completed = Promise.withResolvers<Awaited<ReturnType<typeof importShippedPods>>>();
    let content: ReturnType<typeof createContributionContent> | undefined;
    let routes: ReturnType<typeof createPodRoutes> | undefined;
    let view: ReturnType<typeof render> | undefined;
    try {
      await cp(resolve(examples, "snowdon-circuits"), source, {
        recursive: true, filter: path => !path.split(/[\\/]/).includes("node_modules"),
      });
      const manifest = JSON.parse(await readFile(resolve(source, "pod.json"), "utf8"));
      const current = manifest.routes[0];
      manifest.routes = [{ sourcePath: "routes/voltage-drop/index.js", name: current.name, description: current.description }];
      await writeFile(resolve(source, "pod.json"), JSON.stringify(manifest));
      await writeFile(resolve(source, "routes/voltage-drop/index.js"), "throw Error('Obsolete Pod must never execute');");
      const old = await exportPod({ pod: manifest.id, archivePath: resolve(host.dir, "old.zip") },
        { podsRoot: resolve(host.dir, "old"), captures });
      await installArchive(await readFile(old.archivePath), old.archivePath, undefined, { podsRoot: root, captures });
      await exportPod({ pod: manifest.id, archivePath: resolve(shipped, "snowdon-circuits.zip") }, { podsRoot: examples, captures });
      const pod = resolve(root, manifest.id), key = `route:@${manifest.id}/${current.artifact}`;
      const oldTrust = `pod-bytes:${old.archiveSha256}`;
      const trustPath = resolve(host.dir, "trust.json");
      await writeFile(trustPath, JSON.stringify({ [key]: oldTrust }));
      if (modified) await writeFile(resolve(pod, "README.md"), "Keep this authored worksheet note.");
      const before = (await listPackages(root)).packages.find(p => p.id === manifest.id)!.members.map(m => [m.path, m.sha256]);
      content = createContributionContent({ worldRoot: host.dir, packages: () => listPackages(root),
        decisionsPath: resolve(host.dir, "enabled.json"), bootstrapInBackground: true,
        bootstrap: async () => {
          await gate.promise;
          try {
            const report = await importShippedPods({ shippedRoot: shipped, podsRoot: root, captures,
              ledger: resolve(host.dir, "state/shipped-pods.json") });
            completed.resolve(report);
          } catch (error) { completed.reject(error); throw error; }
        },
      });
      routes = createPodRoutes(content.lifecycle, { trustPath });
      const handler = createPluginsHandler(content, routes);
      let inventoryReads = 0, homeMounts = 0;
      vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(new URL(input instanceof Request ? input.url : String(input), "http://host"), init);
        if (new URL(request.url).pathname === "/pe/plugin-routes") {
          const response = await handler(request); inventoryReads++; return response;
        }
        if (new URL(request.url).pathname === "/pe/navigation")
          return Response.json({ observedAt: new Date().toISOString(), works: [], observations: [], truncated: false });
        throw Error(`Unexpected JP5 request ${request.url}`);
      });
      function Home() {
        const [page, setPage] = useState<Parameters<typeof Directory>[0]["page"][0]>({ query: "snowdon", exposure: "All", sort: "workflow", folded: [] });
        useEffect(() => { homeMounts++; }, []);
        return createElement(Directory, { page: [page, patch => setPage(prior => ({ ...prior, ...patch }))] });
      }
      const top = createRootRoute({ component: () => createElement(NavigationProvider, null,
        createElement(PodRoutesProvider, null, createElement(Outlet))) });
      // File-route mount metadata is normally supplied by the generated route tree.
      const trustMount = { id: "/tool/$key", path: "/tool/$key", getParentRoute: () => top, component: PodTrustRoute.options.component };
      const trust = PodTrustRoute.update(trustMount);
      const router = createRouter({ routeTree: top.addChildren([
        createRoute({ getParentRoute: () => top, path: "/", component: Home }), trust,
      ]), history: createMemoryHistory({ initialEntries: ["/"] }) });
      vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
      await router.load();
      view = render(createElement(RouterProvider, { router }));
      await vi.waitFor(() => expect(inventoryReads).toBe(1));
      expect(screen.queryByText(current.name), "H16: obsolete declarations cannot become executable Home rows").toBeNull();
      await act(async () => { gate.resolve(); await completed.promise; });
      const report = await completed.promise;
      if (!modified && report.outcomes[0]?.outcome === "updated")
        await vi.waitFor(async () => expect((await routes!.list()).find(row => row.packageId === manifest.id)).toMatchObject({ fingerprint: current.fingerprint }));
      // Import completion precedes the owner's asynchronous lifecycle reconciliation.
      // The provider's real interval re-reads; neither router nor Home is reloaded or remounted.
      await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
      await vi.waitFor(() => expect(inventoryReads).toBeGreaterThan(1));
      expect(homeMounts, "H16: completion discovers content in the already mounted Home").toBe(1);
      if (!modified) {
        expect.soft(report.outcomes[0]?.outcome, "H16: unchanged imported example updates at bootstrap").toBe("updated");
        const row = (await routes.list()).find(row => row.packageId === manifest.id);
        expect.soft(row, "H16: replacement publication is discoverable but has no inherited trust").toMatchObject({ trusted: false, fingerprint: current.fingerprint });
        expect.soft(current.fingerprint).not.toBe(oldTrust);
        const title = screen.queryByText(current.name);
        expect.soft(title, "H16: Home gains the published tool without reload").not.toBeNull();
        if (title) {
          const item = title.closest('[role="treeitem"]')!;
          expect(within(item as HTMLElement).getByText("Trust required")).toBeTruthy();
          fireEvent.click(item);
          await screen.findByRole("button", { name: `Trust ${current.name} at this fingerprint` });
          expect(router.state.location.pathname, "H16: Home opens the actual trust page").toBe(`/tool/${encodeURIComponent(key)}`);
          expect(screen.getByText("Trust this fingerprint")).toBeTruthy();
        }
      } else {
        const kept = (await listPackages(root)).packages.find(p => p.id === manifest.id)!;
        expect(kept.members.map(m => [m.path, m.sha256]), "H16: modified authored members stay byte-identical").toEqual(before);
        expect.soft(kept.diagnostics.find(d => d.code === "ShippedExampleUpdateKept"), "H16: retained stale example has a named refusal").toMatchObject({ message: expect.stringContaining("authored members differ") });
        view.unmount(); cleanup();
        view = render(createElement(Members, { ctx: {
          page: { read: () => ({ pod: manifest.id }), query() {} },
          value: { current: true, value: { pods: [kept] } },
        } as unknown as Parameters<typeof Members>[0]["ctx"] }));
        const refusal = screen.getAllByRole("alert").map(node => node.textContent).join(" ");
        expect.soft(refusal, "H16: the actual Pods pane names the preserved example and reason").toContain("Example update kept Snowdon Circuits: its authored members differ");
        expect.soft(refusal, "H16: product refusal text never exposes validator internals").not.toMatch(/invalid_type|unrecognized_keys|expected string|received undefined/);
      }
    } finally {
      gate.resolve(); view?.unmount(); cleanup();
      vi.useRealTimers(); vi.unstubAllGlobals();
      routes?.close(); await content?.close();
      await host.close();
    }
  }
}, 60_000);


import { machineFixture } from "../../../../packages/agent-contracts/tests/machine-fixture";
import { hostResourceObserver } from "../../../host/src/resource-adapters";
import { resourceSnapshot } from "@pe/runtime";
import { readingKey } from "@pe/agent-contracts";
import { module as openRoute } from "../open/route";
import { OpenBody } from "../open/mount";
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
    write: (key, write) => host.workspace.write(key, key.route, "human", write), submit: () => { throw Error("No native actions"); },
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
    return render(createElement(TooltipProvider, null, mount.draw("documents", ctx => createElement(OpenBody, { ctx })) as React.ReactNode));
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
    expect(packet).toMatchObject({ state: "refresh-needed", value: null, reason: expect.stringMatching(/machine.*changed during evaluation/) });
    view = await draw();
    expect(screen.getByText(/machine.*changed during evaluation/)).toBeTruthy();
    expect(screen.queryByText(/no Revit is running/i)).toBeNull();
    expect(screen.queryByText(/0 of 0/)).toBeNull();
    view.unmount();
    conflict = false;
    expect(await read("retry")).toMatchObject({ state: "current" });
  } finally { openNavigation.bypass = false; mounts.forEach(mount => mount.dispose()); cleanup(); await host.close(); }
}, 60_000);


test("JZ route-neutral Plan refusal preserves the reason and holds Apply through HTTP", async () => {
  const { nativeFixture } = await import("../../../host/tests/fans-native.fixture");
  const f = await nativeFixture();
  try {
    const reason = "Shared type cannot scope this authored flow";
    f.planRefusal.reason = reason;
    const fans = await f.saved.apply({ ...f.key, route: "fans" }, "fans", "human", [
      { path: ["flows", "4", "edit"], value: { value: { cfm: 321 } } },
      { path: ["parameters", "terminalFlow", "edit"], value: { value: "PE_M_Grd_AirFlow" } },
    ], 0);
    if (!fans.ok) throw Error(JSON.stringify(fans));
    const staged = await f.saved.apply(f.key, "ducts", "human", [
      { path: ["writeIntent", "edit"], value: { value: { groups: ["g1"] } } },
    ], 0);
    if (!staged.ok) throw Error(JSON.stringify(staged));
    const input = { work: { key: f.key, revision: staged.revision } };
    expect((await f.post("/actions", { id: "jz-refusal-plan", key: "ducts.plan-losses", target: f.target, input })).ok).toBe(true);
    const plan = await f.journal.wait("jz-refusal-plan");
    expect(plan.state, JSON.stringify(plan)).toBe("succeeded");
    if (plan.state !== "succeeded") throw Error(JSON.stringify(plan));
    expect(plan.result).toMatchObject({ planRefusal: expect.stringContaining(reason), planRefusalCode: "ducts.plan-refused" });
    expect((await f.post("/actions", { id: "jz-refusal-apply", key: "ducts.apply-losses", target: f.target, input })).ok).toBe(true);
    const apply = await f.journal.wait("jz-refusal-apply");
    expect(apply.state, JSON.stringify(apply)).toBe("failed");
    expect(JSON.stringify(apply)).toContain(reason);
    expect(JSON.stringify(apply)).toContain("ducts.plan-refused");
    expect(f.dispatched.filter(row => row.key === "ducts.apply")).toEqual([]);
  } finally { await f.close(); }
}, 60_000);


test("JZ upload retains BlobRef before command admission and rejects inline intent", async () => {
  const { nativeFixture } = await import("../../../host/tests/fans-native.fixture");
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
  const { nativeFixture } = await import("../../../host/tests/fans-native.fixture");
  const { readFile, writeFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const first = await nativeFixture();
  let bytes: string;
  try {
    const staged = await first.saved.apply(first.key, "ducts", "human", [
      { path: ["writeIntent", "edit"], value: { value: { groups: ["g1"] } } },
    ], 0);
    if (!staged.ok) throw Error(JSON.stringify(staged));
    await first.post("/actions", { id: "jz-old-row", key: "ducts.plan-losses", target: first.target, input: { work: { key: first.key, revision: staged.revision } } });
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
