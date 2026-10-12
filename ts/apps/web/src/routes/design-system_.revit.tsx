/**
 * The Revit facsimile specimens. Every window here is a plain `Spec` value rendered by
 * `src/revit/revit.js`, the same renderer pages load at /pages/revit.js. Not house style on purpose.
 *
 * Two authoring modes, both visible below:
 * - flow (Family Types, ASHRAE Table Settings): pieces in `row`/`col` boxes, as read off a screenshot
 *   top-left to bottom-right; Revit's control sizes do the rest. This is the low-effort default.
 * - pinned (Mechanical Settings, Edit Shared Parameters, Routing Preferences): each piece carries an
 *   `at` box read off kaitpw's 200% captures (`.artifacts/revit-mock/ref/user-*.png`): the capture
 *   pixel minus the window frame origin, halved. These match their captures within 1px per line.
 */
import { createFileRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { Revit, RevitCompare, set } from "#/revit";
import type { Dialog, Note, Palette, Piece, Ribbon, Task } from "#/revit";

export const Route = createFileRoute("/design-system_/revit")({ component: RevitSpecimens });

// ── flow-authored ────────────────────────────────────────────────────────────────────────────

const familyTypes: Dialog = {
  t: "dialog",
  title: "Family Types",
  w: 943,
  h: 843,
  grip: true,
  padding: "12px 12px 10px",
  body: [
    {
      t: "row",
      items: [
        { t: "label", text: "Type name:", w: 70 },
        { t: "field", text: "Standard", drop: true, grow: true },
        {
          t: "tools",
          dir: "row",
          gap: 13,
          items: [{ icon: "new" }, { icon: "edit" }, { icon: "delete", disabled: true }],
        },
      ],
    },
    { t: "field", text: "Search parameters", placeholder: true, icon: "search" },
    {
      t: "grid",
      grow: true,
      rowHeight: 20.5,
      headHeight: 22.5,
      columns: [
        { text: "Parameter", w: 345 },
        { text: "Value", w: 142 },
        "Formula",
        { text: "Lock", w: 47 },
      ],
      rows: [
        { band: "Constraints", open: true },
        { cells: ["Default Elevation", `0'  0"`, "=", { checked: false }] },
        { band: "Graphics", open: true },
        { cells: ["Use Annotation Scale (default)", { checked: false }, "=", ""] },
        { band: "Dimensions", open: true },
        { cells: ["Takeoff Length Projection (default)", `12"`, "=", ""] },
        { cells: ["Takeoff Length (default)", `4"`, "=", ""] },
        {
          cells: ["Takeoff Fixed Length (default)", `1"`, `=if(Duct Diameter > 16", Duct Diameter * 0.25, 1")`, ""],
          disabled: true,
        },
        { cells: ["Duct Radius (default)", `6"`, "=", { checked: true }] },
        { cells: ["Duct Diameter (default)", `12"`, "=Duct Radius * 2", { checked: true }] },
        { band: "IFC Parameters", open: true },
        { cells: ["Type IFC Predefined Type", "", "=", ""] },
        { cells: ["Export Type to IFC As", "", "=", ""] },
        { band: "Identity Data", open: false },
      ],
    },
    {
      t: "row",
      items: [
        {
          t: "tools",
          dir: "row",
          gap: 12,
          items: [
            { icon: "edit", disabled: true },
            { icon: "new" },
            { icon: "copy" },
            { icon: "delete", disabled: true },
            { icon: "copy", disabled: true },
            { icon: "up" },
            { icon: "down" },
            { icon: "sortAZ" },
            { icon: "sortZA" },
          ],
        },
        { t: "spacer" },
        { t: "button", text: "Manage Lookup Tables", w: 124 },
      ],
    },
  ],
  buttons: [
    { t: "link", text: "How do I manage family types?" },
    { t: "spacer" },
    { t: "button", text: "OK", default: true, w: 77 },
    { t: "button", text: "Cancel", w: 77 },
    { t: "button", text: "Apply", w: 77 },
  ],
};

/** Loss Method Settings > Edit… on a round elbow, View All off: the list is filtered to tables that fit. */
const ashraeA: Dialog = {
  t: "dialog",
  title: "ASHRAE Table Settings",
  w: 771,
  h: 540,
  padding: "10px 12px 12px",
  body: [
    {
      t: "row",
      grow: true,
      gap: 10,
      items: [
        {
          t: "col",
          w: 214,
          items: [
            { t: "check", text: "View All" },
            {
              t: "tree",
              id: "tables",
              grow: true,
              rows: [
                { text: "Common", open: true },
                { text: "Round", depth: 1, open: true },
                { text: "Elbows", depth: 2, open: true },
                { text: "CD3-11", depth: 3, selected: true },
                ...["CD3-12", "CD3-15", "CD3-2", "CD3-20", "CD3-21"].map((text) => ({ text, depth: 3 })),
              ],
            },
          ],
        },
        {
          t: "col",
          id: "pane",
          grow: true,
          items: [
            { t: "label", text: "Diagram:" },
            { t: "image", id: "diagram", text: "CD3-11 diagram", grow: true },
            { t: "rule" },
          ],
        },
      ],
    },
  ],
  buttons: [
    { t: "button", text: "OK", default: true },
    { t: "button", text: "Cancel" },
  ],
};

const viewAllRows = [
  { text: "Common", open: true, disabled: true },
  { text: "Round", depth: 1, open: true, disabled: true },
  { text: "Straights", depth: 2, open: false, disabled: true },
  { text: "Elbows", depth: 2, open: true, disabled: true },
  ...[1, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 2, 20, 21, 3, 4, 5, 6, 7, 8, 9].map((n) =>
    n === 11
      ? { text: "CD3-11", depth: 3, selected: true }
      : { text: `CD3-${n}`, depth: 3, disabled: true },
  ),
  { text: "Obstructions", depth: 2, open: false, disabled: true },
];

/** The same dialog with View All ticked: every table lists, the highlighted one does not apply. */
const ashraeB: Dialog = [
  (d: Dialog) => set(d, "check:View All", { checked: true }),
  (d: Dialog) => set(d, "button:OK", { disabled: true, default: false }),
  (d: Dialog) => set(d, "tables", { rows: viewAllRows, scroll: { from: 0.04, to: 0.72 } }),
  (d: Dialog) =>
    set(d, "pane", {
      items: [
        { t: "label", text: "Diagram:" },
        { t: "image", id: "diagram", text: "CD3-11 diagram", grow: true },
        { t: "label", text: "This ASHRAE table is not applicable to the selected object." },
        { t: "rule" },
      ],
    }),
].reduce((d, step) => step(d), ashraeA);

const ashraeNotes: Note[] = [
  {
    at: "check:View All",
    text: "Unticked, the list is filtered by the fitting's geometry: CD3-1 and CD3-9 (r/D 1.5) are absent for this r/D 1.0 elbow.",
  },
  {
    at: "tables/CD3-11",
    text: "The highlight is only the first name in string order, not a match. Pressing OK stores CD3-11; this die-stamped elbow is CD3-2.",
  },
  {
    at: "button:OK",
    text: "OK enables only when the highlighted table applies to the selected fitting. With View All on, a table can be highlighted but not stored.",
  },
];

// ── palette and task dialogs ─────────────────────────────────────────────────────────────────

const roundElbow: Palette = {
  t: "palette",
  family: "Round Elbow",
  type: "1 D",
  instance: "Duct Fittings (1)",
  w: 300,
  h: 860,
  scroll: { from: 0.03, to: 0.86 },
  groups: [
    {
      text: "Graphics",
      rows: [
        { name: "Use Annotation Scale", checked: true },
        { name: "Graphics Filter", link: true },
      ],
    },
    { text: "Text", rows: [{ name: "Filter", link: true }] },
    {
      text: "Dimensions",
      rows: [
        { name: "Duct Radius", value: `3 1/2"`, link: true },
        { name: "Length1", value: `7"`, disabled: true },
        { name: "Center Radius", value: `7"`, disabled: true },
        { name: "Angle", value: "90.00°", disabled: true },
        { name: "Size", value: `7"ø-7"ø`, disabled: true },
      ],
    },
    {
      text: "Mechanical",
      rows: [
        { name: "System Classification", value: "Supply Air", disabled: true },
        { name: "System Type", value: "Supply Air", disabled: true },
        { name: "System Name", value: "SA 19", disabled: true },
        { name: "System Abbreviation", value: "SA", disabled: true },
        { name: "Loss Method", value: "Coefficient from ASHRAE Table" },
        { name: "Loss Method Settings", button: "Edit..." },
      ],
    },
    { text: "Mechanical - Flow", rows: [{ name: "Pressure Drop", value: "0.0000 in-wg", disabled: true }] },
    {
      text: "Identity Data",
      rows: [
        { name: "Image" },
        { name: "Comments", link: true },
        { name: "Mark" },
        { name: "Workset", value: "Workset1" },
        { name: "Edited by", disabled: true },
        { name: "Design Option", value: "Main Model", disabled: true },
        { name: "Appears in Schedule", checked: true, disabled: true },
      ],
    },
    {
      text: "Phasing",
      rows: [
        { name: "Phase Created", value: "New Construction" },
        { name: "Phase Demolished", value: "None" },
      ],
    },
    {
      text: "IFC Parameters",
      rows: [
        { name: "IFC Predefined Type" },
        { name: "Export to IFC As" },
        { name: "Export to IFC", value: "By Type" },
        { name: "IfcGUID", value: "1d7zz3pyf1NQEK4Gga..." },
      ],
    },
    {
      text: "Insulation",
      rows: [
        { name: "Overall Size", value: `10"ø-10"ø`, disabled: true },
        { name: "Insulation Thickness", value: `1 1/2"`, disabled: true },
        { name: "Insulation Type", value: "Duct Wrap", disabled: true },
      ],
    },
    {
      text: "Lining",
      rows: [
        { name: "Free Size", value: `7"ø-7"ø`, disabled: true },
        { name: "Lining Thickness", value: `0"`, disabled: true },
      ],
    },
  ],
};

/** The three task dialogs met most, in the journal's own words (.artifacts/revit-mock/journal-census.md). */
const unresolvedReferences: Task = {
  t: "task",
  title: "Unresolved References",
  icon: "warning",
  instruction: "Revit could not find or read 3 references. What do you want to do?",
  links: [
    { text: "Open Manage Links to correct the problem" },
    { text: "Ignore and continue opening the project" },
  ],
  default: "Open Manage Links to correct the problem",
  expander: "Show details",
};
const saveFile: Task = {
  t: "task",
  title: "Save File",
  instruction: "Do you want to save changes to Chadds_Clone_Aug_7.rvt?",
  buttons: ["Yes", "No", "Cancel"],
  default: "Yes",
  w: 420,
};
const familyAlreadyExists: Task = {
  t: "task",
  title: "Family Already Exists",
  instruction:
    "You are trying to load the family Ernesto Air Terminal Tag, which already exists in this project. What do you want to do?",
  links: [
    { text: "Overwrite the existing version" },
    { text: "Overwrite the existing version and its parameter values" },
  ],
  buttons: ["Cancel"],
  default: "Overwrite the existing version",
};

const ribbon: Ribbon = {
  t: "ribbon",
  tabs: ["Architecture", "Structure", "Steel", "Precast", "Systems", "Insert", "Annotate", "Analyze", "Massing & Site", "Collaborate", "View", "Manage", "Add-Ins"],
  selected: "Systems",
  modify: "Modify | Place Duct",
  panels: [
    {
      text: "HVAC",
      items: [
        { label: "Duct", glyph: "D", selected: true },
        { label: "Duct\nPlaceholder", glyph: "DP" },
        { label: "Duct\nFitting", glyph: "DF" },
        { label: "Duct\nAccessory", glyph: "DA" },
        [
          { label: "Flex Duct", glyph: "F" },
          { label: "Air Terminal", glyph: "A" },
          { label: "Convert to Flex Duct", glyph: "C" },
        ],
        { label: "Mechanical\nEquipment", glyph: "ME" },
      ],
    },
    {
      text: "Piping",
      items: [
        { label: "Pipe", glyph: "P" },
        { label: "Pipe\nFitting", glyph: "PF" },
        { label: "Plumbing\nFixture", glyph: "PX" },
      ],
    },
  ],
  options: [
    { t: "label", text: "Modify | Place Duct" },
    { t: "label", text: "Width:" },
    { t: "field", text: `12"`, drop: true, w: 80 },
    { t: "label", text: "Height:" },
    { t: "field", text: `12"`, drop: true, w: 80 },
    { t: "label", text: "Offset:" },
    { t: "field", text: `9' 0"`, drop: true, w: 90 },
    { t: "check", text: "Tag on Placement", checked: true },
  ],
};

// ── pinned to captures (1:1) ─────────────────────────────────────────────────────────────────

const pipeSettings: readonly [string, string][] = [
  ["Pipe Fitting Annotation Size", '1/8"'],
  ["Pipe Size Prefix", ""],
  ["Pipe Size Suffix", "ø"],
  ["Pipe Connector Separator", "-"],
  ["Pipe Connector Tolerance", "5.00°"],
  ["Pipe Rise / Drop Annotation Size", '1/8"'],
  ["Flat On Top", "FOT"],
  ["Flat On Bottom", "FOB"],
  ["Set Up From Top", "SU"],
  ["Set Down From Top", "SD"],
  ["Set Up From Bottom", "BU"],
  ["Set Down From Bottom", "BD"],
  ["Centerline", "="],
];

const mechanicalSettings: Dialog = {
  t: "dialog",
  title: "Mechanical Settings",
  caption: "help",
  w: 644.5,
  h: 486.5,
  grip: true,
  body: [
    {
      t: "tree",
      at: { x: 5, y: 33.5, w: 191, h: 422.5 },
      rows: [
        { text: "Hidden Line" },
        { text: "Duct Settings", open: true },
        ...["Angles", "Conversion", "Rectangular", "Oval", "Round", "Calculation"].map((text) => ({
          text,
          depth: 1,
        })),
        { text: "Pipe Settings", open: true, selected: true },
        ...["Angles", "Conversion", "Segments and Sizes", "Fluids", "Slopes", "Calculation"].map(
          (text) => ({ text, depth: 1 }),
        ),
      ],
    },
    {
      t: "grid",
      at: { x: 200.5, y: 33.5, w: 442.5, h: 421 },
      lift: 4,
      columns: [{ text: "Setting", w: 219.5 }, "Value"],
      rows: [
        { cells: ["Use Annot. Scale for Single Line Fittings", { checked: true }], current: 1 },
        ...pipeSettings.map(([name, value]) => ({ cells: [name, value] })),
      ],
    },
    { t: "button", text: "OK", default: true, at: { x: 484.5, y: 462.5, w: 74, h: 21 } },
    { t: "button", text: "Cancel", at: { x: 564.5, y: 462.5, w: 74, h: 21 } },
  ],
};

const sharedParameters: Dialog = {
  t: "dialog",
  title: "Edit Shared Parameters",
  w: 422,
  h: 435,
  grip: true,
  body: [
    { t: "label", text: "Shared parameter file:", at: { x: 11.5, y: 40.5 } },
    {
      t: "field",
      text: "C:\\Users\\kaitp\\AppData\\Local\\Temp\\0eeed4c1.txt",
      readOnly: true,
      at: { x: 11.5, y: 60.5, w: 206.5, h: 19 },
      h: 19,
    },
    { t: "button", text: "Browse...", at: { x: 225.5, y: 59, w: 89, h: 22.5 } },
    { t: "button", text: "Create...", at: { x: 321.5, y: 59, w: 89, h: 22.5 } },
    { t: "label", text: "Parameter group:", at: { x: 11.5, y: 92 } },
    { t: "field", text: "", drop: true, disabled: true, at: { x: 11.5, y: 110.5, w: 263.5, h: 17 }, h: 17 },
    { t: "label", text: "Parameters:", at: { x: 11.5, y: 139.5 } },
    { t: "list", items: [], at: { x: 11.5, y: 155.5, w: 263.5, h: 229.5 } },
    { t: "group", text: "Parameters", at: { x: 285, y: 155.5, w: 126, h: 124.5 } },
    ...(
      [
        ["params", "New...", 165.5],
        ["params", "Properties...", 193.5],
        ["params", "Move...", 223.5],
        ["params", "Delete", 251.5],
        ["groups", "New...", 298.5],
        ["groups", "Rename...", 328],
        ["groups", "Delete", 356],
      ] as const
    ).map(
      ([scope, text, y]): Piece => ({
        t: "button",
        id: `${scope}/${text}`,
        text,
        disabled: true,
        at: { x: 296, y, w: 104, h: 22.5 },
      }),
    ),
    { t: "group", text: "Groups", at: { x: 285, y: 289, w: 126, h: 95 } },
    { t: "button", text: "OK", default: true, at: { x: 129, y: 393.5, w: 89, h: 22.5 } },
    { t: "button", text: "Cancel", at: { x: 225.5, y: 393.5, w: 89, h: 22.5 } },
    { t: "button", text: "Help", at: { x: 321.5, y: 393.5, w: 89, h: 22.5 } },
  ],
};

const routing: readonly [string, readonly string[], number?][] = [
  ["Elbow", ["Round Elbow: 1 D"]],
  ["Preferred Junction Type", ["Tap"]],
  ["Junction", ["Round Takeoff: Standard", "Round Tee: Standard"], 1],
  ["Cross", ["Round Cross: Standard"]],
  ["Transition", ["Round Transition - Angle: 45 Degree"]],
  ["Multi-shape Transition Rectangular to Round", ["Rectangular to Round Transition - Angle: 45 Degree"]],
  ["Multi-shape Transition Rectangular to Oval", ["None"]],
  ["Multi-shape Transition Oval to Round", ["Oval to Round Transition - Length: Standard"]],
  ["Union", ["Round Union: Standard"]],
];

const routingPreferences: Dialog = {
  t: "dialog",
  title: "Routing Preferences",
  caption: "help",
  w: 510,
  h: 555,
  grip: true,
  body: [
    { t: "group", text: "Duct Type: Taps / Short Radius", at: { x: 13.5, y: 51, w: 476.5, h: 454 } },
    { t: "button", text: "Duct Size...", at: { x: 25, y: 66, w: 117, h: 21 } },
    { t: "button", text: "Load Family...", at: { x: 164, y: 66, w: 108.5, h: 21 } },
    {
      t: "tools",
      gap: 11,
      at: { x: 29, y: 106, w: 18 },
      items: (["up", "down", "add", "remove"] as const).map((icon) => ({ icon, disabled: true })),
    },
    {
      t: "grid",
      at: { x: 72, y: 103, w: 408, h: 387 },
      rowHeight: 20.5,
      headHeight: 22,
      scroll: { from: 0.047, to: 0.73 },
      columns: ["Content"],
      rows: routing.flatMap(([band, items, muted]) => [
        { band },
        ...items.map((item, index) => ({ cells: [item], disabled: index === muted })),
      ]),
    },
    { t: "button", text: "OK", default: true, at: { x: 311, y: 518.5, w: 89, h: 22 } },
    { t: "button", text: "Cancel", at: { x: 407, y: 518.5, w: 89, h: 22 } },
  ],
};

// ── the page ─────────────────────────────────────────────────────────────────────────────────

function Specimen(props: { title: string; id?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2" data-specimen={props.id}>
      <h2 className="t-title">{props.title}</h2>
      {props.children}
    </div>
  );
}

function RevitSpecimens() {
  return (
    <div className="flex flex-col gap-8 p-6" data-surface="page">
      <Specimen title="ASHRAE Table Settings · View All off vs on (compare, with notes)">
        <RevitCompare
          a={ashraeA}
          b={ashraeB}
          notes={ashraeNotes}
          labels={["View All off: filtered list, OK enabled", "View All on: every table, OK disabled"]}
        />
      </Specimen>
      <section className="flex flex-wrap items-start gap-8">
        <Specimen title="Properties · Round Elbow">
          <Revit spec={roundElbow} notes={[{ at: "Mechanical/Loss Method Settings", text: "Opens ASHRAE Table Settings." }]} />
        </Specimen>
        <Specimen title="Family Types (flow)">
          <Revit spec={familyTypes} />
        </Specimen>
      </section>
      <section className="flex flex-wrap items-start gap-8">
        <Specimen title="Mechanical Settings · Pipe Settings (pinned)" id="mech-settings">
          <Revit spec={mechanicalSettings} />
        </Specimen>
        <Specimen title="Edit Shared Parameters (pinned)" id="shared-params">
          <Revit spec={sharedParameters} />
        </Specimen>
        <Specimen title="Routing Preferences (pinned)" id="routing-prefs">
          <Revit spec={routingPreferences} />
        </Specimen>
      </section>
      <section className="flex flex-wrap items-start gap-8">
        <Specimen title="Task dialogs, from the journal">
          <Revit spec={unresolvedReferences} />
          <Revit spec={saveFile} />
          <Revit spec={familyAlreadyExists} />
        </Specimen>
      </section>
      <Specimen title="Ribbon · Systems tab, Duct active">
        <Revit spec={ribbon} />
      </Specimen>
    </div>
  );
}
