/**
 * PROTOTYPE FIXTURE — settings-panes round 1 (throwaway; see docs/features/settings/PRODUCT.md).
 *
 * The one shared world every `?variant=` fork of /settings renders. Real domain data — a
 * schedule-profile settings module shaped after `SharedScheduleProfile` (the CmdScheduleManager
 * story) — NOT placeholder lorem, because verdicts on density/legibility need real values.
 * Declared fixture lane: variants render a fixture chip; nothing here can be written through
 * (null-token snapshot, no host calls) — inert by construction.
 */
import type { SettingsRouteDocument, SettingsFieldState } from "@pe/agent-contracts";
import {
  SettingsFileKind,
  type SettingsFileEntry,
  type SettingsWorkspaceDescriptor,
} from "@pe/host-contracts/operation-types";

/* ── the workspace / module / root world (settings.workspaces) ─────────────── */

export const fixtureWorkspaces: SettingsWorkspaceDescriptor[] = [
  {
    workspaceKey: "office",
    displayName: "PE Office",
    basePath: "C:/ProgramData/pe/settings",
    modules: [
      {
        moduleKey: "pe.schedules",
        defaultRootKey: "profiles",
        roots: [
          { rootKey: "profiles", displayName: "Schedule profiles" },
          { rootKey: "batch", displayName: "Batch runs" },
        ],
      },
      {
        moduleKey: "pe.families",
        defaultRootKey: "profiles",
        roots: [{ rootKey: "profiles", displayName: "Family profiles" }],
      },
    ],
  },
];

/* ── the file listing (settings.tree, recursive) — enough depth for a real tree ── */

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
    path: `C:/ProgramData/pe/settings/pe.schedules/profiles/${relativePath}`,
    relativePath,
    relativePathWithoutExtension: relativePath.replace(/\.json$/, ""),
  };
}

export const fixtureFiles: SettingsFileEntry[] = [
  file("mechanical/vav-boxes.json", "2026-08-14T18:22:00Z"),
  file("mechanical/fans.json", "2026-08-11T09:05:00Z"),
  file("mechanical/ahu.json", "2026-07-30T15:41:00Z"),
  file("plumbing/fixtures.json", "2026-08-02T12:12:00Z"),
  file("plumbing/water-heaters.json", "2026-06-19T10:00:00Z"),
  file("electrical/panels.json", "2026-08-16T20:30:00Z"),
  file("lighting-fixtures.json", "2026-05-28T08:00:00Z"),
];

/* ── the open document — mechanical/vav-boxes.json ─────────────────────────── */

const vavProfile = {
  name: "VAV Boxes",
  categoryName: "Mechanical Equipment",
  isItemized: true,
  viewTemplateName: "PE Mech Schedule",
  fields: [
    { parameterName: "Mark", columnHeader: "TAG", width: 0.6 },
    { parameterName: "Family and Type", columnHeader: "DESCRIPTION", width: 2.0 },
    { parameterName: "Air Flow", columnHeader: "CFM", width: 0.8 },
    { parameterName: "Static Pressure", columnHeader: "ESP (in WC)", width: 0.8 },
    { parameterName: "Level", columnHeader: "LEVEL", width: 0.7 },
  ],
  sortGroup: [
    { fieldName: "Level", sortOrder: "Ascending", showHeader: true },
    { fieldName: "Mark", sortOrder: "Ascending", showHeader: false },
  ],
  filters: [{ fieldName: "Air Flow", filterType: "GreaterThan", value: 0 }],
};

export const fixtureRawContent = JSON.stringify(vavProfile, null, 2);

/** Seeded trichotomy states — one of each thing a reviewer must be able to see:
 * an open pea proposal (with note + confidence), a staged value, and a staged
 * value flagged `attention` (the save gate's one hard refusal). */
const fixtureFields: Record<string, SettingsFieldState> = {
  "/viewTemplateName": {
    proposal: {
      value: "PE Mech Schedule v2",
      by: "pea",
      note: "spec sheet 23-09 names the v2 template for VAV schedules",
      confidence: "high",
    },
    staged: null,
    review: "none",
  },
  "/isItemized": {
    proposal: null,
    staged: { value: false },
    review: "good",
  },
  "/fields/2/columnHeader": {
    proposal: null,
    staged: { value: "AIRFLOW (CFM)" },
    review: "attention",
  },
};

export const fixtureDocument: SettingsRouteDocument = {
  binding: { target: "thread:fixture" },
  snapshot: {
    documentId: {
      moduleKey: "pe.schedules",
      rootKey: "profiles",
      relativePath: "mechanical/vav-boxes.json",
    },
    rawContent: fixtureRawContent,
    composedContent: null,
    // ponytail: null version token — the fixture cannot be saved through, by construction.
    versionToken: null,
    modifiedUtc: "2026-08-14T18:22:00Z",
    validation: {
      isValid: false,
      issues: [
        {
          message: 'string "AIRFLOW (CFM)" exceeds maxLength 10 for column headers',
          severity: "error",
          path: "/fields/2/columnHeader",
        },
      ],
    },
    takenAt: "2026-08-17T00:00:00Z",
  },
  fields: fixtureFields,
  savedAt: "2026-08-14T18:22:00Z",
};

/** Raw content for the other tree files so tree clicks feel real. Falls back to a
 * tiny stub profile — the tree story, not the file contents, is under review. */
export function fixtureRawFor(relativePath: string): string {
  if (relativePath === "mechanical/vav-boxes.json") return fixtureRawContent;
  const name =
    relativePath
      .split("/")
      .at(-1)
      ?.replace(/\.json$/, "") ?? relativePath;
  return JSON.stringify(
    {
      name: name.replace(/-/g, " "),
      categoryName: "Mechanical Equipment",
      isItemized: true,
      fields: [
        { parameterName: "Mark", columnHeader: "TAG", width: 0.6 },
        { parameterName: "Family and Type", columnHeader: "DESCRIPTION", width: 2.0 },
      ],
      sortGroup: [{ fieldName: "Mark", sortOrder: "Ascending", showHeader: false }],
    },
    null,
    2,
  );
}
