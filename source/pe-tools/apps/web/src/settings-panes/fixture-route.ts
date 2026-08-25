import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import * as Atom from "effect/unstable/reactivity/Atom";
import type * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
import {
  type RouteStatePatch,
  type RouteStateWriteResult,
  type SettingsFieldState,
  type SettingsRouteDocument,
} from "@pe/agent-contracts";

import type { SettingsHost } from "#/settings/host";
import { projectStagedValues } from "#/settings/store";
import {
  FIXTURE_SCHEMA_JSON,
  fixtureDocument,
  fixtureFiles,
  fixtureRawFor,
  fixtureWorkspaces,
} from "./fixture";

export function createFixtureSettingsHost(registry: AtomRegistry.AtomRegistry): SettingsHost {
  let document = structuredClone(fixtureDocument);
  let revision = 0;
  const state = () => ({ doc: document, hydrated: true, connected: true, error: null, peaActive: false });
  const changed = Atom.make(0);
  const slice = Atom.make((get) => {
    get(changed);
    return AsyncResult.success(state());
  });
  const publish = (next: SettingsRouteDocument) => {
    document = next;
    registry.update(changed, (value) => value + 1);
  };
  const version = () => `fixture-${++revision}`;

  return {
    document: slice,
    workspaces: async () => fixtureWorkspaces,
    tree: async (moduleKey, rootKey) =>
      moduleKey === "CmdScheduleManager" && rootKey === "schedules" ? fixtureFiles : [],
    schema: async (moduleKey) => moduleKey === "CmdScheduleManager" ? FIXTURE_SCHEMA_JSON : "{}",
    sessions: async () => [],
    async apply(patches: RouteStatePatch[]): Promise<RouteStateWriteResult> {
      const fields = { ...document.fields };
      for (const patch of patches) {
        const [head, pointer, member] = patch.path;
        if (head !== "fields" || typeof pointer !== "string" || typeof member !== "string") continue;
        const field: SettingsFieldState = fields[pointer] ?? {
          proposal: null,
          staged: null,
          review: "none",
        };
        fields[pointer] = { ...field, [member]: patch.value ?? null } as SettingsFieldState;
      }
      publish({ ...document, fields });
      return { ok: true, doc: document };
    },
    async command(name, input): Promise<RouteStateWriteResult> {
      if (name === "bind") {
        const target = (input as { target?: string | null } | undefined)?.target ?? null;
        publish({ ...document, binding: { target, boundAt: new Date().toISOString() } });
        return { ok: true, doc: document };
      }
      if (name === "open") {
        const documentId = (input as {
          documentId?: { moduleKey: string; rootKey: string; relativePath: string };
        } | undefined)?.documentId;
        if (!documentId) return { ok: false, error: "open needs a documentId." };
        publish({
          ...document,
          snapshot: {
            documentId,
            rawContent: fixtureRawFor(documentId.relativePath),
            composedContent: null,
            versionToken: version(),
            modifiedUtc: new Date().toISOString(),
            validation:
              documentId.relativePath === "MechEquip/TEST.json"
                ? fixtureDocument.snapshot?.validation
                : { isValid: true, issues: [] },
            takenAt: new Date().toISOString(),
          },
          fields:
            documentId.relativePath === "MechEquip/TEST.json"
              ? structuredClone(fixtureDocument.fields)
              : {},
        });
        return { ok: true, doc: document };
      }
      if (name === "refresh" || name === "validate") {
        if (!document.snapshot) return { ok: false, error: "No document open." };
        publish({
          ...document,
          snapshot: {
            ...document.snapshot,
            versionToken: version(),
            takenAt: new Date().toISOString(),
          },
        });
        return { ok: true, doc: document };
      }
      if (name === "save") {
        if (!document.snapshot) return { ok: false, error: "No document open." };
        if (
          Object.values(document.fields).some(
            (field) => field.review === "attention" && field.staged != null,
          )
        )
          return { ok: false, error: "A staged field needs attention." };
        const rawContent = JSON.stringify(
          projectStagedValues(document.snapshot.rawContent, document.fields),
          null,
          2,
        );
        const fields = Object.fromEntries(
          Object.entries(document.fields)
            .map(([pointer, field]): [string, SettingsFieldState] => [
              pointer,
              { ...field, staged: null, review: "none" },
            ])
            .filter(([, field]) => field.proposal != null),
        );
        publish({
          ...document,
          snapshot: {
            ...document.snapshot,
            rawContent,
            versionToken: version(),
            validation: { isValid: true, issues: [] },
          },
          fields,
          savedAt: new Date().toISOString(),
        });
        return { ok: true, doc: document };
      }
      return { ok: false, error: `The fixture lane has no "${name}" command.` };
    },
  };
}
