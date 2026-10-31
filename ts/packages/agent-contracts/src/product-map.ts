/**
 * The product map: every link from rooms to basis of design, what each needs, where its data is
 * stored and how ready it is. One source for each route's help page, and later
 * Pea. Status is set by hand today; a route's own findings can set it later without changing this
 * shape. Ledger: `docs/features/ducts/LEDGER.md` (2026-10-16).
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
    status: "works",
    adds: "Where every path starts; its worst path is the ESP it must supply",
    automatic:
      "Yes. A unit is a fan when it is the system's base equipment or carries a unit airflow; a through-flow device beside a working fan is passive. You can rule either way.",
    data: "Revit base equipment (Select Equipment), the unit airflow parameter, or your ruling in the Project Information store",
    effort: "Easy. Assign the fan in Revit once, or rule it on the page.",
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
    automatic:
      "Mostly. Pe has rules for the firm's families except rectangular radius elbows; you can change the table under a rule.",
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
    status: "gaps",
    adds: "Manufacturer static pressure at its airflow and size. Priceable, never required.",
    automatic:
      "No. A grille with a drop in its slot is priced; one without counts as zero, sits in Diagnostics, and never blocks. Manufacturer tables are out of scope until terminals are final.",
    data: "The terminal's drop parameter (slot), when a person enters it. The numbers are only in manufacturer PDFs.",
    effort:
      "Deferred by the firm: terminals are finalized last, and installed grilles rarely match the spec.",
  },
  {
    id: "room",
    label: "Room",
    status: "none",
    adds: "Its load sets the airflow of the grilles that serve it",
    automatic: "No. The firm does not use rooms or spaces today; the seam is typed and empty.",
    data: "Revit rooms and spaces; RHVAC",
    effort: "Medium. Depends on the rooms and zoning work, and on the firm adopting rooms.",
  },
  {
    id: "flow",
    label: "Design airflow",
    status: "works",
    adds: "Sets the velocity at each grille, so every other term",
    automatic:
      "Yes, once you point at it. You choose which parameter holds each grille's design airflow (the firm slot, the family's own Flow, or another shared parameter), and the page shows every grille's value and its source.",
    data: "An instance parameter on the grille, chosen per project; the choice persists in the Project Information store",
    effort: "Easy. One choice per project; a grille with no value is a Set row.",
  },
  {
    id: "connectivity",
    label: "Connectivity",
    status: "works",
    adds: "The path must connect from fan to grille",
    automatic:
      "Mostly. Pe bridges gaps under 2 in and near-miss taps and lists them; it caps dangling ends and connects touching ends in Revit after your approval. Anything else is a fix-in-Revit row.",
    data: "Revit model; heals are real fittings and connections",
    effort: "Medium. One Heal row per network, then the hard cases by hand.",
  },
  {
    id: "esp",
    label: "Fan's available static",
    status: "none",
    adds: "What the required static is checked against",
    automatic:
      "No. Apply writes the required ESP to the unit's parameter; the available static comes from equipment selection.",
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
    note: "Load calculation per room and system (RHVAC today); not yet linked to grilles.",
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
    note: "Each grille's design airflow read from the parameter you point at; a fan's flow is the sum of its grilles.",
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
    note: "Revit duct connectivity, with small gaps and near-miss taps bridged and listed, and dangling ends capped in Revit on approval.",
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
    note: "Prices each grille's path from the fan and each fan's ESP; terminals are priceable, never required.",
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
