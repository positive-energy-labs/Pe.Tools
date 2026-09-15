/**
 * Settings seed data — plain values, no store, no host, no behaviour. `?demo=<action>` mounts one
 * of these through `useRoute`'s demo owner. The captured world is REAL: the actual
 * CmdScheduleManager/schedules MechEquip/TEST.json and the actual ScheduleProfile schema, both
 * captured live on 2026-08-17. File Readings are seeded with their raw content strings.
 */
import type {
  Seed,
  SettingsDocumentId,
  SettingsFieldState,
  SettingsRouteDocument,
} from "@pe/agent-contracts";

import { SETTINGS_SEED_RAW } from "#/settings-panes/seed-content";
import { SETTINGS_SEED_SCHEMA } from "#/settings-panes/seed-schema";

/** The Readings this route subscribes: the bound document, and the schema that renders it. */
export type SettingsReading = "document" | "schema";

/** Page state: the file address the picker is pointing at, before `open` adopts it as Work. */
export interface SettingsPage {
  workspaceKey?: string;
  moduleKey?: string;
  rootKey?: string;
  filePath?: string;
  query?: string;
  /** The field pointer `stage` writes. Staging is per-field, so the page names which one. */
  field?: string;
}

/** Every action the route declares. The seed map below is total over this union. */
export type SettingsAction = "open" | "refresh" | "validate" | "adopt" | "save" | "stage";

export const SETTINGS_SEED_DOCUMENT_ID: SettingsDocumentId = {
  moduleKey: "CmdScheduleManager",
  rootKey: "schedules",
  relativePath: "MechEquip/TEST.json",
};

export const SETTINGS_SEED_SCHEMA_ID: SettingsDocumentId = {
  moduleKey: "CmdScheduleManager",
  rootKey: "schedules",
  relativePath:
    "../../../Global/schemas/cmdschedulemanager/profiles/pe-shared-revitdata-schedules-scheduleprofile.schema.json",
};

export const SETTINGS_SEED_PATH =
  "C:/Users/kaitp/OneDrive/Documents/Pe.Tools/settings/CmdScheduleManager/schedules/MechEquip/TEST.json";

/**
 * Seeded trichotomy on REAL pointers in the real document — one of each thing a reviewer must be
 * able to see: an open pea proposal (note + confidence), a staged value, and a second staged
 * value long enough to trip the column-header budget.
 */
const SEED_FIELDS: Record<string, SettingsFieldState> = {
  "/ViewTemplateName": {
    proposal: {
      value: "Schedule - PE Standard v2",
      by: "pea",
      note: "office template register lists v2 as current for performance schedules",
      confidence: "high",
    },
    staged: null,
  },
  "/IsItemized": { proposal: null, staged: { value: false } },
  "/Fields/1/ColumnHeaderOverride": {
    proposal: null,
    staged: { value: "REFRIGERANT TYPE (FULL DESIGNATION)" },
  },
};

export const SETTINGS_SEED_WORK: SettingsRouteDocument = {
  basis: {
    path: SETTINGS_SEED_PATH,
    rawContent: SETTINGS_SEED_RAW,
    versionToken: "seed-v1",
    documentId: SETTINGS_SEED_DOCUMENT_ID,
  },
  fields: SEED_FIELDS,
};

export { SETTINGS_SEED_RAW, SETTINGS_SEED_SCHEMA };

type SettingsSeed = Seed<SettingsRouteDocument, SettingsReading, SettingsPage>;

const at: SettingsPage = {
  workspaceKey: "default",
  moduleKey: SETTINGS_SEED_DOCUMENT_ID.moduleKey,
  rootKey: SETTINGS_SEED_DOCUMENT_ID.rootKey,
  filePath: SETTINGS_SEED_PATH,
};

const base = (title: string, over: Partial<SettingsSeed> = {}): SettingsSeed => ({
  title,
  work: SETTINGS_SEED_WORK,
  readings: { document: SETTINGS_SEED_RAW, schema: SETTINGS_SEED_SCHEMA },
  page: at,
  ...over,
});

/** One seed per action. Total over `SettingsAction` by construction. */
export const SETTINGS_SEEDS: Record<SettingsAction, SettingsSeed> = {
  open: base("a picked file, not yet adopted as the edit basis", {
    work: { basis: null, fields: {} },
    readings: { schema: SETTINGS_SEED_SCHEMA },
  }),
  refresh: base("an adopted basis with staged edits, re-readable"),
  validate: base("a staged column header that the schema budget rejects"),
  adopt: base("disk moved under the edit basis; adopt discards the old edits", {
    work: {
      ...SETTINGS_SEED_WORK,
      basis: { ...SETTINGS_SEED_WORK.basis!, versionToken: "seed-v2" },
    },
  }),
  save: base("two staged fields and one open proposal, ready to commit"),
  stage: base("a pea proposal awaiting approve/deny on /ViewTemplateName", {
    page: { ...at, field: "/ViewTemplateName" },
  }),
};
