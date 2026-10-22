import { z } from "zod";
import { field, text, type RouteDeclaration } from "../route-field.ts";
import { entityFields, tableFields, workLinesField } from "./entity.ts";
import { demo } from "./shared.ts";

export const schedulesAddress = {
  path: "/schedules",
  title: "Schedules",
  fields: {
    ...entityFields,
    /**
     * The open schedule's Work, so a reload reopens it; opening one replaces the place. Opening a
     * schedule may read Revit, so it stays the person's (the Ladder): Pea reads it.
     */
    workspaceId: field(text(), { url: "replace", agent: "read" }),
    ...tableFields(),
    lines: workLinesField,
    /** The located grid cell, `row::column` (a schedule cell key); empty = none. */
    cell: field(
      z
        .string()
        .regex(/^(\d+::\d+)?$/, "a cell is row::column")
        .default(""),
      { url: "replace", agent: "set" },
    ),
    demo,
  },
  agent: {
    finds: ["schedule", "grid", "query", "columns", "cell"],
    policy:
      "Change the visible Schedules view: stage, the Work lines tab (pea, yours, all), the grid's query line, sort (`-key` descending) and hidden columns (column keys from facts), and the located cell (`row::column`, empty = none). Facts name the open schedule, its columns and its row and staged counts. The open schedule (workspaceId) and the opened spec (pod, path) are the person's: read them. A view change never reads Revit, stages a cell or applies.",
  },
} satisfies RouteDeclaration;
