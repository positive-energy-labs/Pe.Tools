/**
 * The entity routes' demo world: one pod and one run. The schedule member's bytes and schema are
 * the settings seed captured live on 2026-08-17; the pod, its folder, hashes and the receipt are
 * fixture.
 */
import { SETTINGS_SEED_RAW, SETTINGS_SEED_SCHEMA } from "#/settings/seeds";

import type { PodRow } from "./manifest";
import type { Receipt } from "./pods";
import type { DemoSpec } from "./spec-editor";

const SCHEDULE_SCHEMA = "http://localhost:5150/schemas/settings/CmdScheduleManager/schedules.json";
const hash = (n: number) => String(n).repeat(64).slice(0, 64);

export const DEMO_SPEC_PATH = "settings/schedule/DX Fan Coil Unit.json";
export const DEMO_RECEIPT_PATH = "output/2026-09-12T14-02-11Z/receipt.json";

export const DEMO_PODS: readonly PodRow[] = [
  {
    id: "mech-standards",
    name: "Mech standards",
    version: "0.4.0",
    folder: "Documents/Pe.Tools/Pods/mech-standards",
    entrypoints: [],
    members: [
      { path: "pod.json", sha256: hash(1), schema: null },
      { path: DEMO_SPEC_PATH, sha256: hash(2), schema: SCHEDULE_SCHEMA },
      { path: "settings/_fields/Header.json", sha256: hash(3), schema: null },
      { path: "settings/_fields/IU Perf Heat.json", sha256: hash(4), schema: null },
      { path: DEMO_RECEIPT_PATH, sha256: hash(5), schema: null },
    ],
    diagnostics: [],
  },
  {
    id: "scripts",
    name: "Scripts",
    version: "0.1.0",
    folder: "Documents/Pe.Tools/Pods/scripts",
    entrypoints: ["src/Tag.cs"],
    members: [
      { path: "pod.json", sha256: hash(6), schema: null },
      { path: "src/Tag.cs", sha256: hash(7), schema: null },
    ],
    diagnostics: [{ message: "entrypoint src/Tag.cs: PeScripts.csproj is missing" }],
  },
];

export const DEMO_RECEIPT: Receipt = {
  pod: "mech-standards",
  member: DEMO_SPEC_PATH,
  sha256: hash(2),
  op: "schedule.apply",
  planHash: null,
  outcome: "applied",
  outputs: ["schedule 481223 · DX Fan Coil Unit Performance Schedule"],
  at: "2026-09-12T14:02:11Z",
};

export const DEMO_SPEC: DemoSpec = { content: SETTINGS_SEED_RAW, schema: SETTINGS_SEED_SCHEMA };

/** `/pods?demo=browse`: the demo pods, the schedule spec open, its run beside it. */
export const PODS_SEEDS = {
  browse: { title: "two pods, a schedule spec and its run", work: null, readings: {}, page: {} },
};
