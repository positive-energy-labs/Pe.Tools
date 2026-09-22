import { workKey, type RouteStatePatch, type WorkKey } from "@pe/agent-contracts";
import { causeRefusal, type Refusal } from "#/route/refusal";
import type { Draft } from "./model";

type Apply = (patches: RouteStatePatch[], expectedRevision: number) => Promise<Refusal | null>;

/** Unacknowledged editor input belongs to its file, including while no pane is mounted. */
export class FamilyEditBuffer {
  private pending = new Map<string, RouteStatePatch>();
  private revision = 0;
  private observedRevision = 0;
  private running: Promise<void> | undefined;
  private listeners = new Set<() => void>();
  private state: { draft: Draft | null; failure: Refusal | null } = { draft: null, failure: null };
  constructor(public apply: Apply) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(draft: Draft | null, failure: Refusal | null) {
    this.state = { draft, failure };
    this.listeners.forEach((listener) => listener());
  }
  stage(draft: Draft, patches: RouteStatePatch[], revision: number) {
    if (!patches.length) return;
    if (!this.pending.size && !this.running) this.revision = Math.max(this.revision, revision);
    for (const patch of patches) this.pending.set(JSON.stringify(patch.path), patch);
    this.publish(draft, this.state.failure);
    // A refusal requires an explicit retry; more typing must not silently rebase failed input.
    if (!this.state.failure) void this.flush().catch(() => undefined);
  }
  observe(revision: number) {
    this.observedRevision = revision;
    if (!this.pending.size && !this.state.failure && revision >= this.revision && this.state.draft)
      this.publish(null, null);
  }
  flush = (): Promise<void> => {
    if (this.running) return this.running;
    this.running = this.drain().finally(() => {
      this.running = undefined;
    });
    return this.running;
  };
  private async drain() {
    while (this.pending.size) {
      const submitted = [...this.pending.entries()];
      let failure: Refusal | null;
      try {
        failure = await this.apply(
          submitted.map(([, patch]) => patch),
          this.revision,
        );
      } catch (error) {
        failure = causeRefusal(error);
      }
      if (failure) {
        this.publish(this.state.draft, failure);
        throw Error(failure.message);
      }
      this.revision++;
      for (const [key, patch] of submitted) {
        if (this.pending.get(key) === patch) this.pending.delete(key);
      }
      this.publish(
        this.pending.size || this.observedRevision < this.revision ? this.state.draft : null,
        null,
      );
    }
  }
}

const buffers = new Map<string, FamilyEditBuffer>();
export function familyEditBuffer(key: WorkKey, apply: Apply) {
  const id = workKey(key);
  let buffer = buffers.get(id);
  if (!buffer) {
    buffer = new FamilyEditBuffer(apply);
    buffers.set(id, buffer);
  }
  buffer.apply = apply;
  return buffer;
}
