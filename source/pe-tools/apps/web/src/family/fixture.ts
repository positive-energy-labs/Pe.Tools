import { pageScope, type Slice } from "#/state/route-store";
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
import box from "../../../../../Pe.Revit.Tests/Fixtures/FamilyModel/a-box.family.json?raw";
import grd from "../../../../../Pe.Revit.Tests/Fixtures/FamilyModel/b-grd.family.json?raw";
import bath from "../../../../../Pe.Revit.Tests/Fixtures/FamilyModel/c-bath-shower.family.json?raw";
import refline from "../../../../../Pe.Revit.Tests/Fixtures/FamilyModel/d-bath-shower-refline.family.json?raw";

export const familyFixtures = { box, grd, bath, refline };
export type FamilyFixtureName = keyof typeof familyFixtures;

const slice = <D>(doc: D): Slice<D> => ({
  doc,
  revision: 0,
  hydrated: true,
  connected: false,
  error: null,
});

const refused = async (): Promise<RouteStateWriteResult> => ({
  ok: false,
  kind: "refused",
  error: "fixture family writes are disabled",
  hint: "open /family without source=fixture to use live family commands",
});

export function createFixtureFamilyStore(
  registry: AtomRegistry.AtomRegistry,
  fixture?: FamilyFixtureName,
) {
  const documentId = fixture
    ? { moduleKey: "FamilyFoundry", rootKey: "models", relativePath: fixture }
    : null;
  return createFamilyStore({
    source: "fixture",
    registry,
    scope: pageScope(address("C:\\Fixtures\\family-review.rfa")),
    slices: {
      settings: Atom.make(
        AsyncResult.success(slice<SettingsRouteDocument>({ bindings: {}, documentId, fields: {} })),
      ),
      family: Atom.make(
        AsyncResult.success(slice<FamilyDocument>({ bindings: {}, doc: null, evidence: null })),
      ),
    },
    host: {
      sessions: async () => [],
      profile: async () => Object.keys(familyFixtures),
      settings: async () => {
        if (fixture && documentId)
          return {
            documentId,
            path: `${fixture}.family.json`,
            versionToken: "fixture-native-v1",
            observedAt: "2026-09-06T00:00:00Z",
            rawContent: familyFixtures[fixture],
            composedContent: familyFixtures[fixture],
            validation: null,
          };
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
