import { z } from "zod";
import type { Command, Tool } from "@pe/agent-contracts";
import { workIntent, workWriteCommands } from "@pe/agent-contracts/write-intent";
import { ductsRouteState } from "./ducts.ts";

export const ductsActions = {
  "ducts.refresh": {
    catalogEffect: "Read",
    says: "Read this document's duct snapshots and pricing inputs again.",
    needs: "project-document",
    effect: "query",
    input: z.strictObject({}),
    dirties: ["snapshot"],
  },
  "ducts.plan-heal": {
    // The host derives the plan from these Reads; it opens no transaction and calls no rehearsal.
    native: ["ducts.snapshot.walk", "ducts.snapshot.roster"],
    says: "Plan healing the staged duct groups: derive each group's repairs (cap dangling open ends, connect coincident same-size ends, close same-size gaps of at most 3 in) from Work and seal them, without opening a transaction. Show the person the planned items before any apply.",
    needs: "project-document",
    effect: "query",
    input: z.strictObject({}),
    dirties: [],
  },
  "ducts.rehearse-heal": {
    native: ["ducts.snapshot.walk", "ducts.snapshot.roster", "ducts.heal.preview"],
    says: "Optionally rehearse the planned heal in Revit: runs every repair and Pe's post-check, then rolls all of it back. Refused on a workshared model before any transaction. A rehearsal never arms apply; plan does.",
    needs: "project-document",
    effect: "query",
    input: z.strictObject({}),
    dirties: [],
  },
  "ducts.apply-heal": {
    native: ["ducts.snapshot.walk", "ducts.snapshot.roster", "ducts.heal"],
    says: "Heal duct groups in Revit, one transaction per group, with exactly the items a plan showed and a person approved; an item failing Pe's post-check is refused and rolled back. Revit gives rebuilt elements new ids: read the duct snapshot again after.",
    needs: "project-document",
    effect: "command",
    input: z.strictObject({}),
    dirties: ["snapshot"],
  },
  "ducts.plan-assign-fan": {
    // The host derives the plan from these Reads; it opens no transaction and calls no rehearsal.
    native: ["ducts.snapshot.walk"],
    says: "Plan making the staged unit the fan of a duct system (Duct Systems > Select Equipment: the system's base equipment): read the system and seal the request, without opening a transaction. Show the person the plan before any apply.",
    needs: "project-document",
    effect: "query",
    input: z.strictObject({}),
    dirties: [],
  },
  "ducts.rehearse-assign-fan": {
    native: ["ducts.snapshot.walk", "ducts.assign-fan.preview"],
    says: "Optionally rehearse the planned fan assignment in Revit: runs Pe's guards, the write and its read back, then rolls it back. Refuses a system that already has base equipment, a unit with no port of the system's air classification, and a workshared model before any transaction. A rehearsal never arms apply; plan does.",
    needs: "project-document",
    effect: "query",
    input: z.strictObject({}),
    dirties: [],
  },
  "ducts.apply-assign-fan": {
    native: ["ducts.snapshot.walk", "ducts.assign-fan"],
    says: "Make a unit the base equipment (the fan) of a duct system in Revit, as a plan showed and a person approved; the system keeps its id, name and type. Read the duct snapshot again after: the unit's role reads base equipment of that system.",
    needs: "project-document",
    effect: "command",
    input: z.strictObject({}),
    dirties: ["snapshot"],
  },
} as const satisfies Record<string, Command>;
export type DuctsActionKey = keyof typeof ductsActions;

/** Ducts derives its native request from the whole staged Work, not one writeIntent cell. */
const ductsDerive = (work: unknown) => ductsRouteState.schema.parse(work);
export const ductSystemsTool = {
  name: "duct-systems",
  says: ductsRouteState.description,
  work: {
    ...ductsRouteState,
    editable: [
      ["writeIntent"],
      ["assumptions", "*"],
      ["rules", "*"],
      ["catalogs", "*"],
      ["ruleAssignments", "*"],
      ["subject", "*"],
      ["labelParameter"],
      ["workingPhase"],
      ["systemColours"],
      ["kinds", "*"],
      ["criteria", "*"],
    ],
  },
  commands: {
    "ducts.refresh": ductsActions["ducts.refresh"],
    ...workWriteCommands("duct-systems", "ducts.apply-heal", ductsActions["ducts.apply-heal"], {
      derive: ductsDerive,
      preview: { key: "ducts.plan-heal", definition: ductsActions["ducts.plan-heal"] },
    }),
    // A rehearsal derives the same request from Work but is no plan: it carries no seal and cannot arm apply.
    ...workIntent("duct-systems", "ducts.rehearse-heal", ductsActions["ducts.rehearse-heal"], {
      derive: ductsDerive,
    }),
    ...workIntent(
      "duct-systems",
      "ducts.rehearse-assign-fan",
      ductsActions["ducts.rehearse-assign-fan"],
      { derive: ductsDerive },
    ),
    ...workWriteCommands(
      "duct-systems",
      "ducts.apply-assign-fan",
      ductsActions["ducts.apply-assign-fan"],
      {
        derive: ductsDerive,
        preview: {
          key: "ducts.plan-assign-fan",
          definition: ductsActions["ducts.plan-assign-fan"],
        },
      },
    ),
  },
} satisfies Tool;

type DuctSystemCommands = typeof ductSystemsTool.commands;
declare module "@pe/agent-contracts/handle" {
  interface ProductCommands extends DuctSystemCommands {}
}
