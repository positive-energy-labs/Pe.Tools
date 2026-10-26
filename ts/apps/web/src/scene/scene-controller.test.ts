import { afterEach, expect, it, vi } from "vite-plus/test";
import { SceneController } from "./scene-controller";
import { SceneMeshes } from "./types";
import { scenePlan } from "./scene-plan";
import { LOOK } from "./grounds";
import { sceneMemory } from "./scene-memory";
import type { SceneRenderer } from "./renderer";
import type { PreparedGeometry } from "./prepare-geometry";
const work = vi.hoisted(() => ({ prepare: vi.fn() }));
vi.mock("./preparation", () => ({ prepareScene: work.prepare }));
const mesh = () =>
  new SceneMeshes(
    new Float32Array(9),
    { minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 1, maxZ: 1 },
    [],
  );
const request = (
  meshes = mesh(),
  context = meshes,
  appearance?: () => { tier: "subject"; ink: string },
) => ({
  focus: scenePlan(meshes, appearance, LOOK.read()),
  context: scenePlan(context, appearance, LOOK.read()),
  appearance,
});
function deferred() {
  let resolve!: (value: unknown) => void, reject!: (error: Error) => void;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  const release = vi.fn();
  return {
    promise,
    finish: () => resolve({ geometry: {} as PreparedGeometry, release }),
    reject,
    release,
  };
}
function viewport() {
  const committed: SceneMeshes[] = [];
  const stage = vi.fn(async (plan) => ({
    commit: () => committed.push(plan.meshes),
    release: vi.fn(),
  }));
  const renderer = { canvas: { hidden: false }, clear: vi.fn(), stage, setAppearance: vi.fn() };
  const controller = new SceneController();
  const detach = controller.attach(renderer as unknown as SceneRenderer);
  return { controller, detach, renderer, committed };
}
const flush = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};
afterEach(() => {
  vi.unstubAllGlobals();
  work.prepare.mockReset();
});

it("publishes focus before same-focus context, without cancelling focus; paint-only changes never prepare", async () => {
  vi.stubGlobal("requestAnimationFrame", (f: () => void) => f());
  const a = deferred(),
    b = deferred();
  work.prepare.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
  const { controller, detach, renderer, committed } = viewport();
  const focus = mesh(),
    context = mesh();
  controller.request(request(focus));
  const signal = work.prepare.mock.calls[0]![1] as AbortSignal;
  controller.request(request(focus, context));
  expect(signal.aborted).toBe(false);
  a.finish();
  await flush();
  expect(committed).toEqual([focus]);
  expect(controller.read().state).toBe("preparing");
  expect(controller.read().display?.focus).toBe(focus);
  b.finish();
  await flush();
  expect(committed).toEqual([focus, context]);
  controller.request(request(focus, context, () => ({ tier: "subject", ink: "#ff0000" })));
  expect(work.prepare).toHaveBeenCalledTimes(2);
  expect(renderer.setAppearance).toHaveBeenCalledTimes(1);
  expect(a.release).toHaveBeenCalledTimes(1);
  expect(b.release).toHaveBeenCalledTimes(1);
  detach();
});

it("failed and superseded requests preserve the accepted frame; every abandoned preparation releases once", async () => {
  vi.stubGlobal("requestAnimationFrame", (f: () => void) => f());
  const baseline = sceneMemory.snapshot().owners.active;
  const a = deferred(),
    failure = deferred(),
    late = deferred(),
    last = deferred();
  work.prepare
    .mockReturnValueOnce(a.promise)
    .mockReturnValueOnce(failure.promise)
    .mockReturnValueOnce(late.promise)
    .mockReturnValueOnce(last.promise);
  const { controller, detach, committed } = viewport();
  const first = request(),
    bad = request(),
    superseded = request(),
    current = request();
  controller.request(first);
  a.finish();
  await flush();
  controller.request(bad);
  failure.reject(Error("allocation failed"));
  await flush();
  expect(controller.read()).toMatchObject({
    state: "failed",
    display: { focus: first.focus.meshes },
  });
  expect(committed).toEqual([first.focus.meshes]);
  controller.request(superseded);
  const signal = work.prepare.mock.calls[2]![1] as AbortSignal;
  controller.request(current);
  expect(signal.aborted).toBe(true);
  late.finish();
  await flush();
  expect(late.release).toHaveBeenCalledTimes(1);
  expect(committed).toEqual([first.focus.meshes]);
  last.finish();
  await flush();
  expect(committed).toEqual([first.focus.meshes, current.focus.meshes]);
  detach();
  await flush();
  expect(controller.read()).toEqual({ state: "empty", display: null });
  expect(sceneMemory.snapshot().owners.active).toBe(baseline);
  expect(sceneMemory.snapshot().owners.reservations).toBe(0);
});
