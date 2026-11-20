import { z } from "zod";
import { routeStatePatchSchema } from "@pe/agent-contracts";
import { handle } from "@pe/agent-contracts/handle";
import { sheetCells } from "@pe/agent-contracts/product";
import type { SheetBinding } from "@pe/agent-contracts/slots";
import { product, regionId, ROOM_FIELDS, roomsWork } from "@pe/rooms-contract/product";
import { fillBody, scrollBody, split, type ContextOf, type Verbs } from "@pe/web-kernel/route";
import { draw } from "@pe/web-kernel/route/draw";
import { screen } from "@pe/web-kernel/route/screen";

import { presentIntent, stageIntent } from "../../src/staged.ts";

const declared = product.routes.rooms;
export const patches = z.array(routeStatePatchSchema);
export const { plans, planImage } = declared.reads;
export type RoomsContext = ContextOf<
  typeof declared.fields,
  typeof declared.core,
  typeof roomsWork,
  typeof patches,
  Verbs<never, "partition" | "merge">
>;

// Hoisted: a generic call inside the `screen()` argument defers the inference of its pane keys.
const rosterBody = draw("scroll", () => import("../../src/rooms.tsx"), "RosterBody");

type Read = RoomsContext["value"]["value"] | null | undefined;
const regionOf = (read: Read, row: string | undefined) =>
  read?.regions.find((region) => region.subject === row);
const cells = sheetCells(product);
/** One cell per field of each picked room, over what the region record holds now. */
const bindings: Record<string, SheetBinding> = Object.fromEntries(
  ROOM_FIELDS.map((name) => {
    const { domain, label, home } = cells[name];
    return [
      name,
      {
        domain,
        label,
        home,
        per: "subject" as const,
        // Two picked rooms show each field twice: the room's name tells the cells apart.
        rowLabel: (read: Read, row: string) => `${label} of ${regionOf(read, row)?.name || "room"}`,
        model: (read: Read, row: string | undefined) => {
          const region = regionOf(read, row);
          return region ? { value: region[name] } : null;
        },
      },
    ];
  }),
);

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
      partition: {
        handle: handle("rooms.partition"),
        label: "Partition",
        stageForPlan: ({ page, doc, value }) => {
          if (!page.view || value?.missing) throw Error("Choose a plan");
          return stageIntent(
            "roster",
            "rooms.partition",
            "Prepare partition",
            { view: page.view },
            doc,
          );
        },
        present: (preview) =>
          presentIntent(
            preview,
            "Create rooms and held regions from the partition, removing prior regions that do not match. Keep locked and matched rooms.",
          ),
      },
      merge: {
        handle: handle("rooms.merge"),
        label: "Merge",
        stageForPlan: ({ page, doc, value }) => {
          const ids = new Set(page.room.kind === "all" ? [] : page.room.ids);
          const regions = (value?.regions ?? [])
            .filter((row) => row.role === "room" && ids.has(row.subject))
            .map((row) => row.subject);
          if (regions.length < 2) throw Error("Pick two or more rooms on the plan");
          return stageIntent(
            "roster",
            "rooms.merge",
            "Prepare merge",
            { view: page.view, regions },
            doc,
          );
        },
        present: (preview) =>
          presentIntent(
            preview,
            "Delete the selected room regions and create one locked room.",
            (authored) => {
              const intent = product.commands["rooms.merge"].authoredInput.safeParse(authored);
              return intent.success
                ? intent.data.regions.map((region) => `Delete region ${regionId(region)}`)
                : [];
            },
          ),
      },
    },
    // The kernel draws the sheet pane and its `sheet` verb: `sheet.plan`, then `sheet.apply`.
    sheet: {
      draft: true,
      bindings,
      empty: (read: Read) => read?.missing ?? null,
    },
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
        kernel: "sheet" as const,
        body: "scroll" as const,
        draw: () => scrollBody(null),
      },
    },
    layout: split(
      "h",
      [split("v", ["roster", "fields"], { id: "rooms-side", size: 320, sized: "end" }), "plan"],
      {
        id: "rooms-layout",
        size: 520,
        sized: "start",
        minSize: 320,
      },
    ),
  },
);
