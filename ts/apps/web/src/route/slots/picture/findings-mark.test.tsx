// @vitest-environment jsdom
import { RegistryContext } from "@effect/atom-react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { useSyncExternalStore, type ReactNode } from "react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { actionReceiptSchema, address, type WorkKey } from "@pe/agent-contracts";
import { createPeClient } from "@pe/agent-contracts/pe-api";
import { findingsWork, findingsWorkSchema } from "@pe/agent-contracts/slots";
import { RouteWorkspace } from "@pe/runtime";
import { withInvocationContext } from "@pe/runtime/context";
import { human } from "../../../../../host/tests/callers";
import { fixtureNative } from "../../../../../host/tests/fixture-native";
import { createPeRoutes } from "../../../../../host/src/pe-routes";
import { createWitness } from "../../../fans/cutover.test-support";
import { RosterBody } from "../../../fans/mount";
import type { ModelPicture } from "#/scene/picture/model";
import { SceneMeshes } from "#/scene/types";
import { makeAtomRegistry } from "../../../shell/owner";
import { TypedPane } from "../../../shell/typed-shell";
import { elementOf } from "./index.ts";

/*
 * Slice 9's mark clause, through the mounted pane (drive gate-b2caafd3: "a person's finding on FC-11
 * port 1 draws no mark from findings Work"). A person writes a finding on a fan port from the /fans
 * roster row; the host's findings Work holds it; the kernel's picture pane, drawn as the shell draws
 * it, hands the renderer one mark on the port's captured geometry under the `findings` layer. Only
 * the native process and the renderer are fixtures.
 */
const io = vi.hoisted(() => ({ call: vi.fn(() => new Promise(() => {})) }));
vi.mock("#/host/client", () => ({ callHostRpc: io.call }));
vi.mock("#/scene/artifact", () => ({ fetchSceneArtifact: async () => new ArrayBuffer(0) }));
const seen = vi.hoisted((): { model: Parameters<typeof ModelPicture>[0] | null } => ({ model: null }));
vi.mock("#/scene/picture/model", async (original) => ({
  ...(await original<typeof import("#/scene/picture/model")>()),
  ModelPicture: (props: Parameters<typeof ModelPicture>[0]) => { seen.model = props; return <div data-model-picture="" />; },
}));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); seen.model = null; });

test("a person's finding on a fan port draws one mark on the port's geometry in the /fans picture pane, from the findings Work", async () => {
  vi.stubGlobal("ResizeObserver", class {
    constructor(private callback: ResizeObserverCallback) {}
    observe(target: Element) { this.callback([{ target, contentRect: new DOMRectReadOnly(0, 0, 640, 480) } as ResizeObserverEntry], this as never); }
    unobserve() {}
    disconnect() {}
  });
  const dir = await mkdtemp(join(tmpdir(), "pe-findings-mark-"));
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
    const f = await createWitness(closes, new Map(), {}, { address: address("C:/model.rvt"), open: socket.target }, undefined,
      async (command) => {
        submitted.push(command as never);
        const response = await post(command, human);
        expect(response.status, await response.clone().text()).toBeLessThan(400);
        return actionReceiptSchema.parse(await native.journal.wait(command.id));
      }, browser);
    await waitFor(() => expect(f.typed.owner()?.ready).toBe(true));
    // The shell's own drawing of each pane, redrawn when the mount publishes.
    const Shown = ({ id, children }: { id: string; children?: (ctx: never) => ReactNode }) => {
      useSyncExternalStore(f.typed.subscribe, f.typed.revision, f.typed.revision);
      return <>{f.typed.draw(id, (ctx) => children ? children(ctx as never) : <TypedPane mount={f.typed} id={id} ctx={ctx} />) as ReactNode}</>;
    };
    render(<RegistryContext value={makeAtomRegistry()}>
      <Shown id="sheet-roster">{(ctx) => <RosterBody ctx={ctx} />}</Shown>
      <Shown id="sheet-picture" />
    </RegistryContext>);

    // The person writes a check on the first fan port's roster row.
    const trigger = (await screen.findAllByRole("button", { name: /^Write a finding on / }))[0]!;
    const name = trigger.getAttribute("aria-label")!.replace("Write a finding on ", "");
    fireEvent.click(trigger);
    const pop = await screen.findByLabelText(`Finding on ${name}`);
    fireEvent.change(within(pop).getByLabelText("finding text"), { target: { value: "port static reads low" } });
    fireEvent.click(within(pop).getByRole("button", { name: `Write note on ${name}` }));
    await waitFor(() => expect(submitted.map((c) => c.key)).toEqual(["findings.write"]), { timeout: 20_000 });
    const key: WorkKey = { ...submitted[0]!.input.work!.key, route: "findings" };
    const written = async () => Object.values(findingsWorkSchema.parse((await host.view(key, "findings"))?.doc ?? {}).findings);
    await waitFor(async () => expect(await written()).toHaveLength(1), { timeout: 20_000 });
    const port = (await written())[0]!.subject;
    expect(port).toMatch(/^UniqueId:.+#port:\d+$/);

    // That fan is opened: its walk is the picture, drawn by the kernel pane.
    f.typed.page.subject({ kind: "ids", ids: [port] });
    await waitFor(() => expect(seen.model?.drawn.map((layer) => layer.key)).toContain("findings"), { timeout: 20_000 });
    // The capture holds the fan unit, not its port: the ring lands on the unit's geometry.
    const meshes = new SceneMeshes(new Float32Array([0, 0, 0, 2, 0, 0, 0, 2, 2]), { minX: 0, minY: 0, minZ: 0, maxX: 2, maxY: 2, maxZ: 2 },
      [{ key: elementOf(port), revitId: 1, documentKey: "host", linkInstanceId: null, uniqueId: "fan", categoryId: null, category: "Mechanical Equipment", focus: true, firstVertex: 0, vertexCount: 3 }]);
    await waitFor(() => {
      const marks = seen.model!.drawn.find((layer) => layer.key === "findings")!.draw({ meshes, paintOf: undefined });
      expect(marks.map((layer) => JSON.parse(layer.key.slice(layer.key.indexOf("{"))))).toEqual([{ kind: "ring", at: { point: [1, 1, 1] } }]);
    }, { timeout: 20_000 });
    // The sheet's computed blockers are their own layer: `findings` toggles the findings Work only.
    expect(seen.model!.drawn.filter((layer) => layer.toggle === "findings").map((layer) => layer.key)).toEqual(["findings"]);
  } finally {
    cleanup();
    closes.reverse().forEach((close) => close());
    await native.close();
    await rm(dir, { recursive: true, force: true });
  }
}, 120_000);
