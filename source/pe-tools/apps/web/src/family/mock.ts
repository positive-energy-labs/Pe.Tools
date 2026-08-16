/**
 * `/family?mock` fixture — a self-contained authored family plus a few pea proposals.
 *
 * The model is a copy of the checked-in showcase family
 * (`Pe.Revit.Tests/Fixtures/Profiles/family-model/family-model-showcase.family.json`):
 * copied, not referenced, because the web app must not reach across into the test project.
 * If the real fixture grows a construct the route cannot draw, re-copy it — that divergence
 * is exactly the signal the mock exists to give.
 */
import { settingsFieldPointer } from "@pe/agent-contracts";

import type { FieldState } from "#/family/store";

export const MOCK_FAMILY_PATH = "showcase/family-model-showcase.family.json";

const MOCK_FAMILY_MODEL = {
  family: {
    name: "PE Family Model Showcase",
    category: "Generic Models",
    template: "Generic Model",
    placement: "Unhosted",
  },
  familyParameters: {
    "Body Width": { dataType: "Length (Common)", value: "24in" },
    "Body Depth": { dataType: "Length (Common)", value: "18in" },
    "Body Height": { dataType: "Length (Common)", value: "30in" },
    "Top Diameter": { dataType: "Length (Common)", value: "8in" },
    "Top Height": { dataType: "Length (Common)", value: "4in" },
    "Slot Width": { dataType: "Length (Common)", value: "6in" },
    "Slot Depth": { dataType: "Length (Common)", value: "4in" },
    "Slot Height": { dataType: "Length (Common)", value: "12in" },
    "Core Diameter": { dataType: "Length (Common)", value: "3in" },
    "Core Height": { dataType: "Length (Common)", formula: "Body Height + Top Height" },
    "Return Elevation": { dataType: "Length (Common)", value: "15in" },
    "Pipe Elevation": { dataType: "Length (Common)", value: "8in" },
    "Electrical Elevation": { dataType: "Length (Common)", value: "20in" },
    "Round Duct Diameter": { dataType: "Length (Common)", value: "6in" },
    "Rect Duct Width": { dataType: "Length (Common)", value: "10in" },
    "Rect Duct Height": { dataType: "Length (Common)", value: "6in" },
    "Pipe Diameter": { dataType: "Length (Common)", value: "1in" },
    "Electrical Diameter": { dataType: "Length (Common)", value: "1in" },
    "Stub Depth": { dataType: "Length (Common)", value: "2in" },
  },
  types: {
    Compact: { "Body Width": "18in", "Body Depth": "14in", "Body Height": "24in" },
    Standard: {},
    Tall: { "Body Height": "42in", "Return Elevation": "24in", "Electrical Elevation": "32in" },
  },
  planes: {
    "return-elevation": {
      from: "plane:family.Bottom",
      by: "param:Return Elevation",
      direction: "Out",
    },
    "pipe-elevation": { from: "plane:family.Bottom", by: "param:Pipe Elevation", direction: "Out" },
    "electrical-elevation": {
      from: "plane:family.Bottom",
      by: "param:Electrical Elevation",
      direction: "Out",
    },
  },
  frames: {
    "supply-air": {
      origin: ["face:body.Top", "plane:family.CenterLR", "plane:family.CenterFB"],
      normal: "+Z",
      up: "+Y",
    },
    "return-air": {
      origin: ["face:body.Back", "plane:family.CenterLR", "plane:return-elevation"],
      normal: "+Y",
      up: "+Z",
    },
    condensate: {
      origin: ["face:body.Left", "plane:family.CenterFB", "plane:pipe-elevation"],
      normal: "+X",
      up: "+Z",
    },
    power: {
      origin: ["face:body.Right", "plane:family.CenterFB", "plane:electrical-elevation"],
      normal: "+X",
      up: "+Z",
    },
  },
  solids: {
    body: {
      kind: "Prism",
      frame: "frame:family",
      width: "param:Body Width",
      depth: "param:Body Depth",
      height: "param:Body Height",
    },
    "top-neck": {
      kind: "Cylinder",
      frame: "frame:family",
      diameter: "param:Top Diameter",
      height: "param:Top Height",
    },
    "access-slot": {
      kind: "VoidPrism",
      frame: "frame:family",
      width: "param:Slot Width",
      depth: "param:Slot Depth",
      height: "param:Slot Height",
    },
    "core-bore": {
      kind: "VoidCylinder",
      frame: "frame:family",
      diameter: "param:Core Diameter",
      height: "param:Core Height",
    },
  },
  connectors: {
    "supply-air": {
      domain: "Duct",
      frame: "frame:supply-air",
      shape: "Round",
      diameter: "param:Round Duct Diameter",
      stub: { depth: "param:Stub Depth", direction: "Out" },
      systemType: "SupplyAir",
      flowDirection: "Out",
    },
    "return-air": {
      domain: "Duct",
      frame: "frame:return-air",
      shape: "Rectangular",
      width: "param:Rect Duct Width",
      height: "param:Rect Duct Height",
      stub: { depth: "param:Stub Depth", direction: "In" },
      systemType: "ReturnAir",
      flowDirection: "In",
    },
    condensate: {
      domain: "Pipe",
      frame: "frame:condensate",
      shape: "Round",
      diameter: "param:Pipe Diameter",
      stub: { depth: "param:Stub Depth", direction: "In" },
      systemType: "Sanitary",
      flowDirection: "Out",
    },
    power: {
      domain: "Electrical",
      frame: "frame:power",
      shape: "Round",
      diameter: "param:Electrical Diameter",
      stub: { depth: "param:Stub Depth", direction: "Out" },
      systemType: "PowerBalanced",
    },
  },
  roomCalculationPoint: { enabled: true },
};

export const MOCK_FAMILY_JSON = JSON.stringify(MOCK_FAMILY_MODEL, null, 2);

/** Two open proposals with citations, so the trichotomy, accept/acceptAll, and the
 * citation channel all have something real to render without pea running. */
export const MOCK_FAMILY_FIELDS: Record<string, FieldState> = {
  [settingsFieldPointer(["familyParameters", "Top Diameter", "value"])]: {
    proposal: {
      value: "10in",
      note: "spec table lists a 10in neck for the -B variant",
      confidence: "high",
      sources: [{ blockId: "block-7", rowIdx: 3, colIdx: 2 }],
    },
    review: "none",
  },
  [settingsFieldPointer(["types", "Tall", "Body Width"])]: {
    proposal: {
      value: "20in",
      note: "read off a low-resolution dimension callout",
      confidence: "low",
      sources: [{ blockId: "block-9", rowIdx: 1, colIdx: 1 }, { blockId: "figure-2" }],
    },
    review: "attention",
  },
  // PROTOTYPE — proposals whose sources point at REAL blocks/cells of SAMPLE_DOC
  // (grounded-doc/sample.ts), so `?mock` can exercise the side-by-side scraping story:
  // hovering these cells drives the doc pane camera onto a measured region.
  // The two fixtures above are deliberately left alone — their block ids resolve to
  // nothing, which is what keeps the honest "unresolved citation" path on screen.
  [settingsFieldPointer(["familyParameters", "Body Width", "value"])]: {
    proposal: {
      value: "24in",
      note: 'spec table, Width row, FCU-400-A column — 24"',
      confidence: "high",
      sources: [{ blockId: "p1-i2", rowIdx: 4, colIdx: 1 }],
    },
    review: "none",
  },
  [settingsFieldPointer(["types", "Tall", "Body Width"])]: {
    proposal: {
      value: "36in",
      note: 'the -C column is the tall unit — Width 36"',
      confidence: "high",
      sources: [{ blockId: "p1-i2", rowIdx: 4, colIdx: 3 }],
    },
    review: "none",
  },
  [settingsFieldPointer(["familyParameters", "Pipe Diameter", "value"])]: {
    proposal: {
      value: "0.875in",
      note: 'connection data table: condensate 7/8" OD',
      confidence: "high",
      sources: [{ blockId: "p2-i1", rowIdx: 2, colIdx: 1 }],
    },
    review: "none",
  },
  [settingsFieldPointer(["familyParameters", "Round Duct Diameter", "value"])]: {
    proposal: {
      value: "6in",
      note: "airflow row plus the wiring note — two regions, one value",
      confidence: "low",
      sources: [
        { blockId: "p1-i2", rowIdx: 0, colIdx: 2 },
        { blockId: "p2-i2" },
        { blockId: "figure-2" },
      ],
    },
    review: "none",
  },
};
