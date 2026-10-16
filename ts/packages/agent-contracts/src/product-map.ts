/**
 * The product map: every link from rooms to basis of design, what each needs, where its data is
 * stored and how ready it is. One source for the `/map` route, each route's help page, and later
 * Pea. Status is set by hand today; a route's own findings can set it later without changing this
 * shape. Ledger: `docs/features/pressure-drop/LEDGER.md` (2026-10-16).
 */

/** works: runs without a person today; gaps: runs with assumptions or manual steps; none: no data yet. */
export type MapStatus = "works" | "gaps" | "none";

export interface MapPart {
  id: string;
  label: string;
  status: MapStatus;
  /** What the part contributes. */
  adds: string;
  /** Whether it runs without a person today, and what is missing. */
  automatic: string;
  /** Where its data is stored today. */
  data: string;
  /** How hard the data is to get. */
  effort: string;
}

/** A dotted relation drawn between two parts of one link. */
export interface MapRelation {
  from: string;
  to: string;
  label: string;
}

export interface MapLink {
  id: string;
  label: string;
  status: MapStatus;
  /** The web route that owns it, if any. */
  route: string | null;
  /** The link before it in the chain. */
  after: string | null;
  note: string;
  parts: MapPart[];
  /** Part ids drawn as a solid path, in order; the other parts hang off it by `relations`. */
  path: string[];
  relations: MapRelation[];
}

const PRESSURE_DROP_PARTS: MapPart[] = [
  {
    id: "fan",
    label: "Fan",
    status: "gaps",
    adds: "Where every path starts",
    automatic:
      "Partly. When one unit on a network has a load system, Pe treats the others as inline.",
    data: "Pe's inference",
    effort: "Medium. Needs a role per unit (decision 5).",
  },
  {
    id: "inline",
    label: "Inline parts",
    status: "none",
    adds: "A fixed drop at design airflow for a coil, filter, dehumidifier or ERV core, from the product's submittal",
    automatic: "No",
    data: "Submittals",
    effort: "Hard. Per product, and depends on what the unit's own rating already includes.",
  },
  {
    id: "duct",
    label: "Straight duct",
    status: "works",
    adds: "Friction from length, size, airflow and roughness",
    automatic: "Yes",
    data: "Revit model",
    effort: "Already modeled",
  },
  {
    id: "fittings",
    label: "Fittings",
    status: "works",
    adds: "Elbows, transitions, takeoffs: C times velocity pressure. C comes from an ASHRAE table.",
    automatic: "Mostly. Pe has rules for the families on Chadds except rectangular radius elbows.",
    data: "Tables ship with Revit. Rules are in Pe's code. Apply stores Pe's C per path on each fitting.",
    effort: "Medium. A firm rulebook, set up once.",
  },
  {
    id: "flex",
    label: "Flex duct",
    status: "gaps",
    adds: "Same as straight duct, with a rougher wall",
    automatic:
      "Partly. Revit uses the rigid-duct roughness unless the flex type sets its own. Pe flags it.",
    data: "Revit duct types",
    effort: "Easy. One value per flex type.",
  },
  {
    id: "dampers",
    label: "Dampers",
    status: "gaps",
    adds: "Drop from ASHRAE table CD9-1",
    automatic: "Partly. Priced fully open. The balancing position is unknown.",
    data: "Pe's rules",
    effort: "Easy if fully open is acceptable",
  },
  {
    id: "grille",
    label: "Grille",
    status: "none",
    adds: "Manufacturer static pressure at its airflow and size. Often the largest single term.",
    automatic: "No. The firm's grille families have no performance data.",
    data: "Revit has a slot for it: the terminal connector's pressure drop, bound to a family parameter. The numbers are only in manufacturer PDFs.",
    effort:
      "Hard. Per manufacturer, model and core. Price's LBP tables cover slot widths 1.5 to 6 in: 268 of the 351 LBP grilles on Chadds fit, 83 are 8 to 18 in wide.",
  },
  {
    id: "room",
    label: "Room",
    status: "gaps",
    adds: "Its load sets the airflow of the grilles that serve it",
    automatic:
      "Partly. Units list the rooms they serve in PE_M___ServesRoom. Grilles are not linked to rooms or loads.",
    data: "Revit rooms and spaces; RHVAC",
    effort: "Medium. Depends on the rooms and zoning work.",
  },
  {
    id: "flow",
    label: "Design airflow",
    status: "gaps",
    adds: "Sets the velocity at each grille, so every other term",
    automatic:
      "Partly. Each unit's airflow comes from the RHVAC Load Preview and is split over its grilles by neck size. Any grille can be overridden.",
    data: "The pasted Load Preview, on this computer until apply. Grilles in Revit carry no design flow.",
    effort: "Medium. Every unit needs its tag in Revit and in the load file.",
  },
  {
    id: "connectivity",
    label: "Connectivity",
    status: "gaps",
    adds: "The path must connect from fan to grille",
    automatic:
      "Partly. Pe joins gaps under an inch and near-miss taps and lists them. Real open ends need a person.",
    data: "Revit model",
    effort: "Medium. Modeling care.",
  },
  {
    id: "esp",
    label: "Fan's available static",
    status: "none",
    adds: "What the required static is checked against",
    automatic: "No. The firm's fan static parameter reads 0 on Chadds.",
    data: "Equipment family, from the submittal",
    effort: "Hard. Comes with equipment selection.",
  },
];

export const PRODUCT_MAP: MapLink[] = [
  {
    id: "rooms",
    label: "Rooms",
    status: "gaps",
    route: "/rooms",
    after: null,
    note: "Revit rooms and spaces, with stable identity.",
    parts: [],
    path: [],
    relations: [],
  },
  {
    id: "zoning",
    label: "Zoning",
    status: "gaps",
    route: null,
    after: "rooms",
    note: "Each room to a system and a unit tag. Units list the rooms they serve in PE_M___ServesRoom; the tag is PE_G___TagInstance.",
    parts: [],
    path: [],
    relations: [],
  },
  {
    id: "loads",
    label: "Loads",
    status: "gaps",
    route: null,
    after: "zoning",
    note: "From the RHVAC Load Preview, pasted into the ducts route per system and unit tag.",
    parts: [],
    path: [],
    relations: [],
  },
  {
    id: "flows",
    label: "Grille airflows",
    status: "gaps",
    route: "/ducts",
    after: "loads",
    note: "Each unit's airflow split over its grilles by neck size, overridable per grille.",
    parts: [],
    path: [],
    relations: [],
  },
  {
    id: "network",
    label: "Duct network",
    status: "gaps",
    route: "/ducts",
    after: "flows",
    note: "Revit duct connectivity, with sub-inch gaps and near-miss taps joined and listed.",
    parts: [],
    path: [],
    relations: [],
  },
  {
    id: "pressure-drop",
    label: "Pressure drop",
    status: "works",
    route: "/ducts",
    after: "network",
    note: "Prices each grille's path from the fan. On Chadds SA 19 every part prices except the grille drop.",
    parts: PRESSURE_DROP_PARTS,
    path: ["fan", "inline", "duct", "fittings", "flex", "dampers", "grille", "room"],
    relations: [
      { from: "room", to: "flow", label: "load sets" },
      { from: "flow", to: "fittings", label: "sets velocity in" },
      { from: "fan", to: "esp", label: "checked against" },
    ],
  },
  {
    id: "selection",
    label: "Equipment selection",
    status: "none",
    route: null,
    after: "pressure-drop",
    note: "Fan curve and available static for each unit.",
    parts: [],
    path: [],
    relations: [],
  },
  {
    id: "bod",
    label: "Basis of design",
    status: "none",
    route: null,
    after: "selection",
    note: "The equipment schedule a project is designed on.",
    parts: [],
    path: [],
    relations: [],
  },
];

export const mapLink = (id: string) => PRODUCT_MAP.find((link) => link.id === id);
