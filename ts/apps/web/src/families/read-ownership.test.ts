// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vite-plus/test";
import { waitFor } from "@testing-library/react";
import { familiesRouteState, workKey } from "@pe/agent-contracts";
import { createGraphMount } from "#/shell/mount-owner";
import { familiesGraph, familiesPageSchema } from "./graph";
import { familiesBinding, familiesTargetReady } from "./actions";
import { familiesMatrixSource, familiesSources, type FamiliesObservation } from "./sources";
import { FamiliesHostFixture } from "./host.fixture";
import { DEMO_FAMILIES } from "./seeds";

afterEach(() => vi.unstubAllGlobals());

// S0a's falsifier, now on the real graph, query verb, Work journal and immutable-parts source.
// Only host transport/persistence and the external Target selection are fake.
test("late A parts and completion cannot enter B or a returned A; an unchanged A still completes", async () => {
  for (const route of [["document-B"], ["document-B", "document-A"], []] as const) {
    const host = new FamiliesHostFixture();
    host.doc = familiesRouteState.schema.parse({});
    host.revision = 0;
    vi.stubGlobal("fetch", host.fetch);
    let complete!: (reading: FamiliesObservation) => void;
    let starting!: FamiliesObservation;
    host.readGate = (body) => {
      starting = {
        ...host.reading,
        id: `pending-${String(body.readId)}`,
        progress: {
          runId: String(body.readId),
          state: "reading",
          phase: "preparing",
          completed: 0,
          total: 0,
          workers: 1,
        },
        result: { families: [], issues: [], page: null },
      };
      host.save(starting, []);
      return new Promise((resolve) => {
        complete = resolve;
      });
    };
    let deliverPart!: (response: Response) => void;
    host.recordBodies.set(
      "late-A-part",
      new Promise((resolve) => {
        deliverPart = resolve;
      }),
    );
    const owner = createGraphMount(
      familiesGraph,
      {
        getSnapshot: host.snapshot,
        subscribe: (notify) => {
          host.scopeListeners.add(notify);
          return () => {
            host.scopeListeners.delete(notify);
          };
        },
        write: host.write,
        subscribeAcceptedDeltas: () => () => {},
        sources: { ...familiesSources(), "families.matrix": familiesMatrixSource(host.resources) },
        binding: familiesBinding,
      },
      familiesPageSchema.parse({
        draft: { categories: host.filter.categoryNames, families: null, placement: "AllLoaded" },
      }),
    );
    const release = owner.connect();
    const demand = owner.readings.mount(["matrix"]);
    const pending = owner.control("read").run();
    await waitFor(() => expect(host.reads).toHaveLength(1));
    await waitFor(() =>
      expect(owner.readings.get("matrix").value).toMatchObject({ id: starting.id }),
    );
    const family = {
      ...DEMO_FAMILIES[0]!,
      familyName: "Only in A",
      familyUniqueId: "late-A-family",
    };
    host.save(
      {
        ...starting,
        id: "A-progress",
        progress: { ...starting.progress!, completed: 1, total: 2 },
      },
      ["late-A-part"],
    );
    await waitFor(() => expect(host.stored.get("A-progress")).toBeDefined());
    // Let metadata resolve and cache the still-pending immutable part under the first attempt.
    await new Promise((resolve) => setTimeout(resolve, 10));
    for (const target of route) host.move(target);
    const scope = () => ({
      ...owner.snapshot(),
      page: owner.view.read().page,
      readings: { matrix: owner.readings.get("matrix") },
    });
    const snapshot = () => ({
      display: owner.readings.get("matrix").value ?? null,
      work: owner.snapshot().work,
      readiness: familiesTargetReady(scope()),
    });
    const before = structuredClone(snapshot());
    expect(before.readiness).toBe("Complete this Families read before planning edits");
    deliverPart(Response.json(family));
    if (route.length) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect.soft(snapshot(), `late parts after A→${route.join("→")}`).toEqual(before);
      expect(host.writes).toEqual([]);
    } else
      await waitFor(() =>
        expect((owner.readings.get("matrix").value as FamiliesObservation).result.families).toEqual(
          [family],
        ),
      );
    const afterParts = structuredClone(snapshot());
    const final: FamiliesObservation = {
      ...starting,
      id: "A-complete",
      envelope: { revision: 1 },
      progress: { ...starting.progress!, state: "complete", completed: 2, total: 2 },
      result: {
        families: [family as FamiliesObservation["result"]["families"][number]],
        issues: [],
        page: null,
      },
    };
    if (!route.length) {
      // The host publishes takenAt before returning its envelope, exactly as call-route does.
      host.doc = familiesRouteState.schema.parse({ takenAt: final.capturedAt });
      host.revision = 1;
      host.notify();
    }
    host.save(final);
    complete(final);
    const outcome = await pending;
    if (route.length) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(snapshot(), `late completion after A→${route.join("→")}`).toEqual(afterParts);
      expect(host.writes).toEqual([]);
      expect(outcome.state).toBe("stale");
    } else {
      await waitFor(() =>
        expect((owner.readings.get("matrix").value as FamiliesObservation).id).toBe("A-complete"),
      );
      expect(snapshot().readiness).toBeNull();
      expect(host.writes).toHaveLength(1);
      expect(host.writeRequests[0]).toMatchObject({
        key: starting.work,
        write: {
          expectedRevision: 1,
          patches: [{ path: ["scope", "edit"], value: { value: starting.filter } }],
        },
      });
      expect(owner.journals.get(workKey(starting.work))!.read().undo).toHaveLength(1);
      expect(outcome.state).toBe("done");
    }
    console.info(
      `A${route.length ? `→${route.join("→")}` : " unchanged"}: Work writes=${host.writes.length}; readiness=${snapshot().readiness}`,
    );
    demand();
    release();
    owner.dispose();
    expect(host.subscriptions.size).toBe(0);
  }
});
