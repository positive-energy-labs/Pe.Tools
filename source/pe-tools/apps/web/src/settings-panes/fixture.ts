/**
 * PROTOTYPE FIXTURE — the settings fixture world (see docs/features/settings/PRODUCT.md).
 *
 * Upgraded 2026-08-17 from an invented VAV profile to the REAL world, captured live:
 * the actual CmdScheduleManager module catalog, the actual schedules tree, the actual
 * MechEquip/TEST.json (fragment $includes intact — fixture-content.ts), and the actual
 * ScheduleProfile schema with its x-options (fixture-schema.ts). Shared by the shipped
 * route's `?source=fixture` lane AND the round `?variant=` forks — one world, comparable
 * verdicts. Declared fixture lane: a chip announces it; nothing here can be written
 * through (null version token) — inert by construction.
 */
import type { SettingsRouteDocument, SettingsFieldState } from "@pe/agent-contracts";
import {
  SettingsFileKind,
  type SettingsFileEntry,
  type SettingsWorkspaceDescriptor,
} from "@pe/host-contracts/operation-types";

import { FIXTURE_DOCUMENT_RAW } from "./fixture-content";

export { FIXTURE_SCHEMA_JSON } from "./fixture-schema";

/* ── the workspace / module / root world — as settings.workspaces served it live ── */

export const fixtureWorkspaces: SettingsWorkspaceDescriptor[] = [
  {
    workspaceKey: "default",
    displayName: "Default Workspace",
    basePath: "C:/Users/kaitp/OneDrive/Documents/Pe.Tools/settings",
    modules: [
      {
        moduleKey: "CmdScheduleManager",
        defaultRootKey: "schedules",
        roots: [
          { rootKey: "schedules", displayName: "schedules" },
          { rootKey: "batch", displayName: "batch" },
        ],
      },
      {
        moduleKey: "FamilyFoundry",
        defaultRootKey: "models",
        roots: [{ rootKey: "models", displayName: "Family Models" }],
      },
      {
        moduleKey: "Global",
        defaultRootKey: "fragments",
        roots: [{ rootKey: "fragments", displayName: "fragments" }],
      },
    ],
  },
];

/* ── the file listing — the real schedules tree as settings.tree served it live ── */

function file(relativePath: string, modifiedUtc: string): SettingsFileEntry {
  const baseName = relativePath.split("/").at(-1) ?? relativePath;
  const directory = relativePath.includes("/")
    ? relativePath.slice(0, relativePath.lastIndexOf("/"))
    : null;
  return {
    baseName,
    directory,
    isFragment: false,
    isSchema: false,
    kind: SettingsFileKind.Profile,
    modifiedUtc,
    name: baseName.replace(/\.json$/, ""),
    path: `C:/Users/kaitp/OneDrive/Documents/Pe.Tools/settings/CmdScheduleManager/schedules/${relativePath}`,
    relativePath,
    relativePathWithoutExtension: relativePath.replace(/\.json$/, ""),
  };
}

export const fixtureFiles: SettingsFileEntry[] = [
  file("MechEquip/TEST.json", "2026-06-16T22:50:54Z"),
  file("MechEquip/WS.json", "2026-06-12T15:20:00Z"),
  file("MechEquip/IU VRF.json", "2026-06-10T09:41:00Z"),
  file("MechEquip/IU VRF Perf.json", "2026-06-10T09:44:00Z"),
  file("MechEquip/IU Hydronic.json", "2026-05-28T11:02:00Z"),
  file("MechEquip/IU Hydronic Perf.json", "2026-05-28T11:05:00Z"),
  file("MechEquip/UH.json", "2026-05-21T16:30:00Z"),
  file("MechEquip/MA.json", "2026-05-19T08:15:00Z"),
  file("WIP/WSFU.json", "2026-07-02T14:00:00Z"),
  file("profiles/invalid-but-saved.json", "2026-04-30T10:00:00Z"),
];

/* ── the open document — the real MechEquip/TEST.json ──────────────────────── */

export const fixtureRawContent = FIXTURE_DOCUMENT_RAW;

/** Seeded trichotomy states on REAL pointers in the real document — one of each thing
 * a reviewer must be able to see: an open pea proposal (note + confidence), a staged
 * value, and a staged value flagged `attention` (the save gate's one hard refusal). */
const fixtureFields: Record<string, SettingsFieldState> = {
  "/ViewTemplateName": {
    proposal: {
      value: "Schedule - PE Standard v2",
      by: "pea",
      note: "office template register lists v2 as current for performance schedules",
      confidence: "high",
    },
    staged: null,
    review: "none",
  },
  "/IsItemized": {
    proposal: null,
    staged: { value: false },
    review: "good",
  },
  "/Fields/1/ColumnHeaderOverride": {
    proposal: null,
    staged: { value: "REFRIGERANT TYPE (FULL DESIGNATION)" },
    review: "attention",
  },
};

export const fixtureDocument: SettingsRouteDocument = {
  binding: { target: fixtureFiles[0]!.path },
  snapshot: {
    from: {
      target: fixtureFiles[0]!.path,
      documentId: fixtureFiles[0]!.path,
      settingsDocumentId: {
        moduleKey: "CmdScheduleManager",
        rootKey: "schedules",
        relativePath: "MechEquip/TEST.json",
      },
      observedAt: "2026-08-17T00:00:00Z",
    },
    rawContent: FIXTURE_DOCUMENT_RAW,
    composedContent: null,
    modifiedUtc: "2026-06-16T22:50:54Z",
    validation: {
      isValid: false,
      issues: [
        {
          // Seeded scenario (the real file is valid): exercises issue-to-field joinery.
          message:
            'seeded fixture issue — "REFRIGERANT TYPE (FULL DESIGNATION)" exceeds the column-header budget',
          severity: "error",
          path: "/Fields/1/ColumnHeaderOverride",
        },
      ],
    },
  },
  fields: fixtureFields,
  savedAt: "2026-06-16T22:50:54Z",
};

/** Raw content for the other tree files so tree clicks feel real. Falls back to a
 * small real-shaped profile — the tree story, not the file contents, is under review. */
export function fixtureRawFor(relativePath: string): string {
  if (relativePath === "MechEquip/TEST.json") return FIXTURE_DOCUMENT_RAW;
  const name =
    relativePath
      .split("/")
      .at(-1)
      ?.replace(/\.json$/, "") ?? relativePath;
  return JSON.stringify(
    {
      Name: `${name} Schedule`,
      CategoryName: "Mechanical Equipment",
      ViewTemplateName: "Schedule - PE Standard",
      IsItemized: true,
      Fields: [
        { $include: "@local/_fields/Header" },
        { ParameterName: "PE_G___NotesInstance", ColumnHeaderOverride: "Notes" },
      ],
      SortGroup: [{ FieldName: "PE_G___TagInstance" }],
      Filters: [],
    },
    null,
    2,
  );
}
