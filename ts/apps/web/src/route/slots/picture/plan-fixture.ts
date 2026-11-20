import type { PlanPicture } from "@pe/agent-contracts/slots";
import { subjectCode } from "@pe/agent-contracts/subject-ref";
import { paneLayout, route, scrollBody } from "@pe/web-kernel/route";

export const planRoom = subjectCode({ keyKind: "region", key: "room" });
export const planHall = subjectCode({ keyKind: "region", key: "hall" });
export const png =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAADCAAAAACRn/EaAAAAE0lEQVR4nGN4WPGwggGIHzKAWAA9HQgXwKzJ9gAAAABJRU5ErkJggg==";

const plan: PlanPicture = {
  raster: {
    href: png,
    registration: {
      width: 4,
      height: 3,
      topLeft: [0, 20],
      topRight: [18, 26],
      bottomLeft: [6, 2],
    },
  },
  polygons: [
    {
      subject: planRoom,
      rings: [
        [
          [5, 5],
          [15, 5],
          [15, 16],
          [5, 16],
        ],
        [
          [8, 8],
          [12, 8],
          [12, 12],
          [8, 12],
        ],
      ],
    },
    {
      subject: planHall,
      rings: [
        [
          [16, 5],
          [20, 5],
          [20, 16],
          [16, 16],
        ],
      ],
      ink: "#456789",
    },
  ],
};

export function declaredPlan(raster: "ready" | "absent" | "pending" | "refused" = "ready") {
  return route({
    key: "plan-fixture",
    name: "Plan fixture",
    directory: {
      group: "Pods",
      summary: "See the registered plan",
      label: "Plan",
      icon: "Boxes",
      exposure: "Main",
      surfaces: { web: "full", pwa: "full", tray: false },
      aliases: [],
      runtimeNeed: "Revit",
      listed: true,
      satellites: [],
    },
    fields: {},
    picture: {
      mode: "plan",
      plan: () => ({ ...plan, raster: raster === "ready" ? plan.raster : null }),
    },
    panes: {
      main: {
        title: "Plan fixture",
        purpose: "Host the picture pane",
        body: "scroll",
        draw: () => scrollBody(null),
      },
    },
    layout: paneLayout("picture"),
  });
}
