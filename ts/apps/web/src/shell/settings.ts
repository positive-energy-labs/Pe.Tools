import {
  routeSettingsSnapshotSchema,
  settingsSchema,
  type RouteGraph,
  type SettingField,
  type RouteSettingsSnapshot,
} from "@pe/agent-contracts";
import { peRouteUrl } from "@pe/agent-contracts/pe-api";
import { peReadings } from "../readings";
import { requestJson } from "./readings-api";

export const settingFields = (graph: Pick<RouteGraph<any, any>, "fields">) =>
  Object.fromEntries(
    Object.entries(graph.fields).filter(([, f]) => f.role === "setting"),
  ) as Record<string, SettingField>;

export interface SettingsTransport {
  read(this: void, signal: AbortSignal): Promise<RouteSettingsSnapshot>;
  write(
    patch: Record<string, unknown>,
    revision: number,
    signal: AbortSignal,
  ): Promise<RouteSettingsSnapshot>;
  subscribe(this: void, notify: () => void): () => void;
}

/** One acknowledged settings store per route, shared by every mount and both Settings surfaces. */
export function createSettingsOwner(
  fields: Record<string, SettingField>,
  transport: SettingsTransport,
) {
  const schema = settingsSchema(fields);
  let state = {
    values: schema.parse({}),
    revision: -1,
    pending: false,
    error: null as string | null,
  };
  const listeners = new Set<() => void>();
  const controllers = new Set<AbortController>();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  const accept = (raw: RouteSettingsSnapshot) => {
    const snapshot = routeSettingsSnapshotSchema.parse(raw);
    if (snapshot.revision < state.revision) return;
    state = {
      values: schema.parse(snapshot.values),
      revision: snapshot.revision,
      pending: state.pending,
      error: null,
    };
    notify();
  };
  const run = async (
    operation: (signal: AbortSignal) => Promise<RouteSettingsSnapshot>,
    writing = false,
  ) => {
    const controller = new AbortController();
    controllers.add(controller);
    try {
      const result = await operation(controller.signal);
      if (!controller.signal.aborted) accept(result);
    } catch (error) {
      if (controller.signal.aborted) return;
      state = {
        ...state,
        error: error instanceof Error ? error.message : String(error),
      };
      notify();
      throw error;
    } finally {
      controllers.delete(controller);
      if (writing) {
        state = { ...state, pending: false };
        notify();
      }
    }
  };
  const refresh = () => run(transport.read).catch(() => {});
  let users = 0;
  let release = () => {};
  return {
    read: () => state,
    subscribe(this: void, notify: () => void) {
      listeners.add(notify);
      return () => {
        listeners.delete(notify);
      };
    },
    refresh,
    connect() {
      if (++users === 1 && Object.keys(fields).length) {
        release = transport.subscribe(() => void refresh());
        void refresh();
      }
      return () => {
        if (--users === 0) {
          release();
          for (const controller of controllers) controller.abort();
        }
      };
    },
    async set(patch: Record<string, unknown>) {
      if (state.revision < 0 || state.pending)
        throw Error("Wait for settings to finish loading or saving");
      try {
        schema.partial().parse(patch);
      } catch (error) {
        state = { ...state, error: error instanceof Error ? error.message : String(error) };
        notify();
        throw error;
      }
      const revision = state.revision;
      state = { ...state, pending: true, error: null };
      notify();
      await run((signal) => transport.write(patch, revision, signal), true);
    },
  };
}
export type SettingsOwner = ReturnType<typeof createSettingsOwner>;
const owners = new WeakMap<object, SettingsOwner>();
export function graphSettings(graph: RouteGraph<any, any>): SettingsOwner {
  let owner = owners.get(graph);
  if (!owner) {
    owner = createSettingsOwner(settingFields(graph), {
      read: (signal) =>
        requestJson(
          { path: peRouteUrl("route-settings.get", { params: { route: graph.key } }) },
          routeSettingsSnapshotSchema,
          signal,
        ),
      write: (patch, expectedRevision, signal) =>
        requestJson(
          {
            path: peRouteUrl("route-settings.set", { params: { route: graph.key } }),
            body: { patch, expectedRevision },
          },
          routeSettingsSnapshotSchema,
          signal,
        ),
      subscribe: (notify) =>
        peReadings.subscribe({ kind: "world" }, (frame) => {
          if (frame.kind === "gap" || frame.kind === "stale") return notify();
          if (frame.kind !== "event") return;
          const event = frame.value as { type?: string; route?: string };
          if (event?.type === "route-settings-changed" && event.route === graph.key) notify();
        }),
    });
    owners.set(graph, owner);
  }
  return owner;
}
