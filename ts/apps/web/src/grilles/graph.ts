import { pane, split, type RouteGraph } from "@pe/agent-contracts";
import { grillesFields, type GrillesPage } from "./page";
export type { GrillesPage } from "./page";

export const grillesGraph: RouteGraph<GrillesPage, null> = {
  key: "grilles",
  address: "grilles",
  name: "Grilles",
  fields: grillesFields,
  readings: {
    result: {
      kind: "derive",
      source: "grilles.solve",
      args: (page) => page,
      deps: ["page"],
      retire: "page",
    },
  },
  verbs: {},
  panes: {
    drawing: {
      label: "Drawing",
      purpose: "Active profile; a dimension edits every row",
      draws: ["result"],
      verbs: [],
    },
    field: {
      label: "Field",
      purpose: "Pick a buildable opening width and quantity",
      draws: ["result"],
      verbs: [],
    },
    profiles: {
      label: "Profiles",
      purpose: "Edit candidate profiles and export checked drawings",
      draws: ["result"],
      verbs: [],
    },
  },
  layout: split(
    "grilles",
    { axis: "v", sized: "start", size: 420 },
    split("design", { axis: "h", sized: "end", size: 500 }, pane("drawing"), pane("field")),
    pane("profiles"),
  ),
  stages: {
    calculate: {
      word: "Calculating",
      panes: ["drawing", "field", "profiles"],
      verbs: [],
      teach:
        "Edit candidate wood floor grille profiles. Drawing dimensions change every row. Pick a buildable profile in the field chart; arrow keys walk quantity and opening width. Checked rows form the printable export. Rows stay in memory for this page view.",
    },
  },
  pick: false,
};
