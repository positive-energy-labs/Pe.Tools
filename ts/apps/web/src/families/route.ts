import { paneLayout } from "../route/defaults";
import { z } from "zod";
import {
  familiesRouteState,
  familyCellValueSchema,
  familyCellKey,
  familyCellAddress,
  cellPatches,
  showFamilyCell,
} from "@pe/agent-contracts";
import {
  familiesViewCapability,
} from "../../../../packages/agent-contracts/src/families-read.ts";
import { route, field, command, sessionCommand } from "../route/defaults.ts";
import { hostRead } from "../route/host-read.ts";
import { draw } from "../route/draw.tsx";
export const fields = {
  readId: field(z.string(), "", "pose"),
  focus: field(
    z.string().refine((key) => {
      if (!key) return true;
      try {
        familyCellAddress(key);
        return true;
      } catch {
        return false;
      }
    }),
    "",
    "pose",
  ),
};
export const edit = z.object({
  address: z.object({ familyName: z.string(), typeName: z.string(), parameter: z.string() }),
  value: familyCellValueSchema,
  current: z.string(),
});
export const view = { ...hostRead(familiesViewCapability), args: () => ({}) };
export type { FamiliesDrawContext } from "./context.generated";
export const module = route({
  key: "families",
  name: "Families",
  needs: "project",
  host: "../../../host/src/reads/families.ts",
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
  fields,
  core: view,
  panes: {
    main: {
      title: "Families",
      purpose: "Audit family values",
      draw: draw(() => import("./matrix.tsx"), "FamiliesMatrix"),
    },
  },
  edits: {
    work: familiesRouteState,
    seed: () => familiesRouteState.schema.parse({}),
    value: "familiesWork",
    owners: {},
    input: edit,
    patches: (input, data) => {
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
      input: ({ work }, supplied) => {
        if (!work) throw Error("Wait for Families Work before reading");
        return {
          work,
          readId: supplied
            ? z.object({ readId: z.uuid() }).parse(supplied).readId
            : crypto.randomUUID(),
        };
      },
    },
    stop: {
      ...sessionCommand("families.cancel-read"),
      label: "Stop family read",
      input: ({ page, value }) => {
        const readId = value?.activeReadId || page.readId;
        if (!readId) throw Error("No family read is running");
        return { readId };
      },
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
  layout: paneLayout("main"),
});
export const familiesData = module.data;
export const familiesHostModule = module.host;
