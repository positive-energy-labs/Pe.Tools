import { paneLayout } from "../route/defaults";
import { z } from "zod";
import {
  familyDraftRouteState,
  routeStatePatchSchema,
  valueRead,
} from "@pe/agent-contracts";
import { familyPageSchema } from "./page";
import { familyQueries } from "../../../../packages/mcps/src/shared/query-client";
import {
  route,
  field,
  command,
  sessionCommand,
  queryAction,
  catalogAction,
} from "../route/defaults";
import { hostRead } from "../route/host-read";
import { draw } from "../route/draw";
import { familyArgs, familyData } from "@pe/agent-contracts";
import { presentFamilyPlan } from "./review";
const address = familyPageSchema.shape;
export const fields = {
  stage: field(address.stage, "audit", "pose", "push"),
  pod: field(address.pod, "", "query", "push"),
  path: field(address.path, "", "query", "push"),
  pane: field(address.pane, "spec", "pose"),
  query: field(address.query, "", "query"),
  sort: field(address.sort, { columns: [] }, "query"),
  hidden: field(address.hidden, {}, "query"),
  overlay: field(address.overlay, "draft", "pose", "push"),
  drill: field(address.drill, "", "pose", "push"),
  inspector: field(address.inspector, "", "pose"),
  doc: field(address.doc, "text", "pose"),
};
export const loaded = {
  ...hostRead(valueRead("family.workspace", familyArgs, familyData)),
  args: (page: { pod: string; path: string }) => ({
    member: page.pod && page.path ? { pod: page.pod, path: page.path } : null,
  }),
};
export const edits = z.array(routeStatePatchSchema);
export type { Context as FamilyContext } from "./context.generated";
export const module = route({
  key: "family",
  name: "Family",
  needs: "host",
  optionalTarget: "document",
  host: "../../../host/src/reads/family.ts",
  directory: {
    label: "Family Foundry",
    exposure: "Main",
    group: "Build / audit families",
    icon: "Boxes",
    runtimeNeed: "Revit for capture and apply",
    summary: "Inspect saved family profiles, edit cells and review PDF evidence",
    aliases: ["rfa", "author", "build", "capture", "matrix"],
    listed: true,
    satellites: [],
    resume: "document",
    surfaces: { web: "full", pwa: "full", tray: false },
  },
  core: loaded,
  fields,
  panes: {
    workspace: {
      title: "Family",
      purpose: "Review the family and its cut-sheet evidence",
      draw: draw(() => import("./mount"), "FamilyBody"),
    },
  },
  edits: {
    work: familyDraftRouteState,
    seed: () => familyDraftRouteState.schema.parse({}),
    value: "familyWork",
    owners: {},
    input: edits,
    patches: (input) => input,
    history: z.object({ label: z.string() }),
    describe: (history) => ({ label: history.label }),
  },
  commands: {
    read: {
      ...queryAction(familyQueries["family.read"]),
      label: "Read family",
      input: ({ work }) => ({ readId: crypto.randomUUID(), expectedRevision: work!.revision }),
    },
    saved: {
      ...queryAction(familyQueries["family.saved"]),
      label: "Read saved family",
      input: (_context, supplied) => supplied,
    },
    open: {
      ...catalogAction("family.observe"),
      label: "Open member",
      input: (_context, supplied) => supplied,
    },
    attach: {
      ...sessionCommand("family.attach-spec"),
      label: "Attach PDF",
      input: (_context, supplied) => supplied,
    },
    capture: {
      ...sessionCommand("family.capture"),
      label: "Save family to pod",
    },
    build: {
      ...command("family.build"),
      label: "Build .rfa",
      present: () => ({ sentence: "Build the staged saved family member", rows: [] }),
    },
    apply: {
      ...command("family.apply"),
      label: "Apply family",
      present: (result) => presentFamilyPlan(result),
    },
  },
  layout: paneLayout("workspace"),
});
