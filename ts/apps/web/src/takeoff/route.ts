import * as contracts from "./contract.ts";
import { z } from "zod";
import { route, field, read, paneLayout, type ContextOf, type Verbs } from "@pe/web-kernel/route";
import type { ReadingState } from "@pe/agent-contracts";
import { hostRead } from "@pe/web-kernel/host-read";
import { draw } from "@pe/web-kernel/route/draw";
import { handle } from "@pe/agent-contracts/handle";
import {
  takeoffsRouteState,
  routeStatePatchSchema,
  canonicalRouteInput,
} from "@pe/agent-contracts";

import {
  threadListFields,
  planViewport,
} from "../../../../packages/agent-contracts/src/routes/shared";
const many = z.union([z.array(z.string()), z.literal("all")]);
export const fields = {
  level: field(z.string(), "", "pose", "push"),
  zone: field(z.string(), "", "pose", "push"),
  room: field(z.string(), "", "pose", "push"),
  viewport: field(planViewport.schema, null, "pose"),
  ...threadListFields,
  views: field(many, [], "query", "push"),
  zones: field(many, [], "query", "push"),
  work: field(z.string(), "", "query", "push"),
  r10: field(z.string(), "", "query", "push"),
  stage: field(z.literal("adopt"), "adopt", "stage", "push"),
};
export const loaded = read(
  hostRead(contracts.adoption),
  (page: { views: readonly string[] | "all"; zones: readonly string[] | "all"; work: string }) => ({
    views: page.views,
    zones: page.zones,
    work: page.work,
  }),
);
export const viewCatalogue = read(hostRead(contracts.views), (page: { work: string }) => ({
  work: page.work,
}));
export const patches = z.array(routeStatePatchSchema);
/** The adoption pane draws the view catalogue it chooses from: the core refuses until views and zones
 * are chosen ("choose explicit zones"), and the chooser is the control that clears that refusal. */
export type AdoptionContext = Omit<
  ContextOf<
    typeof fields,
    typeof viewCatalogue,
    typeof takeoffsRouteState,
    typeof patches,
    Verbs<never, "initialize" | "adopt">
  >,
  "read"
> & {
  // Named, not generic: wrapping the adoption data in the generic `read`'s `ReadingState` exceeds tsc's
  // instantiation depth, so the present arm takes the value as the core context already types it.
  read(read: typeof loaded): AdoptionReading;
};
type Adoption = ContextOf<typeof fields, typeof loaded>["value"];
export type AdoptionReading =
  | Pick<Adoption, "state" | "value" | "reason">
  | Exclude<ReadingState<unknown>, { value: unknown }>;
export const module = route({
  key: "takeoffs",
  name: "View adoption",
  needs: "project",
  host: "./host.ts",
  directory: {
    label: "Manual J",
    exposure: "Main",
    group: "Calculate loads & airflow",
    icon: "Map",
    runtimeNeed: "Revit for model actions; browsing saved data is separate",
    summary: "Adopt zoning regions from chosen views.",
    aliases: ["manual", "j", "loads", "rhvac", "zones"],
    listed: true,
    satellites: [],
    surfaces: { web: "full", pwa: "full", tray: false },
    resume: "document",
  },
  fields,
  core: loaded,
  // The adoption pane draws the view catalogue, so no pane demands the core: it is declared here, among the
  // reads that stay demanded, or the adoption reading is never read (Start, initialize and adopt all need it).
  reads: { views: viewCatalogue, adoption: loaded },
  edits: {
    work: takeoffsRouteState,
    seed: () => takeoffsRouteState.schema.parse({}),
    value: "takeoffWork",
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
      input: ({ value }) => {
        if (!value || value.initialize.refusal)
          throw Error(value?.initialize.refusal ?? "Read the current document first");
        if (
          canonicalRouteInput(
            value.takeoffWork.writeIntent?.["takeoffs.initialize"]?.edit?.value,
          ) !== canonicalRouteInput(value.initialize.request)
        )
          throw Error("Prepare Initialize from the current reading");
        return {};
      },
      present: (_preview, { value: data }) => {
        const missing = data.initialize.missingCarrierGuids;
        if (!missing.length) throw Error("Read the missing shared parameters before initializing");
        return {
          sentence: `${data.initialize.request.stage}: bind ${missing.length} missing shared parameters.`,
          rows: missing.map((guid) => `Bind shared parameter ${guid}`),
        };
      },
    },
    adopt: {
      handle: handle("takeoffs.adopt"),
      label: "Adopt",
      input: ({ value }) => {
        if (!value || value.adopt.refusal)
          throw Error(value?.adopt.refusal ?? "Read the current document first");
        if (
          canonicalRouteInput(value.takeoffWork.writeIntent?.["takeoffs.adopt"]?.edit?.value) !==
          canonicalRouteInput(value.adopt.request)
        )
          throw Error("Prepare Adopt from the current rows");
        return {};
      },
      present: () => ({
        sentence: "Adopt the selected zoning regions with their staged names and system tags.",
        rows: [],
      }),
    },
  },
  panes: {
    adoption: {
      title: "View adoption",
      purpose: "Choose views and stage designer region names and system tags",
      read: viewCatalogue,
      body: "scroll",
      draw: draw("scroll", () => import("./typed-adoption"), "AdoptionBody"),
    },
  },
  // The band draws each review; the pane stages the Work a plan reads, then asks for the plan.
  band: ["initialize", "adopt"],
  layout: paneLayout("adoption"),
});
