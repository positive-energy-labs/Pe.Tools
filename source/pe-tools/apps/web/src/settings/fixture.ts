import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import * as Atom from "effect/unstable/reactivity/Atom";
import type * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
import {
  address,
  applyPatches,
  settingsRouteState,
  type RouteEnvelope,
  type SettingsRouteDocument,
} from "@pe/agent-contracts";

import {
  FIXTURE_SCHEMA_JSON,
  fixtureDocument,
  fixtureFiles,
  fixtureRawFor,
  fixtureSnapshot,
  fixtureWorkspaces,
} from "#/settings-panes/fixture";
import { createSettingsStore } from "#/settings/store";

export const fixtureSettingsAddress = address("C:\\Fixtures\\settings-review.rvt");
export const fixtureSettingsPicker = {
  workspaceKey: fixtureWorkspaces[0]!.workspaceKey,
  moduleKey: fixtureDocument.documentId!.moduleKey,
  rootKey: fixtureDocument.documentId!.rootKey,
  filePath: fixtureFiles[0]!.path,
};

const fixtureSchemaJson = JSON.stringify(JSON.parse(FIXTURE_SCHEMA_JSON), (key, value) =>
  key === "x-options" ? undefined : value,
);

export function createFixtureSettingsStore(registry: AtomRegistry.AtomRegistry) {
  let envelope: RouteEnvelope<SettingsRouteDocument> = {
    version: 1,
    revision: 0,
    doc: structuredClone(fixtureDocument),
  };
  const changed = Atom.make(0);
  const slice = Atom.make((get) => {
    get(changed);
    return AsyncResult.success({
      doc: envelope.doc,
      revision: envelope.revision,
      hydrated: true,
      connected: false,
      error: null,
      peaActive: false,
    });
  });
  const store = createSettingsStore({
    registry,
    scope: { documentAddress: fixtureSettingsAddress },
    slice,
    apply: async (patches) => {
      const result = applyPatches(
        settingsRouteState,
        envelope,
        "human",
        patches,
        envelope.revision,
      );
      if (!result.ok) return result;
      envelope = result.envelope;
      registry.update(changed, (value) => value + 1);
      return { ok: true, revision: envelope.revision, doc: envelope.doc };
    },
    command: async () => ({
      ok: false,
      kind: "refused",
      error: "fixture settings commands are disabled",
      hint: "open /settings without source=fixture to use live settings commands.",
    }),
    host: {
      workspaces: async () => fixtureWorkspaces,
      tree: async () => fixtureFiles,
      schema: async () => fixtureSchemaJson,
      open: async (documentId) => {
        const file = fixtureFiles.find((entry) => entry.relativePath === documentId.relativePath);
        return {
          ...fixtureSnapshot,
          documentId,
          path: file?.path ?? fixtureSnapshot.path,
          rawContent: fixtureRawFor(documentId.relativePath),
          modifiedUtc: file?.modifiedUtc ?? fixtureSnapshot.modifiedUtc,
        };
      },
    },
  });
  return store;
}
