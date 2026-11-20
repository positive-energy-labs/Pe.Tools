import type { ContextOf, Verbs } from "@pe/web-kernel/route";
import { handle } from "@pe/agent-contracts/handle";
import { read, field, hostRead } from "@pe/agent-contracts/route";
import { paneLayout } from "@pe/web-kernel/route";
import { z } from "zod";
import {
  familiesRouteState,
  familyCellValueSchema,
  familyCellKey,
  familyCellAddress,
  cellPatches,
  showFamilyCell,
} from "@pe/agent-contracts";
import * as reads from "./contract.ts";
import { route } from "@pe/web-kernel/route";
import { draw } from "@pe/web-kernel/route/draw";
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
export const view = read(hostRead(reads.view));
export type FamiliesDrawContext = ContextOf<
  typeof fields,
  typeof view,
  typeof import("@pe/agent-contracts").familiesRouteState,
  typeof edit,
  Verbs<"read" | "stop", "apply">
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
  fields,
  core: view,
  panes: {
    main: {
      title: "Families",
      purpose: "Audit family values",
      body: "scroll",
      // Dark `support` resolves to the page colour, so the matrix heads recede only on the artifact
      // ground (design ledger default 6, 2026-11-11).
      ground: "artifact",
      draw: draw("scroll", () => import("./matrix.tsx"), "FamiliesMatrix"),
      verbs: ["read", "stop", "apply"],
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
  verbs: {
    read: {
      handle: handle("families.read"),
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
      handle: handle("families.cancel-read"),
      label: "Stop family read",
      input: ({ page, value }) => {
        const readId = value?.activeReadId || page.readId;
        if (!readId) throw Error("No family read is running");
        return { readId };
      },
    },
    apply: {
      handle: handle("families.apply"),
      label: "Apply families",
      present: (_result, { doc: work }) => ({
        sentence: "Review family parameter changes",
        rows: Object.entries(work.cells).flatMap(([key, cell]) => {
          if (!cell.edit) return [];
          const { familyName, typeName, parameter } = familyCellAddress(key);
          return [
            `${familyName} / ${typeName} / ${parameter}: observed value to ${showFamilyCell(cell.edit.value)}`,
          ];
        }),
      }),
    },
  },
  layout: paneLayout("main"),
});
export const familiesData = module.data;
export const familiesHostModule = module.host;
