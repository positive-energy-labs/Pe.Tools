// @vitest-environment jsdom
import { useState, useSyncExternalStore } from "react";
import { journey as takeoffJourney, Drawing as TakeoffDrawing } from "../takeoff/adoption.test.fixture";
import { adoptionData } from "@pe/agent-contracts/takeoff-read";
import { createPortal } from "react-dom";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { route, type TypedRoute } from "./typed-route";
import { module as fans } from "../fans/route";
import { module as ducts } from "../ducts/route";
import { TypedChrome, TypedShell } from "../shell/typed-shell";
import * as mounts from "../shell/typed-mount";
import { familiesRouteState, address, workFingerprintSchema, type WorkJournalDoor } from "@pe/agent-contracts";
import { ReviewSurface } from "../shell/review-surface";
import { RouteVisibility } from "./activity";
import { setup as scheduleHost, cellsApplied } from "../../../host/tests/schedule-test-fixture";
import { module as schedules } from "../schedules/route";
import { namesOf } from "./typed-route";
import { createWorkFeedClient } from "../shell/work-feed-client";
import type { UseSource } from "../shell/source-contract";
import { KeyScopeHost } from "@pe/kit/keys";
import { module as families } from "../families/route";
import { familyDraftRouteState } from "@pe/agent-contracts";
import { module as family } from "../family/route";
import { detailResponse } from "../../../host/tests/schedule-fixture";
import { createPeClient } from "@pe/agent-contracts/pe-api";
import { contextFetch } from "@pe/runtime/context";
import { routeInput } from "./host";
import userEvent from "@testing-library/user-event";
import { createServer } from "node:http";
import { HistoryRail } from "../shell/history-rail";
import { historySnapshotSchema } from "../shell/history";
import * as historyLinks from "../shell/history";
import { ref, path } from "../../../host/tests/host-read-graph.test-support";
import { publicationSource } from "../host/publication-source";
import { builtinRouteStamp } from "./builtin-inventory";

test("JZ Families History offers published values and marks ambiguous publications Unavailable", async () => {
  const browserHref = window.location.href;
  window.history.replaceState({}, "", "/families");
  const j = await takeoffJourney({ route: "families" });
  const fetchHttp = globalThis.fetch;
  const server = createServer(async (req, res) => {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const response = await j.host.request(new Request(`http://host${req.url}`, {
        method: req.method, headers: req.headers as Record<string, string>,
        ...(chunks.length ? { body: Buffer.concat(chunks) } : {}),
      }));
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (error) { res.writeHead(500); res.end(String(error)); }
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const request = (url: string, init?: RequestInit) => fetchHttp(new URL(url, base), init);
  vi.stubGlobal("fetch", request);
  const pose = { instance: "families:history-journey", route: "families", page: {}, href: "/families" };
  const publish = async (subscription: string) => {
    const response = await request("/pe/reads/value", { method: "POST", headers: {
      "content-type": "application/json", "x-pe-history-page": encodeURIComponent(JSON.stringify(pose)),
    }, body: JSON.stringify({ read: "families.view", args: { target: ref, readId: "" }, subscription, generation: 1 }) });
    expect(response.status, await response.clone().text()).toBe(200);
    return response.json();
  };
  const mountsToClose: mounts.TypedMount[] = [];
  const streams = new Set<{ close(): void }>();
  // Browser EventSource over the real host SSE handler; no fixture chooses invalidations.
  class Stream {
    onmessage?: (event: { data: string }) => void;
    onerror?: () => void;
    private reader?: ReadableStreamDefaultReader<Uint8Array>;
    private closed = false;
    constructor(url: string) {
      streams.add(this);
      void (async () => {
        const response = await j.host.request(new Request(new URL(url, "http://host")));
        this.reader = response.body!.getReader();
        if (this.closed) return void this.reader.cancel();
        let buffer = "";
        const decoder = new TextDecoder();
        while (!this.closed) {
          const frame = await this.reader.read(); if (frame.done) break;
          buffer += decoder.decode(frame.value, { stream: true });
          let end: number;
          while ((end = buffer.indexOf("\n\n")) >= 0) {
            const frame = buffer.slice(0, end); buffer = buffer.slice(end + 2);
            for (const line of frame.split("\n")) if (line.startsWith("data: ")) this.onmessage?.({ data: line.slice(6) });
          }
        }
      })().catch(() => { if (!this.closed) this.onerror?.(); });
    }
    addEventListener() {}
    removeEventListener() {}
    close() { this.closed = true; void this.reader?.cancel(); streams.delete(this); }
  }
  vi.stubGlobal("EventSource", Stream);
  const workListeners = new Set<(state: any) => void>();
  const refreshWork = async () => {
    const response = await createPeClient(base, request).response("work.get", { params: { route: "families" }, query: { target: path } });
    expect(response.status, await response.clone().text()).toBe(200);
    const state = await response.json();
    for (const deliver of workListeners) deliver({ kind: "ready", snapshot: { handle: state.handle, revision: state.revision, value: state.doc },
      history: { acks: [], from: state.revision + 1 } });
  };
  const writeScope = async () => {
    const state = await j.host.workspace.viewUncaptured(j.key, "families");
    const doc = familiesRouteState.schema.parse(state!.doc);
    const categoryNames = doc.scope.edit?.value.categoryNames.length ? [] : ["Air Terminal Tags"];
    const response = await createPeClient(base, request).response("work.apply", { params: { route: "families" }, query: { target: path }, body: {
      kind: "apply", press: crypto.randomUUID(), expectedRevision: state!.revision,
      patches: [{ path: ["scope", "edit"], value: { value: { categoryNames, familyNames: [], placementScope: "AllLoaded" } } }],
    } });
    const result = await response.json();
    expect(result, JSON.stringify(result)).toMatchObject({ ok: true });
    await refreshWork();
    return categoryNames;
  };
  try {
    await j.ready();
    const address = { read: () => new URLSearchParams(), write() {}, subscribe: () => () => {} };
    const lifecyclePose = { ...pose, instance: "families:hide-show" };
    const requests: { subscription: string; generation: number; release: boolean }[] = [];
    const source = publicationSource({ async read(ctx, publication, release) {
      const response = await request("/pe/reads/value", { method: "POST", headers: {
        "content-type": "application/json", "x-pe-history-page": encodeURIComponent(JSON.stringify(ctx.historyPose)),
      }, body: JSON.stringify({ read: "families.view", args: { target: ref, ...(ctx.args as object) }, ...publication, release }) });
      expect(response.status, await response.clone().text()).toBe(200);
      requests.push({ ...publication, release });
      return response.json();
    } });
    const feed = createWorkFeedClient({ subscribe: () => () => {}, dirty() {} }, {
      write: (key, write) => j.host.workspace.write(key, key.route, "human", write),
      submit() { throw Error("This lifecycle journey writes through HTTP"); },
    });
    // Work observations come from HTTP inspection; publication invalidations use host SSE above.
    const work: WorkJournalDoor = { ...feed, open: () => ({ subscribe(deliver) {
      workListeners.add(deliver); void refreshWork();
      return () => { workListeners.delete(deliver); };
    } }) };
    const live = mounts.mountTypedRoute(families, { address, fixture: null, publicationInstance: lifecyclePose.instance,
      target: { kind: "document", ref }, work: { address: path, open: ref }, custody: { current: () => true }, memory: () => ({}),
    }, workFingerprintSchema.parse(`builtin-closure:${builtinRouteStamp("families")}`), { work, sources: { "families.view": source } });
    mountsToClose.push(live);
    const firstStop = live.subscribe(() => {});
    await waitFor(() => expect(live.value().current).toBe(true));
    const earlier = await j.host.history("", { kind: "captured", document: path });
    const originalBinding = earlier.history.publications.find((b: any) => b.instance === lifecyclePose.instance);
    await waitFor(() => expect(streams.size).toBeGreaterThan(0));
    firstStop(); live.release();
    await waitFor(() => expect(requests.filter(r => r.release)).toHaveLength(1));
    live.subscribe(() => {});
    await waitFor(() => expect(live.value().current).toBe(true));
    await waitFor(() => expect(new Set(requests.filter(r => !r.release).map(r => r.subscription)).size).toBe(2));
    await writeScope();
    // A point records what the host has published, including a Value awaiting refresh after a write.
    // No Revit: the write receipt boundary asks History to snapshot the open subscriptions.
    j.host.reads.history!.afterWrite(ref, "lifecycle-write");
    const afterShow = await j.host.history(`?document=${encodeURIComponent(path)}`);
    const reopened = afterShow.points.find((p: any) => p.reason.receipt === "lifecycle-write");
    const bindings = reopened.history.publications.filter((b: any) => b.instance === lifecyclePose.instance);
    expect(bindings, "hide/show must retire the first subscription before a later point").toHaveLength(1);
    expect(bindings[0].subscription).not.toBe(originalBinding.subscription);
    expect(afterShow.unavailable.some((item: any) => item.point === reopened.id && item.instance === lifecyclePose.instance)).toBe(false);
    const old = await j.host.history(`?at=${earlier.id}`);
    expect(old.point.history.publications.find((b: any) => b.instance === lifecyclePose.instance)).toEqual(originalBinding);
    live.release();
    await waitFor(() => expect(requests.filter(r => r.release)).toHaveLength(2));
    const first = await publish("first");
    const good = await j.host.history("", { kind: "captured", document: path });
    await writeScope();
    const second = await publish("second");
    expect(second.version).not.toBe(first.version);
    // No Revit: inject the native completion notification at the host's receipt boundary.
    j.host.reads.history!.afterWrite(ref, "history-journey-write");
    const listed = await j.host.history(`?document=${encodeURIComponent(path)}`);
    const bad = listed.points.find((point: any) => point.reason.receipt === "history-journey-write");
    expect(bad).toBeTruthy();
    expect(bad.history.publications.filter((binding: any) => binding.instance === pose.instance)).toHaveLength(2);
    render(<HistoryRail document={path} route="families" address={address} compare={false} />);
    fireEvent.click(await screen.findByRole("button", { name: "Open History" }));
    const rows = await screen.findAllByRole("option");
    const badRow = rows.find(row => row.getAttribute("data-key") === `${bad.id}:${pose.instance}`)!;
    expect(badRow.textContent).toContain("Unavailable: Ambiguous pane at this point");
    fireEvent.click(badRow);
    expect(await screen.findByRole("status")).toHaveProperty("textContent", "Ambiguous pane at this point");
    // jsdom cannot leave the document. Intercept only navigation, retaining the actual point URL.
    const pointHref = historyLinks.pointHref;
    let picked = "";
    vi.spyOn(historyLinks, "pointHref").mockImplementation((point, instance) => {
      picked = pointHref(point, instance); return "#history-picked";
    });
    // Every enabled menu entry is opened through the host's HTTP replay door and typed mount.
    const available = listed.points.flatMap((point: any) => point.history.poses
      .filter((pose: any) => pose.route === "families" && !listed.unavailable.some((item: any) => item.point === point.id && item.instance === pose.instance))
      .map((pose: any) => ({ point, pose })));
    expect(available.map(({ point }: any) => point.id)).toContain(good.id);
    for (const { point, pose: recordedPose } of available) {
      cleanup();
      render(<HistoryRail document={path} route="families" address={address} compare={false} />);
      fireEvent.click(await screen.findByRole("button", { name: "Open History" }));
      const options = await screen.findAllByRole("option");
      picked = "";
      const option = options.find(option => option.getAttribute("data-key") === `${point.id}:${recordedPose.instance}`)!;
      expect(option.textContent).not.toContain("Unavailable");
      fireEvent.click(option);
      await waitFor(() => expect(new URL(picked, base).searchParams.get("atInstance")).toBe(recordedPose.instance));
      cleanup();
      const opened = await request(`/pe/history?at=${new URL(picked, base).searchParams.get("at")}`);
      const history = historySnapshotSchema.parse(await opened.json());
      const source: UseSource = { kind: "use", open(ctx, deliver) {
        void request("/pe/reads/value", { method: "POST", headers: {
          "content-type": "application/json", "x-pe-history-point": history.point.id,
          "x-pe-history-page": encodeURIComponent(JSON.stringify(recordedPose)),
        }, body: JSON.stringify({ read: "families.view", args: { target: ref, ...(ctx.args as object) }, subscription: "replay", generation: 1 }) })
          .then(async response => { expect(response.status, await response.clone().text()).toBe(200);
            deliver({ kind: "complete", value: await response.json(), revision: 1 }); });
        return () => {};
      } };
      const mounted = mounts.mountTypedRoute(families, { address, fixture: null, history,
        publicationInstance: recordedPose.instance, readOnly: true, target: { kind: "document", ref },
        work: { address: path, open: ref }, custody: { current: () => true }, memory: () => recordedPose.page,
      }, workFingerprintSchema.parse(`builtin-closure:${"a".repeat(64)}`), { sources: { "families.view": source } });
      mountsToClose.push(mounted);
      function Recorded() {
        useSyncExternalStore(mounted.subscribe, mounted.revision, mounted.revision);
        return <TypedChrome mount={mounted} document={<span>Recorded Families</span>} />;
      }
      const router = createRouter({ routeTree: createRootRoute({ component: Recorded }), history: createMemoryHistory({ initialEntries: [picked] }) });
      render(<RouterProvider router={router} />);
      expect(await screen.findByRole("button", { name: "Choose Air Terminal Tags" })).toBeTruthy();
      const binding = point.history.publications.find((b: any) => b.instance === recordedPose.instance && b.read === "families.view");
      expect(mounted.value().publication!.evaluation).toBe(binding.evaluation);
      if (recordedPose.instance === pose.instance) expect(mounted.value().value).toEqual(first.value.data);
    }
  } finally {
    cleanup();
    for (const mounted of mountsToClose) mounted.dispose();
    for (const stream of streams) stream.close();
    vi.unstubAllGlobals();
    window.history.replaceState({}, "", browserHref);
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await j.close();
  }
}, 60000);

test("JZ numeric cells refuse bounds and fractional integers without changing Work, then commit exactly", async () => {
  const { InputsBody } = await import("../ducts/sheet/mount");
  const { TakeoffEditCell } = await import("../takeoff/proposals");
  const { NumberCell } = await import("@pe/kit/table/cells");
  const f = await createWitness(closes);
  await waitFor(() => expect(f.typed.value().current).toBe(true));
  await waitFor(() => expect(f.typed.work()).not.toBeNull());
  function Journey() {
    useSyncExternalStore(f.typed.subscribe, f.typed.revision, f.typed.revision);
    const [people, setPeople] = useState(3);
    const [bounded, setBounded] = useState(1);
    return <>
      {f.typed.draw("sheet-inputs", ctx => <InputsBody ctx={ctx as never} />) as import("react").ReactNode}
      <section aria-label="Takeoff occupants">
        <TakeoffEditCell roomId="numeric-entry-room" field="people" value={people} digits={0} integer
          cell={undefined} wire={{ segment: "edits", revision: null, write: async () => { throw Error("No transition requested"); } }}
          onPatch={setPeople} />
        <output aria-label="Committed occupants">{people}</output>
      </section>
      <section aria-label="Bounded number">
        <NumberCell value={bounded} max={10} onCommit={setBounded} />
        <output aria-label="Committed bounded value">{bounded}</output>
      </section>
    </>;
  }
  const router = createRouter({ routeTree: createRootRoute({ component: Journey }), history: createMemoryHistory({ initialEntries: ["/fans"] }) });
  const user = userEvent.setup();
  render(<RouterProvider router={router} />);
  const friction = await screen.findByRole("textbox", { name: "Design friction" });
  const before = structuredClone(f.saved.get("fans"));
  const revision = f.typed.work()!.revision;
  await user.click(friction);
  await user.keyboard("{Control>}a{/Control}-0.1{Enter}");
  await waitFor(() => expect(friction.closest(".dl-cell")?.getAttribute("aria-busy")).not.toBe("true"));
  expect.soft(f.saved.get("fans")).toEqual(before);
  expect.soft(f.typed.work()!.revision).toBe(revision);
  expect.soft(friction.closest("[data-sheet-cell]")?.textContent).toContain("at least 0");
  await user.click(screen.getByRole("textbox", { name: "Design friction" }));
  await user.keyboard("{Control>}a{/Control}0.123456789{Enter}");
  await waitFor(() => expect(f.typed.owner()?.doc.designFriction?.edit).toBeDefined());
  expect.soft(f.typed.owner()?.doc.designFriction?.edit?.value).toBe(0.123456789);
  expect.soft((f.saved.get("fans") as { doc: { designFriction?: { edit?: { value: number } } } }).doc.designFriction?.edit?.value).toBe(0.123456789);
  const occupants = within(screen.getByRole("region", { name: "Takeoff occupants" }));
  await user.click(occupants.getByRole("textbox"));
  await user.keyboard("{Control>}a{/Control}2.7{Enter}");
  expect.soft(occupants.getByLabelText("Committed occupants").textContent).toBe("3");
  expect.soft(occupants.queryByText(/whole number/)).not.toBeNull();
  await user.click(occupants.getByRole("textbox"));
  await user.keyboard("{Control>}a{/Control}7{Enter}");
  expect.soft(occupants.getByLabelText("Committed occupants").textContent).toBe("7");
  const bounded = within(screen.getByRole("region", { name: "Bounded number" }));
  await user.click(bounded.getByRole("textbox"));
  await user.keyboard("{Control>}a{/Control}11{Enter}");
  expect.soft(bounded.getByLabelText("Committed bounded value").textContent).toBe("1");
  expect.soft(bounded.queryByText(/at most 10/)).not.toBeNull();
  await user.click(bounded.getByRole("textbox"));
  await user.keyboard("{Control>}a{/Control}0.987654321{Enter}");
  expect.soft(bounded.getByLabelText("Committed bounded value").textContent).toBe("0.987654321");
});

test("JZ DuctLoss numeric drafts refuse negatives without changing the URL and recover by keyboard", async () => {
  const { module: ductLoss } = await import("../duct-loss/route");
  const { InputsBody } = await import("../duct-loss/route.tsx");
  const { solve } = await import("@pe/ducts-domain/duct-loss-math");
  let search = new URLSearchParams({ cfm: "0", length: "100" });
  const mount = mounts.mountTypedRoute(ductLoss, {
    address: { read: () => new URLSearchParams(search), write: next => { search = new URLSearchParams(next); }, subscribe: () => () => {} },
    fixture: null, target: { kind: "host" }, work: { address: null, open: null },
    custody: { current: () => true }, memory: () => ({}),
  }, workFingerprintSchema.parse(`builtin-closure:${"a".repeat(64)}`), {
    work: createWorkFeedClient({ subscribe: () => () => {}, dirty() {} }, {
      write: async () => { throw Error("Calculator must not write Work"); },
      submit: async () => { throw Error("Calculator must not run native commands"); },
    }),
    // Only the host reading is a fixture; the page, address codec and input events are production.
    sources: { "duct-loss.result": { kind: "use", open(_ctx, deliver) {
      deliver({ kind: "complete", value: { key: "numeric-entry", generation: 1, version: 1, state: "current", value: { data: { result: solve({ shape: "round", a: 12, b: 8, cfm: 0, length: 100, roughness: 0.0003, density: 0.075 }), error: null }, evaluation: "numeric-entry", inputs: "numeric-entry", coverage: { requested: [], covered: [], unknown: [], refused: [] }, origin: { kind: "fixture" }, trace: [], freshness: "current" } }, revision: 1 }); return () => {};
    } } },
  });
  function Journey() {
    useSyncExternalStore(mount.subscribe, mount.revision, mount.revision);
    return mount.draw("inputs", ctx => <InputsBody ctx={ctx as never} />) as import("react").ReactNode;
  }
  const user = userEvent.setup();
  try {
    render(<Journey />);
    const airflow = screen.getByLabelText(/airflow/) as HTMLInputElement;
    for (const [input, key, prior] of [[airflow, "cfm", "0"], [screen.getByLabelText(/length/), "length", "100"]] as const) {
      await user.click(input);
      await user.keyboard("{Control>}a{/Control}-");
      expect.soft((input as HTMLInputElement).value).toBe("-");
      expect.soft(search.get(key)).toBe(prior);
      await user.keyboard("1{Enter}");
      expect.soft(search.get(key)).toBe(prior);
      expect.soft(screen.queryByRole("alert")?.textContent).toContain("at least 0");
      expect.soft((input as HTMLInputElement).value).toBe("-1");
      expect.soft(input.getAttribute("aria-invalid")).toBe("true");
      await user.keyboard("{Control>}a{/Control}-{Backspace}5{Enter}");
      expect.soft((input as HTMLInputElement).value).toBe("5");
      expect.soft(search.get(key)).toBe("5");
    }
    await user.click(airflow);
    await user.keyboard("{Control>}a{/Control}01");
    expect(airflow.value).toBe("01");
    await user.tab();
    expect(airflow.value).toBe("1");
    expect(search.get("cfm")).toBe("1");
    for (const draft of ["", ".", "1."]) {
      await user.click(airflow);
      await user.keyboard("{Control>}a{/Control}{Backspace}");
      if (draft) await user.keyboard(draft);
      expect(airflow.value).toBe(draft);
      expect(search.get("cfm")).toBe("1");
      await user.keyboard("{Enter}");
      if (draft !== "1.") expect(screen.getByRole("alert").textContent).toContain("Enter a number");
    }
    await user.click(airflow);
    await user.keyboard("{Control>}a{/Control}0{Enter}");
    expect(search.get("cfm")).toBe("0");
    const diameter = screen.getByLabelText(/^diameter/, { selector: "input" }) as HTMLInputElement;
    await user.click(diameter);
    await user.keyboard("{Control>}a{/Control}0{Enter}");
    expect(screen.getByRole("alert").textContent).toContain("greater than 0");
    expect(mount.page.read().a).toBe(12);
  } finally { cleanup(); mount.dispose(); }
});

test.each(["review identity", "insertText", "pointer keyboard", "navigation keyboard", "pointer shifted text", "navigation shifted text", "navigation composition", "navigation paste", "range shifted text"] as const)("JZ Schedules Description Enter stages r3, reviews BEFORE to AFTER, and shows a refused edit at its cell (%s)", async (entryMode) => {
  const user = userEvent.setup();
  const host = await scheduleHost({ cold: true });
  if (entryMode.startsWith("range")) host.setResponse(cellsApplied([[1, 2, true], [2, 2, true]]));
  const detail = detailResponse();
  const entry = detail.entries[0]!;
  entry.columns[1]!.headerText = "Description";
  entry.rows[0]!.values = ["SH1", "Duct heater"];
  Object.assign(entry.rows[0]!.bindings[0]!, {
    parameterName: "PE_G___Description", storageType: "String", rawValue: "Duct heater",
    displayValue: "Duct heater", targetElementIds: [7], isTypeParameter: false,
    targets: [{ ...entry.rows[0]!.bindings[0]!.targets[0]!, storageType: "String", rawValue: "Duct heater" }],
  });
  Object.assign(entry.rows[0]!.bindings[0]!.targets[0]!, {
    elementLabel: "SH1", uniqueId: "schedule-member-7", parameterName: "PE_G___Description",
    scope: "instance", displayValue: "Duct heater",
  });
  const second = structuredClone(entry.rows[0]!);
  second.rowNumber = 2;
  second.values[0] = "SH2";
  second.subjectIds = [8];
  second.bindings[0]!.targetElementIds = [8];
  second.bindings[0]!.targets[0]!.elementId = 8;
  Object.assign(second.bindings[0]!.targets[0]!, { elementLabel: "SH2", uniqueId: "schedule-member-8" });
  entry.rows.push(second);
  host.setDetail(detail);
  const client = createPeClient(host.base, contextFetch);
  const pending = new Set<Promise<void>>();
  const listeners = new Set<(state: any) => void>();
  const publishWork = async () => {
    const state = await host.view();
    for (const deliver of listeners) deliver(state.revision === 0 ? { kind: "absent" } : {
      kind: "ready", history: { from: 0, acks: [] },
      snapshot: { handle: { key: host.scope, revision: state.revision }, revision: state.revision, value: state.doc },
    });
  };
  // Replay the existing fixture's HTTP inspection transport. Every state and refusal
  // comes from the production host; no fixture code chooses a revision or edited value.
  const native = createWorkFeedClient({ subscribe: () => () => {}, dirty() {} }, {
    write: async (key, body) => {
      const response = await client.response("work.apply", { ...routeInput(key.route, key), body });
      const wire = await response.json();
      return response.ok ? wire : wire.error.details;
    },
    submit: async command => {
      const response = await host.post("/actions", command);
      if (response.status >= 400) throw Error(JSON.stringify(response.value));
      const result = await host.owner().wait(command.id);
      await publishWork();
      return result;
    },
  });
  const work: WorkJournalDoor = { ...native, open: () => ({ subscribe(deliver) {
    listeners.add(deliver); const task = publishWork(); pending.add(task);
    void task.finally(() => pending.delete(task));
    return () => { listeners.delete(deliver); };
  } }) };
  const source: UseSource = { kind: "use", open(ctx, deliver) {
    const task = host.post("/pe/reads/value", {
      read: "schedules.view", subscription: crypto.randomUUID(), generation: 1,
      args: { target: host.b, ...(ctx.args as object) },
    }).then(response => {
      expect(response.status).toBe(200);
      if (!ctx.signal.aborted) deliver({ kind: "complete", value: response.value, revision: 1 });
    });
    pending.add(task); void task.finally(() => pending.delete(task)); return () => {};
  } };
  const search = new URLSearchParams();
  const mount = mounts.mountTypedRoute(schedules, {
    address: { read: () => new URLSearchParams(search), write: next => { for (const [k,v] of next) search.set(k,v); }, subscribe: () => () => {} },
    fixture: null, target: { kind: "document", ref: host.b }, work: { address: null, open: host.b },
    custody: { current: () => true }, memory: () => ({}),
  }, workFingerprintSchema.parse(`builtin-closure:${"a".repeat(64)}`), { work, sources: { "schedules.view": source } });
  function Journey() {
    useSyncExternalStore(mount.subscribe, mount.revision, mount.revision);
    return <KeyScopeHost id="schedules-cell-edit"><TypedChrome mount={mount} document={<span>Project schedules</span>} /></KeyScopeHost>;
  }
  const router = createRouter({ routeTree: createRootRoute({ component: Journey }), history: createMemoryHistory({ initialEntries: ["/schedules"] }) });
  const view = render(<RouterProvider router={router} />);
  try {
    fireEvent.click(await screen.findByRole("button", { name: "Choose schedule" }));
    fireEvent.click(await screen.findByRole("option", { name: "Panel" }));
    fireEvent.click(await screen.findByRole("button", { name: "Start" }));
    await waitFor(() => expect(mount.work()?.handle.revision).toBe(1));
    await waitFor(() => expect(mount.value().current).toBe(true));
    fireEvent.click(screen.getAllByRole("button", { name: "Read schedule" })[1]!);
    await waitFor(() => expect(mount.work()?.handle.revision).toBe(2));
    await waitFor(() => expect(mount.problem()).toBeNull());
    await screen.findByText("SH1");
    await screen.findByText("SH2");
    const input = (await screen.findAllByDisplayValue("Duct heater"))[0] as HTMLInputElement;
    const cell = input.closest("td")!;
    const text = "Duct heater - gate review";
    if (entryMode === "insertText") {
      // Retain the original no-printable-keydown witness alongside real keyboard entry.
      act(() => cell.focus()); // jsdom has no browser default mousedown focus.
      fireEvent.mouseDown(cell);
      fireEvent.mouseUp(cell);
      fireEvent.click(cell);
      expect.soft(document.activeElement, "A clicked editable cell receives native text input before Enter").toBe(input);
      const active = document.activeElement!;
      fireEvent.keyDown(active, { key: "a", code: "KeyA", ctrlKey: true });
      if (active === input) fireEvent.input(input, { target: { value: text }, inputType: "insertText", data: text });
      fireEvent.keyDown(active, { key: "Enter", code: "Enter" });
    } else {
      if (entryMode.startsWith("range")) {
        const last = screen.getAllByDisplayValue("Duct heater")[1]!.closest("td")!;
        await user.pointer([
          { keys: "[MouseLeft>]", target: cell },
          { target: last },
          { keys: "[/MouseLeft]", target: last },
        ]);
        expect(cell.getAttribute("aria-selected")).toBe("true");
        expect(last.getAttribute("aria-selected")).toBe("true");
      } else if (entryMode.startsWith("pointer")) {
        await user.click(cell);
        await user.keyboard("{Control>}a{/Control}");
      } else {
        // Enter the preceding cell as a keyboard user, then navigate; no mouse gesture.
        const previous = cell.parentElement!.querySelector<HTMLElement>('[data-column-key="c1"]')!;
        act(() => previous.focus());
        await user.keyboard("{ArrowRight}");
        expect(document.activeElement).toBe(cell);
      }
      if (entryMode === "navigation paste") {
        await user.paste(text);
      } else {
        if (entryMode.endsWith("shifted text") || entryMode === "navigation composition") {
          const composing = entryMode === "navigation composition";
          fireEvent.keyDown(document.activeElement!, composing
            ? { key: "Process", keyCode: 229, isComposing: true }
            : { key: "D", code: "KeyD", keyCode: 68, shiftKey: true });
          if (composing) fireEvent.compositionStart(document.activeElement!);
          const editor = document.activeElement as HTMLInputElement;
          expect(editor.tagName, `${entryMode}: native insertion has an editor`).toBe("INPUT");
          const data = composing ? text : "D";
          if (composing) fireEvent.compositionUpdate(editor, { data });
          // Replay the Driver's separate character delivery after keydown. Unlike
          // user-event, CDP delivers this even if keydown was prevented.
          const inputType = composing ? "insertCompositionText" : "insertText";
          const insert = (data: string) => {
            const allowed = fireEvent(editor, new InputEvent("beforeinput", { bubbles: true, cancelable: true, data, inputType, isComposing: composing }));
            const start = editor.selectionStart!, end = editor.selectionEnd!;
            if (allowed) {
              fireEvent.input(editor, { target: { value: editor.value.slice(0, start) + data + editor.value.slice(end) }, data, inputType, isComposing: composing });
              editor.setSelectionRange(start + data.length, start + data.length);
            }
          };
          insert(data);
          if (composing) fireEvent.compositionEnd(editor, { data });
          else fireEvent.keyUp(editor, { key: "D", code: "KeyD", keyCode: 68 });
          if (!composing) for (const char of text.slice(1)) {
            fireEvent.keyDown(editor, { key: char });
            insert(char);
            fireEvent.keyUp(editor, { key: char });
          }
        } else {
          await user.keyboard("{Shift>}D{/Shift}");
          await user.keyboard(text.slice(1));
        }
        expect.soft((document.activeElement as HTMLInputElement).value, `${entryMode}: draft text is exact`).toBe(text);
        await user.keyboard("{Enter}");
      }
    }
    await waitFor(async () => expect(await host.view()).toMatchObject({ revision: 3, doc: { cells: { "1::2": { edit: { value: "Duct heater - gate review" } } } } }));
    if (entryMode.startsWith("range")) expect(await host.view()).toMatchObject({ revision: 3, doc: { cells: { "2::2": { edit: { value: text } } } } });
    // This recorded HTTP read adapter has no invalidation socket; Refresh re-reads host Value.
    act(() => mount.refresh());
    await waitFor(() => expect(mount.problem()).toBeNull());
    await screen.findAllByDisplayValue("Duct heater - gate review");
    if (entryMode === "review identity") expect(screen.queryByText(/Id 7/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /plan Apply cells/i }));
    if (entryMode === "review identity") {
      await screen.findByText(/Panel Schedule.*SH1.*Id 7.*PE_G___Description.*instance.*Duct heater → Duct heater - gate review/);
      const reading = mount.value().value as { saved: { snapshot: { rows: { bindings: { targets: unknown[] }[] }[] } } };
      expect(reading.saved.snapshot.rows[0]!.bindings[0]!.targets[0]).toMatchObject({
        uniqueId: "schedule-member-7", elementLabel: "SH1", scope: "instance",
        parameterName: "PE_G___Description", displayValue: "Duct heater",
      });
    } else await screen.findByText(/SH1.*Description.*Duct heater → Duct heater - gate review/);
    act(() => mount.cancel("push"));
    // Another writer advances Work behind the drawn cell. The host must refuse the
    // stale revision and its real reason must remain beside the user's cell.
    await host.patch([{ path: ["cells", "1::2"], value: { edit: { value: "Other writer" } } }]);
    const current = screen.getAllByDisplayValue("Duct heater - gate review")[0]!;
    if (entryMode === "insertText") {
      fireEvent.mouseDown(current);
      fireEvent.mouseUp(current);
      fireEvent.click(current);
      expect(document.activeElement).toBe(current);
      fireEvent.change(current, { target: { value: "Must visibly refuse" } });
      fireEvent.keyDown(current, { key: "Enter", code: "Enter" });
    } else {
      act(() => current.focus());
      await user.keyboard("{Control>}a{/Control}Must visibly refuse{Enter}");
    }
    await waitFor(() => expect(within(current.closest("td")!).getByText(/document moved|revision|changed/i)).toBeTruthy());
    expect(await host.view()).toMatchObject({ revision: 4, doc: { cells: { "1::2": { edit: { value: "Other writer" } } } } });
  } finally { view.unmount(); mount.dispose(); await Promise.all(pending); }
}, 30_000);

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

test("JZ header chooser query keys preserve open systems until an explicit choice", async () => {
  const [{ default: userEvent }, { fixture, ref, path }, { registeredReads }, reads,
    { module: ducts }, { TypedSubject }, { observeResources }, { valueReadResponse }, { localId }] = await Promise.all([
    import("@testing-library/user-event"), import("../../../host/tests/host-read-graph.test-support"),
    import("../../../host/src/reads/routes"), import("../../../host/src/reads/ducts"),
    import("../ducts/route"), import("../shell/typed-shell"), import("@pe/runtime"),
    import("@pe/agent-contracts"), import("./typed-route"),
  ]);
  const { default: saved } = await import("../ducts/fixtures/synthetic-snapshot.json");
  const { nativeResponseSchema } = await import("@pe/host-contracts/decoders");
  const snapshot = nativeResponseSchema("ducts.snapshot.walk").parse(saved);
  snapshot.systems = [snapshot.systems[0]!, { ...snapshot.systems[0]!, id: 501, name: "SA 16" }];
  for (const element of [...snapshot.nodes, ...snapshot.segments]) element.uniqueId ||= `chooser-${element.id}`;
  const host = await fixture(false, { snapshot, roster: { ...snapshot, groups: [], segments: [], flows: [] } });
  const definitions = [reads.ductsPricing, reads.ductsNetwork, reads.ductsRoster];
  const unregister = registeredReads.register(Object.fromEntries(definitions
    .filter(d => !registeredReads.reads.has(d.name)).map(d => [d.name, d])));
  let generation = 0;
  const requests: unknown[] = [];
  const sources = Object.fromEntries(definitions.map(d => [`${d.name}.value`, {
    kind: "use" as const,
    open(ctx, deliver) {
      requests.push(ctx.args);
      return host.probe({ read: d.name, subscription: `chooser-${++generation}`, generation,
        args: { target: ref, ...(ctx.args as object) } }).then(async response => {
        if (!response.ok) throw Error(await response.text());
        const packet = valueReadResponse.parse(await response.json());
        deliver({ kind: "complete", value: packet, revision: packet.version });
      }).catch(error => deliver({ kind: "failure", error }));
    },
  } satisfies UseSource]));
  let search = new URLSearchParams({ system: JSON.stringify({ kind: "ids", ids: [localId("ducts-system", "SA 1")] }) });
  const listeners = new Set<() => void>();
  const work = createWorkFeedClient({ subscribe: observeResources(host.workspace, { observe: () => () => {} }), dirty() {} }, {
    write: (key, write) => host.workspace.write(key, key.route, "human", write),
    submit: () => { throw Error("Chooser journey cannot write native data"); },
  });
  // C042: the shared header chooser belongs to a route with no subject-list pane.
  // Real Ducts owns its roster choice there; this journey retains the chooser's query safety.
  const chooserOnly = route({ ...ducts.spec, subject: { ...ducts.spec.subject!, pane: "value" },
    panes: { value: { title: "System value", purpose: "Inspect chosen systems", draw: () => null } },
    layout: { kind: "pane", id: "value" } });
  const mount = mounts.mountTypedRoute(chooserOnly, {
    target: { kind: "document", ref }, fixture: null, work: { address: path, open: ref },
    custody: { current: () => true }, memory: () => ({}),
    address: { read: () => new URLSearchParams(search), write(next) { search = next; listeners.forEach(f => f()); },
      subscribe(f) { listeners.add(f); return () => { listeners.delete(f); }; } },
  }, workFingerprintSchema.parse(`builtin-closure:${"a".repeat(64)}`), { work, sources });
  let view: ReturnType<typeof render> | undefined;
  try {
    await waitFor(() => expect(mount.value().current).toBe(true), { timeout: 20_000 });
    const pending: string[] = [];
    const unsubscribe = mount.subscribe(() => { if (mount.value().status === "pending") pending.push(mount.value().status); });
    const root = createRootRoute({ component: () => <KeyScopeHost id="chooser-journey"><TypedSubject mount={mount} /></KeyScopeHost> });
    const router = createRouter({ routeTree: root, history: createMemoryHistory({ initialEntries: ["/ducts"] }) });
    view = render(<RouterProvider router={router} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Choose system" }));
    await user.click(await screen.findByRole("combobox", { name: "system search" }));
    const before = search.toString(), count = requests.length;
    for (const key of "SA 16") {
      await user.keyboard(key);
      expect.soft(search.toString(), `query key ${JSON.stringify(key)} never changes URL selection`).toBe(before);
    }
    expect((screen.getByRole("combobox", { name: "system search" }) as HTMLInputElement).value).toBe("SA 16");
    expect(screen.queryByRole("option", { name: "SA 1" }), "filtered-out selected item stays open").toBeNull();
    expect.soft(mount.page.read().system).toEqual({ kind: "ids", ids: [localId("ducts-system", "SA 1")] });
    expect.soft(pending, "query never starts Reading").toEqual([]);
    expect.soft(requests.length, "query never dispatches a host read").toBe(count);
    unsubscribe();
    await user.click(screen.getByRole("option", { name: "SA 16" }));
    // The ordinary Ducts chooser opens multiple systems. A choice adds SA 16; SA 1 stays open.
    await waitFor(() => expect(mount.page.read().system.ids).toEqual([
      localId("ducts-system", "SA 1"), localId("ducts-system", "SA 16"),
    ]));
    await waitFor(() => expect(mount.value().current).toBe(true), { timeout: 20_000 });
    expect(requests.length).toBeGreaterThan(count);
  } finally { view?.unmount(); mount.dispose(); unregister(); await host.close(); }
});
import { createFixtureWorkDoor } from "../shell/fixture-work-door";
import { evaluate } from "../../../host/src/reads/evaluator";
import { reads as familyReads } from "../../../host/src/reads/family";
import { FAMILY_MODEL_SCHEMA } from "../family/page";
import { leaks } from "../shell/visible-text";


test("D G07 Family renders named picker, member roster, Work and stage words without internal identities", async () => {
  const pod = "f88cf37a-6fda-4ee6-9f20-5b39b47d29ba", member = "Box.family.json";
  const reading = JSON.stringify({ family: { name: "Box" },
    parameters: { Width: { dataType: "Length", value: "24in" }, Height: { dataType: "Length", value: "12in" } },
    types: { Standard: {}, Wide: { Width: "36in" } },
    connectors: { c1: { domain: "Duct", shape: "Round", diameter: "6in", on: "Front" } },
  });
  const original = familyDraftRouteState.schema.parse({ reading, cells: { "/types/Wide/Width": { edit: { value: "40in" } } } });
  const door = createFixtureWorkDoor(familyDraftRouteState, original);
  const ready = Promise.withResolvers<void>();
  let accepted: { key: any; revision: number; doc: unknown };
  const work: WorkJournalDoor = { ...door, open: scope => ({ subscribe(deliver, end) {
    return door.open(scope).subscribe(state => {
      if (state.kind === "ready") {
        accepted = { key: state.snapshot.handle.key, revision: state.snapshot.revision, doc: state.snapshot.value };
        ready.resolve();
      }
      deliver(state);
    }, end);
  } }) };
  const pending = new Set<Promise<unknown>>(), roster = Promise.withResolvers<void>();
  let memberReads = 0;
  const source: UseSource = { kind: "use", open(ctx, deliver) {
    const task = (async () => {
      await ready.promise; await roster.promise;
      const value = await evaluate(familyReads.workspace, { ...(ctx.args as { member: { pod: string; path: string } | null }), target: ctx.target }, {
        evaluation: crypto.randomUUID(), origin: { kind: "d-rendered-family" }, revision: () => accepted.revision,
        async take(name) {
          if (name === "work-scope") return accepted.key;
          if (name === "work") return { doc: accepted.doc, revision: accepted.revision };
          if (name === "local:pod.member.read") { memberReads++; return { content: reading, sha256: "a".repeat(64), bytesBase64: "" }; }
          if (name === "local:pod.member.compose") return { sha256: "a".repeat(64), schemaUrl: FAMILY_MODEL_SCHEMA,
            schemaJson: null, composed: reading, source: { id: pod, path: member, sha256: "a".repeat(64), bytesBase64: "", origin: "SavedMember" },
            diagnostics: [], dependencies: [], schemaValidation: "no-schema", semanticValidation: "not-run" };
          if (name === "file:family-spec") return { doc: null, error: null };
          if (name === "local:pod.list") return { pods: [{ id: pod, name: "Mechanical library", version: "1.0.0",
            folder: "mechanical", entrypoints: [], contributions: [], diagnostics: [], members: [
            { path: member, sha256: "a".repeat(64), schema: FAMILY_MODEL_SCHEMA },
          ] }], unreadable: [] };
          throw Error(`Unexpected Family input: ${name}`);
        },
      });
      if (!ctx.signal.aborted) deliver({ kind: "complete", revision: accepted.revision + 1,
        value: { key: "family.workspace", generation: 0, version: accepted.revision + 1, state: "current", value } });
    })().catch(error => deliver({ kind: "failure", error }));
    pending.add(task); void task.finally(() => pending.delete(task));
    return () => {};
  } };
  let search = new URLSearchParams({ pod });
  const mount = mounts.mountTypedRoute(family, {
    address: { read: () => new URLSearchParams(search), write: next => { search = new URLSearchParams(next); }, subscribe: () => () => {} },
    target: { kind: "host" }, fixture: null, custody: { current: () => true }, memory: () => ({}),
    work: { address: null, open: null },
  }, workFingerprintSchema.parse(`builtin-closure:${"a".repeat(64)}`), { work, sources: { "family.workspace": source } });
  function Journey() { return <TypedChrome mount={mount} document={<span>Family library</span>} />; }
  const root = createRootRoute({ component: Journey });
  const router = createRouter({ routeTree: root, history: createMemoryHistory({ initialEntries: ["/family"] }) });
  const view = render(<RouterProvider router={router} />);
  const cleanWords = (where: string) => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT), text: string[] = [];
    while (walker.nextNode()) text.push(walker.currentNode.textContent ?? "");
    const words = [...text, ...Array.from(document.body.querySelectorAll("[aria-label], [title]"))
      .flatMap(node => [node.getAttribute("aria-label") ?? "", node.getAttribute("title") ?? ""]),
      ...Array.from(document.body.querySelectorAll("input")).map(input => input.value)];
    expect.soft(words.flatMap(word => leaks(word)), where).toEqual([]);
    expect.soft(words.join(" "), where).not.toContain(pod);
  };
  try {
    await screen.findByText("Family library");
    await ready.promise;
    expect(mount.value().current).toBe(false);
    cleanWords("C746: before the roster publication, no raw identity fallback");
    roster.resolve();
    await waitFor(() => expect(mount.value().current, JSON.stringify(mount.value())).toBe(true));
    expect(mount.owner()?.doc).toEqual(original);
    expect.soft(await screen.findByText(member)).toBeTruthy();
    expect.soft(screen.queryByText("Mechanical library")).toBeTruthy();
    cleanWords("C747: actual Work and member payload display strings");
    fireEvent.click(screen.getByText(member));
    await waitFor(() => expect(memberReads).toBeGreaterThan(0));
    await waitFor(() => expect(mount.value().current).toBe(true));
    expect(mount.page.read()).toMatchObject({ pod, path: member });
    expect.soft((screen.getByRole("textbox", { name: "Destination pod" }) as HTMLInputElement).value).toBe("Mechanical library");
    cleanWords("C746: selected roster member keeps its canonical key off the surface");
    await act(async () => fireEvent.click(screen.getAllByRole("button", { name: /^bind/ })[0]!));
    const picker = await screen.findByRole("listbox", { name: "bind c1.diameter" });
    expect(within(picker).getAllByRole("option").some(option => option.textContent?.includes("Width"))).toBe(true);
    cleanWords("C746: rendered binding picker labels");
    fireEvent.keyDown(picker, { key: "Escape", code: "Escape" });
    for (const stage of ["audit", "apply", "history"] as const) {
      await act(async () => mount.page.pose({ stage }));
      expect(mount.page.read().stage).toBe(stage);
      expect(view.container.textContent).toContain("Family");
      cleanWords(`C746: rendered Family route/stage words in ${stage}`);
    }
    fireEvent.change(screen.getByRole("textbox", { name: "Destination pod" }), { target: { value: "new-mechanical" } });
    expect(mount.page.read()).toMatchObject({ pod: "new-mechanical", path: "" });
    expect((screen.getByRole("textbox", { name: "Destination pod" }) as HTMLInputElement).value).toBe("new-mechanical");
    expect(mount.owner()?.doc).toEqual(original);
  } finally { roster.resolve(); view.unmount(); mount.dispose(); await Promise.all(pending); }
}, 30_000);


test("JM H17 browse an optional host route without a pin, then refuse malformed document pins", async () => {
  const module = route({ ...family.spec, edits: undefined, core: undefined, commands: {}, reads: {},
    panes: { main: { title: "Optional document", purpose: "Inspect exact target authority",
      draw: ctx => <p role="status">{ctx.target?.kind === "host" ? "Host browsing" : "Pinned document"}</p> } },
    layout: { kind: "pane", id: "main" } });
  const stamp = workFingerprintSchema.parse(`builtin-closure:${"a".repeat(64)}`);
  let search = new URLSearchParams();
  const listeners = new Set<() => void>();
  const address = { read: () => new URLSearchParams(search), write(next: URLSearchParams) { search = next; listeners.forEach(f => f()); },
    subscribe(f: () => void) { listeners.add(f); return () => { listeners.delete(f); }; } };
  const root = createRootRoute({ component: () => <TypedShell module={module} fingerprint={stamp} address={address} /> });
  const router = createRouter({ routeTree: root, history: createMemoryHistory({ initialEntries: ["/"] }) });
  render(<RouterProvider router={router} />);
  await screen.findByText("Host browsing");
  address.write(new URLSearchParams({ target: "not JSON" }));
  await waitFor(() => expect(screen.queryByText("Host browsing"), "H17: a bad pin never falls back to host authority").toBeNull());
  expect(screen.queryByText("Pinned document"), "H17: unresolved pin grants no document authority").toBeNull();
});

test("JZ B04 read a long review, dismiss with Escape and return to its opener", async () => {
  function Journey() {
    const [open, setOpen] = useState(false);
    return <><button onClick={() => setOpen(true)}>Review airflows</button>{open && <ReviewSurface
      label="Update airflows" sentence="Change Supply" rows={Array.from({ length: 200 }, (_, i) => `Change ${i}`)}
      enabled confirm={() => { throw Error("Escape must not commit"); }} cancel={() => setOpen(false)} />}</>;
  }
  const view = render(<Journey />);
  const opener = screen.getByRole("button", { name: "Review airflows" });
  opener.focus();
  fireEvent.click(opener);
  const commit = await screen.findByRole("button", { name: "Commit Update airflows" });
  expect(view.container.contains(commit), "B04: review is portalled").toBe(false);
  const footer = commit.closest(".shrink-0");
  expect(footer, "Commit stays outside the scrollable change list").not.toBeNull();
  expect(footer!.previousElementSibling?.className).toContain("overflow-y-auto");
  expect(commit.textContent).toContain("Commit Update airflows");
  expect(screen.getByText("Change 199"), "B04: final change is present").toBeTruthy();
  commit.focus();
  expect(document.activeElement).toBe(commit);
  fireEvent.keyDown(commit, { key: "Escape", code: "Escape" });
  await waitFor(() => expect(screen.queryByRole("button", { name: "Commit Update airflows" })).toBeNull());
  await waitFor(() => expect(document.activeElement, "B04: dismissal restores prior focus").toBe(opener));
  // Scroll reach and footer visibility require Driver layout evidence; jsdom cannot establish either.
});

test("JZ B02 undo follows focus between typed routes, portal and hidden pane; text keeps native undo", async () => {
  const live = mounts.mountTypedRoute;
  const owners: mounts.TypedMount[] = [];
  vi.spyOn(mounts, "mountTypedRoute").mockImplementation((...args) => {
    const owner = live(...args); owners.push(owner); return owner;
  });
  const make = (key: string) => route({ ...fans.spec, key, name: key, needs: "browser", core: undefined,
    subject: undefined, reads: {}, edits: undefined, commands: {}, fields: {},
    panes: { main: { title: key, purpose: "Focus ownership", draw: () => <><button>{key} focus</button><textarea aria-label={`${key} text`} />{createPortal(<button>{key} portal</button>, document.body)}</> } },
    layout: { kind: "pane", id: "main" } });
  const a = make("jz-a"), b = make("jz-b");
  const stamp = workFingerprintSchema.parse(`builtin-closure:${"a".repeat(64)}`);
  const address = () => ({ read: () => new URLSearchParams(), write: () => {}, subscribe: () => () => {} });
  const addressA = address(), addressB = address();
  function Journey() {
    const [hidden, setHidden] = useState(false);
    return <><button onClick={() => setHidden(true)}>Hide B</button><TypedShell module={a} fingerprint={stamp} address={addressA} />
      <RouteVisibility.Provider value={!hidden}><div hidden={hidden}><TypedShell module={b} fingerprint={stamp} address={addressB} /></div></RouteVisibility.Provider></>;
  }
  const root = createRootRoute({ component: Journey });
  const router = createRouter({ routeTree: root, history: createMemoryHistory({ initialEntries: ["/"] }) });
  render(<RouterProvider router={router} />);
  await screen.findByRole("button", { name: "jz-b focus" });
  expect(owners).toHaveLength(2);
  const undo = owners.map(owner => vi.spyOn(owner.history, "undo"));
  const press = (node: HTMLElement) => { node.focus(); const native = fireEvent.keyDown(node, { key: "z", code: "KeyZ", ctrlKey: true }); fireEvent.keyUp(node, { key: "z", code: "KeyZ", ctrlKey: true }); return native; };
  press(screen.getByRole("textbox", { name: "jz-a text" }));
  expect(undo.map(spy => spy.mock.calls.length), "B02: browser retains text undo").toEqual([0, 0]);
  press(screen.getByRole("button", { name: "jz-a focus" }));
  expect(undo.map(spy => spy.mock.calls.length), "B02: only the focused route receives undo").toEqual([1, 0]);
  press(screen.getByRole("button", { name: "jz-b portal" }));
  expect(undo.map(spy => spy.mock.calls.length), "B02: portal belongs to B").toEqual([1, 1]);
  fireEvent.click(screen.getByRole("button", { name: "Hide B" }));
  press(screen.getByRole("button", { name: "jz-a focus" }));
  expect(undo.map(spy => spy.mock.calls.length), "B02: hidden B cannot steal undo").toEqual([2, 1]);
});


import type { DuctSnapshot } from "@pe/ducts-domain/types";
import { inputsFor } from "@pe/ducts-domain/sheet/test-inputs";
import { inputRows } from "../ducts/sheet/input-rows";
import { SheetCell } from "../ducts/sheet/sheet-cell";
import { PreviewAction } from "@pe/kit/lang/write-action";

// Plan reviews seal model inputs, never browser pane visibility or Page pose.
import { useEffect, useReducer } from "react";
import realMuas from "../../../../packages/ducts-domain/src/sheet/fixtures/muas-local-20261102.json";
import { createWitness } from "../fans/cutover.test-support";
import { StateCell } from "@pe/kit/lang/cell";
import { actionStatusSchema } from "@pe/agent-contracts";
import type { ReceiptFeedState, ReceiptCursor } from "../../../../packages/agent-contracts/src/work-journal-door";
import { TypedWrite } from "../shell/typed-shell";
import type { ReadingDelivery } from "../shell/source-contract";
const native = vi.hoisted(() => ({ submit: vi.fn(), permission:vi.fn(), retained: [] as unknown[] }));
vi.mock("../../../../packages/mcps/src/shared/takeoff-action-client", async (actual) => ({
  ...(await actual<object>()),
  submitAction: native.submit,
}));

vi.mock("../workbench/provider/harness-client",()=>({harnessClient:()=>({permission:native.permission})}));

const closes: (() => void)[] = [];
afterEach(() => {
  cleanup();
  closes
    .splice(0)
    .reverse()
    .forEach((close) => close());
});

// CB4-F01: replay the recorded MUAS walk through Work, Plan and the shared review DOM.
// Native responses use the new DTO; they certify presentation, not a Revit read.
test("JZ Fans native before: stage, Plan, inspect method and unset pressure; unreadable holds Apply", async () => {
  for (const unreadable of [false, true]) {
    const capture = structuredClone(realMuas);
    native.submit.mockImplementation(async () => {
      const input = f.inputs.get("fans:ducts.plan-losses") as { work: unknown };
      return ({
      id: "native-before-plan", state: "succeeded",
      result: {
        previewOnly: true,
        derivedRequest: {
          components: [{ id: 14607308, inWg: 0.03980584344921083, source: "damper CD9-1" }],
          equipmentFlows: [{ id: 14577391, cfm: 1000, source: "Work" }],
        },
        takenAt: "2026-11-07T19:06:18.171Z",
        seal: {
          caller: { kind: "human", via: "local" }, requestHash: "sealed", work: { handle: input.work },
          documentMark: { session: "fixture", openId: "fans", observedSince: null, changedAt: null },
          incarnation: {}, dependencies: "exact",
        },
        value: {
          previewOnly: true,
          writes: [{
            id: 14607308, kind: "component", outcome: unreadable ? "refused" : "planned",
            elementLabel: 'Mechanical Damper 10"', uniqueId: "cd545b04-afd3-4993-836f-9b3d8116003a-00dee3cc",
            parameter: "Specific Loss", scope: "instance",
            before: unreadable ? null : "unset", after: unreadable ? null : "0.0398 in-wg",
            reason: unreadable ? "Revit refused the read: element is inaccessible" : null,
            changes: unreadable ? null : [
              { parameter: "Loss Method", before: "ashrae-table", after: "specific-loss" },
              { parameter: "Specific Loss", before: "unset", after: "0.0398 in-wg" },
            ],
            reportedPressureDropInWg: unreadable ? null : 0.025,
          }, {
            id: 14577391, kind: "equipment-flow", outcome: "planned",
            elementLabel: "MUAS-1", uniqueId: "78fb66ed-41aa-47c4-907e-6ccf601ad7b3-00de62f1",
            parameter: "PE_M_Fan_AirFlowDesign", scope: "instance",
            before: "880 cfm", after: "1000 cfm",
          }],
          counts: { planned: unreadable ? 1 : 2, refused: unreadable ? 1 : 0, written: 0, unchanged: 0 },
          storeRevision: 0, systemsAfter: null,
        },
      },
    }); });
    const f = await createWitness(closes, new Map(), {
      "ducts.sheet-snapshot": { kind: "use", open(_ctx, deliver) {
        deliver({ kind: "complete", value: capture, revision: 1 });
      } },
    });
    await vi.waitFor(() => expect(f.fans.work()).not.toBeNull());
    await f.ws.apply(f.fans.workBasis()!.token.scope.identity.work!, "fans", "human", [
      { path: ["writeIntent"], value: { edit: { value: { walk: { unitId: 14577391, portIndex: 2 } } } } },
      { path: ["equipmentFlows", "14577391", "edit"], value: { value: { cfm: 1000, source: "Work" } } },
    ], f.fans.work()!.revision);
    await vi.waitFor(() => expect(f.fans.work()!.value.equipmentFlows["14577391"]?.edit?.value.cfm).toBe(1000));
    f.fans.refresh("value");
    for (const id of ["value", "owner:ducts"])
      await vi.waitFor(() => expect(f.fans.readingStatus(id).snapshot).toMatchObject({ current: true }));
    function WriteReview() {
      const [, changed] = useReducer(n => n + 1, 0);
      useEffect(() => f.fans.subscribe(changed), []);
      return <TypedWrite mount={f.typed} id="losses" />;
    }
    render(<WriteReview />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "plan Write to Revit" })));
    await waitFor(() => expect(f.fans.review("losses")?.cells?.length).toBeGreaterThan(0));
    const reviewTrigger = screen.getByRole("button", { name: /Write to Revit.*planned/ });
    if (reviewTrigger.getAttribute("aria-expanded") !== "true")
      await act(async () => fireEvent.click(reviewTrigger));
    const rows = [...document.querySelectorAll("[data-write-cell]")].map(row => row.textContent!);
    if (unreadable) {
      expect.soft(rows.some(row => row.includes('Mechanical Damper 10"') && row.includes("14607308") && row.includes("Specific Loss") && row.includes("element is inaccessible"))).toBe(true);
      expect.soft(screen.queryByRole("button", { name: "Write to Revit" }), "unreadable native target holds the entire intent").toBeNull();
    } else {
      for (const words of [
        ['Mechanical Damper 10"', "14607308", "Loss Method", "ASHRAE table", "Specific Loss"],
        ['Mechanical Damper 10"', "14607308", "Specific Loss", "unset", "0.0398 in-wg", "reported effective pressure", "0.025 in-wg"],
        ["MUAS-1", "14577391", "PE_M_Fan_AirFlowDesign", "instance", "880 cfm", "1000 cfm"],
      ]) expect.soft(rows.some(row => words.every(word => row.includes(word))), words.join(" / ")).toBe(true);
      expect.soft(rows).toHaveLength(3);
      expect.soft(screen.getByRole("button", { name: "Write to Revit" }).hasAttribute("disabled")).toBe(false);
    }
    cleanup();
    closes.splice(0).reverse().forEach(close => close());
  }
});

test.each([false, true])(
  "JZ Plan pane/pose: pending Fans review stays Apply-eligible without Work revisions (oversized reading: %s)",
  async (large) => {
    native.retained.length = 0;
    const capture = structuredClone(realMuas);
    if (large) capture.document.title = "large-model-evidence".repeat(65536);
    const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
    if (large) expect(bytes(capture)).toBeGreaterThan(1024 * 1024);
    let plan!: (result: unknown) => void;
    const snapshots: ReadingDelivery[] = [];
    const snapshot:ReadingDelivery = frame => snapshots.forEach(deliver=>deliver(frame));
    native.submit.mockImplementation(
      () =>
        new Promise((resolve) => {
          plan = resolve;
        }),
    );
    native.permission.mockClear();
    const receiptSubscribers=new Set<(state:ReceiptFeedState)=>void>();
    const receipts:WorkJournalDoor["receipts"]=()=>({subscribe(deliver){receiptSubscribers.add(deliver);return ()=>{receiptSubscribers.delete(deliver);};}});
    const f = await createWitness(closes, new Map(), {
      "ducts.sheet-snapshot": {
        kind: "use",
        open(_ctx, deliver) {
          snapshots.push(deliver);
          deliver({ kind: "complete", value: capture, revision: 1 });
        },
      },
    },undefined,receipts);
    await vi.waitFor(() => expect(f.fans.work()).not.toBeNull());
    const key = f.fans.workBasis()!.token.scope.identity.work!;
    await f.ws.apply(
      key,
      "fans",
      "pea",
      [
        {
          path: ["writeIntent"],
          value: { edit: { value: { walk: { unitId: 14577391, portIndex: 2 } } } },
        },
        {
          path: ["equipmentFlows", "14577391", "edit"],
          value: { value: { cfm: 925, source: "test" } },
        },
      ],
      f.fans.work()!.revision,
    );
    await vi.waitFor(() => expect(f.fans.work()!.value.writeIntent).toBeTruthy());
    f.fans.refresh("value");
    for (const id of ["value", "owner:ducts"])
      await vi.waitFor(() => {
        const snapshot = f.fans.readingStatus(id).snapshot;
        if (snapshot.status === "failed") throw Error(`${id}: ${snapshot.reason}`);
        expect(snapshot).toMatchObject({ current: true });
      });
    function Write() {
      const [, changed] = useReducer((n) => n + 1, 0);
      useEffect(() => f.fans.subscribe(changed), []);
      return <TypedWrite mount={f.typed} id="losses" />;
    }
    render(<Write />);
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "plan Write to Revit" })),
    );
    // The native mount retains handles and hash dependencies; it never serializes a Value into a token.
    expect(bytes(f.fans.workBasis())).toBeLessThan(2048);
    expect(plan).toBeTypeOf("function");
    const input = f.inputs.get("fans:ducts.plan-losses") as { work: unknown; readWorks: unknown };
    expect(input.readWorks).toHaveProperty("fans");
    // H1: a plan the host refuses after invoke returned shows its reason, arms nothing, and retries clean.
    const refusedText = "Fans Work belongs to another document";
    await act(async () => plan({ id: "plan-refused", state: "refused", error: refusedText }));
    expect(document.querySelector("[data-write-outcome=refused]")?.textContent).toBe(refusedText);
    expect(screen.queryByRole("button", { name: "Write to Revit" })).toBeNull();
    const trigger = screen.getByRole("button", { name: "plan Write to Revit" });
    await act(async () => fireEvent.click(trigger));
    await act(async () => fireEvent.click(trigger));
    expect(f.fans.reviewRefusal("losses")).toBeNull();
    expect(document.body.textContent).not.toContain(refusedText);
    const stagedRevision = f.fans.work()!.revision;
    const beforeSwitch = f.typed.value().publication!.evaluation;
    const beforeReads = f.calls.get("fans:fans.sheet");
    // The shell releases the retained typed mount while another pane is expanded.
    await act(async () => {
      f.typed.release();
      f.typed.subscribe(() => {})();
      f.typed.page.pose({ layers: [] });
    });
    expect(f.fans.work()!.revision).toBe(stagedRevision);
    expect(f.calls.get("fans:fans.sheet")).toBeGreaterThan(beforeReads!);
    await waitFor(() => expect(f.typed.value().current).toBe(true));
    expect(f.typed.value().publication!.evaluation).toBe(beforeSwitch);
    await act(async () =>
      plan({
        id: "plan-retention",
        state: "succeeded",
        result: {
          previewOnly: true,
          takenAt: "2026-11-05T00:00:00Z",
          derivedRequest: { equipmentFlows: [{ id: 14577391, cfm: 925, source: "test" }] },
          seal: {
            caller: { kind: "human", via: "local" },
            requestHash: "sealed",
            work: { handle: input.work },
            documentMark: {
              session: "fixture",
              openId: "fans",
              observedSince: null,
              changedAt: null,
            },
            incarnation: {},
            dependencies: "exact",
          },
          response: {
            writes: [
              {
                id: 14577391,
                kind: "equipment-flow",
                outcome: "planned",
                before: "880 cfm",
                after: "925 cfm",
              },
            ],
            counts: { planned: 1, written: 0, refused: 0, unchanged: 0 },
          },
        },
      }),
    );
    expect(f.fans.review("losses")).toMatchObject({
      stale: false,
      cells: [{ before: "880 cfm", author: "human" }],
    });
    expect(f.fans.review("losses")!.rows[0]).toContain("MUAS-1");
    expect(f.typed.action("losses").read()?.preview).toBeTruthy();
    const reviewTrigger = screen.getByRole("button", { name: /Write to Revit.*planned/ });
    if (reviewTrigger.getAttribute("aria-expanded") !== "true")
      await act(async () => fireEvent.click(reviewTrigger));
    expect((await screen.findByRole("button", { name: "Write to Revit" })).hasAttribute("disabled")).toBe(false);
    expect(document.querySelector("[data-write-cell]")?.textContent).toContain("925 cfm");
    expect(f.fans.work()!.revision).toBe(stagedRevision);
    // Broad route-surface witness: the real typed action consumes its receipt feed, and the
    // consent review contains the exact owned Work cell rather than a parallel fake handle.
    const receipt=actionStatusSchema.parse({id:"consent-review",key:"ducts.apply-losses",state:"waiting",
      caller:{kind:"pea",thread:"consent-thread",context:"surface-test"},basis:null,target:{kind:"host"},input:{},startedAt:new Date().toISOString(),
      consentWindow:{requestId:"consent-request",deadline:new Date(Date.now()+60_000).toISOString()}});
    act(()=>{for(const deliver of receiptSubscribers)deliver({kind:"ready",receipts:{rows:[receipt],from:0 as ReceiptCursor,through:1 as ReceiptCursor}});});
    expect(f.typed.action("losses").consent).not.toBeNull();
    cleanup();
    function ConsentReview(){return <PreviewAction handle={f.typed.action("losses")} label="Write to Revit">
      {f.typed.draw("sheet-inputs",ctx=><StateCell label="Equipment flow" cell={ctx.cells.at(["equipmentFlows","14577391"],"fans",{
        format:value=>typeof value==="object"&&value!==null&&"cfm" in value?String(value.cfm):String(value),
      })}/> ) as import("react").ReactNode}
    </PreviewAction>;}
    render(<ConsentReview/>);
    await act(async()=>fireEvent.click(screen.getByRole("button",{name:/Write to Revit.*planned/})));
    expect(screen.getByDisplayValue("925")).toBeTruthy();
    expect(screen.queryByRole("button",{name:"Write to Revit"})).toBeNull();
    fireEvent.click(document.querySelector("[data-write-reject]")!);
    expect(native.permission).toHaveBeenCalledWith("consent-thread","consent-request","stop_writes");
    // New naming evidence must revoke the old before/after review rather than silently re-present it.
    const moved = structuredClone(capture);
    moved.document.title = "changed model evidence";
    act(() => {
      f.fans.refresh("value");
      snapshot({ kind: "complete", value: moved, revision: 2 });
    });
    expect(f.fans.review("losses")).toMatchObject({ stale: true, rows: [], cells: [] });
    expect(() => f.fans.confirm("losses")).toThrow(/stale/i);
  },
);
test("JZ B03 people choose named subjects: pending Families scope, cold Schedules picker and honest Read", async () => {
  await pendingFamiliesChoice();
  const host = await scheduleHost();
  host.addSchedule(43, "ElectricDuctHeater");
  // Replay the native boundary for the unstarted member, not the fixture's seeded Panel Work.
  const { detailResponse } = await import("../../../host/tests/schedule-fixture");
  const heater = detailResponse();
  Object.assign(heater.entries[0]!, { scheduleId: 43, scheduleUniqueId: "uid-43", scheduleName: "ElectricDuctHeater" });
  heater.entries[0]!.rows[0]!.values[0] = "SH1";
  heater.entries[0]!.rows.push({ ...structuredClone(heater.entries[0]!.rows[0]!), rowNumber: 2, values: ["SH2", "100 VA"] });
  host.setDetail(heater);
  const pending = new Set<Promise<void>>();
  const source: UseSource = {
    kind: "use",
    open(ctx, deliver) {
      const task = host.post("/pe/reads/value", {
        read: "schedules.view", subscription: crypto.randomUUID(), generation: 1,
        args: { target: host.b, ...(ctx.args as Record<string, unknown>) },
      }).then(response => {
        expect(response.status).toBe(200);
        if (!ctx.signal.aborted) deliver({ kind: "complete", value: response.value, revision: 1 });
      }).catch(error => { if (!ctx.signal.aborted) deliver({ kind: "failure", error }); });
      pending.add(task);
      void task.finally(() => pending.delete(task));
      return () => {};
    },
  };
  // Receipt SSE is outside B03; commands still settle against the real host ActionJournal.
  const native = createWorkFeedClient({ subscribe: () => () => {}, dirty() {} }, {
    write: async () => { throw Error("B03 does not edit Work"); },
    submit: async command => {
      const response = await host.post("/actions", command);
      if (response.status >= 400) throw Error(JSON.stringify(response.value));
      return host.owner().wait(command.id);
    },
  });
  // This fixture serves persisted Work over HTTP, without a browser admission registry.
  // Replay that transport boundary; never substitute a seed or revision for the host's answer.
  const work: WorkJournalDoor = {
    ...native,
    open: scope => ({ subscribe(deliver, end) {
      let closed = false;
      const task = host.view(scope.key.work).then(state => {
        // The HTTP inspection door returns schema defaults at r0 for absent Work.
        if (state.revision === 0) { if (!closed) deliver({ kind: "absent" }); return; }
        if (!closed) deliver({ kind: "ready", history: { from: 0, acks: [] }, snapshot: {
          handle: { key: scope.key, revision: state.revision }, revision: state.revision, value: state.doc,
        } });
      }).catch(error => {
        if (!closed) { deliver({ kind: "failed", failure: { kind: "failed", code: "WorkReadFailed", message: String(error) } }); end(); }
      });
      pending.add(task); void task.finally(() => pending.delete(task));
      return () => { closed = true; };
    } }),
  };
  let search = new URLSearchParams();
  const fingerprint = workFingerprintSchema.parse(`builtin-closure:${"a".repeat(64)}`);
  const mount = mounts.mountTypedRoute(schedules, {
    address: { read: () => new URLSearchParams(search), write: next => { search = new URLSearchParams(next); }, subscribe: () => () => {} },
    fixture: null, target: { kind: "document", ref: host.b }, work: { address: null, open: host.b },
    custody: { current: () => true }, memory: () => ({}),
  }, fingerprint, { work, sources: { "schedules.view": source } });
  function Journey() {
    useSyncExternalStore(mount.subscribe, mount.revision, mount.revision);
    return <KeyScopeHost id="b03-schedules"><TypedChrome mount={mount} document={<span>Project schedules</span>} /></KeyScopeHost>;
  }
  const root = createRootRoute({ component: Journey });
  const router = createRouter({ routeTree: root, history: createMemoryHistory({ initialEntries: ["/schedules"] }) });
  const view = render(<RouterProvider router={router} />);
  try {
    await waitFor(() => expect(mount.value().current).toBe(true));
    expect(mount.work(), "B03: catalogue discovery does not require selected Work").toBeNull();
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Read schedule" })).toHaveLength(2));
    await act(async () => { fireEvent.click(screen.getAllByRole("button", { name: "Read schedule" }).at(-1)!); });
    expect(screen.getAllByText("Choose a schedule before reading").length, "B03: refused Read is visible").toBeGreaterThan(0);
    expect.soft(screen.queryAllByText(/.+ complete$/i), "B03: a refused verb must never produce any completion receipt").toEqual([]);
    const chooser = screen.queryByRole("button", { name: "Choose schedule" });
    expect.soft(chooser, "B03: cold open exposes the declared named-subject picker").not.toBeNull();
    if (!chooser) return; // Both base defects above remain assertion failures, not a missing-control exception.
    fireEvent.click(chooser);
    expect(await screen.findByRole("option", { name: "ElectricDuctHeater" }), "B03: choices come from the host catalogue").toBeTruthy();
    fireEvent.click(screen.getByRole("option", { name: "ElectricDuctHeater" }));
    const chosen = namesOf(mount.page.read().workspaceId);
    expect(chosen).not.toEqual([host.scope.work]);
    expect(search.has("workspaceId"), "B03: picker creates the Page address without a URL seed").toBe(true);
    await screen.findByRole("button", { name: "Start" });
    await waitFor(() => expect(mount.value().current).toBe(true));
    const before = host.reads();
    await act(async () => { fireEvent.click(screen.getAllByRole("button", { name: "Read schedule" }).at(-1)!); });
    expect.soft(screen.queryAllByText("Start this schedule Work before reading").length,
      "B03: a chosen but unstarted schedule names Start").toBeGreaterThan(0);
    expect.soft(screen.queryAllByText(/choose a schedule before reading|no schedule open/i),
      "B03: a selected schedule never asks to choose again").toEqual([]);
    expect(host.reads(), "B03: refused Read dispatches no native detail").toBe(before);
    expect(mount.work(), "B03: Read cannot implicitly Start").toBeNull();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Start" })); });
    await waitFor(() => expect(mount.work()).not.toBeNull());
    expect([mount.work()!.handle.key.work]).toEqual(chosen);
    await waitFor(() => expect(mount.value().current).toBe(true));
    await act(async () => { fireEvent.click(screen.getAllByRole("button", { name: "Read schedule" }).at(-1)!); });
    await waitFor(() => expect(host.reads(), "B03: Read reaches native schedule detail").toBeGreaterThan(before));
    await waitFor(() => expect(mount.result("read")).toBeDefined());
    await waitFor(() => {
      expect(mount.value().current, "B03: Read publishes a current Value").toBe(true);
      expect(mount.value().value?.reading, "B03: publication contains the completed Read, not the old capture").toEqual(mount.result("read"));
    });
    expect(mount.action("read").failure).toBeNull();
    expect(mount.value().value?.reading?.snapshot.scheduleId).toBe(43);
    expect(mount.value().value?.reading?.snapshot.scheduleName).toBe("ElectricDuctHeater");
    expect(host.sent.filter(row => row.key === "revit.detail.schedules").at(-1)?.input)
      .toMatchObject({ query: { kind: "ScheduleReferences", scheduleIds: [43] } });
    // TypedChrome mounts the shipped pane: members must reach the grid.
    await screen.findByText("SH1");
    await screen.findByText("SH2");
    expect(screen.getAllByRole("button", { name: "Choose schedule" }), "B03: one declared subject control").toHaveLength(1);
    expect(view.container.textContent, "B03: people see names, not internal Work identities").not.toContain(host.scope.work);
  } finally {
    view.unmount(); mount.dispose(); await Promise.all(pending);
  }
}, 30_000);


/** Retained Families publication + ready Work reproduce the Driver's post-Start refresh. */
async function pendingFamiliesChoice() {
  const doc = familiesRouteState.schema.parse({});
  const catalogue = {
    summary: { totalFamilies: 1, placedFamilies: 0, unplacedFamilies: 1, totalTypes: 1, totalPlacedInstances: 0, truncated: false },
    families: [{ familyId: 1, familyUniqueId: "air-tag", familyName: "Air Terminal Tag", categoryName: "Air Terminal Tags", typeCount: 1, placedInstanceCount: 0, types: [{ typeName: "Standard" }] }],
    issues: [],
  };
  // Only this retained publication boundary is replayed. Schedules below retains its real host HTTP reads/actions.
  const packet = families.spec.core!.output.parse({
    key: "b03-families", generation: 1, version: 1, state: "current", value: {
      data: { familiesWork: doc, catalog: catalogue, categories: ["Air Terminal Tags"], observation: null,
        rows: [], params: [], pivotRows: [], pivotFamilies: [], outcomes: [], activeReadId: null, editRefusal: "Read these families before editing" },
      evaluation: "b03-families", inputs: "b03-families", coverage: { requested: [], covered: [], unknown: [], refused: [] },
      origin: { kind: "fixture", name: "post-start-families" }, trace: [], freshness: "current",
    },
  });
  const release = Promise.withResolvers<void>();
  let hold = false;
  const tasks = new Set<Promise<void>>();
  const source: UseSource = { kind: "use", open(ctx, deliver) {
    const task = (hold ? release.promise : Promise.resolve()).then(() => {
      if (!ctx.signal.aborted) deliver({ kind: "complete", value: packet, revision: 1 });
    });
    tasks.add(task); void task.finally(() => tasks.delete(task));
    return () => {};
  } };
  let search = new URLSearchParams();
  const mount = mounts.mountTypedRoute(families, {
    address: { read: () => new URLSearchParams(search), write: next => { search = new URLSearchParams(next); }, subscribe: () => () => {} },
    fixture: null, target: { kind: "document", ref: { session: "b03-families", openId: "project" } },
    work: { address: address("C:/Models/B03-Families.rvt"), open: null }, custody: { current: () => true }, memory: () => ({}),
  }, workFingerprintSchema.parse(`builtin-closure:${"a".repeat(64)}`), {
    work: createFixtureWorkDoor(familiesRouteState, doc), sources: { "families.view": source },
  });
  function Journey() {
    useSyncExternalStore(mount.subscribe, mount.revision, mount.revision);
    return <KeyScopeHost id="b03-families"><TypedChrome mount={mount} document={<span>Families after Start</span>} /></KeyScopeHost>;
  }
  const root = createRootRoute({ component: Journey });
  const router = createRouter({ routeTree: root, history: createMemoryHistory({ initialEntries: ["/families"] }) });
  const view = render(<RouterProvider router={router} />);
  try {
    await screen.findByRole("button", { name: "Choose Air Terminal Tags" });
    await waitFor(() => expect(mount.work()).not.toBeNull());
    await waitFor(() => expect(mount.value().current).toBe(true));
    hold = true;
    await act(async () => mount.refresh());
    expect(mount.value(), "B03 Families: pending refresh retains named choices").toMatchObject({ status: "pending", current: false });
    const before = { work: mount.work(), page: mount.page.read(), url: search.toString() };
    const category = screen.getByRole("button", { name: "Choose Air Terminal Tags" });
    const member = screen.getByRole("button", { name: "Choose Air Terminal Tag" });
    expect.soft(category.getAttribute("aria-disabled"), "B03 Families: pending category is visibly disabled, not a swallowed choice").toBe("true");
    expect.soft(member.getAttribute("aria-disabled"), "B03 Families: the same refusal governs family choices").toBe("true");
    expect.soft(screen.queryByText("Family scope unavailable"), "B03 Families: scope refusal is visible before interaction").not.toBeNull();
    const group = screen.getByRole("group", { name: "Family scope" });
    expect.soft(group.textContent, "B03 Families: scope refusal names the pending Reading").toContain("Reading...");
    await act(async () => { fireEvent.click(category); fireEvent.click(member); });
    expect({ work: mount.work(), page: mount.page.read(), url: search.toString() }, "B03 Families: a refused choice commits nothing").toEqual(before);
    expect(familiesRouteState.schema.parse(mount.work()?.value).scope.edit, "B03 Families: no category was queued secretly").toBeUndefined();
    await act(async () => { release.resolve(); });
    await waitFor(() => expect(mount.value().current).toBe(true));
    expect(screen.getByRole("button", { name: "Choose Air Terminal Tags" }).getAttribute("aria-disabled"), "B03 Families: current basis re-enables scope choices").not.toBe("true");
    expect(familiesRouteState.schema.parse(mount.work()?.value).scope.edit).toBeUndefined();
  } finally { release.resolve(); view.unmount(); mount.dispose(); await Promise.all(tasks); }
}
test("JZ H01 H17 saved takeoff choice preserves authored Work and live Initialize while History captures", async () => {
  const j = await takeoffJourney();
  try {
    await j.ready();
    expect((await j.host.journal.list()).some(row => row.key === "work.start" && row.state === "succeeded"), "ordinary Start crossed the real /actions handler").toBe(true);
    const originalWork = j.mount.owner()!.handle;
    expect(originalWork).toBeTruthy();
    render(<TakeoffDrawing mount={j.mount} />);
    fireEvent.click(screen.getByRole("button", { name: "Choose views" }));
    fireEvent.click(await screen.findByRole("option", { name: "Zoning plan" }));
    await waitFor(() => expect(j.mount.value().current).toBe(true), {timeout:20000});
    await waitFor(() => expect(j.mount.owner()?.ready || j.mount.owner()?.absent).toBe(true));
    expect(j.mount.owner()!.handle, "H01: view choice cannot select another Work through serialized Page fields").toEqual(originalWork);
    await j.ready();
    const capture = adoptionData.parse(j.mount.value().value).captures[0]!;
    fireEvent.click(screen.getByRole("button", { name: "Choose capture" }));
    const option = (await screen.findAllByRole("option")).find(row => row.textContent?.includes(capture.capturedAt));
    expect(option, "choose this exact saved capture").toBeTruthy();
    fireEvent.click(option!);
    await waitFor(() => expect(j.mount.value().current).toBe(true), {timeout:20000});
    await waitFor(() => expect(j.mount.owner()?.ready || j.mount.owner()?.absent).toBe(true));
    expect(screen.getByText(/Archived takeoff/)).toBeTruthy();
    expect(j.mount.owner()!.handle, "H01: a saved-evidence id cannot select another Work").toEqual(originalWork);
    expect(j.host.inputs.source).toMatchObject({capturing:true});
    fireEvent.click(screen.getByRole("button", {name:"live"}));
    await j.ready();
    await screen.findByRole("checkbox", {name:"Select Office zone in Zoning plan"});
    expect(j.mount.owner()!.handle).toEqual(originalWork);
    expect((screen.getByRole("button", {name:"initialize"}) as HTMLButtonElement).disabled, "H17: live readiness uses the current document and its original Work").toBe(false);
    expect(j.mount.value().value.initialize.refusal).toBeNull();
    expect(j.host.inputs.source).toMatchObject({capturing:true});
    expect(j.host.inputs.lane.kind).toBe("live");
    if(j.host.inputs.lane.kind === "live")
      expect(j.host.inputs.lane.captureStore!.capture.truncated(), "zero capture stops").toBeNull();
  } finally { await j.close(); }
}, 60000);
// Only the conversation/reading boundaries are recorded. RouteDock, Activity, typed Family,
// Work feeds, file persistence and the Host view HTTP handler remain production owners.
const conversation = vi.hoisted(() => ({ value: null as unknown }));
vi.mock("../workbench/provider", () => ({ useWorkbench: () => conversation.value }));
vi.mock("../chat/chat-shell", () => ({ ChatShell: () => null }));

test("JZ B05 retain Family Work and its spec across folding, first-thread promotion and thread switches", async () => {
  const [{ createRoute }, { RegistryContext }, { appAtomRegistry }, { RouteDock },
    { createChatPageStore }, { module: family }, { publicRoutes }, { peClient },
    { createPeClient }, { peReadings }, { observeResources }, { createPeRoutes },
    { fileRouteDocumentStore }, { fixture, who }, { withInvocationContext },
    { bindWork, workKey, familyDraftSchema }, { rememberPlace },
    { readThreadWork }, { chatPluginTitle }] = await Promise.all([
      import("@tanstack/react-router"), import("@effect/atom-react"), import("../shell/owner"),
      import("../workbench/route-panes"), import("../workbench/store"), import("../family/route"),
      import("./route-discovery"), import("../host/pe-client"), import("@pe/agent-contracts/pe-api"),
      import("../host/resource-stream"), import("@pe/runtime"), import("../../../host/src/pe-routes"),
      import("../../../host/src/route-document-store"), import("../../../host/tests/host-read-graph.test-support"),
      import("@pe/runtime/context"), import("@pe/agent-contracts"),
      import("../../../host/src/thread-work-context"), import("../../../host/src/navigation"),
      import("../workbench/chat-plugins"),
    ]);
  const { join } = await import("node:path");
  // Import the shipped root, not builtin-routes: the root must actually bootstrap discovery.
  await import("../routes/__root");
  const host = await fixture();
  await host.send(0, []);
  const api = createPeRoutes({ workspace: host.workspace, registrations: [] });
  const key = bindWork("family", null);
  const member = { pod: "family-context-journey", path: "settings/family/silencer.json" };
  const doc = familyDraftSchema.parse({ reading: "captured-family", spec: { member, doc: {
    jobId: "retained-spec", fileName: "retained-spec.pdf", images: [],
    pages: [{ page: 1, width: 612, height: 792, screenshotUrl: null, markdown: "Retained specification" }],
    blocks: [{ id: "page-1-block-1", page: 1, kind: "text", md: "Retained specification", bboxes: [] }],
  } } });
  await fileRouteDocumentStore(join(host.dir, "work")).setState({ targetKey: workKey(key), route: "family",
    value: { version: 1, schemaVersion: 1, revision: 3, doc, history: [] } });
  const transport = createPeClient("", (input, init) => withInvocationContext({ caller: who }, () =>
    api.fetch(new Request(new URL(String(input), "http://host"), init))));
  vi.spyOn(peClient, "call").mockImplementation(transport.call);
  vi.spyOn(peReadings, "subscribe").mockImplementation(observeResources(host.workspace, { observe: () => () => {} }));
  // No native or provider turn is needed to address existing Work. Keep Value unavailable.
  vi.spyOn(await import("../shell/host-read-source"), "hostReadSource")
    .mockReturnValue({ kind: "use", open: () => () => {} });
  vi.spyOn(await import("../navigation/surface-host"), "useSurfaceHost").mockReturnValue({ surface: "web" } as never);
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  const threads = [{ id: "jz-family-first" }, { id: "jz-family-other" }];
  const store = createChatPageStore({ registry: appAtomRegistry, search: { mode: "threads", patch: async () => {} } });
  conversation.value = { store, threads };
  const { builtinRouteStamp } = await import("./builtin-inventory");
  const stamp = workFingerprintSchema.parse(`builtin-closure:${builtinRouteStamp("family")}`);
  const declaration = route({ ...family.spec, panes: { workspace: {
    ...family.spec.panes.workspace,
    draw: ctx => <output aria-label="Mounted Family Work">{ctx.cells.doc?.spec?.doc.fileName}</output>,
  } } });
  function Family() { return <TypedShell module={declaration} fingerprint={stamp} />; }
  const root = createRootRoute({ component: () => <RegistryContext.Provider value={appAtomRegistry}>
    <RouteDock renderRoute={body => body}>{null}</RouteDock>
  </RegistryContext.Provider> });
  const router = createRouter({ routeTree: root.addChildren([
    createRoute({ getParentRoute: () => root, path: "/family", component: Family }),
  ]), history: createMemoryHistory({ initialEntries: ["/family"] }) });
  const read = (thread: string) => withInvocationContext({ caller: { kind: "pea", context: `ctx-${thread}`, thread } },
    () => api.fetch(new Request(`http://host/pe/route-view/family?thread=${thread}`)));
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  try {
    await router.load();
    render(<RouterProvider router={router} />);
    await screen.findByText("retained-spec.pdf");
    const seam = screen.getByRole("separator", { name: "Resize pane" });
    for (let i = 0; i < 40 && !screen.queryByRole("button", { name: "Expand tools" }); i++)
      fireEvent.keyDown(seam, { key: "ArrowRight" });
    expect(screen.getByRole("button", { name: "Expand tools" }), "B05: the actual tools Activity is folded").toBeTruthy();
    expect(screen.getByLabelText("Pea context").textContent, "E8-11: folded tools still name Pea's bound Place").toContain("Family");
    await (await import("@testing-library/react")).act(() => store.actions.promoteThread(threads[0]!.id));
    expect(router.state.location.search.thread, "B05: first Send supplies the thread after the drawing folded").toBe(threads[0]!.id);
    await waitFor(async () => expect((await read(threads[0]!.id)).status,
      "B05: folding before promotion must not lose the selected Place").toBe(200));
    const first = await (await read(threads[0]!.id)).json();
    expect(first.context.work, "B05: mounted Work is host-bound, not the conversation document").toEqual(key);
    expect(first.work, "B05: Pea receives authoritative Work including its attached spec").toMatchObject({ revision: 3, doc });
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + 20_000);
    await (await import("@testing-library/react")).act(() => vi.advanceTimersByTimeAsync(5_000));
    expect((await read(threads[0]!.id)).status, "B05: a folded Place refreshes past the 15-second lease expiry").toBe(200);
    await (await import("@testing-library/react")).act(() => router.navigate({ to: "/family", search: { thread: threads[1]!.id } }));
    await waitFor(async () => expect((await read(threads[1]!.id)).status).toBe(200));
    expect((await read(threads[0]!.id)).status, "B05: switching conversation retires the previous association").toBe(409);
    await (await import("@testing-library/react")).act(() => router.navigate({ to: "/family", search: { thread: threads[0]!.id } }));
    await waitFor(async () => expect((await read(threads[0]!.id)).status).toBe(200));
    expect((await (await read(threads[0]!.id)).json()).work).toMatchObject({ revision: 3, doc });
    expect(publicRoutes.declaration("family"), "B05: the shipped root registers typed builtins").toMatchObject({ name: "Family" });
    const context = rememberPlace({ documents: [], works: [] }, "family", "/family");
    const snapshot = await readThreadWork(host.workspace, {
      threads: async () => [], documents: async () => [], contexts: () => [{ threadId: threads[0]!.id, context }],
    });
    expect(chatPluginTitle(snapshot.threads[0]!.place!), "B05: the row names its Place independently of unfinished Work").toBe("Family");
  } finally {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    sessionStorage.clear();
    await host.close();
    vi.unstubAllGlobals();
    conversation.value = null;
  }
}, 30_000);


test.each(["takeoffs", "families"] as const)("JZ kernel Start on %s after read release settles while Reading or after it", async (route) => {
  const { gate } = await import("../../../host/tests/host-read-graph.test-support");
  for (const phase of ["settled", "reading"] as const) {
    const catalogue = phase === "reading" ? gate() : undefined;
    const j = await takeoffJourney({ catalogue, start: false, ...(route === "families" ? { route } : {}) });
    function Journey() {
      useSyncExternalStore(j.mount.subscribe, j.mount.revision, j.mount.revision);
      return <KeyScopeHost id={`start-${route}`}><TypedChrome mount={j.mount} document={<span>Project document</span>} /></KeyScopeHost>;
    }
    const root = createRootRoute({ component: Journey });
    const router = createRouter({ routeTree: root, history: createMemoryHistory({ initialEntries: [`/${route}`] }) });
    render(<RouterProvider router={router} />);
    try {
      const start = await screen.findByRole("button", { name: "Start" });
      const retainedStart = j.mount.startAction()!;
      if (!catalogue) await waitFor(() => expect(j.mount.value().current).toBe(true), { timeout: 20000 });
      else expect(j.mount.value()).toMatchObject({ current: false, status: "pending" });
      // Resource release alone leaves the selected Place's Start authority intact.
      await act(async () => { j.mount.release(); });
      expect(j.mount.available()).toBe(true);
      fireEvent.click(start);
      catalogue?.release.resolve();
      await waitFor(() => expect(j.mount.owner()?.ready).toBe(true));
      await act(async () => { const stop = j.mount.subscribe(() => {}); stop(); });
      await j.ready();
      const receipts = (await j.host.journal.list()).filter(row => row.key === "work.start");
      expect(receipts).toHaveLength(1);
      expect(receipts[0]!.state).toBe("succeeded");
      expect(screen.queryByRole("button", { name: "Start" })).toBeNull();
      if (route === "takeoffs") expect(j.mount.value().value.initialize.refusal).toBeNull();
      else {
        const category = await screen.findByRole("button", { name: "Choose Air Terminal Tags" });
        expect(category.getAttribute("aria-disabled")).toBeNull();
        fireEvent.click(category);
        await j.ready();
        await waitFor(() => expect(j.mount.owner()?.doc.scope.edit?.value.categoryNames).toEqual(["Air Terminal Tags"]));
      }
      j.mount.dispose();
      await expect(retainedStart.run()).rejects.toThrow("Place is not writable");
      expect(retainedStart.failure).toBe("Place is not writable");
      expect((await j.host.journal.list()).filter(row => row.key === "work.start")).toHaveLength(1);
    } finally { await j.close(); }
  }
}, 60000);

test("JZ saved Takeoffs capture explains its empty snapshot and returns to live candidates", async () => {
  const j = await takeoffJourney();
  try {
    await j.ready();
    render(<TakeoffDrawing mount={j.mount} />);
    const capture = adoptionData.parse(j.mount.value().value).captures[0]!;
    fireEvent.click(screen.getByRole("button", { name: "Choose capture" }));
    const option = (await screen.findAllByRole("option")).find(row => row.textContent?.includes(capture.capturedAt));
    fireEvent.click(option!);
    await waitFor(() => expect(j.mount.value().current).toBe(true), { timeout: 20000 });
    expect(screen.getByText(/Archived takeoff/)).toBeTruthy();
    expect(screen.getByText("No adopted zones in this saved takeoff")).toBeTruthy();
    expect(screen.getByText(/This capture stores takeoff data, not a view image/)).toBeTruthy();
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.queryByRole("button", { name: "initialize" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "live" }));
    await j.ready();
    fireEvent.click(screen.getByRole("button", { name: "Choose views" }));
    fireEvent.click(await screen.findByRole("option", { name: "Zoning plan" }));
    await screen.findByRole("checkbox", { name: "Select Office zone in Zoning plan" });
  } finally { await j.close(); }
}, 60000);
test("JZ E8-12 close Home clears a capacity refusal and permits another Place", async () => {
  const [{ createRoute }, { RegistryContext }, { appAtomRegistry }, { RouteDock },
    { createChatPageStore }] = await Promise.all([
    import("@tanstack/react-router"), import("@effect/atom-react"), import("../shell/owner"),
    import("../workbench/route-panes"), import("../workbench/store"),
  ]);
  await import("../routes/__root");
  vi.spyOn(await import("../navigation/surface-host"), "useSurfaceHost").mockReturnValue({ surface: "web" } as never);
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  sessionStorage.setItem("pe.places", JSON.stringify(Array.from({ length: 12 }, (_, i) => ({
    id: `aaaaaaaa-0000-4000-8000-${String(i).padStart(12, "0")}`, route: "home", link: "/", at: new Date().toISOString(),
  }))));
  const store = createChatPageStore({ registry: appAtomRegistry, search: { mode: "threads", patch: async () => {} } });
  conversation.value = { store, threads: [] };
  const module = route({ ...family.spec, key: "home", address: "/", name: "Home", needs: "browser", core: undefined,
    subject: undefined, reads: {}, edits: undefined, commands: {}, fields: {},
    panes: { main: { title: "Home", purpose: "Place capacity", draw: () => <p>Home body</p> } }, layout: { kind: "pane", id: "main" } });
  const root = createRootRoute({ component: () => <RegistryContext.Provider value={appAtomRegistry}>
    <RouteDock renderRoute={body => body}>{null}</RouteDock>
  </RegistryContext.Provider> });
  const router = createRouter({ routeTree: root.addChildren([createRoute({ getParentRoute: () => root, path: "/",
    component: () => <TypedShell module={module} fingerprint={workFingerprintSchema.parse(`builtin-closure:${"a".repeat(64)}`)} /> })]),
    history: createMemoryHistory({ initialEntries: ["/"] }) });
  try {
    await router.load();
    render(<RouterProvider router={router} />);
    await screen.findByText("Home body");
    fireEvent.click(screen.getByRole("button", { name: "Open another Place on this route" }));
    await screen.findByText("This window keeps 12 Places; close one first.");
    fireEvent.click(screen.getAllByRole("button", { name: "Close Home" })[11]!);
    await waitFor(() => expect(JSON.parse(sessionStorage.getItem("pe.places")!)).toHaveLength(11));
    expect(screen.queryByText("This window keeps 12 Places; close one first.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open another Place on this route" }));
    await waitFor(() => expect(JSON.parse(sessionStorage.getItem("pe.places")!)).toHaveLength(12));
  } finally { cleanup(); sessionStorage.clear(); vi.unstubAllGlobals(); conversation.value = null; }
});

test("JZ E8-03 a typed Fans refused Plan explains the atomic Apply hold at the action area", async () => {
  const capture = structuredClone(realMuas) as unknown as DuctSnapshot;
  Object.assign(capture.nodes.find(node => node.id === 14577391)!, { flowParameter: null });
  capture.slots = { ...capture.slots!, fanFlow: "PE_M_Fan_AirFlowDesign" };
  // Controlled native-input twins exercise label disambiguation; this is not a native-model claim.
  const damper = capture.nodes.find(node => node.id === 14607308)!;
  Object.assign(damper, { partType: "Damper" });
  capture.nodes.push({ ...structuredClone(damper), id: 99999991, uniqueId: "fixture-other-damper", levelId: 30, connectors: [] });
  const f = await createWitness(closes, new Map(), { "ducts.sheet-snapshot": {
    kind: "use", open(_ctx, deliver) { deliver({ kind: "complete", value: capture, revision: 1 }); },
  } });
  await vi.waitFor(() => expect(f.fans.work()).not.toBeNull());
  const key = f.fans.workBasis()!.token.scope.identity.work!;
  await f.ws.apply(key, "fans", "human", [
    { path: ["writeIntent"], value: { edit: { value: { walk: { unitId: 14577391, portIndex: 2 } } } } },
    { path: ["equipmentFlows", "14577391", "edit"], value: { value: { cfm: 925, source: "test" } } },
  ], f.fans.work()!.revision);
  f.fans.refresh("value");
  await vi.waitFor(() => expect(f.typed.value().current).toBe(true));
  const reason = "MUAS-1: missing PE_M_Fan_AirFlowDesign; add the missing parameter";
  native.submit.mockImplementation(async () => ({ id: "atomic-hold", state: "succeeded", result: {
    previewOnly: true, planRefusal: reason,
    seal: { caller: { kind: "human", via: "local" }, requestHash: "atomic-hold", work: { handle: (f.inputs.get("fans:ducts.plan-losses") as { work: unknown }).work },
      documentMark: { session: "fixture", openId: "fans", observedSince: null, changedAt: null },
      incarnation: null, dependencies: "exact" },
    value: { writes: [
      { id: 14577391, kind: "equipment-flow", outcome: "refused", before: null, reason },
      { id: 14607308, kind: "component", outcome: "planned", parameter: "Specific Loss", before: "unset", after: "0.0398 in-wg" },
      { kind: "store", outcome: "planned", before: "absent", after: "revision 1" },
    ], counts: { refused: 1, planned: 2, written: 0, unchanged: 0 } },
  } }));
  function Write() {
    const [, changed] = useReducer(n => n + 1, 0);
    useEffect(() => f.fans.subscribe(changed), []);
    return <TypedWrite mount={f.typed} id="losses" />;
  }
  render(<Write />);
  fireEvent.click(screen.getByRole("button", { name: "plan Write to Revit" }));
  await screen.findByRole("button", { name: /Write to Revit.*planned/ });
  const trigger = screen.getByRole("button", { name: /Write to Revit.*planned/ });
  if (trigger.getAttribute("aria-expanded") !== "true") fireEvent.click(trigger);
  expect(screen.queryByRole("button", { name: "Write to Revit" })).toBeNull();
  const explanation = screen.getByRole("status");
  expect(explanation.textContent).toBe(`Apply is held: ${reason}`);
  expect(explanation.parentElement?.textContent).toContain("Esc");
  expect(screen.getByText("Computed losses written back")).toBeTruthy();
  expect(screen.getByText("Pe loss record")).toBeTruthy();
  expect(document.body.textContent).toContain("unset");
  expect(document.body.textContent).toContain("14607308");
  expect(document.body.textContent).toMatch(/damper/i);
  expect(document.body.textContent).toContain("Level 2/Upper Level");
  cleanup();
  // The recorded adapter has no unit rows; prepare the native input model before rendering.
  const nativeInputs = inputsFor(capture);
  const attempted = vi.fn();
  function MissingFlow({ ctx }: { ctx: any }) {
    const data = ctx.value.value;
    if (!data.open) throw Error("The native Fan must be open");
    const rows = inputRows({ snapshot: data.sheetSnapshot, doc: null, fanUnitId: 14577391, inputs: nativeInputs });
    const control = rows.find(row => row.key === "unit:14577391:cfm")!.control;
    if (control.kind !== "number") throw Error("Fan airflow must have a number control");
    return <SheetCell label="MUAS-1 airflow" value={control.value} unit={{ label: "cfm" }} digits={0} source="none"
      refusal={control.refusal ?? null} onValue={value => { attempted(value); return ctx.cells.at(["equipmentFlows", "14577391"]).stage({ cfm: value, source: "Work" }, { label: "MUAS airflow" }); }} />;
  }
  render(f.typed.draw("sheet-inputs", ctx => <MissingFlow ctx={ctx} />) as React.ReactElement);
  expect(document.querySelector('[data-body="locked"]'), "The missing native parameter locks the actual typed cell before Plan").not.toBeNull();
  expect(document.body.innerHTML).toContain("PE_M_Fan_AirFlowDesign");
  expect(attempted).not.toHaveBeenCalled();

});

// The declared roster is the route's sole subject-choice surface, even on another pane.
test.each(["Fans", "Ducts"] as const)("JZ C042 %s subject-list declaration suppresses the header chooser across panes", async name => {
  const { useAdmittedSubject } = await import("../shell/subject");
  const read = fans.spec.core!;
  const declared = name === "Fans" ? fans.spec.panes["sheet-roster"] : ducts.spec.panes["e-systems"];
  function Roster({ ctx }: { ctx: any }) {
    const subject = useAdmittedSubject()!;
    const first = fans.spec.subject!.options(ctx.value.value)[0]!;
    return <section aria-label="Fan subject list"><button onClick={() => subject.add([first.id])}>{first.label}</button></section>;
  }
  for (const pane of ["detail", "roster"] as const) {
    const module = route({ ...fans.spec, needs: "browser", edits: undefined, commands: {}, reads: {},
      subject: { ...fans.spec.subject!, pane: "roster", read },
      panes: {
        roster: { subjectList: declared.subjectList, title: "Fan list", purpose: "Choose the subject", read: { ...read }, draw: ctx => <Roster ctx={ctx} /> },
        detail: { title: "Detail", purpose: "Inspect the subject", read: { ...read }, draw: () => <p>Subject detail</p> },
      }, layout: { kind: "pane", id: pane } });
    const mount = mounts.mountTypedRoute(module, {
      target: { kind: "host" }, fixture: "layout", work: { address: null, open: null },
      address: { read: () => new URLSearchParams(), write() {}, subscribe: () => () => {} },
      custody: { current: () => true }, memory: () => ({}),
    }, workFingerprintSchema.parse(`builtin-closure:${"a".repeat(64)}`));
    const router = createRouter({ routeTree: createRootRoute({ component: () => <TypedChrome mount={mount} document={<span>Recorded Fans</span>} /> }),
      history: createMemoryHistory({ initialEntries: ["/"] }) });
    const view = render(<RouterProvider router={router} />);
    try {
      if (pane === "detail") await screen.findByText("Subject detail");
      else await screen.findByRole("region", { name: "Fan subject list" });
      expect(screen.queryByRole("button", { name: "Choose fan" }), "One subject capability has one choice path").toBeNull();
      if (pane === "roster") {
        const first = fans.spec.subject!.options(mount.value().value)[0]!;
        fireEvent.click(screen.getByRole("button", { name: first.label }));
        expect(mount.page.read().fan).toEqual({ kind: "ids", ids: [first.id] });
      }
    } finally { view.unmount(); mount.dispose(); cleanup(); }
  }
});

test("JZ audit named subject choices preserve all none add and toggle without raw ids", async () => {
  const { fixture, ref, path: documentPath } = await import("../../../host/tests/host-read-graph.test-support");
  const { localId } = await import("./typed-route");
  const { typedSubjectDoor } = await import("../shell/subject");
  const host = await fixture(true), tasks = new Set<Promise<unknown>>();
  const roster = fans.spec.subject!.read!;
  const module = route({ ...fans.spec, core: roster, edits: undefined, commands: {},
    subject: { ...fans.spec.subject!, pane: "detail" },
    panes: { detail: { title: "Subject choices", purpose: "Choose named subjects", draw: () => <p>Subject choice surface</p> } },
    layout: { kind: "pane", id: "detail" } });
  let seq = 0, search = new URLSearchParams(), moves = 0;
  const unknown = localId("ducts-fan", "unknown-roster-audit@0");
  const source: UseSource = { kind: "use", open(ctx, deliver) {
    const generation = ++seq;
    const task = host.send(generation, [], undefined, `subject-${generation}`).then(value => {
      if (!ctx.signal.aborted) deliver({ kind: "complete", value, revision: generation });
    });
    tasks.add(task); void task.finally(() => tasks.delete(task)); return () => {};
  } };
  const mount = mounts.mountTypedRoute(module, {
    target: { kind: "document", ref }, fixture: null, work: { address: documentPath, open: ref },
    memory: () => ({ fan: { kind: "ids", ids: [unknown] } }), custody: { current: () => true },
    address: { read: () => new URLSearchParams(search), write(next) { search = next; moves++; }, subscribe: () => () => {} },
  }, workFingerprintSchema.parse(`builtin-closure:${"a".repeat(64)}`), { sources: { "fans.sheet": source } });
  const router = createRouter({ routeTree: createRootRoute({ component: () => <TypedChrome mount={mount} document={<span>Recorded subjects</span>} /> }), history: createMemoryHistory({ initialEntries: ["/"] }) });
  let view: ReturnType<typeof render> | undefined;
  try {
    await Promise.allSettled([...tasks]);
    view = render(<RouterProvider router={router} />);
    await screen.findByRole("button", { name: "Choose fan" });
    expect(document.body.textContent).not.toContain(unknown);
    expect(screen.getByText(/outside the current roster/)).toBeTruthy();
    const options = module.spec.subject!.options(mount.value(roster).value);
    expect(options.length).toBeGreaterThan(1);
    fireEvent.click(screen.getByRole("button", { name: "No fan" }));
    expect(mount.page.read().fan).toEqual({ kind: "ids", ids: [] }); expect(moves).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: "All fan" }));
    expect(mount.page.read().fan).toEqual({ kind: "all" }); expect(moves).toBe(2);
    const door = typedSubjectDoor(mount)!;
    act(() => door.add([options[0]!.id]));
    expect(mount.page.read().fan).toEqual({ kind: "all" }); expect(moves).toBe(2);
    act(() => door.clear()); expect(moves).toBe(3);
    act(() => door.add([options[0]!.id]));
    act(() => door.add([options[0]!.id, options[1]!.id]));
    expect(mount.page.read().fan).toEqual({ kind: "ids", ids: [options[0]!.id, options[1]!.id] });
    act(() => door.toggle(options[0]!.id));
    expect(mount.page.read().fan).toEqual({ kind: "ids", ids: [options[1]!.id] });
    expect(document.body.textContent).toContain(options[1]!.label);
    expect(document.body.textContent).not.toContain(String(options[1]!.id));
    expect(seq, "Subject selection does not enumerate subjects into extra roster reads").toBe(1);
  } finally { view?.unmount(); mount.dispose(); await Promise.allSettled(tasks); await host.close(); cleanup(); }
}, 60_000);

test("JZ audit optional document pins retain exact source authority and retire replaced custody", async () => {
  const resources = await import("../host/resource-state");
  const Atom = await import("effect/reactivity/Atom");
  const { machineFixture } = await import("../../../../packages/agent-contracts/tests/machine-fixture");
  const observed = { state: "ready", observation: { sessions: [{ connected: true, sessionId: "bridge-one", processId: 1,
    sdkSessionId: "audit", openDocumentCount: 2, openDocuments: [
      { openId: "project-one", title: "Project A", isFamilyDocument: false },
      { openId: "family-one", title: "Family A", isFamilyDocument: true },
    ] }] } };
  const inventory = Atom.make(observed), machine = Atom.make({ state: "ready", observation: machineFixture() });
  const atoms = vi.spyOn(resources, "readingAtom").mockImplementation(((request: { kind: string }) => request.kind === "inventory" ? inventory : machine) as typeof resources.readingAtom);
  const created: mounts.TypedMount[] = [];
  const original = mounts.mountTypedRoute;
  const factory = vi.spyOn(mounts, "mountTypedRoute").mockImplementation((...args) => { const m = original(...args); created.push(m); return m; });
  const module = route({ ...family.spec, needs: "host", optionalTarget: "document", edits: undefined, core: undefined, reads: {}, commands: {}, fields: {},
    panes: { main: { title: "Optional document", purpose: "Inspect exact document authority", draw: ctx => <p>{ctx.target?.kind === "document" ? `Pinned ${ctx.target.ref.session}/${ctx.target.ref.openId}` : ctx.target?.kind === "host" ? "Host browsing" : "No authority"}</p> } }, layout: { kind: "pane", id: "main" } });
  let search = new URLSearchParams();
  const listeners = new Set<() => void>();
  const address = { read: () => new URLSearchParams(search), write(next: URLSearchParams) { search = next; listeners.forEach(f => f()); }, subscribe(f: () => void) { listeners.add(f); return () => { listeners.delete(f); }; } };
  const router = createRouter({ routeTree: createRootRoute({ component: () => <TypedShell module={module} fingerprint={workFingerprintSchema.parse(`builtin-closure:${"a".repeat(64)}`)} address={address} /> }), history: createMemoryHistory({ initialEntries: ["/"] }) });
  const view = render(<RouterProvider router={router} />);
  const pin = (ref: { session: string; openId: string }) => new URLSearchParams({ target: JSON.stringify({ kind: "open", ref }) });
  try {
    await screen.findByText("Host browsing");
    await act(async () => address.write(pin({ session: "bridge-one", openId: "project-one" })));
    await screen.findByText("Pinned bridge-one/project-one");
    const first = created.at(-1)!;
    expect(first.target()).toEqual({ kind: "document", ref: { session: "bridge-one", openId: "project-one" } });
    await act(async () => address.write(pin({ session: "bridge-one", openId: "family-one" })));
    await screen.findByText("Pinned bridge-one/family-one");
    expect(first.available(), "Old exact source custody is retired").toBe(false);
    expect(first.target()).toEqual({ kind: "document", ref: { session: "bridge-one", openId: "project-one" } });
    for (const params of [pin({ session: "bridge-one", openId: "closed" }), pin({ session: "foreign", openId: "project-one" }), new URLSearchParams({ target: "{invalid" })]) {
      await act(async () => address.write(params));
      expect(screen.queryByText("Host browsing"), "An invalid pin never becomes host authority").toBeNull();
      expect(screen.queryByText("Pinned bridge-one/family-one")).toBeNull();
    }
    await act(async () => address.write(new URLSearchParams()));
    await screen.findByText("Host browsing");
  } finally { view.unmount(); created.forEach(m => m.dispose()); factory.mockRestore(); atoms.mockRestore(); cleanup(); }
});

test("JZ audit Schedules keyed edits preserve a sibling stale mark and narrow inverse restoration", async () => {
  const host = await scheduleHost();
  const detail = detailResponse(), first = detail.entries[0]!.rows[0]!;
  const second = structuredClone(first); second.rowNumber = 2; second.subjectIds = [8];
  second.bindings[0]!.targetElementIds = [8]; second.bindings[0]!.targets[0]!.elementId = 8;
  detail.entries[0]!.rows.push(second); host.setDetail(detail);
  await host.bind(await host.read());
  expect(await host.patch([1, 2].map(row => ({ path: ["cells", `${row}::2`, "edit"], value: { value: `${row * 150} VA` } })))).toMatchObject({ ok: true });
  const changed = structuredClone(detail);
  for (const row of changed.entries[0]!.rows) { row.values[1] = "999 VA"; row.bindings[0]!.rawValue = "999"; row.bindings[0]!.displayValue = "999 VA"; row.bindings[0]!.targets[0]!.rawValue = "999"; }
  host.setDetail(changed); await host.bind(await host.read());
  const client = createPeClient(host.base, contextFetch);
  let last: any;
  const native = createWorkFeedClient({ subscribe: () => () => {}, dirty() {} }, {
    write: async (key, body) => { const response = await client.response("work.apply", { ...routeInput(key.route, key), body }); const wire = await response.json(); last = response.ok ? wire : wire.error.details; return last; },
    submit: async () => { throw Error("This Work journey does not submit native commands"); },
  });
  const work: WorkJournalDoor = { ...native, open: () => ({ subscribe(deliver) {
    let closed = false;
    void host.view().then(state => { if (!closed) deliver({ kind: "ready", history: { from: 0, acks: [] }, snapshot: { handle: { key: host.scope, revision: state.revision }, revision: state.revision, value: state.doc } }); });
    return () => { closed = true; };
  } }) };
  // Keep the real schemas while bounding TypeScript's recursive JSON-schema expansion.
  const spec = (schedules as TypedRoute).spec;
  const module = route({ key: "schedules", name: "Schedule cells", directory: spec.directory, fields: {},
    edits: { ...spec.edits!, value: undefined, seed: undefined, key: () => host.scope.work },
    panes: { main: { title: "Schedule cells", purpose: "Review stale cells", draw: () => null } }, layout: { kind: "pane", id: "main" } });
  const mount = mounts.mountTypedRoute(module, { target: { kind: "document", ref: host.b }, fixture: null,
    work: { address: null, open: host.b }, address: { read: () => new URLSearchParams(), write() {}, subscribe: () => () => {} },
    custody: { current: () => true }, memory: () => ({}),
  }, workFingerprintSchema.parse(`builtin-closure:${"a".repeat(64)}`), { work });
  const cells = () => mount.draw("main", ctx => ctx.cells) as any;
  try {
    await vi.waitFor(() => expect(mount.owner()?.ready).toBe(true));
    expect(mount.owner()!.doc.basis.stale.map((row: { key: string }) => row.key).sort()).toEqual(["1::2", "2::2"]);
    const revision = mount.owner()!.handle!.revision;
    expect(await cells().at(["cells", "1::2"]).stage("175 VA", { label: "Review first stale cell" })).toBeNull();
    expect(mount.owner()!.handle!.revision).toBe(revision + 1);
    expect(mount.owner()!.doc.basis.stale.map((row: { key: string }) => row.key)).toEqual(["2::2"]);
    const reviewed = structuredClone(mount.owner()!.doc);
    const stale = await client.call("work.apply", { ...routeInput("schedules", host.scope), body: { kind: "apply", expectedRevision: revision, press: crypto.randomUUID(), patches: [{ path: ["cells", "2::2", "edit"], value: { value: "old" } }] } });
    expect(stale).toMatchObject({ ok: false, code: "stale_revision" });
    expect(await cells().at(["cells", "1::2"]).delete({ label: "Delete first cell" })).toBeNull();
    expect(last.write.inverse.filter((p: { path: string[] }) => p.path[0] === "cells").map((p: { path: string[] }) => p.path)).toEqual([["cells", "1::2"]]);
    expect(await mount.history.undo()).toMatchObject({ ok: true });
    expect(mount.owner()!.doc).toEqual(reviewed);
    expect(await cells().patch([{ path: ["cells"], value: reviewed.cells }], { label: "Replace collection deliberately" })).toBeNull();
    expect(mount.owner()!.doc.basis.stale ?? []).toEqual([]);
  } finally { mount.journal().intents.forEach(intent => mount.discardIntent(intent.id)); mount.dispose(); }
}, 60_000);


test("JZ Plan refusal marker holds a valid sealed ancillary-only review at the typed action", async () => {
  const f = await createWitness(closes, new Map(), { "ducts.sheet-snapshot": {
    kind: "use", open(_ctx, deliver) { deliver({ kind: "complete", value: structuredClone(realMuas), revision: 1 }); },
  } });
  await vi.waitFor(() => expect(f.fans.work()).not.toBeNull());
  await f.ws.apply(f.fans.workBasis()!.token.scope.identity.work!, "fans", "human", [
    { path: ["writeIntent"], value: { edit: { value: { walk: { unitId: 14577391, portIndex: 2 } } } } },
    { path: ["equipmentFlows", "14577391", "edit"], value: { value: { cfm: 925, source: "test" } } },
  ], f.fans.work()!.revision);
  f.fans.refresh("value"); await vi.waitFor(() => expect(f.typed.value().current).toBe(true));
  const reason = "MUAS-1: required airflow parameter is missing; add the missing parameter";
  native.submit.mockClear();
  native.submit.mockImplementation(async () => ({ id: "marker-only-plan", state: "succeeded", result: {
    previewOnly: true, planRefusal: reason,
    seal: { caller: { kind: "human", via: "local" }, requestHash: "marker-only-plan",
      work: { handle: (f.inputs.get("fans:ducts.plan-losses") as { work: unknown }).work },
      documentMark: { session: "fixture", openId: "fans", observedSince: null, changedAt: null }, incarnation: null, dependencies: "exact" },
    // No refused native row can accidentally supply the shell's refusal. Only the Plan marker holds Apply.
    value: { writes: [{ kind: "store", outcome: "planned", before: "absent", after: "revision 1" }],
      counts: { refused: 0, planned: 1, written: 0, unchanged: 0 } },
  } }));
  function Write() {
    const [, changed] = useReducer(n => n + 1, 0);
    useEffect(() => f.fans.subscribe(changed), []);
    return <TypedWrite mount={f.typed} id="losses" />;
  }
  render(<Write />);
  fireEvent.click(screen.getByRole("button", { name: "plan Write to Revit" }));
  const trigger = await screen.findByRole("button", { name: /Write to Revit.*planned/ });
  if (trigger.getAttribute("aria-expanded") !== "true") fireEvent.click(trigger);
  const apply = screen.getByRole("button", { name: "Write to Revit" });
  expect.soft(screen.queryByRole("status")?.textContent).toBe(`Apply is held: ${reason}`);
  expect.soft(apply.getAttribute("aria-disabled")).toBe("true");
  expect(document.body.textContent).toContain("Pe loss record");
  expect(native.submit).toHaveBeenCalledTimes(1);
  await act(async () => { fireEvent.click(apply); });
  expect(native.submit, "A valid seal and ancillary planned write cannot authorize a refused Plan").toHaveBeenCalledTimes(1);
});
