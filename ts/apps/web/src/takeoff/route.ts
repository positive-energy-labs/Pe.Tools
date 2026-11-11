import { z } from "zod";
import { route, field, read, paneLayout, type ContextOf } from "../route/defaults";
import { hostRead } from "../route/host-read";
import { draw } from "../route/draw";
import { command, sessionCommand } from "../route/typed-actions";
import {
  takeoffsRouteState,
  valueRead,
  routeStatePatchSchema,
  canonicalRouteInput,
} from "@pe/agent-contracts";
import { adoptionArgs, adoptionData, viewCatalogueArgs, viewCatalogueData } from "@pe/agent-contracts/takeoff-read";
import {
  threadListFields,
  threadSearchDefault,
  planViewport,
} from "../../../../packages/agent-contracts/src/routes/shared";
const many = z.union([z.array(z.string()), z.literal("all")]);
export const fields = {
  level: field(z.string(), "", "pose", "push"),
  zone: field(z.string(), "", "pose", "push"),
  room: field(z.string(), "", "pose", "push"),
  viewport: field(planViewport.schema, null, "pose"),
  threadSearch: field(threadListFields.threadSearch.schema, threadSearchDefault(), "query"),
  threadSort: field(threadListFields.threadSort.schema, "", "query"),
  views: field(many, [], "query", "push"),
  zones: field(many, [], "query", "push"),
  work: field(z.string(), "", "query", "push"),
  r10: field(z.string(), "", "query", "push"),
  stage: field(z.literal("adopt"), "adopt", "pose"),
};
export const loaded = read(
  hostRead(valueRead("takeoffs.adoption", adoptionArgs, adoptionData)),
  (page: { views: readonly string[] | "all"; zones: readonly string[] | "all"; work: string }) => ({
    views: page.views,
    zones: page.zones,
    work: page.work,
  }),
);
export const viewCatalogue = read(
  hostRead(valueRead("takeoffs.views", viewCatalogueArgs, viewCatalogueData)),
  (page: { work: string }) => ({ work: page.work }),
);
export const patches = z.array(routeStatePatchSchema);
export type AdoptionContext = ContextOf<
  typeof fields,
  typeof loaded,
  typeof takeoffsRouteState,
  typeof patches
>;
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
  reads: { views: viewCatalogue },
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
  commands: {
    initialize: {
      ...sessionCommand("takeoffs.initialize"),
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
    },
    adopt: {
      ...command("takeoffs.adopt"),
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
      body: "scroll",
      draw: draw("scroll", () => import("./typed-adoption"), "AdoptionBody"),
    },
  },
  layout: paneLayout("adoption"),
});
