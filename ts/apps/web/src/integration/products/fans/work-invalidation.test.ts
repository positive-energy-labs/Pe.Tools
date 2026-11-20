// @vitest-environment jsdom
import { expect, test, vi } from "vite-plus/test";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { createElement, useSyncExternalStore } from "react";
import { fansRouteState } from "@pe/fans-contract/fans";
import { workFingerprintSchema, workHandle, workKey } from "@pe/agent-contracts";
import { module as fans } from "../../../../../../products/fans/web/route.ts";
import { mountTypedRoute } from "../../../shell/typed-mount.ts";
import { publicationSource } from "../../../host/publication-source.ts";
import { peReadings } from "../../../host/resource-stream.ts";
import { createFixtureWorkDoor } from "../../../shell/fixture-work-door.ts";
import { stableFanKey } from "@pe/ducts-web/calc/model";
import { fixture, key, path, ref, who } from "../../../../../host/tests/host-read-graph.test-support.ts";
import { canonicalJson } from "@pe/host-internal/native-read";

/*
 * D36 (J6 on a real host): Pea writes the Fans Work through the canonical handle, which drops
 * `from`. The core Value traced the Work with `from`, so the host never invalidated it, and the
 * page stayed locked on "Refreshing Value after Work changed". Every spelling of one Work must
 * re-read the Value. Mutant: compare serialized scopes in `reads/invalidations.ts` turns three red.
 */
test.each(["with-from", "without-from", "path-only", "canonical-handle"] as const)(
  "an outside edit to the Fans Work re-reads the Value and unlocks the page (%s)",
  async (spelling) => {
    const host = await fixture();
    let mount: ReturnType<typeof mountTypedRoute> | undefined;
    const requests: unknown[] = [];
    // The host's resource stream: a subscription with no slot yet first reads `absent`
    // (apps/host/src/builtin-inputs.ts), which is the page's cue to acquire it (D37).
    const spy = vi.spyOn(peReadings, "subscribe").mockImplementation((request: any, deliver: any) => {
      if (request.kind !== "publication") return () => {};
      let sent = false;
      const stop = host.reads.publications.observe(canonicalJson([who, request.subscription]),
        (value) => { sent = true; deliver({ kind: "snapshot", stale: false, value }); });
      if (!sent) deliver({ kind: "snapshot", stale: false, value: { generation: request.generation, version: 0, state: "absent" } });
      return stop;
    });
    try {
      const initial = await host.send(0, []);
      const fan = initial.value!.data.rows.find((row) => row.mark === "MUAS-1")!;
      for (const [owner, doc] of Object.entries({ fans: initial.value!.data.fansWork,
        "duct-systems": initial.value!.data.ductSystemsWork }))
        expect((await host.workspace.start(key(owner), doc, "human")).ok).toBe(true);
      const door = createFixtureWorkDoor(fansRouteState, {});
      const work = { ...door, open: (scope: any) => ({ subscribe: (deliver: any) => host.workspace.observeFeed(scope.key,
        (s: any) => deliver({ kind: "ready", history: s.history, snapshot: { handle: s.handle, revision: s.revision, value: s.doc } }),
        (ack) => deliver({ kind: "ack", ack }), (error) => { throw error; }) }) };
      const source = publicationSource({ async read(ctx, publication, release) {
        if (!release) requests.push(ctx.args);
        return (await host.probe({ ...publication, release, read: "fans.calc", args: { ...(ctx.args as any), target: ref } })).json();
      } });
      mount = mountTypedRoute(fans, {
        fixture: null, target: { kind: "document", ref }, work: { address: path, open: ref }, custody: { current: () => true },
        memory: () => ({ fan: { kind: "ids", ids: [stableFanKey(fan)] } }),
        address: { read: () => new URLSearchParams(), write() {}, subscribe: () => () => {} },
      }, workFingerprintSchema.parse(`builtin-closure:${"a".repeat(64)}`), {
        work, sources: { "fans.calc": source },
        timeline: { open(_works, deliver) { deliver({ rows: [], undo: null, redo: null, refusal: { undo: null, redo: null } }); return () => {}; }, step: async () => null },
      });
      const mounted = mount;
      const Surface = () => { useSyncExternalStore(mounted.subscribe, mounted.revision, mounted.revision); return createElement("output", null, mounted.problem() ?? "unlocked"); };
      const surface = render(createElement(Surface));
      await waitFor(() => expect(mounted.problem()).toBeNull());
      const before = requests.length;
      const { from: _from, ...withoutFrom } = key("fans") as any;
      const scope = spelling === "with-from" ? key("fans") : spelling === "without-from" ? withoutFrom
        : spelling === "path-only" ? { ...key("fans"), target: workHandle(key("fans"), 1).key.target } : workHandle(key("fans"), 1).key;
      expect(workKey(scope)).toBe(workKey(key("fans")));
      await act(async () => {
        const result = await host.workspace.apply(scope, "fans", "pea", [{ path: ["ratedEsp", `UniqueId:${fan.uniqueId}`, "edit"], value: { value: { inWg: 1.25 } } }], 1);
        expect(result.ok).toBe(true);
      });
      await waitFor(() => expect(requests.length).toBeGreaterThan(before), { timeout: 2000 });
      await waitFor(() => expect(surface.container.textContent).toBe("unlocked"), { timeout: 2000 });
    } finally { cleanup(); mount?.dispose(); spy.mockRestore(); await host.close(); }
  },
);
