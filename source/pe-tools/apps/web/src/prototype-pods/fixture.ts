/**
 * PROTOTYPE FIXTURE — the one comparison scenario every variant renders. Throwaway.
 *
 * REAL: the schedule member's JSON and schema are the captured settings seed
 * (`settings/seeds.ts`, MechEquip/TEST.schedule.json + ScheduleProfile schema); its staged fields
 * and Pea proposal come from the `?demo=save` seed through `useRoute`. The family member is the
 * checked-in `a-box.family.json` fixture.
 *
 * ILLUSTRATIVE (prototype seam): the two pods, their identities, dependency states, the documents,
 * the diagnostic, the run receipt, and the "captured" values in variant C. None of it round-trips.
 */
import { familyFixtures } from "#/family/authored-families";

export type BoundaryState = "installed" | "must fetch" | "reachable" | "selected";

export interface Dependency {
  /** What kind of thing sits across the boundary. */
  kind: "pod source" | "APS" | "Revit document" | "code package";
  label: string;
  /** Exact pin, when the dependency is pinned to a release/hash. */
  pin?: string;
  state: BoundaryState;
  /** True when using the member makes the pod reach outside its own folder. */
  crosses: boolean;
  /** Which member paths pull this dependency in. */
  usedBy: string;
}

export interface Member {
  path: string;
  kind: "schedule" | "family" | "families profile" | "fragment" | "script";
  /** Declared `$schema`, which selects editor validation. Absent = no library validator selected. */
  schema: string | null;
  consumer: "/schedule-grid" | "/family" | "/families" | null;
  deps: readonly Dependency[];
  lastCapture: string | null;
  lastRun: string | null;
  /** The member with the unsaved JSON change in the scenario. */
  dirty: boolean;
  /** Real JSON when we have it; null draws the member as name-only. */
  json: string | null;
}

export interface Pod {
  key: string;
  name: string;
  kind: "shared release" | "independent copy";
  folder: string;
  lineage: string;
  contentHash: string;
  parentRelease: string | null;
  origin: string;
  editable: boolean;
  members: readonly Member[];
}

export interface RevitDocument {
  session: string;
  openId: string;
  kind: "project" | "family";
  title: string;
}

const HEADER_FRAGMENT: Dependency = {
  kind: "pod source",
  label: "@company/_fields/Header",
  pin: "pe-mech-standards@2026.09 · 9c1e…d4",
  state: "must fetch",
  crosses: true,
  usedBy: "Fields[0].$include",
};
const APS: Dependency = {
  kind: "APS",
  label: "parameter definitions (PE_G___RefrigerantType, PE_G___TagInstance)",
  state: "reachable",
  crosses: true,
  usedBy: "Fields[1].Parameter, Filters[0].FieldName",
};
const DOCUMENT: Dependency = {
  kind: "Revit document",
  label: "ViewTemplateName resolves in the selected document",
  state: "selected",
  crosses: true,
  usedBy: "ViewTemplateName",
};

const sharedMembers: readonly Member[] = [
  {
    path: "settings/MechEquip/TEST.schedule.json",
    kind: "schedule",
    schema: "/schemas/settings/schedules/schedule-profile.json",
    consumer: "/schedule-grid",
    deps: [HEADER_FRAGMENT, APS, DOCUMENT],
    lastCapture: "2026-09-15 16:40 from 2405_Hospital_MEP.rvt",
    lastRun: "2026-09-16 10:12 · succeeded",
    dirty: false,
    json: null, // the real seed is mounted through the settings handle, not copied here
  },
  {
    path: "settings/_fields/Header.json",
    kind: "fragment",
    schema: null,
    consumer: null,
    deps: [],
    lastCapture: null,
    lastRun: null,
    dirty: false,
    json: '{\n  "ParameterName": "PE_G___TagInstance",\n  "ColumnHeaderOverride": "TAG"\n}',
  },
  {
    path: "settings/families/a-box.family.json",
    kind: "family",
    schema: null,
    consumer: "/family",
    deps: [
      {
        kind: "Revit document",
        label: "a-box.rfa must be the open family document to build",
        state: "selected",
        crosses: true,
        usedBy: "build",
      },
    ],
    lastCapture: "2026-09-12 09:03 from a-box.rfa",
    lastRun: null,
    dirty: false,
    json: familyFixtures.box,
  },
  {
    path: "settings/families/mech-equip.families.json",
    kind: "families profile",
    schema: "/schemas/settings/family-foundry/families-profile.json",
    consumer: "/families",
    deps: [
      {
        kind: "APS",
        label: "shared parameter definitions for placement",
        state: "reachable",
        crosses: true,
        usedBy: "parameters[*]",
      },
    ],
    lastCapture: null,
    lastRun: "2026-09-10 14:22 · 3 warnings",
    dirty: false,
    json: '{\n  "placementScope": "project",\n  "categoryNames": ["Mechanical Equipment"],\n  "familyNames": [],\n  "parameters": ["PE_G___TagInstance", "PE_G___NotesInstance"]\n}',
  },
  {
    path: "scripts/rename-tags.csx",
    kind: "script",
    schema: null,
    consumer: null,
    deps: [
      {
        kind: "code package",
        label: "Pe.Revit.Scripting runtime",
        state: "installed",
        crosses: true,
        usedBy: "entrypoint",
      },
    ],
    lastCapture: null,
    lastRun: null,
    dirty: false,
    json: null,
  },
];

export const COMPANY_POD: Pod = {
  key: "company",
  name: "PE Mechanical Standards",
  kind: "shared release",
  folder: "Pods/pe-mech-standards/",
  lineage: "pod:7d2a9f0e-…-standards",
  contentHash: "sha256:9c1e4b…d4",
  parentRelease: null,
  origin: "archive · \\\\pe-share\\pods\\pe-mech-standards-2026.09.zip",
  editable: false,
  members: sharedMembers,
};

export const LOCAL_POD: Pod = {
  key: "local",
  name: "PE Mechanical Standards (my copy)",
  kind: "independent copy",
  folder: "Pods/mech-standards-local/",
  lineage: "pod:c41b…-local",
  contentHash: "sha256:e07a…21 (dirty: unsaved draft not hashed)",
  parentRelease: "pe-mech-standards@2026.09 · 9c1e…d4",
  origin: "independent import of the release above, 2026-09-14",
  editable: true,
  members: sharedMembers.map((member) =>
    member.path === "settings/MechEquip/TEST.schedule.json"
      ? { ...member, dirty: true, lastRun: "2026-09-16 10:12 · succeeded (before the draft)" }
      : member,
  ),
};

export const PODS: readonly Pod[] = [LOCAL_POD, COMPANY_POD];

export const DOCUMENTS: readonly RevitDocument[] = [
  {
    session: "dev-7f3a",
    openId: "2405_Hospital_MEP.rvt",
    kind: "project",
    title: "2405_Hospital_MEP.rvt",
  },
  { session: "dev-7f3a", openId: "a-box.rfa", kind: "family", title: "a-box.rfa" },
  {
    session: "dev-7f3a",
    openId: "2405_Hospital_MEP_detached.rvt",
    kind: "project",
    title: "2405_Hospital_MEP_detached.rvt",
  },
];

/** Tied to the staged /ViewTemplateName proposal in the real seed. Prototype: no host produced it. */
export const DIAGNOSTIC = {
  path: "/ViewTemplateName",
  says: '"Schedule - PE Standard v2" is not a view template in 2405_Hospital_MEP.rvt; the build would leave the schedule untemplated',
  resolvesAt: "apply, against the selected document",
};

export const RECEIPT = {
  runFolder: "output/2026-09-16T10-12-03Z-schedules.build/",
  snapshot: "sha256:e07a…21",
  member: "settings/MechEquip/TEST.schedule.json",
  operation: "schedules.build",
  outcome: "succeeded",
  document: "2405_Hospital_MEP.rvt",
  outputs: ["receipt.json", "schedules.build.log", "DX Fan Coil Unit Performance Schedule.csv"],
};

/**
 * Variant C only: the "captured" side for the schedule member. Illustrative — the schedule capture
 * op returns a grid snapshot, not a ScheduleProfile projection; this is what such a projection
 * would have to say.
 */
export const CAPTURED_SCHEDULE: Record<string, unknown> = {
  Name: "DX Fan Coil Unit Performance Schedule",
  CategoryName: "Mechanical Equipment",
  ViewTemplateName: "Schedule - PE Standard",
  ColumnHeaderVerticalAlignment: "Bottom",
  IsItemized: true,
  Fields: [
    { ParameterName: "PE_G___TagInstance", ColumnHeaderOverride: "TAG" },
    { ParameterName: "PE_G___RefrigerantType", ColumnHeaderOverride: "Refrigerant" },
    { ParameterName: "PE_G___IU_HeatCap", ColumnHeaderOverride: "Heating (MBH)" },
    { ParameterName: "PE_G___IU_CoolCap", ColumnHeaderOverride: "Cooling (MBH)" },
    { ParameterName: "PE_G___NotesInstance", ColumnHeaderOverride: "Notes" },
    { ParameterName: "Mark", ColumnHeaderOverride: "MARK" },
  ],
  SortGroup: [{ FieldName: "PE_G___TagInstance" }],
  Filters: [{ FieldName: "PE_G___TagInstance", FilterType: "BeginsWith", Value: "IU-" }],
};
