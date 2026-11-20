import { contract } from "@pe/agent-contracts/handle";
// @vitest-environment jsdom
import { useSyncExternalStore } from "react";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, expect, test } from "vite-plus/test";
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { z } from "zod";
import { KeyScopeHost } from "@pe/kit/keys";
import {  workFingerprintSchema } from "@pe/agent-contracts";
import { module as families } from "../families/route";
import { route, type ContextOf } from "@pe/web-kernel/route";
import { hostRead } from "@pe/web-kernel/host-read";
import { scrollBody } from "@pe/web-kernel/route/body";
import { refusalOf } from "@pe/web-kernel/route/typed-route";
import { TypedChrome } from "./typed-shell";
import { mountTypedRoute } from "./typed-mount";
import type { UseSource } from "@pe/web-kernel/shell/source-contract";

afterEach(cleanup);

const read = hostRead(contract("probe.value", { input: z.object({}), data: z.object({ rows: z.array(z.string()) }), uses: [] }));
const core = { ...read, args: () => ({}) };
const choices = { ...hostRead(contract("probe.choices", { input: z.object({}), data: z.object({ names: z.array(z.string()) }), uses: [] })), args: () => ({}) };
type Core = ContextOf<{}, typeof core>;
/** Two panes draw the core, and both bodies throw on a missing value: neither narrows, neither falls back.
 *  The chooser names its own read, as a pane does whose control clears the core's refusal. */
const probe = route({
  key: "reading-states-probe", address: "/", name: "Probe", needs: "host", directory: families.data.directory, fields: {},
  core,
  reads: { choices },
  panes: {
    chooser: { title: "Chooser", purpose: "Choose what the core reads", read: choices, body: "scroll", draw: (ctx: ContextOf<{}, typeof choices>) => scrollBody(`choose: ${ctx.value.value.names.join()}`) },
    one: {
      title: "One", purpose: "Draw the rows", body: "scroll",
      draw: (ctx: Core) => {
        // The type half of the falsifier (map slice 5): inside `draw`, `ctx.value.value` is not `undefined`.
        // tsc fails this file if `Present` loses its value, or if a second reading stops needing a narrow.
        const rows: readonly string[] = ctx.value.value.rows;
        // @ts-expect-error a second reading may be value-less: the body narrows on `"value" in`.
        void (() => ctx.read(core).value);
        return scrollBody(`one: ${rows.join()}`);
      },
    },
    two: { title: "Two", purpose: "Count the rows", body: "scroll", draw: (ctx: Core) => scrollBody(`two: ${ctx.value.value.rows.length}`) },
  },
  layout: { kind: "split", axis: "h", id: "probe", size: 320, sized: "end", children: [{ kind: "pane", id: "chooser" }, { kind: "pane", id: "one" }, { kind: "pane", id: "two" }] },
});

const packet = (data: object) => ({ key: "probe", generation: 0, version: 1, state: "current", value: {
  data, evaluation: JSON.stringify(data), inputs: "probe", origin: { kind: "fixture" }, works: [], trace: [], freshness: "current",
  coverage: { requested: [], covered: [], unknown: [], refused: [] } } });

/** Map slice 5: the shell draws reading, refused and not-yet-run; a body sees a present value. */
test("a refused core read shows every pane the same refusal line, and a body that throws on a missing value does not throw", async () => {
  const frames: Parameters<UseSource["open"]>[1][] = [];
  const source: UseSource = { kind: "use", open(_ctx, deliver) { frames.push(deliver); return () => {}; } };
  const chooser: UseSource = { kind: "use", open(_ctx, deliver) { deliver({ kind: "complete", revision: 1, value: packet({ names: ["north", "south"] }) }); return () => {}; } };
  const mount = mountTypedRoute(probe, {
    address: { read: () => new URLSearchParams(), write() {}, subscribe: () => () => {} },
    fixture: null, target: { kind: "host" }, work: { address: null, open: null }, custody: { current: () => true }, memory: () => ({}),
  }, workFingerprintSchema.parse(`builtin-closure:${"a".repeat(64)}`), { sources: { "probe.value": source, "probe.choices": chooser } });
  function Journey() {
    useSyncExternalStore(mount.subscribe, mount.revision, mount.revision);
    return <KeyScopeHost id="reading-states"><TypedChrome mount={mount} document={null} /></KeyScopeHost>;
  }
  const router = createRouter({ routeTree: createRootRoute({ component: Journey }), history: createMemoryHistory({ initialEntries: ["/"] }) });
  const view = render(<RouterProvider router={router} />);
  const all = () => [...document.querySelectorAll<HTMLElement>("[data-slot='pane']")].map((pane) => pane.textContent ?? "");
  const panes = () => all().filter((text) => !text.includes("choose:"));
  try {
    // Reading: no value yet. Both bodies would throw here; the shell draws its own line instead.
    await waitFor(() => expect(panes()).toHaveLength(2));
    expect(mount.value().state).toBe("reading");
    for (const text of panes()) expect(text).toContain("Reading...");
    // Refused: the same line in every pane.
    await waitFor(() => expect(frames).toHaveLength(1));
    await act(async () => frames[0]!({ kind: "failure", error: "The model is closed" }));
    const refused = mount.value();
    expect(refused.state).toBe("refused");
    const reason = refusalOf(refused)!;
    expect(reason).toContain("The model is closed");
    for (const text of panes()) { expect(text).toContain(reason); expect(text).not.toMatch(/one:|two:/); }
    // With the core refused, the pane that names its own read still draws: its control can clear the refusal.
    expect(all().join("|"), "the chooser draws over a refused core").toContain("choose: north,south");
    // Present: the bodies draw, and a later refusal keeps them drawn over the stale value.
    await act(async () => frames[0]!({ kind: "complete", revision: 1, value: packet({ rows: ["a", "b"] }) }));
    expect(panes().join("|")).toContain("one: a,b");
    expect(panes().join("|")).toContain("two: 2");
    await act(async () => frames[0]!({ kind: "failure", error: "The model is closed" }));
    expect(mount.value().state).toBe("stale");
    expect(panes().join("|")).toContain("one: a,b");
  } finally { view.unmount(); mount.dispose(); }
}, 30_000);
