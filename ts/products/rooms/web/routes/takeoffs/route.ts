import { z } from "zod";
import { routeStatePatchSchema } from "@pe/agent-contracts";
import { handle } from "@pe/agent-contracts/handle";
import { product, takeoffsWork } from "@pe/rooms-contract/product";
import { paneLayout, type ContextOf, type Verbs } from "@pe/web-kernel/route";
import { draw } from "@pe/web-kernel/route/draw";
import { screen } from "@pe/web-kernel/route/screen";

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
const says = (sentence: string) => () => ({ sentence, rows: [] });

// Hoisted: a generic call inside the `screen()` argument defers the inference of its pane keys.
const adoptionBody = draw("scroll", () => import("../../src/takeoffs.tsx"), "AdoptionBody");

export const module = screen(
  {
    ...declared,
    needs: "project",
    host: "@pe/rooms-host/product",
    documentFields: ["views"],
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
        present: says("Bind the shared parameters this document is missing."),
      },
      adopt: {
        handle: handle("takeoffs.adopt"),
        label: "Adopt",
        present: says("Adopt the ticked zoning regions with their staged names and system tags."),
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
