/**
 * PROTOTYPE FIXTURE — param-tables round 1 (find-the-product).
 *
 * Real data pulled live from ProjectA_Clone_Aug_11 (port 5180,
 * session-4152b5db3f63c250) on 2026-08-17:
 *   - "SXL - FOM HWCH Plant" (schedule 7199405) — a figures-of-merit grid that
 *     lives entirely in schedule HEADER cells: dead text, unlinkable in Revit.
 *   - "SXL - M_BOD_MainHouse" (schedule 11673741, placed on sheet M001) — a
 *     basis-of-design list whose label AND value are concatenated into one
 *     header cell per row. IDT/ODT live here as prose.
 *   - "Hydronic Fan Coil Unit Performance Schedule" (9553275) — a REAL
 *     schedule over OST_MechanicalEquipment driven by PE_* shared parameters.
 *
 * The product question this fixture serves: those design values (IDT, ODT,
 * plant temps) should be AUTHORED once in a table and FLOW into the PE_*
 * parameters on the fan coils, where the real schedule picks them up.
 * Native Revit cannot express that linkage at all — the SXL views are the
 * workaround this product replaces.
 *
 * Honesty notes baked in (do not sand off in variants):
 *   - Several temperature params are FORMULA-DRIVEN and read-only on some
 *     types (see PARAM_META); a write there must refuse per-target.
 *   - Perf params live at TYPE scope; tag/serves/location are instance scope.
 *     One type (Mortex MSVT18) is shared by 14 tags — writing "FC-4's EWT"
 *     actually writes the type and hits 13 siblings.
 *   - The model holds 36 FC-* instances; the Main House schedule shows 23.
 */

// ---------------------------------------------------------------------------
// Basis of Design (M001 · "SXL - M_BOD_MainHouse")
// ---------------------------------------------------------------------------

export interface BodEntry {
  key: string;
  label: string;
  value: string;
  /** Numeric portion when the value is a single number. */
  numeric?: number;
  unit?: string;
}

export const BOD_MAIN_HOUSE: BodEntry[] = [
  {
    key: "weather-station",
    label: "Weather Station Location for Design Conditions",
    value: "Avondale 2 N, PA",
  },
  { key: "climate-zone", label: "Climate Zone", value: "4A" },
  {
    key: "odt-summer",
    label: "Outdoor Design Temperature (Summer DB)",
    value: "88.9",
    numeric: 88.9,
    unit: "°F",
  },
  {
    key: "odt-winter",
    label: "Outdoor Design Temperature (Winter DB)",
    value: "9.4",
    numeric: 9.4,
    unit: "°F",
  },
  {
    key: "idt",
    label: "Indoor Design Temperature (Summer DB/WB / Winter DB)",
    value: "70.0 / 58.3 / 70.0",
    unit: "°F",
  },
  { key: "volume", label: "Building Volume", value: "3,550,984", numeric: 3550984, unit: "CF" },
  { key: "sqft", label: "Building Square Footage", value: "42,330", numeric: 42330 },
  { key: "bedrooms", label: "Number of Bedrooms", value: "8", numeric: 8 },
  { key: "ach50", label: "Design Airtightness Rating", value: "3", numeric: 3, unit: "ACH50" },
  {
    key: "cfm50",
    label: "Design Blower Door Maximum",
    value: "177,549",
    numeric: 177549,
    unit: "CFM50",
  },
  {
    key: "vent-strategy",
    label: "Ventilation, Pressurization Strategy",
    value: "Continuous, Balanced",
  },
  {
    key: "vent-irc",
    label: "Minimum Ventilation Rate — 2021 IRC Table M1505.4.3(1)",
    value: "165",
    numeric: 165,
    unit: "CFM",
  },
  {
    key: "vent-ashrae",
    label: "Minimum Ventilation Rate — ASHRAE 62.2-2016",
    value: "1,338",
    numeric: 1338,
    unit: "CFM",
  },
  {
    key: "vent-design",
    label: "Design Ventilation Rate",
    value: "1,360",
    numeric: 1360,
    unit: "CFM",
  },
  {
    key: "wall-assembly",
    label: "Wall Assembly Description",
    value:
      "Above grade: R-3 insulated sheathing, R-13 closed cell sprayfoam in a 2x6 wood stud cavity, Batt R-13 ~R-28. Below grade: Concrete wall with R-20 board insulation, 2x6 wood framing.",
  },
  {
    key: "floor-assembly",
    label: "Floor Assembly Description",
    value: 'Slab on grade, 2" foam ~R-10 edge insulation',
  },
  {
    key: "roof-assembly",
    label: "Roof Assembly Description",
    value: "R-49 closed cell sprayfoam in 2x14 joist cavity",
  },
  { key: "window-u-shgc", label: "Average Window Assembly U-value/SHGC", value: "0.28 / 0.41" },
];

// ---------------------------------------------------------------------------
// Figures of Merit (source: "SXL - FOM HWCH Plant")
// ---------------------------------------------------------------------------

/** The FOM grid exactly as it renders today (5 header rows × 11 columns). */
export const FOM_HWCH_PLANT = {
  name: "FOM HWCH Plant",
  groupRow: ["Equipment", "", "", "Net Cooling", "", "", "", "Heating", "", "", ""],
  headRow: [
    "HP Mark",
    "HP Model",
    "Area Served",
    "Source Temp",
    "Capacity (Btu/hr)",
    "Load (Btu/hr)",
    "Capacity/Load",
    "Source Temp",
    "Capacity (Btu/hr)",
    "Load (Btu/hr)",
    "Capacity/Load",
  ],
  dataRow: [
    "WWHP-1 through WWHP-4",
    "NDW180",
    "Main House, Guest Suite, Pool House",
    "50°F",
    "773,260",
    "469,077",
    "165%",
    "30°F",
    "559,212",
    "486,751",
    "115%",
  ],
  footnote: "* 20% propylene glycol mix for source side loop; 100% water for load side loop",
} as const;

// ---------------------------------------------------------------------------
// Fan coils (the far side of the linkage)
// ---------------------------------------------------------------------------

export interface FcRow {
  tag: string;
  elementId: number;
  /** Family type name — perf params live at TYPE scope and are shared. */
  typeName: string;
  serves: string;
  location: string;
  manufacturer: string;
  model: string;
  heat: { capTotal: number; gpm: number; ewt: number; lwt: number };
  cool: { sens: number; lat: number; total: number; gpm: number; ewt: number; lwt: number };
  voltage: number;
  mca: number;
}

const mortex18 = {
  heat: { capTotal: 17760, gpm: 1.8, ewt: 110, lwt: 100 },
  cool: { sens: 17979, lat: 8192, total: 26171, gpm: 4.0, ewt: 45, lwt: 55 },
  voltage: 120,
  mca: 6,
};
const mortex24 = {
  heat: { capTotal: 20700, gpm: 2.1, ewt: 110, lwt: 100 },
  cool: { sens: 23736, lat: 10795, total: 34531, gpm: 6.0, ewt: 45, lwt: 55 },
  voltage: 120,
  mca: 6,
};
const mortex36 = {
  heat: { capTotal: 32710, gpm: 3.3, ewt: 110, lwt: 100 },
  cool: { sens: 33322, lat: 12928, total: 46250, gpm: 7.0, ewt: 45, lwt: 55 },
  voltage: 120,
  mca: 10.5,
};
const jaga = {
  heat: { capTotal: 17860, gpm: 3.6, ewt: 110, lwt: 100 },
  cool: { sens: 9248, lat: 0, total: 9248, gpm: 1.9, ewt: 45, lwt: 55 },
  voltage: 120,
  mca: 1.3,
};

const mk = (
  tag: string,
  elementId: number,
  typeName: string,
  serves: string,
  location: string,
  manufacturer: string,
  model: string,
  perf: { heat: FcRow["heat"]; cool: FcRow["cool"]; voltage: number; mca: number },
): FcRow => ({ tag, elementId, typeName, serves, location, manufacturer, model, ...perf });

export const FC_UNITS: FcRow[] = [
  mk(
    "FC-1",
    6071117,
    "DVWHSA024A07000810RV2",
    "Primary Bedroom",
    "Mechanical West 021",
    "Mortex",
    "DVWHSA024A07000810RV2",
    {
      heat: { capTotal: 12700, gpm: 1.3, ewt: 110, lwt: 90 },
      cool: { sens: 13700, lat: 330, total: 14030, gpm: 4.0, ewt: 45, lwt: 55 },
      voltage: 208,
      mca: 1.1,
    },
  ),
  mk(
    "FC-2",
    6047212,
    "Mortex MSVT24",
    "Primary Bath/Closet",
    "Mechanical West 021",
    "Mortex",
    "MSVT24",
    mortex24,
  ),
  mk(
    "FC-3",
    6047248,
    "Mortex MSVT36",
    "Public Spaces",
    "Mechanical West 021",
    "Mortex",
    "MSVT36",
    mortex36,
  ),
  mk(
    "FC-4",
    6034271,
    "Mortex MSVT18",
    "Golf Sim",
    "Mechanical West 021",
    "Mortex",
    "MSVT18",
    mortex18,
  ),
  mk("FC-5", 6404587, "Mortex MSVT18", "Den", "Mechanical West 021", "Mortex", "MSVT18", mortex18),
  mk(
    "FC-6",
    6814595,
    "Mortex MSVT18",
    "Entry Hall",
    "Mechanical West 021",
    "Mortex",
    "MSVT18",
    mortex18,
  ),
  mk(
    "FC-7",
    11055778,
    "Mortex MSVT18",
    "Tasting/Lounge/Bar",
    "Mechanical West 021",
    "Mortex",
    "MSVT18",
    mortex18,
  ),
  mk(
    "FC-8",
    6830559,
    "Mortex MSVT18",
    "Great Room W",
    "Mechanical West 021",
    "Mortex",
    "MSVT18",
    mortex18,
  ),
  mk(
    "FC-9",
    6064216,
    "Mortex MSVT18",
    "Kathy's Office",
    "Mechanical South 026",
    "Mortex",
    "MSVT18",
    mortex18,
  ),
  mk(
    "FC-10",
    9191428,
    "Mortex MSVT18",
    "Theater",
    "Mechanical Northeast 028",
    "Mortex",
    "MSVT18",
    mortex18,
  ),
  mk(
    "FC-11",
    6066558,
    "Mortex MSVT36",
    "Kitchen & Breakfast",
    "Mechanical Northeast 028",
    "Mortex",
    "MSVT36",
    mortex36,
  ),
  mk("FC-12", 6852955, "Mortex MSVT18", "Family Room", "Storage 030", "Mortex", "MSVT18", mortex18),
  mk(
    "FC-13",
    6404588,
    "HWHDA036212000.500800RB2",
    "Great Room E",
    "Mechanical Northeast 028",
    "Mortex",
    "HWHDA036212000.500800RB2",
    {
      heat: { capTotal: 0, gpm: 0, ewt: 110, lwt: 100 },
      cool: { sens: 37900, lat: 10200, total: 27700, gpm: 15.0, ewt: 45, lwt: 55 },
      voltage: 208,
      mca: 1.2,
    },
  ),
  mk(
    "FC-14",
    9983239,
    "Mortex MSVT18",
    "AV Equipment",
    "Mechanical Northeast 028",
    "Mortex",
    "MSVT18",
    mortex18,
  ),
  mk(
    "FC-15",
    6037907,
    "Mortex MSVT18",
    "Xbox/Hall",
    "Mechanical Southeast 027",
    "Mortex",
    "MSVT18",
    mortex18,
  ),
  mk(
    "FC-16",
    6071192,
    "Mortex MSVT18",
    "Side Entry & Mudroom",
    "Mechanical Southeast 027",
    "Mortex",
    "MSVT18",
    mortex18,
  ),
  mk(
    "FC-17",
    9668311,
    "Mortex MSVT36",
    "Conf Room/Kitchenette",
    "Storage 154",
    "Mortex",
    "MSVT36",
    mortex36,
  ),
  mk(
    "FC-18",
    7764774,
    "Mortex MSVT24",
    "Guest Living Room",
    "Guest House Attic",
    "Mortex",
    "MSVT24",
    mortex24,
  ),
  mk(
    "FC-19",
    8707393,
    "Jaga BABC095",
    "Pool House",
    "Pool House Attic",
    "Jaga",
    "BABC.05509522/BT",
    jaga,
  ),
  mk(
    "FC-20",
    6110025,
    "Mortex MSVT18",
    "Suite #4",
    "Upper Level Mech Room",
    "Mortex",
    "MSVT18",
    mortex18,
  ),
  mk(
    "FC-21",
    6107982,
    "Mortex MSVT18",
    "Massage/Spa",
    "Storage & Mech 259",
    "Mortex",
    "MSVT18",
    mortex18,
  ),
  mk(
    "FC-22",
    6075210,
    "Jaga BABC095",
    "Break Room",
    "Storage & Mech 259",
    "Jaga",
    "BABC.05509522/BT",
    jaga,
  ),
  mk(
    "FC-23",
    8732550,
    "Mortex MSVT24",
    "Rob's Office/Lounge",
    "Garage Attic Southwest 259",
    "Mortex",
    "MSVT24",
    mortex24,
  ),
];

// ---------------------------------------------------------------------------
// Parameter identities (what a linkage actually targets)
// ---------------------------------------------------------------------------

export interface ParamMeta {
  name: string;
  scope: "type" | "instance";
  storage: "Double" | "String";
  unit?: string;
  /** True on types where a family formula owns the value — a write must refuse. */
  readOnlyOn?: string[];
  label: string;
}

/** Verified live on FC-1's type (DVWHSA…RV2). Read-only flags are per-type facts. */
export const PARAM_META: ParamMeta[] = [
  {
    name: "PE_M_PerfHeat_FluidEWT",
    scope: "type",
    storage: "Double",
    unit: "°F",
    label: "Heating EWT",
    readOnlyOn: ["DVWHSA024A07000810RV2"],
  },
  {
    name: "PE_M_PerfHeat_FluidLWT",
    scope: "type",
    storage: "Double",
    unit: "°F",
    label: "Heating LWT",
  },
  {
    name: "PE_M_PerfCool_FluidEWT",
    scope: "type",
    storage: "Double",
    unit: "°F",
    label: "Cooling EWT",
    readOnlyOn: ["DVWHSA024A07000810RV2"],
  },
  {
    name: "PE_M_PerfCool_FluidLWT",
    scope: "type",
    storage: "Double",
    unit: "°F",
    label: "Cooling LWT",
    readOnlyOn: ["DVWHSA024A07000810RV2"],
  },
  {
    name: "PE_M_PerfHeat_CapacityDesignTotal",
    scope: "type",
    storage: "Double",
    unit: "Btu/h",
    label: "Heating design capacity",
  },
  {
    name: "PE_M_PerfCool_CapacityDesignTotal",
    scope: "type",
    storage: "Double",
    unit: "Btu/h",
    label: "Cooling design capacity",
  },
  {
    name: "PE_M_Fan_AirFlow",
    scope: "instance",
    storage: "Double",
    unit: "CFM",
    label: "Fan airflow",
  },
  { name: "PE_G___TagInstance", scope: "instance", storage: "String", label: "Tag" },
];

/**
 * The demo linkage the round must express end-to-end:
 * FOM "Heating Source Temp" (30°F) and BOD ODT-winter (9.4°F) are design
 * facts; the concrete acceptance path is: edit heating EWT/LWT in the
 * authored table → staged writes on PE_M_PerfHeat_FluidEWT/LWT across the
 * FC types → the performance schedule columns move → one explicit apply.
 */
export const DEMO_LINK = {
  sourceLabel: "Heating loop supply/return (design)",
  targets: ["PE_M_PerfHeat_FluidEWT", "PE_M_PerfHeat_FluidLWT"],
} as const;
