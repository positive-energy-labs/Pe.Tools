/**
 * PROTOTYPE FIXTURE — a local stand-in for `useRouteState(settingsRouteState)` so the
 * shipped /settings works with NO host at all (`?source=fixture`, the takeoffs pattern:
 * an explicit URL choice, never a fallback). Commands and patches run against in-memory
 * state; "save" splices staged fields into the local raw content exactly like the real
 * save op, so the full open → form-edit → stage → save loop is drivable — and nothing
 * ever leaves the page.
 */
import { useCallback, useRef, useState } from "react";

import {
  settingsFieldSegments,
  type SettingsFieldState,
  type SettingsRouteDocument,
} from "@pe/agent-contracts";

import { fixtureDocument, fixtureRawFor } from "./fixture";

type WriteResult = { ok: boolean; error?: string | null; hint?: string | null };

export interface FixtureSettingsRoute {
  slice: SettingsRouteDocument;
  connected: boolean;
  peaActive: boolean;
  error: null;
  command: (name: string, input?: unknown) => Promise<WriteResult>;
  apply: (patches: { path: (string | number)[]; value?: unknown }[]) => Promise<WriteResult>;
}

function spliceStagedIntoRaw(rawContent: string, fields: SettingsRouteDocument["fields"]): string {
  const parsed = JSON.parse(rawContent) as Record<string, unknown>;
  for (const [pointer, field] of Object.entries(fields)) {
    if (field.staged == null) continue;
    const segments = settingsFieldSegments(pointer);
    let cursor: Record<string, unknown> = parsed;
    for (const segment of segments.slice(0, -1)) {
      const next = cursor[segment];
      if (next == null || typeof next !== "object") {
        cursor[segment] = {};
      }
      cursor = cursor[segment] as Record<string, unknown>;
    }
    const leaf = segments.at(-1);
    if (leaf === undefined) continue;
    if (field.staged.delete === true) delete cursor[leaf];
    else cursor[leaf] = field.staged.value;
  }
  return JSON.stringify(parsed, null, 2);
}

export function useFixtureSettingsRoute(): FixtureSettingsRoute {
  const [document, setDocument] = useState<SettingsRouteDocument>(fixtureDocument);
  const saveCounter = useRef(0);

  const command = useCallback(async (name: string, input?: unknown): Promise<WriteResult> => {
    switch (name) {
      case "open": {
        const documentId = (input as { documentId?: SettingsRouteDocument["snapshot"] } | undefined)
          ?.documentId as { moduleKey: string; rootKey: string; relativePath: string } | undefined;
        if (!documentId) return { ok: false, error: "open needs a documentId." };
        setDocument((prev) => ({
          ...prev,
          snapshot: {
            documentId,
            rawContent: fixtureRawFor(documentId.relativePath),
            composedContent: null,
            versionToken: null,
            modifiedUtc: new Date().toISOString(),
            // Only the seeded TEST.json carries the seeded validation scenario.
            validation:
              documentId.relativePath === "MechEquip/TEST.json"
                ? fixtureDocument.snapshot?.validation
                : { isValid: true, issues: [] },
            takenAt: new Date().toISOString(),
          },
          // Real open preserves open proposals; the fixture mirrors that.
          fields: documentId.relativePath === "MechEquip/TEST.json" ? fixtureDocument.fields : {},
        }));
        return { ok: true };
      }
      case "refresh": {
        setDocument((prev) =>
          prev.snapshot
            ? { ...prev, snapshot: { ...prev.snapshot, takenAt: new Date().toISOString() } }
            : prev,
        );
        return { ok: true };
      }
      case "validate":
        // ponytail: advisory no-op — the fixture has no schema runner; the seeded
        // validation stands. Re-add ajv (recovered settings-validation) for real dry-runs.
        return { ok: true };
      case "save": {
        let failed: string | undefined;
        setDocument((prev) => {
          if (!prev.snapshot) {
            failed = "No document open.";
            return prev;
          }
          const attention = Object.values(prev.fields).some(
            (field) => field.review === "attention" && field.staged != null,
          );
          if (attention) {
            failed =
              "A staged field needs attention — the fixture save refuses, like the real one.";
            return prev;
          }
          saveCounter.current += 1;
          const rawContent = spliceStagedIntoRaw(prev.snapshot.rawContent, prev.fields);
          const fields: Record<string, SettingsFieldState> = Object.fromEntries(
            Object.entries(prev.fields)
              .map(([pointer, field]): [string, SettingsFieldState] => [
                pointer,
                { ...field, staged: null, review: "none" },
              ])
              .filter(([, field]) => field.proposal != null),
          );
          return {
            ...prev,
            snapshot: {
              ...prev.snapshot,
              rawContent,
              versionToken: `fixture-${saveCounter.current}`,
              validation: { isValid: true, issues: [] },
            },
            fields,
            savedAt: new Date().toISOString(),
          };
        });
        return failed ? { ok: false, error: failed } : { ok: true };
      }
      default:
        return { ok: false, error: `The fixture lane has no "${name}" command.` };
    }
  }, []);

  /** Only `["fields", pointer, member]` patches exist on this route; a missing `value`
   * clears the member — the same shape route.apply sends to the real dispatcher. */
  const apply = useCallback(
    async (patches: { path: (string | number)[]; value?: unknown }[]): Promise<WriteResult> => {
      setDocument((prev) => {
        const fields = { ...prev.fields };
        for (const patch of patches) {
          const [head, pointer, member] = patch.path;
          if (head !== "fields" || typeof pointer !== "string" || typeof member !== "string")
            continue;
          const field: SettingsFieldState = fields[pointer] ?? {
            proposal: null,
            staged: null,
            review: "none",
          };
          fields[pointer] = { ...field, [member]: patch.value ?? null } as SettingsFieldState;
        }
        return { ...prev, fields };
      });
      return { ok: true };
    },
    [],
  );

  return { slice: document, connected: true, peaActive: false, error: null, command, apply };
}
