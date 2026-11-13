// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vite-plus/test";
import { actionReceiptSchema, address, workHandle, workTimelineSchema, type WorkKey } from "@pe/agent-contracts";
import { createPeClient } from "@pe/agent-contracts/pe-api";
import { withInvocationContext } from "@pe/runtime/context";
import { findingsWork, findingsWorkSchema } from "@pe/agent-contracts/slots";
import { RouteWorkspace } from "@pe/runtime";
import { fixtureNative } from "../../../../../host/tests/fixture-native";
import { approvedPea, human } from "../../../../../host/tests/callers";
import { createPeRoutes } from "../../../../../host/src/pe-routes";
import { graphRoute } from "../../../../../host/src/reads/routes";
import { inputPort } from "../../../../../host/src/reads/inputs";
import { hostTimeline } from "../../../../../host/src/reads/work-timeline";
import { TimelineButtons } from "../../../shell/situation-band";
import { createTimelineClient, type TimelineClient } from "../../../shell/work-feed-client";
import { GraphHistory } from "../../../shell/graph-history";
import { observeWorkReceipts } from "../../../../../host/src/work-receipt-feed";
import { createWitness } from "../../../fans/cutover.test-support";
import { Notes } from "./notes.tsx";
import { subjectCode } from "@pe/agent-contracts/subject-ref";
import { workReadings } from "./readings.test-support";

afterEach(cleanup);

/*
 * The person's half of MAP row 9: the shell's notes surface runs its kernel verb
 * through the typed mount, which submits `findings.say` to a real host action journal
 * as the person. Only the native process is a fixture; the journal, registry and Work are real.
 */
test("a person writes a finding from the /fans roster row; the host's findings.say stamps the author person", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pe-findings-person-"));
  const native = await fixtureNative(join(dir, "native"));
  const socket = await native.connect();
  let saved: unknown = null;
  const host = new RouteWorkspace({
    registrations: [{ spec: findingsWork }],
    store: { getState: async () => structuredClone(saved), setState: async ({ value }) => void (saved = structuredClone(value)) },
  });
  const post = native.actions({ workspace: host });
  const submitted: { key: string; input: { work?: { key: WorkKey } } }[] = [];
  const closes: (() => void)[] = [];
  try {
    const f = await createWitness(closes, new Map(), {}, { address: address("C:/model.rvt"), open: socket.target }, undefined,
      async (command) => {
        submitted.push(command as never);
        const response = await post(command, human);
        expect(response.status, await response.clone().text()).toBeLessThan(400);
        return actionReceiptSchema.parse(await native.journal.wait(command.id));
      });
    await waitFor(() => expect(f.typed.owner()?.ready).toBe(true));
    render(<Notes mount={f.typed} />);
    fireEvent(document, new CustomEvent("pe:findings", { detail: { route: "fans", code: subjectCode({ keyKind: "name", key: ["Fan", "Type"] }) } }));
    const pop = await screen.findByRole("dialog");
    fireEvent.click(within(pop).getByRole("button", { name: "check" }));
    const write = within(pop).getByRole("button", { name: "Write finding" });
    // A refused verb says why without a hover (gate-1ebf1fb1: disabled Undo buttons gave no reason).
    expect(write.getAttribute("aria-disabled")).toBe("true");
    expect(write.getAttribute("aria-description")).toBe("Write what you found");
    // With text written the check may be said unruled: a verdict is optional and may come later (findings.rule).
    fireEvent.change(within(pop).getByLabelText("finding text"), { target: { value: "port 1 static reads low" } });
    expect(write.getAttribute("aria-description")).toBeNull();
    fireEvent.click(within(pop).getByRole("button", { name: "fail" }));
    fireEvent.click(write);
    await waitFor(() => expect(submitted.map((c) => c.key)).toEqual(["findings.say"]), { timeout: 20_000 });
    const key = { ...submitted[0]!.input.work!.key, route: "findings" } as WorkKey;
    await waitFor(async () => {
      const { findings } = findingsWorkSchema.parse((await host.view(key, "findings"))?.doc ?? {});
      expect(Object.values(findings)).toEqual([
        expect.objectContaining({ said: expect.objectContaining({ by: "person" }), kind: "check", verdict: expect.objectContaining({ by: "person", value: "fail" }),
          text: "port 1 static reads low", subject: expect.stringMatching(/^name:/) }),
      ]);
    }, { timeout: 20_000 });
  } finally {
    closes.reverse().forEach((close) => close());
    await native.close();
    await rm(dir, { recursive: true, force: true });
  }
}, 60_000);

/*
 * gate-1ebf1fb1 FALSIFIED: after the person wrote, both Undo buttons on /fans were disabled (they undo
 * Fans Work) and the History entry offered no undo. The person's latest finding's History row now
 * carries "Undo finding", which goes to the findings Work's history door as the person.
 */
test("the person undoes their own finding through the host Timeline; Pea's newer finding stays", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pe-findings-undo-"));
  const native = await fixtureNative(join(dir, "native"));
  const socket = await native.connect();
  let saved: unknown = null;
  const host = new RouteWorkspace({
    registrations: [{ spec: findingsWork }],
    store: { getState: async () => structuredClone(saved), setState: async ({ value }) => void (saved = structuredClone(value)) },
  });
  const post = native.actions({ workspace: host });
  // The host's read door, answering `work.timeline` from the real host Timeline for the person.
  const timeline = inputPort({ source: {} as never, workspace: host, marks: {} as never, run: (async () => undefined) as never,
    evaluation: "findings-undo", origin: () => null, revision: () => 0, timeline: hostTimeline(host, native.journal) });
  const routes = createPeRoutes({ workspace: host, journal: native.journal, registrations: [{ spec: findingsWork }],
    readGraph: async (request) => (request as { release?: boolean }).release ? {}
      : { value: { data: await graphRoute("reads.value", request, undefined, "human").evaluate(timeline) } } });
  // The browser's Pe client, answered by the host's own route door as the person.
  const browser = createPeClient("http://host", (url, init) =>
    withInvocationContext({ caller: human }, () => routes.fetch(new Request(url, init))));
  const client: TimelineClient = {
    step: createTimelineClient(browser).step,
    open(works, deliver) {
      let closed = false, generation = 0;
      const refresh = async () => {
        const turn = ++generation;
        deliver(null, "Refreshing Timeline");
        const answer = await graphRoute("reads.value", { read: "work.timeline", args: { works }, subscription: "finding-timeline", generation: 0 }, undefined, "human").evaluate(timeline);
        if (!closed && turn === generation) deliver(workTimelineSchema.parse(answer));
      };
      const work = host.subscribeUncaptured(() => { void refresh(); });
      const receipts = native.journal.subscribe({ kinds: ["action"] }, () => { void refresh(); });
      void refresh(); return () => { closed = true; work(); receipts(); };
    },
  };
  const submitted: { key: string; input: { work?: { key: WorkKey } } }[] = [];
  const closes: (() => void)[] = [];
  try {
    // The Timeline's receipts: the host's own feed over its action journal, as the browser reads it.
    const receipts = (scope: Parameters<typeof observeWorkReceipts>[1]) =>
      ({ subscribe: (deliver: (state: never) => void) => observeWorkReceipts(native.journal as never, scope, deliver as never) });
    const f = await createWitness(closes, new Map(), {}, { address: address("C:/model.rvt"), open: socket.target }, receipts as never,
      async (command) => {
        submitted.push(command as never);
        const response = await post(command, human);
        expect(response.status, await response.clone().text()).toBeLessThan(400);
        return actionReceiptSchema.parse(await native.journal.wait(command.id));
      }, browser, workReadings(host), client);
    await waitFor(() => expect(f.typed.owner()?.ready).toBe(true));
    render(<Notes mount={f.typed} />);
    fireEvent(document, new CustomEvent("pe:findings", { detail: { route: "fans", code: subjectCode({ keyKind: "name", key: ["Fan", "Type"] }) } }));
    const pop = await screen.findByRole("dialog");
    fireEvent.change(within(pop).getByLabelText("finding text"), { target: { value: "person note" } });
    fireEvent.click(within(pop).getByRole("button", { name: "Write finding" }));
    await waitFor(() => expect(submitted.map((c) => c.key)).toEqual(["findings.say"]), { timeout: 20_000 });
    const key = { ...submitted[0]!.input.work!.key, route: "findings" } as WorkKey;
    const findings = async () => Object.values(findingsWorkSchema.parse((await host.view(key, "findings"))?.doc ?? {}).findings);
    const authors = async () => (await findings()).map((x) => [x.text, x.said.by]);
    await waitFor(async () => expect(await authors()).toEqual([["person note", "person"]]), { timeout: 20_000 });
    // Pea writes after the person, through the findings Work handle.
    const pea = await post({ id: "pea-write", key: "findings.say", target: { kind: "document", ref: socket.target },
      input: { work: workHandle(key, (await host.view(key, "findings"))!.revision),
        subject: (await findings())[0]!.subject, kind: "note", text: "pea note" } },
      approvedPea("findings-undo"));
    expect(pea.status, await pea.clone().text()).toBeLessThan(400);
    expect(await native.journal.wait("pea-write")).toMatchObject({ state: "succeeded" });
    await waitFor(async () => expect(await authors()).toEqual([["person note", "person"], ["pea note", "pea"]]));
    await waitFor(() => expect(f.typed.timeline()?.undo).toBeTruthy());
    const label = f.typed.timeline()!.undo!.label;
    render(<><TimelineButtons owner={f.typed} /><GraphHistory owner={f.typed} /></>);
    fireEvent.click(await screen.findByRole("button", { name: `Undo ${label}` }));
    await waitFor(async () => expect(await authors()).toEqual([["pea note", "pea"]]), { timeout: 20_000 });
    await waitFor(() => expect(f.typed.timeline()?.rows.some(row => row.kind === "restore")).toBe(true));
    await waitFor(() => expect(screen.getByRole("button", { name: "Undo" }).getAttribute("aria-disabled")).toBe("true"));
    expect(await f.typed.stepTimeline("undo")).toMatchObject({ message: expect.any(String) });
    expect(await authors()).toEqual([["pea note", "pea"]]);
  } finally {
    closes.reverse().forEach((close) => close());
    await native.close();
    await rm(dir, { recursive: true, force: true });
  }
}, 90_000);

/*
 * gate-ef940d36 FALSIFIED: on /fans before Start, Write was enabled with no reason; the press reached
 * no host and said nothing. The row verb now refuses with the Work's own reason, as the cells do.
 */
test("before the Work is started, the row's Write is refused with the Work's reason and no press reaches the host", async () => {
  const submitted: unknown[] = [];
  const closes: (() => void)[] = [];
  try {
    // No Fans Work in the store: the route reads it absent, as before Start.
    const f = await createWitness(closes, new Map<string, unknown>([["fans", undefined]]), {}, undefined, undefined,
      async (command) => { submitted.push(command); throw Error("no host call expected"); });
    await waitFor(() => expect(f.typed.owner()?.problem).toBe("Start this Work to edit"));
    render(<Notes mount={f.typed} />);
    fireEvent(document, new CustomEvent("pe:findings", { detail: { route: "fans", code: subjectCode({ keyKind: "name", key: ["Fan", "Type"] }) } }));
    const pop = await screen.findByRole("dialog");
    fireEvent.change(within(pop).getByLabelText("finding text"), { target: { value: "unstarted note" } });
    const write = within(pop).getByRole("button", { name: "Write finding" });
    expect(write.getAttribute("aria-disabled")).toBe("true");
    expect(write.getAttribute("aria-description")).toBe("Start this Work to edit");
    fireEvent.click(write);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(submitted).toEqual([]);
    // The press kept the person's text: nothing was dropped.
    expect((within(pop).getByLabelText("finding text") as HTMLInputElement).value).toBe("unstarted note");
  } finally {
    closes.reverse().forEach((close) => close());
  }
}, 60_000);
