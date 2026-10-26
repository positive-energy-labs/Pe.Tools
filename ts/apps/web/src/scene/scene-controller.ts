import { sceneMemory, type SceneMemoryLease } from "./scene-memory";
import type { PaintOf, SceneMeshes } from "./types";
import type { SceneRenderer } from "./renderer";
import { prepareScene } from "./preparation";
import { samePlan, type ScenePlan } from "./scene-plan";

export type SceneRequest = { focus: ScenePlan; context: ScenePlan; appearance?: PaintOf };
type Display = { focus: SceneMeshes; plan: ScenePlan };
export type SceneSnapshot =
  | { state: "empty"; display: null }
  | { state: "preparing"; display: Display | null; target: ScenePlan }
  | { state: "displayed"; display: Display }
  | { state: "failed"; display: Display | null; target: ScenePlan; error: string };
const EMPTY: SceneSnapshot = { state: "empty", display: null };
const mark = (phase: string, instances: number) => {
  if (typeof location !== "undefined" && new URLSearchParams(location.search).has("scenePerf"))
    performance.mark(`scene:${phase}`, { detail: { instances } });
};

/** One replacement owner per viewport. A pending request never owns the displayed frame. */
export class SceneController {
  private displayLease: SceneMemoryLease | undefined;
  private appearance: PaintOf | undefined;
  private renderer: SceneRenderer | null = null;
  private wanted: SceneRequest | null = null;
  private job: { plan: ScenePlan; focus: SceneMeshes; abort: AbortController } | null = null;
  private snapshot: SceneSnapshot = EMPTY;
  private listeners = new Set<() => void>();
  constructor(private readonly committed: (focusChanged: boolean) => void = () => {}) {}
  read = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(snapshot: SceneSnapshot) {
    this.snapshot = snapshot;
    for (const listener of this.listeners) listener();
  }
  attach(renderer: SceneRenderer) {
    this.renderer = renderer;
    this.advance();
    return () => {
      this.cancel();
      this.renderer = null;
      this.wanted = null;
      this.displayLease?.release();
      this.displayLease = undefined;
      this.publish(EMPTY);
    };
  }
  request(request: SceneRequest | null) {
    this.wanted = request;
    this.advance();
  }
  private cancel() {
    const job = this.job;
    this.job = null;
    job?.abort.abort();
  }
  private advance() {
    const renderer = this.renderer,
      request = this.wanted;
    if (!renderer) return;
    if (!request) {
      this.cancel();
      renderer.canvas.hidden = true;
      renderer.clear();
      this.displayLease?.release();
      this.displayLease = undefined;
      this.publish(EMPTY);
      return;
    }
    renderer.canvas.hidden = false;
    const display = this.snapshot.display;
    const focusChanged = display?.focus !== request.focus.meshes;
    const plan = focusChanged ? request.focus : request.context;
    if (display && samePlan(display.plan, plan)) {
      this.cancel();
      if (this.appearance !== request.appearance) {
        renderer.setAppearance(display.plan, request.appearance);
        this.appearance = request.appearance;
      }
      if (this.snapshot.state !== "displayed") this.publish({ state: "displayed", display });
      return;
    }
    if (this.job && samePlan(this.job.plan, plan)) return;
    if (this.snapshot.state === "failed" && samePlan(this.snapshot.target, plan)) return;
    this.cancel();
    const job = { plan, focus: request.focus.meshes, abort: new AbortController() };
    this.job = job;
    this.publish({ state: "preparing", display, target: plan });
    void this.replace(renderer, job, !focusChanged);
  }
  private async replace(
    renderer: SceneRenderer,
    job: NonNullable<SceneController["job"]>,
    preserve: boolean,
  ) {
    const signal = job.abort.signal;
    let prepared: Awaited<ReturnType<typeof prepareScene>> | undefined;
    let sourceLease: SceneMemoryLease | undefined = sceneMemory.acquire("decoded", {
      buffers: [job.plan.meshes.positions.buffer, job.focus.positions.buffer],
    });
    let staged: Awaited<ReturnType<SceneRenderer["stage"]>> | undefined;
    try {
      // Expose the accepted exact focus before beginning optional context work.
      if (preserve)
        await new Promise<void>((resolve, reject) => {
          let frame = 0;
          const cancelled = () => {
            cancelAnimationFrame(frame);
            reject(signal.reason);
          };
          signal.addEventListener("abort", cancelled, { once: true });
          frame = requestAnimationFrame(() => {
            frame = requestAnimationFrame(() => {
              signal.removeEventListener("abort", cancelled);
              resolve();
            });
          });
        });
      signal.throwIfAborted();
      mark("prepare-start", job.plan.meshes.instances.length);
      prepared = await prepareScene(job.plan, signal);
      signal.throwIfAborted();
      mark("prepare-ready", job.plan.meshes.instances.length);
      staged = await renderer.stage(job.plan, prepared.geometry, signal, preserve);
      signal.throwIfAborted();
      staged.commit(this.wanted?.appearance);
      this.appearance = this.wanted?.appearance;
      this.displayLease?.release();
      this.displayLease = sourceLease;
      sourceLease = undefined;
      this.job = null;
      this.publish({ state: "displayed", display: { focus: job.focus, plan: job.plan } });
      this.committed(!preserve);
      this.advance();
    } catch (error) {
      if (this.job !== job || signal.aborted) return;
      this.job = null;
      this.publish({
        state: "failed",
        display: this.snapshot.display,
        target: job.plan,
        error: `Scene preparation failed: ${String(error)}`,
      });
    } finally {
      staged?.release();
      prepared?.release();
      sourceLease?.release();
    }
  }
}
