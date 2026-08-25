import type * as Atom from "effect/unstable/reactivity/Atom";
import type * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import {
  type RouteStatePatch,
  type RouteStateWriteResult,
  type SettingsRouteDocument,
} from "@pe/agent-contracts";
import type {
  SettingsFileEntry,
  SettingsWorkspaceDescriptor,
} from "@pe/host-contracts/operation-types";

import { callHostRpc } from "#/host/client";
import type { Slice } from "#/state/route-store";

export interface SettingsHost {
  readonly document?: Atom.Atom<AsyncResult.AsyncResult<Slice<SettingsRouteDocument>, Error>>;
  workspaces(): Promise<readonly SettingsWorkspaceDescriptor[]>;
  tree(moduleKey: string, rootKey: string): Promise<readonly SettingsFileEntry[]>;
  schema(moduleKey: string, rootKey: string): Promise<string>;
  apply?(patches: RouteStatePatch[]): Promise<RouteStateWriteResult>;
  command?(name: "bind" | "open" | "refresh" | "validate" | "save", input?: unknown): Promise<RouteStateWriteResult>;
}

export function createLiveSettingsHost(): SettingsHost {
  return {
    async workspaces() {
      return (await callHostRpc("settings.workspaces", undefined)).workspaces;
    },
    async tree(moduleKey, rootKey) {
      return (await callHostRpc("settings.tree", {
        moduleKey,
        rootKey,
        subDirectory: "",
        recursive: true,
        includeFragments: false,
        includeSchemas: false,
      })).files;
    },
    async schema(moduleKey, rootKey) {
      return (await callHostRpc("settings.schema", { moduleKey, rootKey })).schemaJson;
    },
  };
}
