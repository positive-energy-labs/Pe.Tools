import { canonicalRouteInput, type Machine, type MachineSession } from "@pe/agent-contracts";
import type { ResourceObserver } from "@pe/runtime";
import { createJiti } from "jiti";
import { expect, test } from "vite-plus/test";
import { z } from "zod";
import { read } from "@pe/host-internal/reads/evaluator";
import { registeredReads } from "../src/reads/routes.ts";
import { unreadLeg } from "../src/update-reader.ts";
import { fixture, who } from "./host-read-graph.test-support.ts";

// Run the web's launch plan without pulling its JSX project into the host's type check.
const { EMPTY_DRAFT, launchPlan } = await createJiti(import.meta.url).import<{
  EMPTY_DRAFT: object;
  launchPlan(draft: object, machine: Machine, rows: readonly never[]): unknown;
}>("../../web/src/machine/open-model.ts");
const { BACKGROUND_BOOTING, CHECKOUT_HOT } = await createJiti(import.meta.url).import<{
  BACKGROUND_BOOTING: MachineSession;
  CHECKOUT_HOT: MachineSession;
}>("../../web/src/machine/open-examples.ts");

async function openYears(years: Machine["revit"]["years"], error: string | null) {
  const leg = unreadLeg();
  let machine: Machine = {
    observedAtUtc: "2026-11-19T00:00:00Z",
    host: null,
    revit: { years, sessions: [], unclassifiedAttachments: [] },
    update: {
      plan: null,
      receipt: null,
      requestId: null,
      admittedPlanId: null,
      planLeg: leg,
      receiptLeg: leg,
      automatic: false,
    },
    share: null,
    providers: null,
    legs: { years: { ...leg, error } },
  };
  const listeners = new Set<() => void>();
  let machineObservations = 0;
  let sample = 0;
  let beforeRecents: (() => void) | undefined;
  const resourceObserver: ResourceObserver = (reading, publish) => {
    if (reading.kind === "machine") {
      machineObservations++;
      const send = () => publish({ kind: "snapshot", key: "machine", value: machine });
      listeners.add(send);
      send();
      return () => listeners.delete(send);
    }
    if (reading.kind === "threads") publish({ kind: "snapshot", key: "threads", value: [] });
    if (reading.kind === "sdk" && reading.read === "recents") {
      const change = beforeRecents;
      beforeRecents = undefined;
      change?.();
      publish({ kind: "snapshot", key: "recents", value: { result: { recents: [] } } });
    }
    return () => {};
  };
  const host = await fixture(false, { resourceObserver });
  const subscription = "open-years";
  const url = new URL("http://host/pe/resources");
  url.searchParams.set(
    "keys",
    JSON.stringify([{ kind: "publication", subscription, generation: 0 }]),
  );
  const response = await host.request(new Request(url));
  const stream = response.body!.getReader();
  await stream.read();
  return {
    async read(recipe = "open.documents") {
      const response = await host.request(
        new Request("http://host/pe/reads/value", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            read: recipe,
            subscription,
            generation: 0,
            args: { target: { kind: "host" } },
          }),
        }),
      );
      expect(response.status, await response.clone().text()).toBe(200);
      return response.json();
    },
    observations: () => machineObservations,
    publication: () =>
      host.reads.publications.publication(canonicalRouteInput([who, subscription])),
    onNextRecents(change: () => void) {
      beforeRecents = change;
    },
    async nextEvent(state: string, { version, retry }: { version?: number; retry?: number } = {}) {
      const decoder = new TextDecoder();
      const metadata = z.object({
        value: z.object({ state: z.string(), version: z.number(), retry: z.number().optional() }),
      });
      let text = "";
      for (;;) {
        const chunk = await stream.read();
        if (chunk.done) throw Error(`Publication stream closed before ${state}`);
        text += decoder.decode(chunk.value, { stream: true });
        const lines = text.split("\n");
        text = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const frame = metadata.parse(JSON.parse(line.slice(6))).value;
          if (
            frame.state === state &&
            frame.retry === retry &&
            (version === undefined || frame.version === version)
          )
            return frame;
        }
      }
    },
    pass(
      years: Machine["revit"]["years"],
      error: string | null,
      sessions = machine.revit.sessions,
      sessionsError: string | null = null,
    ) {
      const now = new Date(Date.UTC(2026, 10, 19, 0, 0, ++sample)).toISOString();
      machine = {
        ...machine,
        observedAtUtc: now,
        revit: { ...machine.revit, years, sessions },
        legs: {
          years: { ...leg, attemptedAtUtc: now, error },
          sessions: { ...leg, attemptedAtUtc: now, error: sessionsError },
        },
      };
      for (const notify of listeners) notify();
    },
    async close() {
      await stream.cancel();
      await host.close();
      expect(listeners.size).toBe(0);
    },
  };
}

const plan = (machine: Machine) =>
  launchPlan({ ...EMPTY_DRAFT, doc: "C:/witness.rvt", target: "new" }, machine, []);

test("an open tab reacquires its publication when the installed-year check recovers", async () => {
  const open = await openYears(null, "years leg timed out");
  try {
    const first = await open.read();
    expect(plan(first.value.data.machine)).toMatchObject({ year: null, launch: null });

    open.pass([2025], null);
    expect(open.publication()?.state).toBe("refresh-needed");
    await open.nextEvent("refresh-needed");
    const next = await open.read();
    expect(next.version).toBeGreaterThan(first.version);
    expect(plan(next.value.data.machine)).toMatchObject({ year: 2025, refusal: null });
  } finally {
    await open.close();
  }
});

test("Stop invalidates a ready row through a failed reading, removal, and a second launch", async () => {
  const open = await openYears([2026], null);
  const pending = BACKGROUND_BOOTING;
  const attached = CHECKOUT_HOT;
  if (pending.row.case !== "controlled-pending" || attached.row.case !== "controlled-active")
    throw Error("Expected pending and attached session fixtures");
  const first = {
    ...attached,
    row: { ...attached.row, id: pending.row.id, year: pending.row.year },
  };
  try {
    await open.read();
    open.pass([2026], null, [pending]);
    expect((await open.read()).value.data.machine.revit.sessions).toMatchObject([
      { row: { id: pending.row.id, case: "controlled-pending" } },
    ]);
    open.pass([2026], null, [first]);
    expect((await open.read()).value.data.machine.revit.sessions).toMatchObject([
      { row: { case: "controlled-active", process: first.row.process } },
    ]);

    // Stop can close the native bridge while the holdings query is in flight. A sampled
    // Ready row can still have the same PID and attachment when the failure lands.
    open.pass([2026], null, [
      {
        ...first,
        holdingsLeg: { ...first.holdingsLeg, error: "SDK bridge stopped answering" },
      },
    ]);
    expect(open.publication()?.state).toBe("refresh-needed");
    expect((await open.read()).value.data.machine.revit.sessions).toMatchObject([
      { holdingsLeg: { error: "SDK bridge stopped answering" } },
    ]);

    open.pass([2026], null, []);
    expect(open.publication()?.state).toBe("refresh-needed");
    expect((await open.read()).value.data.machine.revit.sessions).toEqual([]);

    if (pending.row.attempt.attempt !== "launched") throw Error("Expected a launched attempt");
    const pid = first.row.process.pid + 1;
    open.pass([2026], null, [
      {
        ...pending,
        row: {
          ...pending.row,
          attempt: { ...pending.row.attempt, process: { ...pending.row.attempt.process, pid } },
        },
      },
    ]);
    expect(open.publication()?.state).toBe("refresh-needed");
    expect((await open.read()).value.data.machine.revit.sessions).toMatchObject([
      { row: { id: pending.row.id, case: "controlled-pending", attempt: { process: { pid } } } },
    ]);
  } finally {
    await open.close();
  }
});

test("a Stop read that races the disappearing Revit retries on the next Machine sample", async () => {
  const open = await openYears([2026], null);
  const pending = BACKGROUND_BOOTING;
  const attached = CHECKOUT_HOT;
  if (
    pending.row.case !== "controlled-pending" ||
    pending.row.attempt.attempt !== "launched" ||
    attached.row.case !== "controlled-active"
  )
    throw Error("Expected a launched attempt and an attached session");
  const id = pending.row.id;
  const first = { ...attached, row: { ...attached.row, id } };
  const nextPid = first.row.process.pid + 1;
  const second = {
    ...pending,
    row: {
      ...pending.row,
      attempt: {
        ...pending.row.attempt,
        process: { ...pending.row.attempt.process, pid: nextPid },
      },
    },
  };
  try {
    await open.read();
    open.pass([2026], null, [pending]);
    expect((await open.read()).value.data.machine.revit.sessions).toMatchObject([
      { row: { id, case: "controlled-pending" } },
    ]);
    open.pass([2026], null, [first]);
    const ready = await open.read();
    expect(ready.value.data.machine.revit.sessions).toMatchObject([
      { row: { id, case: "controlled-active", process: first.row.process } },
    ]);

    open.pass([2026], null, [first], "Session census temporarily unavailable");
    await open.nextEvent("refresh-needed", { version: ready.version });
    // The recipe takes Machine first, then recents. Stop lands before Machine is validated.
    open.onNextRecents(() => open.pass([2026], null, []));
    const raced = await open.read();
    expect(raced).toMatchObject({
      state: "refresh-needed",
      reason: "The machine input changed while this was being read.",
      value: { freshness: "refresh-needed" },
    });
    expect(raced.value.data.machine.revit.sessions).toMatchObject([
      { row: { id, case: "controlled-active" } },
    ]);

    open.pass([2026], null, []);
    const woke = await Promise.race([
      open.nextEvent("refresh-needed", { version: ready.version, retry: 1 }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 500)),
    ]);
    expect(woke).toMatchObject({ state: "refresh-needed", retry: 1 });
    expect(open.publication()?.version).toBe(ready.version);
    const removed = await open.read();
    expect(removed).toMatchObject({
      state: "current",
      value: { data: { machine: { revit: { sessions: [] } } } },
    });

    open.pass([2026], null, [second]);
    await open.nextEvent("refresh-needed", { version: removed.version });
    expect(await open.read()).toMatchObject({
      state: "current",
      value: {
        data: {
          machine: {
            revit: {
              sessions: [
                { row: { id, case: "controlled-pending", attempt: { process: { pid: nextPid } } } },
              ],
            },
          },
        },
      },
    });
  } finally {
    await open.close();
  }
});

test("the shared Open and Sessions publication follows a start through attachment or removal", async () => {
  const open = await openYears([2026], null);
  const pending = BACKGROUND_BOOTING;
  const attached = CHECKOUT_HOT;
  if (pending.row.case !== "controlled-pending" || attached.row.case !== "controlled-active")
    throw Error("Expected pending and attached session fixtures");
  const ready = {
    ...attached,
    row: { ...attached.row, id: pending.row.id, year: pending.row.year },
  };
  try {
    const initial = await open.read();
    expect(initial.value.data.machine.revit.sessions).toEqual([]);

    open.pass([2026], null, [pending]);
    expect(open.publication()?.state).toBe("refresh-needed");
    await open.nextEvent("refresh-needed");
    const starting = await open.read();
    expect(starting.value.data.machine.revit.sessions).toMatchObject([
      { row: { id: pending.row.id, case: "controlled-pending" } },
    ]);

    open.pass([2026], null, [
      { ...pending, row: { ...pending.row, observedAtUtc: "2026-11-19T01:00:00Z" } },
    ]);
    expect(open.publication()?.state).toBe("current");

    open.pass([2026], null, [ready]);
    expect(open.publication()?.state).toBe("refresh-needed");
    const afterAttach = await open.read();
    expect(afterAttach.value.data.machine.revit.sessions).toMatchObject([
      { row: { id: pending.row.id, case: "controlled-active" } },
    ]);

    open.pass([2026], null, [pending]);
    await open.read();
    open.pass([2026], null, [
      {
        ...pending,
        row: {
          ...pending.row,
          case: "failed-receipt",
          failure: {
            source: "journal",
            event: "failed",
            journalFile: "launch.jsonl",
            message: "Startup failed.",
            process: ready.row.process,
          },
        },
      },
    ]);
    expect(open.publication()?.state).toBe("refresh-needed");
    const afterFailure = await open.read();
    expect(afterFailure.value.data.machine.revit.sessions).toMatchObject([
      { row: { id: pending.row.id, case: "failed-receipt" } },
    ]);

    open.pass([2026], null, [pending]);
    await open.read();
    open.pass([2026], null, []);
    expect(open.publication()?.state).toBe("refresh-needed");
    const afterCancel = await open.read();
    expect(afterCancel.value.data.machine.revit.sessions).toEqual([]);
  } finally {
    await open.close();
  }
});

test("a publication without the Open recipe never starts a machine observation", async () => {
  const unrelated = read("test.unrelated-publication", {
    input: z.object({ target: z.unknown() }),
    output: z.unknown(),
    run: () => ({ machine: { revit: { years: [2025] }, legs: {} } }),
  });
  const unregister = registeredReads.register({ unrelated });
  const open = await openYears([2025], null);
  try {
    const first = await open.read(unrelated.name);
    expect(open.observations()).toBe(0);
    open.pass([2026], null);
    expect(open.publication()).toMatchObject({ state: "current", version: first.version });
  } finally {
    unregister();
    await open.close();
  }
});

test("Open ignores sampling changes but invalidates on changed years or check status", async () => {
  const open = await openYears([2025], null);
  try {
    const first = await open.read();
    open.pass([2025], null);
    expect(open.publication()).toMatchObject({ state: "current", version: first.version });

    open.pass([2025], "check failed");
    expect(open.publication()?.state).toBe("refresh-needed");
    const failed = await open.read();
    open.pass([2025], "retry failed with a different error");
    expect(open.publication()).toMatchObject({ state: "current", version: failed.version });

    open.pass([2025], null);
    expect(open.publication()?.state).toBe("refresh-needed");
    await open.read();

    open.pass([2026], null);
    expect(open.publication()?.state).toBe("refresh-needed");
  } finally {
    await open.close();
  }
});
