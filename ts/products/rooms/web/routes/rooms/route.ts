import { z } from "zod";
import { routeStatePatchSchema } from "@pe/agent-contracts";
import { handle } from "@pe/agent-contracts/handle";
import { product, roomsWork } from "@pe/rooms-contract/product";
import { fillBody, split, type ContextOf, type Verbs } from "@pe/web-kernel/route";
import { draw } from "@pe/web-kernel/route/draw";
import { screen } from "@pe/web-kernel/route/screen";

const declared = product.routes.rooms;
export const patches = z.array(routeStatePatchSchema);
export const { plans, planImage } = declared.reads;
export type RoomsContext = ContextOf<
  typeof declared.fields,
  typeof declared.core,
  typeof roomsWork,
  typeof patches,
  Verbs<never, "partition" | "merge" | "write">
>;
const says = (sentence: string) => () => ({ sentence, rows: [] });

// Hoisted: a generic call inside the `screen()` argument defers the inference of its pane keys.
const rosterBody = draw("scroll", () => import("../../src/rooms.tsx"), "RosterBody");
const fieldsBody = draw("scroll", () => import("../../src/rooms.tsx"), "FieldsBody");

export const module = screen(
  {
    ...declared,
    host: "@pe/rooms-host/product",
    documentFields: ["view"],
    edits: {
      work: roomsWork,
      seed: () => roomsWork.schema.parse({}),
      owners: {},
      input: patches,
      patches: (input) => input,
      history: z.object({ label: z.string() }),
      describe: (history) => ({ label: history.label }),
    },
    verbs: {
      write: {
        handle: handle("rooms.write"),
        label: "Write to Revit",
        present: says("Write every staged room field. Each cell the model confirms leaves Work."),
      },
      partition: {
        handle: handle("rooms.partition"),
        label: "Partition",
        present: says("Partition every zone on this plan, keeping locked and matched rooms."),
      },
      merge: {
        handle: handle("rooms.merge"),
        label: "Merge",
        present: says("Combine the selected rooms into one locked room."),
      },
    },
    band: ["write"],
    // Design choice (S9): plan mode pans, zooms and picks. Draw and the marks have no sketch hook
    // there yet, so they go through Work and Pea (`rooms.draw`, the `marks` cells).
    picture: {
      mode: "plan",
      plan: (ctx) => {
        const image = ctx.read(planImage);
        return {
          raster: "value" in image ? (image.value?.raster ?? null) : null,
          // Zones first, so a room inside one is picked before it.
          polygons: [...ctx.value.value.regions]
            .sort((a, b) => Number(b.role === "zone") - Number(a.role === "zone"))
            .map((row) => ({
              subject: row.subject,
              rings: [row.outer, ...row.holes],
              ink: row.role === "zone" ? "viz-5" : row.role === "held" ? "viz-2" : "viz-3",
            })),
        };
      },
    },
  },
  {
    panes: {
      roster: {
        subjectList: true as const,
        title: "Rooms",
        purpose: "Choose a plan and its rooms",
        verbs: ["partition", "merge"] as const,
        body: "scroll" as const,
        draw: rosterBody,
      },
      plan: {
        title: "Plan",
        purpose: "See the plan with its zones and rooms",
        kernel: "picture" as const,
        body: "fill" as const,
        draw: () => fillBody(null),
      },
      fields: {
        title: "Fields",
        purpose: "State each room's fields",
        body: "scroll" as const,
        draw: fieldsBody,
      },
    },
    layout: split("h", [split("v", ["roster", "fields"], { id: "rooms-side", size: 320, sized: "end" }), "plan"], {
      id: "rooms-layout",
      size: 520,
      sized: "start",
      minSize: 320,
    }),
  },
);
