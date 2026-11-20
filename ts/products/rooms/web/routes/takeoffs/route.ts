import { z } from "zod";
import { routeStatePatchSchema } from "@pe/agent-contracts";
import { handle } from "@pe/agent-contracts/handle";
import { product, takeoffsWork } from "@pe/rooms-contract/product";
import { paneLayout, type ContextOf, type Verbs } from "@pe/web-kernel/route";
import { draw } from "@pe/web-kernel/route/draw";
import { screen } from "@pe/web-kernel/route/screen";

import { presentIntent, stageIntent } from "../../src/staged.ts";

const declared = product.routes.takeoffs;
export const patches = z.array(routeStatePatchSchema);
export const { plans, captures } = declared.reads;
export type AdoptionContext = ContextOf<
  typeof declared.fields,
  typeof declared.core,
  typeof takeoffsWork,
  typeof patches,
  Verbs<never, "initialize" | "adopt">
>;
type Row = AdoptionContext["value"]["value"]["rows"][number];
/** The ticked rows as the adopt command takes them: one entry per plan, by its UniqueId. */
function adoptRequest(rows: readonly Row[]) {
  const views = new Map<string, Pick<Row, "elementId" | "uniqueId" | "name" | "systemTag">[]>();
  for (const row of rows.filter((row) => row.checked))
    views.set(row.view, [
      ...(views.get(row.view) ?? []),
      {
        elementId: row.elementId,
        uniqueId: row.uniqueId,
        name: row.name,
        systemTag: row.systemTag,
      },
    ]);
  return views.size ? { views: [...views].map(([view, items]) => ({ view, items })) } : null;
}

// Hoisted: a generic call inside the `screen()` argument defers the inference of its pane keys.
const adoptionBody = draw("scroll", () => import("../../src/takeoffs.tsx"), "AdoptionBody");

export const module = screen(
  {
    ...declared,
    needs: "project",
    host: "@pe/rooms-host/product",
    edits: {
      work: takeoffsWork,
      seed: () => takeoffsWork.schema.parse({}),
      owners: {},
      input: patches,
      patches: (input) => input,
      history: z.object({ label: z.string() }),
      describe: (history) => ({ label: history.label }),
    },
    verbs: {
      initialize: {
        handle: handle("takeoffs.initialize"),
        label: "Initialize",
        stageForPlan: ({ doc, value }) => {
          if (value?.carriers.status !== "needs-initialization")
            throw Error("The document already carries every shared parameter");
          return stageIntent(
            "adoption",
            "takeoffs.initialize",
            "Prepare initialize",
            { stage: value.carriers.stage },
            doc,
          );
        },
        present: (preview) => presentIntent(preview, "Initialize the missing shared parameters."),
      },
      adopt: {
        handle: handle("takeoffs.adopt"),
        label: "Adopt",
        stageForPlan: ({ doc, value }) => {
          const request = adoptRequest(value?.rows ?? []);
          if (!request) throw Error("Select regions to adopt");
          return stageIntent("adoption", "takeoffs.adopt", "Prepare adopt", request, doc);
        },
        present: (preview) =>
          presentIntent(
            preview,
            "Record these zoning regions and update their entries in the system registry.",
            (authored) => {
              const intent = product.commands["takeoffs.adopt"].authoredInput.safeParse(authored);
              return intent.success
                ? intent.data.views.flatMap(({ items }) =>
                    items.map(
                      (item) =>
                        `${item.name} (${item.uniqueId})${item.systemTag ? ` ${item.systemTag}` : ""}`,
                    ),
                  )
                : [];
            },
          ),
      },
    },
  },
  {
    panes: {
      adoption: {
        title: "View adoption",
        purpose: "Choose plans and stage designer region names and system tags",
        verbs: ["initialize", "adopt"] as const,
        body: "scroll" as const,
        draw: adoptionBody,
      },
    },
    layout: paneLayout("adoption"),
  },
);
