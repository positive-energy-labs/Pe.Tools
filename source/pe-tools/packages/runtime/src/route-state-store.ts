/**
 * Durable route-state store — survives host restart.
 *
 * Route-state documents live under `route:*` keys of the AgentController session state
 * (see route-state-dispatch.ts). Session state is in-memory and RESETS on host restart,
 * even though thread history persists — so staged, human-owned work (a mid-commit
 * family-types edit) was lost across a restart. This store write-throughs those keys to a
 * small JSON file and rehydrates them into session state at composition, before the first
 * read.
 *
 * Keying: one file per session resource id. Pea's resource id is
 * `pea:base64url(workspaceRoot)` (see createLocalResourceId) — deterministic and STABLE
 * across restarts for a given workspace, so the same workspace re-attaches to its own file.
 * Only `route:*` keys are touched; all other session state is left to the harness.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getDefaultPeaProductStateDirectory } from "./storage/profiles.ts";
import type { RouteStateSession } from "./route-state-dispatch.ts";

const ROUTE_KEY_PREFIX = "route:";

export interface RouteStateStore {
  /** Read the persisted `route:*` slice (empty when the file is missing or corrupt). */
  read(): Record<string, unknown>;
  /** Atomically replace the persisted slice with the `route:*` keys of `state`. */
  write(state: Record<string, unknown>): void;
}

/** A file-backed store keyed by session resource id, under the host state directory. */
export function createRouteStateStore(resourceId: string, stateDir?: string): RouteStateStore {
  const dir = path.join(stateDir ?? getDefaultPeaProductStateDirectory(), "route-state");
  const file = path.join(dir, `${sanitizeResourceId(resourceId)}.json`);
  return {
    read() {
      try {
        const parsed = JSON.parse(readFileSync(file, "utf8")) as unknown;
        return pickRouteKeys(parsed);
      } catch {
        return {};
      }
    },
    write(state) {
      mkdirSync(dir, { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify(pickRouteKeys(state)), "utf8");
      renameSync(tmp, file); // atomic replace on the same volume
    },
  };
}

/**
 * Wrap a session so route-state writes are durable: rehydrate the persisted `route:*` keys
 * into session state (filling only absent keys, never clobbering live state), then
 * write-through on every update. Non-`route:*` state is untouched.
 */
export async function makeDurableRouteStateSession(
  session: RouteStateSession,
  store: RouteStateStore,
): Promise<RouteStateSession> {
  const persisted = store.read();
  const keys = Object.keys(persisted);
  if (keys.length > 0) {
    await session.update((state) => {
      const updates: Record<string, unknown> = {};
      for (const key of keys) if (state[key] == null) updates[key] = persisted[key];
      return { updates, result: undefined };
    });
  }
  return {
    getState: () => session.getState(),
    update: async (updater) => {
      const result = await session.update(updater);
      store.write(session.getState());
      return result;
    },
  };
}

function pickRouteKeys(value: unknown): Record<string, unknown> {
  if (value == null || typeof value !== "object") return {};
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (key.startsWith(ROUTE_KEY_PREFIX)) out[key] = v;
  }
  return out;
}

/** Resource ids carry `:` and base64url — keep the readable head, hash the whole for uniqueness. */
function sanitizeResourceId(resourceId: string): string {
  const safe = resourceId.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
  return safe || "default";
}
