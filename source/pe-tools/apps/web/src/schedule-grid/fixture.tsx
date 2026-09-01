import { useState } from "react";
import * as Atom from "effect/unstable/reactivity/Atom";
import {
  scheduleGridDocumentSchema,
  type RouteStatePatch,
  type RouteStateWriteResult,
  type ScheduleCellBinding,
} from "@pe/agent-contracts";

import type { VerbAtoms } from "#/components/lang/verb-lane";
import { ScheduleGridWorkspace, type ScheduleGridState } from "#/schedule-grid/workspace";

const observedAt = "2026-08-30T18:30:00Z";

const binding = (
  columnNumber: number,
  displayValue: string,
  options: Partial<ScheduleCellBinding> = {},
): ScheduleCellBinding => ({
  columnNumber,
  targetElementIds: [41000 + columnNumber],
  parameterName: ["Mark", "Type Name", "Air Flow", "Level"][columnNumber - 1] ?? null,
  parameterId: -1000000 - columnNumber,
  storageType: "String",
  displayValue,
  isTypeParameter: false,
  isEditable: true,
  blocker: "None",
  hasMixedValues: false,
  ...options,
});

export const fixtureScheduleGridDocument = scheduleGridDocumentSchema.parse({
  catalog: {
    documentTitle: "project-a Tower.rvt",
    takenAt: observedAt,
    schedules: [
      [701, "Mechanical Equipment Schedule", "Mechanical Equipment", 7, true],
      [702, "Air Terminal Schedule", "Air Terminals", 18, true],
      [703, "VAV Box Schedule", "Mechanical Equipment", 12, false],
      [704, "Equipment Electrical Loads", "Electrical Equipment", 9, true],
      [705, "Plumbing Fixture Schedule", "Plumbing Fixtures", 14, false],
    ].map(([scheduleId, name, categoryName, rowCount, isPlacedOnSheet]) => ({
      scheduleId,
      name,
      categoryName,
      rowCount,
      isPlacedOnSheet,
    })),
  },
  snapshot: {
    scheduleId: 701,
    scheduleUniqueId: "fixture-schedule-701",
    scheduleName: "Mechanical Equipment Schedule",
    documentTitle: "project-a Tower.rvt",
    takenAt: observedAt,
    truncated: false,
    columns: [
      { columnNumber: 1, headerText: "Mark", fieldName: "Mark" },
      { columnNumber: 2, headerText: "Type", fieldName: "Type Name" },
      { columnNumber: 3, headerText: "Airflow", fieldName: "Air Flow" },
      { columnNumber: 4, headerText: "Level", fieldName: "Level" },
      {
        columnNumber: 5,
        headerText: "Cooling Load",
        fieldName: "Cooling Load",
        isCalculated: true,
      },
    ],
    rows: (
      [
        [101, ["VAV-1", "VAV Terminal 12in", "850 CFM", "Level 2", "2.4 tons"], [41001]],
        [102, ["VAV-2", "VAV Terminal 10in", "625 CFM", "Level 2", "1.8 tons"], [41002]],
        [103, ["AHU-1", "Rooftop AHU", "12000 CFM", "Roof", "32.0 tons"], [41003]],
        [104, ["FCU-12", "Fan Coil Concealed", "450 CFM", "Level 3", "1.2 tons"], [41004]],
        [105, ["EF-3", "Roof Exhaust Fan", "1800 CFM", "Roof", "—"], [41005, 41006]],
        [106, ["P-1", "Hydronic Pump", "—", "Basement", "—"], [41007]],
        [107, ["CUH-2", "Cabinet Unit Heater", "300 CFM", "Level 1", "0.8 tons"], [41008]],
      ] satisfies Array<[number, string[], number[]]>
    ).map(([rowNumber, values, subjectIds]) => ({
      rowNumber,
      kind: "Data",
      values,
      subjectIds,
      bindings: [
        binding(1, values[0]),
        binding(2, values[1], {
          isTypeParameter: true,
          isEditable: false,
          blocker: "TypeParameter",
        }),
        binding(3, values[2], {
          hasMixedValues: subjectIds.length > 1,
          targetElementIds: subjectIds,
        }),
        binding(4, values[3], { isEditable: false, blocker: "ReadOnly" }),
      ],
    })),
  },
  cells: {
    "101::3": {
      proposal: {
        value: "925 CFM",
        by: "pea",
        note: "align with the issued airflow schedule",
        confidence: "high",
      },
    },
    "102::1": { staged: { value: "VAV-2A" } },
    "103::3": { staged: { value: "12500 CFM" } },
    "104::3": {
      proposal: {
        value: "500 CFM",
        by: "pea",
        note: "cut sheet differs from the model",
        confidence: "low",
      },
    },
  },
  pushedAt: null,
});

const atoms = {
  busy: Atom.make<{ id: string; seconds: number } | null>(null),
  failure: Atom.make<null>(null),
  receipt: Atom.make({
    verb: "fixture",
    text: "fixture loaded locally",
    at: Date.parse(observedAt),
  }),
} satisfies VerbAtoms;

const refused = async (): Promise<RouteStateWriteResult> => ({
  ok: false,
  kind: "refused",
  error: "fixture schedule commands are disabled",
  hint: "open /schedule-grid without source=fixture to use live commands",
});

export function FixtureScheduleGrid() {
  const [document, setDocument] = useState(fixtureScheduleGridDocument);
  const apply = async (patches: RouteStatePatch[]): Promise<RouteStateWriteResult> => {
    setDocument((current) => {
      const cells = { ...current.cells };
      for (const patch of patches) {
        const [, key, field] = patch.path;
        if (patch.path[0] !== "cells" || typeof key !== "string" || typeof field !== "string")
          continue;
        const cell = { ...cells[key] };
        if (patch.value === undefined) delete cell[field as keyof typeof cell];
        else Object.assign(cell, { [field]: patch.value });
        cells[key] = cell;
      }
      return { ...current, cells };
    });
    return { ok: true, revision: 1 };
  };
  const state: ScheduleGridState = {
    slice: document,
    hydrated: true,
    apply,
    command: refused,
    peaActive: false,
    connected: false,
    busy: null,
    atoms,
  };
  return <ScheduleGridWorkspace state={state} />;
}
