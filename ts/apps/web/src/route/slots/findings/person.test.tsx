// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vite-plus/test";
import { actionReceiptSchema, address, type WorkKey } from "@pe/agent-contracts";
import { findingsWork, findingsWorkSchema } from "@pe/agent-contracts/slots";
import { RouteWorkspace } from "@pe/runtime";
import { fixtureNative } from "../../../../../host/tests/fixture-native";
import { human } from "../../../../../host/tests/callers";
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
