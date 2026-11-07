import { z } from "zod";
import {
  familiesRouteState,
  appliedScopeSchema,
  familyCellValueSchema,
  familyCellKey,
  cellPatches,
  showFamilyCell,
} from "@pe/agent-contracts";
import {
  familiesViewCapability,
  familiesViewData,
} from "../../../../packages/agent-contracts/src/families-read.ts";
import {
  route,
  field,
  subjectSchema,
  localId,
  command,
  sessionCommand,
  type DrawContext,
} from "../route/typed-route.ts";
import { hostRead } from "../route/host-read.ts";
import { draw } from "../route/draw.tsx";
const fields = {
  scope: field(
    subjectSchema(1),
    { kind: "ids", ids: [localId("families", "draft")] },
    "subject",
    "push",
  ),
  readId: field(z.string(), "", "pose"),
  focus: field(z.string(), "", "pose"),
};
const edit = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("scope"), value: appliedScopeSchema }),
  z.object({
    kind: z.literal("cell"),
    address: z.object({ familyName: z.string(), typeName: z.string(), parameter: z.string() }),
    value: familyCellValueSchema,
    current: z.string(),
  }),
]);
const view = { ...hostRead(familiesViewCapability), args: () => ({}) };
export type FamiliesDrawContext = DrawContext<
  z.output<typeof familiesViewData>,
  typeof fields,
  z.output<typeof familiesRouteState.schema>,
  z.output<typeof edit>
>;
export const module = route({
  key: "families",
  name: "Families",
  needs: "project",
  host: "./host.ts",
  directory: {
    group: "Build / audit families",
    summary: "Audit and reconcile loaded family parameters",
    label: "Family Foundry",
    icon: "Table2",
    exposure: "Main",
    surfaces: { web: "full", pwa: "full", tray: false },
    aliases: ["audit", "parameters"],
    runtimeNeed: "Revit for model actions",
    listed: true,
    satellites: [],
    resume: "document",
  },
  subject: {
    field: "scope",
    noun: "family draft scope",
    pane: "main",
    options: () => [{ id: localId("families", "draft"), label: "Family draft scope" }],
  },
  fields,
  core: view,
  panes: {
    main: {
      title: "Families",
      purpose: "Audit family values",
      read: view,
      draw: draw(() => import("./matrix.tsx"), "FamiliesMatrix"),
    },
  },
  edits: {
    work: familiesRouteState,
    value: "familiesWork",
    owners: {},
    input: edit,
    patches: (input, data) => {
      if (input.kind === "scope")
        return [{ path: ["scope"], value: { edit: { value: input.value } } }];
      if (data.editRefusal) throw Error(data.editRefusal);
      const key = familyCellKey(input.address);
      return cellPatches(["cells"], key, data.familiesWork.cells[key] ?? {}, {
        kind: "set",
        rung: { value: input.value },
        baseline: { value: { value: input.current, storageType: input.value.storageType } },
      });
    },
    history: z.object({ label: z.string() }),
    describe: (detail) => ({ label: detail.label }),
  },
  commands: {
    read: {
      ...sessionCommand("families.read"),
      label: "Read families",
      input: ({ work }, supplied) => ({
        work,
        readId: supplied
          ? z.object({ readId: z.uuid() }).parse(supplied).readId
          : crypto.randomUUID(),
      }),
    },
    stop: {
      ...sessionCommand("families.cancel-read"),
      label: "Stop family read",
      input: ({ page, value }) => ({ readId: value?.activeReadId || page.readId }),
    },
    apply: {
      ...command("families.apply"),
      label: "Apply families",
      present: (_result, _data, work) => ({
        sentence: "Review family parameter changes",
        rows: Object.entries(work.cells).flatMap(([key, cell]) => {
          if (!cell.edit) return [];
          const [family, type, parameter] = JSON.parse(key) as string[];
          return [
            `${family} / ${type} / ${parameter}: observed value to ${showFamilyCell(cell.edit.value)}`,
          ];
        }),
      }),
    },
  },
  layout: { kind: "pane", id: "main" },
});
export const familiesData = module.data;
export const familiesHostModule = module.host;
