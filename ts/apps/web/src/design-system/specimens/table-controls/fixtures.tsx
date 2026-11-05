/**
 * FIXTURES for the table-controls specimen (2026-10-19): two hand-authored tables with different
 * schemas, so the shared query workbench is shown against real variety. Invented, not Revit data.
 * Each preset uses the canonical grammar. Domain rules use the same public `passes` seam as Families.
 */
import type { Column, QueryFilter, QueryVocabulary, TableState } from "@pe/kit/table/model";
import { resolveStateColumn } from "@pe/kit/table/master-table-columns";
import { queryCapabilities } from "@pe/kit/table/query-workbench";
import { TooltipHint } from "@pe/kit/lang/tooltip";
import { conditionValues, passes, readQuery, visibleRows, wordMatches } from "@pe/kit/table/view";

// A cell is the row's height and the kit's inset: no vertical padding, so rows stay `--item-h`.
const mono = "block truncate px-(--item-pad-x) leading-(--item-h) t-small face-mono text-ink-2";
const text = "block truncate px-(--item-pad-x) leading-(--item-h) t-small text-ink";

export interface Preset {
  id: string;
  label: string;
  /** What this preset demonstrates, in the grammar's words. */
  says: string;
  state: Omit<TableState, "hiddenColumns">;
}

export interface Dataset<Row> {
  id: string;
  label: string;
  rowKey: (row: Row) => string;
  rows: readonly Row[];
  columns: Column<Row>[];
  presets: Preset[];
  /** Constraints worth saying aloud: what each field can and cannot do. */
  constraints: string[];
  rules?: readonly { word: string; label: string; matches: (row: Row) => boolean }[];
  filters?: readonly QueryFilter[];
}

/** A route-supplied rule vocabulary, using the existing engine rather than rewriting query text. */
export function datasetQuery<Row>(dataset: Dataset<Row>, state: TableState) {
  const columns = dataset.columns.map(resolveStateColumn);
  const fields = new Map(
    columns.flatMap((column) =>
      column.condition ? [[column.label.toLowerCase(), column.condition] as const] : [],
    ),
  );
  const rows = (query: string) =>
    visibleRows(
      dataset.rows.filter((row) =>
        passes(row, readQuery(query), fields, (each, word) => {
          const rule = dataset.rules?.find((rule) => rule.word === word);
          return rule
            ? rule.matches(each)
            : columns.some((column) => column.search && wordMatches(column.search(each), word));
        }),
      ),
      dataset.columns,
      { ...state, query: "" },
    );
  const vocabulary: QueryVocabulary = {
    ...queryCapabilities(dataset.rows, dataset.columns, state),
    rules: dataset.rules ?? [],
    filters: dataset.filters,
    count: (query) => rows(query).length,
    values: (label, query) => {
      const field = fields.get(label.toLowerCase());
      return field ? conditionValues(rows(query), field) : [];
    },
  };
  return { rows, vocabulary };
}

const preset = (
  id: string,
  label: string,
  says: string,
  query: string,
  sorts: TableState["sorts"] = [],
): Preset => ({ id, label, says, state: { query, sorts } });

/* ── duct segments ─────────────────────────────────────────────────────────────────────────── */

export interface Segment {
  tag: string;
  run: string;
  system: "SA" | "RA" | "EA" | "OA";
  status: "submitted" | "approved" | "revise" | "hold";
  level: string;
  size: string;
  cfm: number | null;
  fpm: number | null;
  lengthFt: number;
  note: string;
  order: number;
}

const SYSTEM_OPTIONS = [
  { value: "SA", label: "Supply air" },
  { value: "RA", label: "Return air" },
  { value: "EA", label: "Exhaust air" },
  { value: "OA", label: "Outdoor air" },
];
const TONE = { approved: "done", submitted: undefined, revise: "caution", hold: "alarm" } as const;

const SEGMENTS: readonly Segment[] = [
  {
    tag: "SA-101",
    run: "Main trunk off AHU-1",
    system: "SA",
    status: "approved",
    level: "L1",
    size: "30x16",
    cfm: 4200,
    fpm: 1180,
    lengthFt: 42.5,
    note: "Above corridor ceiling; hanger spacing per detail 7",
    order: 1,
  },
  {
    tag: "SA-102",
    run: "Main trunk off AHU-1",
    system: "SA",
    status: "approved",
    level: "L1",
    size: "24x14",
    cfm: 3100,
    fpm: 1240,
    lengthFt: 18,
    note: "",
    order: 2,
  },
  {
    tag: "SA-103",
    run: "Branch to open office",
    system: "SA",
    status: "submitted",
    level: "L2",
    size: "16x10",
    cfm: 1450,
    fpm: 1010,
    lengthFt: 26.25,
    note: "Verify throw against diffuser schedule",
    order: 3,
  },
  {
    tag: "SA-104",
    run: "Branch to open office",
    system: "SA",
    status: "revise",
    level: "L2",
    size: "12x8",
    cfm: 640,
    fpm: 960,
    lengthFt: 9.5,
    note: "Transition at structural beam; coordinate with fire damper FD-114",
    order: 4,
  },
  {
    tag: "SA-105",
    run: "Drop to VAV box",
    system: "SA",
    status: "submitted",
    level: "L2",
    size: "ø10",
    cfm: null,
    fpm: null,
    lengthFt: 6,
    note: "Flow not scheduled yet",
    order: 5,
  },
  {
    tag: "RA-201",
    run: "Return plenum relief",
    system: "RA",
    status: "approved",
    level: "L1",
    size: "36x18",
    cfm: 3800,
    fpm: 790,
    lengthFt: 55,
    note: "Existing to remain",
    order: 6,
  },
  {
    tag: "RA-202",
    run: "Shaft riser",
    system: "RA",
    status: "hold",
    level: "L3",
    size: "24x24",
    cfm: 2250,
    fpm: 560,
    lengthFt: 38,
    note: "Relocated per RFI 042 — hold until architect confirms ceiling height",
    order: 7,
  },
  {
    tag: "RA-203",
    run: "Return grille tap",
    system: "RA",
    status: "submitted",
    level: "L3",
    size: "14x10",
    cfm: 520,
    fpm: 540,
    lengthFt: 4.75,
    note: "",
    order: 8,
  },
  {
    tag: "EA-301",
    run: "Toilet exhaust riser",
    system: "EA",
    status: "revise",
    level: "L2",
    size: "ø14",
    cfm: 800,
    fpm: 750,
    lengthFt: 61,
    note: "Reroute around sprinkler main",
    order: 9,
  },
  {
    tag: "EA-302",
    run: "Toilet exhaust riser",
    system: "EA",
    status: "revise",
    level: "L3",
    size: "ø14",
    cfm: 800,
    fpm: 750,
    lengthFt: 14,
    note: "Reheat coil bypass",
    order: 10,
  },
  {
    tag: "EA-303",
    run: "Kitchen hood exhaust",
    system: "EA",
    status: "hold",
    level: "Roof",
    size: "20x20",
    cfm: 2800,
    fpm: 1010,
    lengthFt: 33,
    note: "Grease duct; confirm 18 in clearance to combustibles",
    order: 11,
  },
  {
    tag: "OA-401",
    run: "Louver to AHU-1",
    system: "OA",
    status: "approved",
    level: "Roof",
    size: "36x24",
    cfm: 5200,
    fpm: 870,
    lengthFt: 22,
    note: "Intake louver FL-1",
    order: 12,
  },
  {
    tag: "OA-402",
    run: "Louver to AHU-2",
    system: "OA",
    status: "submitted",
    level: "Roof",
    size: "30x20",
    cfm: null,
    fpm: null,
    lengthFt: 19.5,
    note: "",
    order: 13,
  },
  {
    tag: "OA-403",
    run: "Economizer relief",
    system: "OA",
    status: "approved",
    level: "Roof",
    size: "24x16",
    cfm: 2400,
    fpm: 900,
    lengthFt: 11,
    note: "Barometric damper BD-2",
    order: 14,
  },
];

const num = (value: number | null, digits = 0) =>
  value === null ? "—" : value.toLocaleString("en-US", { maximumFractionDigits: digits });

const SEGMENT_COLUMNS: Column<Segment>[] = [
  {
    key: "tag",
    label: "Tag",
    width: "w-24",
    lock: true,
    sort: (r) => r.tag,
    search: (r) => r.tag,
    condition: { kind: "text", read: (r) => r.tag },
    cell: (r) => <span className={`${mono} text-ink`}>{r.tag}</span>,
  },
  {
    key: "run",
    label: "Run name",
    title: "The named run this segment belongs to. Text: contains, is, is not, empty.",
    width: "w-56",
    sort: (r) => r.run,
    search: (r) => r.run,
    condition: { kind: "text", read: (r) => r.run },
    cell: (r) => <span className={text}>{r.run}</span>,
  },
  {
    key: "system",
    label: "System",
    title: "Stored as a code (SA); the picker shows the name. Choices only come from the options.",
    width: "w-28",
    sort: (r) => r.system,
    facet: (r) => r.system,
    options: SYSTEM_OPTIONS,
    search: (r) =>
      `${r.system} ${SYSTEM_OPTIONS.find((option) => option.value === r.system)?.label ?? ""}`,
    cell: (r) => (
      <span className={text}>{SYSTEM_OPTIONS.find((o) => o.value === r.system)?.label}</span>
    ),
  },
  {
    key: "status",
    label: "Status",
    title: "Submittal status. A verdict: filters and sorts by its word.",
    width: "w-28",
    verdict: (r) => ({
      word: r.status,
      tone: TONE[r.status],
      note: `Submittal status: ${r.status}`,
    }),
  },
  {
    key: "level",
    label: "Level",
    width: "w-20",
    sort: (r) => r.level,
    facet: (r) => r.level,
    cell: (r) => <span className={mono}>{r.level}</span>,
  },
  {
    key: "cfm",
    label: "Airflow (cfm)",
    title: "Numeric. Some segments are not scheduled yet, so they are empty, not zero.",
    right: true,
    width: "w-32",
    sort: (r) => r.cfm ?? Number.NEGATIVE_INFINITY,
    condition: { kind: "number", read: (r) => r.cfm },
    cell: (r) => <span className={`${mono} text-right text-ink`}>{num(r.cfm)}</span>,
  },
  {
    key: "fpm",
    label: "Velocity (fpm)",
    title: "Numeric, empty where airflow is not scheduled.",
    right: true,
    width: "w-32",
    sort: (r) => r.fpm ?? Number.NEGATIVE_INFINITY,
    condition: { kind: "number", read: (r) => r.fpm },
    cell: (r) => <span className={`${mono} text-right`}>{num(r.fpm)}</span>,
  },
  {
    key: "length",
    label: "Length (ft)",
    right: true,
    width: "w-28",
    sort: (r) => r.lengthFt,
    condition: { kind: "number", read: (r) => r.lengthFt },
    cell: (r) => <span className={`${mono} text-right`}>{num(r.lengthFt, 2)}</span>,
  },
  {
    key: "order",
    label: "Install order",
    title: "Sort only: it can be ordered by but has no condition.",
    right: true,
    width: "w-28",
    sort: (r) => r.order,
    cell: (r) => <span className={`${mono} text-right`}>{r.order}</span>,
  },
  {
    key: "note",
    label: "Note",
    title: "Free text: found by a plain search word, or by a text condition.",
    width: "w-80",
    search: (r) => r.note,
    condition: { kind: "text", read: (r) => r.note },
    cell: (r) => (
      <TooltipHint content={r.note}>
        <span className={text}>{r.note}</span>
      </TooltipHint>
    ),
  },
];

export const SEGMENT_DATASET: Dataset<Segment> = {
  id: "segments",
  label: "Duct segments",
  rowKey: (r) => r.tag,
  rows: SEGMENTS,
  columns: SEGMENT_COLUMNS,
  constraints: [
    "Text fields: contains, is, is not, is empty, is not empty.",
    "Number fields: = ≠ > ≥ < ≤, is empty, is not empty. A value must be a number.",
    "System stores a code (SA) and shows a name; the picker lists the names and writes the code.",
    "Install order sorts only. Note is free text: a search word or a text condition finds it.",
  ],
  presets: [
    preset("search", "Free word", "a word searches every searchable field", "damper"),
    preset("contains", "Run name contains", "~ on a multi-word field", '"Run name"~trunk'),
    preset("is", "System is Return air", "= on an option (stored RA)", "System=RA"),
    preset("isnot", "Status is not hold", "!= on a verdict word", "Status!=hold"),
    preset("empty", "Note is empty", "= with no value", "Note=", []),
    preset("nonempty", "Note is not empty", "!= with no value", "Note!="),
    preset("gt", "Airflow > 2000", "number comparison", '"Airflow (cfm)">2000'),
    preset("ge", "Velocity ≥ 1000", "≥ on a number", '"Velocity (fpm)">=1000'),
    preset("lt", "Length < 10", "< on a number", '"Length (ft)"<10'),
    preset("le", "Length ≤ 14", "≤ on a number", '"Length (ft)"<=14'),
    preset("eq", "Airflow = 800", "= on a number", '"Airflow (cfm)"=800'),
    preset("ne", "Airflow ≠ 800", "≠ on a number", '"Airflow (cfm)"!=800'),
    preset("numempty", "Airflow is empty", "unscheduled flow, not zero", '"Airflow (cfm)"='),
    preset(
      "numnonempty",
      "Airflow is not empty",
      "!= with no value on a number",
      '"Airflow (cfm)"!=',
    ),
    preset("negfield", "Not level Roof", "! negates a field clause", "!Level=Roof"),
    preset("negword", "Not 'sprinkler'", "! negates a search word", "!sprinkler"),
    preset(
      "quoted",
      "Quoted value",
      "a value with spaces is quoted",
      '"Run name"="Main trunk off AHU-1"',
    ),
    preset(
      "stack",
      "Stacked conditions",
      "every chip is ANDed",
      'System=SA Status!=revise "Airflow (cfm)">1000 !hanger',
    ),
    preset("sorts", "Ordered sorts", "sort chips apply in order", "Level!=Roof", [
      { key: "level", dir: "asc" },
      { key: "cfm", dir: "desc" },
      { key: "tag", dir: "asc" },
    ]),
    preset("sortonly", "Sort-only column", "Install order has no condition", "", [
      { key: "order", dir: "desc" },
    ]),
  ],
};

/* ── family parameter audit ────────────────────────────────────────────────────────────────── */

export interface ParameterAudit {
  family: string;
  parameter: string;
  scope: "Instance" | "Type";
  group: string;
  shared: boolean;
  usedIn: number | null;
  formula: string;
  finding: "clean" | "unused" | "conflict" | "unreviewed";
}

const FINDING_TONE = {
  clean: "done",
  unused: "caution",
  conflict: "alarm",
  unreviewed: undefined,
} as const;

const PARAMETERS: readonly ParameterAudit[] = [
  {
    family: "Rectangular Duct Tee",
    parameter: "Branch Width",
    scope: "Type",
    group: "Dimensions",
    shared: false,
    usedIn: 3,
    formula: "Main Width * 0.6",
    finding: "clean",
  },
  {
    family: "Rectangular Duct Tee",
    parameter: "Pressure Loss Coefficient",
    scope: "Type",
    group: "Mechanical - Flow",
    shared: true,
    usedIn: 1,
    formula: "",
    finding: "clean",
  },
  {
    family: "Rectangular Duct Tee",
    parameter: "Legacy Flag",
    scope: "Instance",
    group: "Other",
    shared: false,
    usedIn: 0,
    formula: "",
    finding: "unused",
  },
  {
    family: "VAV Box - Single Duct",
    parameter: "Max Airflow",
    scope: "Type",
    group: "Mechanical - Flow",
    shared: true,
    usedIn: 4,
    formula: "",
    finding: "clean",
  },
  {
    family: "VAV Box - Single Duct",
    parameter: "Reheat Capacity",
    scope: "Type",
    group: "Mechanical",
    shared: true,
    usedIn: null,
    formula: "",
    finding: "unreviewed",
  },
  {
    family: "VAV Box - Single Duct",
    parameter: "Inlet Diameter",
    scope: "Type",
    group: "Dimensions",
    shared: false,
    usedIn: 2,
    formula: 'if(Max Airflow > 1500 cfm, 12", 8")',
    finding: "clean",
  },
  {
    family: "Ceiling Diffuser 24x24",
    parameter: "Neck Size",
    scope: "Type",
    group: "Dimensions",
    shared: false,
    usedIn: 2,
    formula: "",
    finding: "conflict",
  },
  {
    family: "Ceiling Diffuser 24x24",
    parameter: "Neck Size",
    scope: "Instance",
    group: "Dimensions",
    shared: false,
    usedIn: 0,
    formula: "",
    finding: "conflict",
  },
  {
    family: "Ceiling Diffuser 24x24",
    parameter: "Throw Distance",
    scope: "Type",
    group: "Mechanical",
    shared: true,
    usedIn: 1,
    formula: "",
    finding: "clean",
  },
  {
    family: "Fire Damper - Rectangular",
    parameter: "Fire Rating",
    scope: "Type",
    group: "Identity Data",
    shared: true,
    usedIn: 5,
    formula: "",
    finding: "clean",
  },
  {
    family: "Fire Damper - Rectangular",
    parameter: "Access Panel Offset",
    scope: "Instance",
    group: "Dimensions",
    shared: false,
    usedIn: null,
    formula: "",
    finding: "unreviewed",
  },
  {
    family: "Fire Damper - Rectangular",
    parameter: "Manufacturer Notes",
    scope: "Type",
    group: "Identity Data",
    shared: false,
    usedIn: 0,
    formula: "",
    finding: "unused",
  },
];

const PARAMETER_VERDICT_TONE = FINDING_TONE;

const PARAMETER_COLUMNS: Column<ParameterAudit>[] = [
  {
    key: "family",
    label: "Family",
    width: "w-56",
    lock: true,
    sort: (r) => r.family,
    search: (r) => r.family,
    condition: { kind: "text", read: (r) => r.family },
    cell: (r) => <span className={text}>{r.family}</span>,
  },
  {
    key: "parameter",
    label: "Parameter name",
    title: "Text with spaces: quote it in a query, or pick it.",
    width: "w-52",
    sort: (r) => r.parameter,
    search: (r) => r.parameter,
    condition: { kind: "text", read: (r) => r.parameter },
    cell: (r) => <span className={text}>{r.parameter}</span>,
  },
  {
    key: "scope",
    label: "Instance or type",
    width: "w-36",
    sort: (r) => r.scope,
    facet: (r) => r.scope,
    options: [
      { value: "Instance", label: "Instance" },
      { value: "Type", label: "Type" },
    ],
    cell: (r) => <span className={text}>{r.scope}</span>,
  },
  {
    key: "group",
    label: "Parameter group",
    width: "w-44",
    sort: (r) => r.group,
    facet: (r) => r.group,
    cell: (r) => <span className={text}>{r.group}</span>,
  },
  {
    key: "shared",
    label: "Shared",
    width: "w-24",
    facet: (r) => (r.shared ? "yes" : "no"),
    options: [
      { value: "yes", label: "Shared" },
      { value: "no", label: "Family only" },
    ],
    cell: (r) => <span className={text}>{r.shared ? "Shared" : "Family only"}</span>,
  },
  {
    key: "usedIn",
    label: "Used by",
    title: "How many dimensions or formulas read it. Empty where the audit has not run.",
    right: true,
    width: "w-28",
    sort: (r) => r.usedIn ?? Number.NEGATIVE_INFINITY,
    condition: { kind: "number", read: (r) => r.usedIn },
    cell: (r) => <span className={`${mono} text-right`}>{r.usedIn ?? "—"}</span>,
  },
  {
    key: "formula",
    label: "Formula",
    width: "w-72",
    search: (r) => r.formula,
    condition: { kind: "text", read: (r) => r.formula },
    cell: (r) => <span className={`${text} face-mono`}>{r.formula}</span>,
  },
  {
    key: "finding",
    label: "Finding",
    title: "The audit's verdict on this parameter.",
    width: "w-32",
    verdict: (r) => ({
      word: r.finding,
      tone: PARAMETER_VERDICT_TONE[r.finding],
      note: `Audit finding: ${r.finding}`,
    }),
  },
];

export const PARAMETER_DATASET: Dataset<ParameterAudit> = {
  id: "parameters",
  label: "Family parameter audit",
  rowKey: (r) => `${r.family}|${r.parameter}|${r.scope}`,
  rows: PARAMETERS,
  columns: PARAMETER_COLUMNS,
  filters: [
    {
      clause: "needs-review",
      label: "Needs review",
      description:
        "Keep unresolved audit findings, including conflicts, unused parameters and incomplete audits.",
      default: true,
    },
    {
      clause: "!unreviewed",
      label: "Audit complete",
      description:
        "Keep parameters whose usage audit has run. A measured zero is still a completed audit.",
    },
    {
      clause: '"Used by">=2',
      label: "Used in multiple places",
      description:
        "Keep parameters referenced in at least two places. A heuristic threshold, not an audit verdict.",
    },
  ],
  rules: [
    { word: "unreviewed", label: "usage audit has not run", matches: (row) => row.usedIn === null },
    {
      word: "needs-review",
      label: "a finding remains to resolve",
      matches: (row) => row.finding !== "clean",
    },
  ],
  constraints: [
    "Shared stores yes/no and shows Shared / Family only; the picker lists the names and writes the stored value.",
    "Used by is a number and is empty until the audit runs.",
    "Formula is text and is empty for a plain value.",
    "Finding is a verdict: it filters and sorts by its word.",
  ],
  presets: [
    preset(
      "rule",
      "Needs review",
      "table-specific rule: any unresolved audit finding",
      "needs-review",
    ),
    preset("negrule", "Audit complete", "negate a table-specific rule", "!unreviewed"),
    preset("tee", "Family contains Tee", "~ on a multi-word value", "Family~Tee"),
    preset("conflict", "Findings that conflict", "= on a verdict", "Finding=conflict"),
    preset("notclean", "Not clean", "! negates a field clause", "!Finding=clean"),
    preset(
      "shared",
      "Shared parameters",
      "= on the stored value yes (shown as Shared)",
      "Shared=yes",
    ),
    preset("unused", "Used by = 0", "= on a number", '"Used by"=0'),
    preset("unreviewed", "Used by is empty", "audit not run", '"Used by"='),
    preset("reviewed", "Used by is not empty", "numeric != with no value", '"Used by"!='),
    preset("formula", "Has a formula", "text != with no value", "Formula!="),
    preset("noformula", "Formula is empty", "text = with no value", "Formula="),
    preset("formulacontains", "Formula contains Max", "~ in free-form text", "Formula~Max"),
    preset(
      "multi",
      "Multi-word field and value",
      "both quoted",
      '"Parameter group"="Mechanical - Flow"',
    ),
    preset(
      "stack",
      "Stacked audit",
      "chips AND together",
      '"Instance or type"=Type "Used by">=1 !"Parameter group"=Dimensions',
    ),
    preset("ordered", "Findings, then usage", "ordered sorts", "", [
      { key: "finding", dir: "asc" },
      { key: "usedIn", dir: "desc" },
      { key: "family", dir: "asc" },
    ]),
  ],
};
