// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vite-plus/test";
import { actionReceiptSchema, address, workHandle, type WorkKey } from "@pe/agent-contracts";
import { createPeClient } from "@pe/agent-contracts/pe-api";
import { withInvocationContext } from "@pe/runtime/context";
import { findingsWork, findingsWorkSchema } from "@pe/agent-contracts/slots";
import { RouteWorkspace } from "@pe/runtime";
import { fixtureNative } from "../../../../../host/tests/fixture-native";
import { approvedPea, human } from "../../../../../host/tests/callers";
import { createPeRoutes } from "../../../../../host/src/pe-routes";
import { GraphHistory } from "../../../shell/graph-history";
import { observeWorkReceipts } from "../../../../../host/src/work-receipt-feed";
import { createWitness } from "../../../fans/cutover.test-support";
import { RosterBody } from "../../../ducts/sheet/mount";

afterEach(cleanup);

/*
 * The person's half of MAP row 9: the /fans roster row's own verb runs the route's `finding`
 * command through the typed mount, which submits `findings.write` to a real host action journal
 * as the person. Only the native process is a fixture; the journal, registry and Work are real.
 */
test("a person writes a finding from the /fans roster row; the host's findings.write stamps the author person", async () => {
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
    render(<>{f.typed.draw("sheet-roster", (ctx) => <RosterBody ctx={ctx as never} />) as React.ReactNode}</>);
    const trigger = (await screen.findAllByRole("button", { name: /^Write a finding on / }))[0]!;
    const name = trigger.getAttribute("aria-label")!.replace("Write a finding on ", "");
    fireEvent.click(trigger);
    const pop = await screen.findByLabelText(`Finding on ${name}`);
    fireEvent.click(within(pop).getByRole("button", { name: "check" }));
    const write = within(pop).getByRole("button", { name: `Write check on ${name}` });
    expect(write.getAttribute("aria-disabled") ?? write.hasAttribute("disabled"), "a check refuses until its verdict").toBeTruthy();
    // A refused verb says why without a hover (gate-1ebf1fb1: disabled Undo buttons gave no reason).
    expect(write.getAttribute("aria-description")).toBe("Write what you found");
    fireEvent.click(within(pop).getByRole("button", { name: "fail" }));
    fireEvent.change(within(pop).getByLabelText("finding text"), { target: { value: "port 1 static reads low" } });
    fireEvent.click(write);
    await waitFor(() => expect(submitted.map((c) => c.key)).toEqual(["findings.write"]), { timeout: 20_000 });
    const key = { ...submitted[0]!.input.work!.key, route: "findings" } as WorkKey;
    await waitFor(async () => {
      const { findings } = findingsWorkSchema.parse((await host.view(key, "findings"))?.doc ?? {});
      expect(Object.values(findings)).toEqual([
        expect.objectContaining({ by: "person", kind: "check", verdict: "fail", text: "port 1 static reads low", subject: expect.stringMatching(/^UniqueId:/) }),
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
test("the person undoes their own finding from its History row; Pea's newer finding stays", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pe-findings-undo-"));
  const native = await fixtureNative(join(dir, "native"));
  const socket = await native.connect();
  let saved: unknown = null;
  const host = new RouteWorkspace({
    registrations: [{ spec: findingsWork }],
    store: { getState: async () => structuredClone(saved), setState: async ({ value }) => void (saved = structuredClone(value)) },
  });
  const post = native.actions({ workspace: host });
  const routes = createPeRoutes({ workspace: host, registrations: [{ spec: findingsWork }] });
  // The browser's Pe client, answered by the host's own route door as the person.
  const browser = createPeClient("http://host", (url, init) =>
    withInvocationContext({ caller: human }, () => routes.fetch(new Request(url, init))));
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
      }, browser);
    await waitFor(() => expect(f.typed.owner()?.ready).toBe(true));
    render(<>{f.typed.draw("sheet-roster", (ctx) => <RosterBody ctx={ctx as never} />) as React.ReactNode}</>);
    const trigger = (await screen.findAllByRole("button", { name: /^Write a finding on / }))[0]!;
    const name = trigger.getAttribute("aria-label")!.replace("Write a finding on ", "");
    fireEvent.click(trigger);
    const pop = await screen.findByLabelText(`Finding on ${name}`);
    fireEvent.change(within(pop).getByLabelText("finding text"), { target: { value: "person note" } });
    fireEvent.click(within(pop).getByRole("button", { name: `Write note on ${name}` }));
    await waitFor(() => expect(submitted.map((c) => c.key)).toEqual(["findings.write"]), { timeout: 20_000 });
    const key = { ...submitted[0]!.input.work!.key, route: "findings" } as WorkKey;
    const findings = async () => Object.values(findingsWorkSchema.parse((await host.view(key, "findings"))?.doc ?? {}).findings);
    const authors = async () => (await findings()).map((x) => [x.text, x.by]);
    await waitFor(async () => expect(await authors()).toEqual([["person note", "person"]]), { timeout: 20_000 });
    // Pea writes after the person, through the findings Work handle.
    const pea = await post({ id: "pea-write", key: "findings.write", target: { kind: "document", ref: socket.target },
      input: { work: workHandle(key, (await host.view(key, "findings"))!.revision),
        finding: { id: "pea-1", subject: (await findings())[0]!.subject, kind: "note", text: "pea note", place: {} } } },
      approvedPea("findings-undo"));
    expect(pea.status, await pea.clone().text()).toBeLessThan(400);
    expect(await native.journal.wait("pea-write")).toMatchObject({ state: "succeeded" });
    await waitFor(async () => expect(await authors()).toEqual([["person note", "person"], ["pea note", "pea"]]));
    render(<GraphHistory owner={f.typed} />);
    fireEvent.click(await screen.findByRole("button", { name: "Undo your last finding" }, { timeout: 20_000 }));
    await waitFor(async () => expect(await authors()).toEqual([["pea note", "pea"]]), { timeout: 20_000 });
  } finally {
    closes.reverse().forEach((close) => close());
    await native.close();
    await rm(dir, { recursive: true, force: true });
  }
}, 90_000);
