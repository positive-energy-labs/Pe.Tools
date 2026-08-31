import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import * as Atom from "effect/unstable/reactivity/Atom";
import type * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
import {
  address,
  type FamilyDocument,
  type RouteStateWriteResult,
  type SettingsRouteDocument,
} from "@pe/agent-contracts";

import { createFamilyStore } from "#/family/store";
import type { Slice } from "#/state/route-store";

const slice = <D>(doc: D): Slice<D> => ({
  doc,
  revision: 0,
  hydrated: true,
  connected: false,
  error: null,
  peaActive: false,
});

const refused = async (): Promise<RouteStateWriteResult> => ({
  ok: false,
  kind: "refused",
  error: "fixture family writes are disabled",
  hint: "open /family without source=fixture to use live family commands",
});

export function createFixtureFamilyStore(registry: AtomRegistry.AtomRegistry) {
  return createFamilyStore({
    registry,
    scope: { documentAddress: address("C:\\Fixtures\\family-review.rfa") },
    slices: {
      settings: Atom.make(
        AsyncResult.success(
          slice<SettingsRouteDocument>({ bindings: {}, documentId: null, fields: {} }),
        ),
      ),
      family: Atom.make(
        AsyncResult.success(slice<FamilyDocument>({ bindings: {}, doc: null, evidence: null })),
      ),
    },
    host: {
      sessions: async () => [],
      profile: async () => [],
      settings: async () => {
        throw new Error("fixture family settings reads are disabled");
      },
    },
    writers: {
      settingsApply: refused,
      settingsCommand: refused,
      familyApply: refused,
      familyCommand: refused,
    },
  });
}
