/**
 * The entity routes' demo world: one pod and one run. The schedule member's bytes and schema are
 * captured live on 2026-08-17 (`seed-schedule-*.ts`); the pod, its folder, hashes, the receipt
 * and the Pea proposal lane on the schedule member are fixture, on real pointers of those bytes.
 */
import type { SettingsFieldState } from "@pe/agent-contracts";

import { SCHEDULE_SEED_BYTES } from "./seed-schedule-content";
import { SCHEDULE_SEED_CAPTURED_SCHEMA } from "./seed-schedule-schema";

import type { PodRow } from "./manifest";
import type { Receipt } from "./pods";
import type { DemoSpec } from "./spec-editor";

const SCHEDULE_SCHEMA = "http://localhost:5150/schemas/settings/CmdScheduleManager/schedules.json";
const FAMILIES_SCHEMA = "http://localhost:5150/schemas/settings/FamilyFoundry/patches.json";
export const hash = (n: number) => String(n).repeat(64).slice(0, 64);

export const DEMO_SPEC_PATH = "settings/schedule/DX Fan Coil Unit.json";
export const DEMO_FAMILIES_SPEC_PATH = "settings/families/Mech equipment standard.json";
const DEMO_HEADER_PATH = "settings/_fields/Header.json";
const DEMO_PERF_HEAT_PATH = "settings/_fields/IU Perf Heat.json";
export const DEMO_RECEIPT_PATH = "output/2026-09-12T14-02-11Z/receipt.json";

export const DEMO_PODS: readonly PodRow[] = [
  {
    id: "mech-standards",
    name: "Mech standards",
    version: "0.4.0",
    folder: "Documents/Pe.Tools/Pods/mech-standards",
    entrypoints: [],
    members: [
      { path: DEMO_SPEC_PATH, sha256: hash(2), schema: SCHEDULE_SCHEMA },
      { path: DEMO_FAMILIES_SPEC_PATH, sha256: hash(8), schema: FAMILIES_SCHEMA },
      { path: DEMO_HEADER_PATH, sha256: hash(3), schema: null },
      { path: DEMO_PERF_HEAT_PATH, sha256: hash(4), schema: null },
      { path: DEMO_RECEIPT_PATH, sha256: hash(5), schema: null },
    ],
    diagnostics: [],
  },
  {
    id: "scripts",
    name: "Scripts",
    version: "0.1.0",
    folder: "Documents/Pe.Tools/Pods/scripts",
    entrypoints: [{ id: "tag", sourcePath: "src/Tag.cs" }],
    members: [{ path: "src/Tag.cs", sha256: hash(7), schema: null }],
    diagnostics: [
      {
        code: "Entrypoint",
        path: "src/Tag.cs",
        severity: "error",
        message: "entrypoint src/Tag.cs: PeScripts.csproj is missing",
      },
    ],
  },
];

export const DEMO_RECEIPT: Receipt = {
  podId: "mech-standards",
  memberPath: DEMO_SPEC_PATH,
  memberSha256: hash(2),
  operation: "schedule.apply",
  planHash: null,
  outcome: "Succeeded",
  outputs: ["result.json"],
  reason: null,
};

/** The captured schema names a fragment no demo pod holds; the seed drops that one example. */
export const SCHEDULE_SEED_SCHEMA = SCHEDULE_SEED_CAPTURED_SCHEMA.replace(
  ',\r\n                  "@global/_fields/my-fragment"',
  "",
);
export const SCHEDULE_SEED_RAW = SCHEDULE_SEED_BYTES;

/**
 * One of each thing a reviewer must see on the schedule member: an open Pea proposal (note and
 * confidence), a staged value, and a staged value long enough to trip the column-header budget.
 */
const SCHEDULE_SEED_FIELDS: Record<string, SettingsFieldState> = {
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

export const DEMO_SPEC: DemoSpec = {
  content: SCHEDULE_SEED_RAW,
  schema: SCHEDULE_SEED_SCHEMA,
  fields: SCHEDULE_SEED_FIELDS,
};

const fragment = (fields: object[]): DemoSpec => ({
  content: JSON.stringify(fields, null, 2),
  schema: "",
});

/** The schedule member's field fragments: plain data, fixture bytes. */
export const DEMO_FRAGMENTS: Record<string, DemoSpec> = {
  [DEMO_HEADER_PATH]: fragment([
    { ParameterName: "PE_G___TagInstance", ColumnHeaderOverride: "Tag" },
    { ParameterName: "PE_G___Model", ColumnHeaderOverride: "Model" },
  ]),
  [DEMO_PERF_HEAT_PATH]: fragment([
    { ParameterName: "PE_M___HeatingCapacity", ColumnHeaderOverride: "Heating (MBH)" },
    { ParameterName: "PE_M___EnteringAirTempHeating", ColumnHeaderOverride: "EAT (F)" },
  ]),
};

/** `/pods?demo=browse`: the demo pods, the schedule spec open, its run beside it. */
export const PODS_SEEDS = {
  browse: { title: "two pods, a schedule spec and its run", work: null, readings: {}, page: {} },
};
