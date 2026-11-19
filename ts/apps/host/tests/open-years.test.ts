import { canonicalRouteInput, type Machine } from "@pe/agent-contracts";
import type { ResourceObserver } from "@pe/runtime";
import { createJiti } from "jiti";
import { expect, test } from "vite-plus/test";
import { unreadLeg } from "../src/update-reader.ts";
import { fixture, who } from "./host-read-graph.test-support.ts";

// Run the web's launch plan without pulling its JSX project into the host's type check.
const { EMPTY_DRAFT, launchPlan } = await createJiti(import.meta.url).import<{
  EMPTY_DRAFT: object;
  launchPlan(draft: object, machine: Machine, rows: readonly never[]): unknown;
}>("../../web/src/machine/open-model.ts");

async function openYears(years: Machine["revit"]["years"], error: string | null, watch = true) {
  const leg = unreadLeg();
  let machine: Machine = {
    observedAtUtc: "2026-11-19T00:00:00Z",
    host: null,
    revit: { years, sessions: [], unclassifiedAttachments: [] },
    update: {
      plan: null, receipt: null, requestId: null, admittedPlanId: null,
      planLeg: leg, receiptLeg: leg, automatic: false,
    },
    share: null,
    providers: null,
    legs: { years: { ...leg, error } },
  };
  const listeners = new Set<() => void>();
  const resourceObserver: ResourceObserver = (reading, publish) => {
    if (reading.kind === "machine") {
      const send = () => publish({ kind: "snapshot", key: "machine", value: machine });
      listeners.add(send);
      send();
      return () => listeners.delete(send);
    }
    if (reading.kind === "threads") publish({ kind: "snapshot", key: "threads", value: [] });
    if (reading.kind === "sdk" && reading.read === "recents")
      publish({ kind: "snapshot", key: "recents", value: { result: { recents: [] } } });
    return () => {};
  };
  const host = await fixture(false, { resourceObserver });
  const subscription = "open-years";
  const url = new URL("http://host/pe/resources");
  url.searchParams.set("keys", JSON.stringify([{
    kind: "publication", subscription, generation: 0, ...(watch ? { watch: "open-years" } : {}),
  }]));
  const response = await host.request(new Request(url));
  const stream = response.body!.getReader();
  await stream.read();
  return {
    async read() {
      const response = await host.request(new Request("http://host/pe/reads/value", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ read: "open.documents", subscription, generation: 0, args: { target: { kind: "host" } } }),
      }));
      expect(response.status, await response.clone().text()).toBe(200);
      return response.json();
    },
    publication: () => host.reads.publications.publication(canonicalRouteInput([who, subscription])),
    async nextEvent(state: string) {
      const decoder = new TextDecoder();
      let text = "";
      while (!text.includes(`"state":"${state}"`)) {
        const chunk = await stream.read();
        if (chunk.done) throw Error(`Publication stream closed before ${state}`);
        text += decoder.decode(chunk.value, { stream: true });
      }
    },
    pass(years: Machine["revit"]["years"], error: string | null) {
      const now = "2026-11-19T00:00:05Z";
      machine = {
        ...machine, observedAtUtc: now, revit: { ...machine.revit, years },
        legs: { years: { ...leg, attemptedAtUtc: now, error } },
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

test("the shared documents read keeps its snapshot behavior without the Open watch", async () => {
  const sessions = await openYears([2025], null, false);
  try {
    const first = await sessions.read();
    sessions.pass([2026], null);
    expect(sessions.publication()).toMatchObject({ state: "current", version: first.version });
  } finally {
    await sessions.close();
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
