import { placesFileSchema } from "../../../../packages/agent-contracts/src/places";
import type { ThreadTab } from "@pe/agent-contracts";
import { peClient } from "#/host/pe-client";
import { peReadings, type Readings } from "#/host/resource-stream";
import { z } from "zod";

const publicationStateSchema = z.object({ state: z.string() });

/** A window's projection of the host list. Focus never travels to the host. */
export class Places {
  private state: { tabs: ThreadTab[]; ready: boolean; error: string | null } = {
    tabs: [], ready: false, error: null,
  };
  private listeners = new Set<() => void>();
  private stop?: () => void;
  private writes = Promise.resolve();
  private pending = 0;
  private refresh?: () => Promise<void>;
  constructor(private client = peClient, private stream: Readings = peReadings) {}
  read = () => this.state;
  private publish(tabs: ThreadTab[], ready: boolean, error: string | null = null) {
    this.state = { tabs, ready, error };
    for (const listener of this.listeners) listener();
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    if (!this.stop) this.connect();
    return () => {
      this.listeners.delete(listener);
      if (!this.listeners.size) {
        this.stop?.(); this.stop = undefined;
        this.publish(this.state.tabs, false, this.state.error);
      }
    };
  };
  private connect() {
    const subscription = crypto.randomUUID();
    const body = { read: "places", args: {}, subscription, generation: 0 };
    let closed = false, running = false, again = false;
    const refresh = async () => {
      if (running) { again = true; return; }
      running = true;
      try {
        const result = await this.client.call("reads.value", { body });
        if (!closed && !this.pending) {
          const list = placesFileSchema.parse(result.value?.data);
          this.publish(list.places, true);
        }
      } catch (error) {
        if (!closed) this.publish(this.state.tabs, false, String(error));
      } finally {
        running = false;
        if (again && !closed) { again = false; void refresh(); }
      }
    };
    const release = this.stream.subscribe({ kind: "publication", subscription, generation: 0 }, frame => {
      if (frame.kind === "snapshot" && !frame.stale) {
        const state = publicationStateSchema.safeParse(frame.value);
        if (state.success && (!this.state.ready || ["refresh-needed", "absent"].includes(state.data.state)))
          void refresh();
      }
      if (frame.kind === "failure") this.publish(this.state.tabs, false, frame.error);
    });
    this.refresh = refresh;
    this.stop = () => {
      closed = true; release(); this.refresh = undefined;
      void this.client.call("reads.value", { body: { ...body, release: true } }).catch(() => {});
    };
  }
  save(tabs: ThreadTab[]) {
    if (!this.state.ready) throw Error("Places are not available from the host yet.");
    placesFileSchema.parse({ places: tabs });
    this.pending++;
    this.publish(tabs, true);
    this.writes = this.writes.then(async () => {
      try { await this.client.call("places.put", { body: { places: tabs } }); }
      catch (error) { this.publish(this.state.tabs, false, String(error)); }
      finally { this.pending--; if (!this.pending) void this.refresh?.(); }
    });
  }
}
export const places = new Places();

type FocusStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export const readFocus = (storage: FocusStorage = sessionStorage): string | null => {
  try { return storage.getItem("pe.place.focus"); } catch { return null; }
};
export function focus(id: string | null, storage: FocusStorage = sessionStorage) {
  try {
    if (id) storage.setItem("pe.place.focus", id);
    else storage.removeItem("pe.place.focus");
  } catch { /* The URL still owns this window's visible Place. */ }
}
