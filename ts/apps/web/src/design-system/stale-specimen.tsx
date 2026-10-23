import { useState } from "react";
import {
  showCellValue,
  type RouteStatePatch,
  type ScheduleGridDocument,
} from "@pe/agent-contracts";

import { Button } from "@pe/kit/lang/button";
import { cellFromTrichotomy } from "@pe/kit/lang/cell";
import { Section } from "@pe/kit/lang/section";
import { reviewAddresses } from "#/components/work/band";
import { WorkLines, type WorkTab } from "#/components/work/lines";
import { StaleResolve } from "#/route/schedules/stale-resolve";

/** Ask A on the band: the real `StaleResolve` over three stale LOAD cells. */
export function StaleSection({ say }: { say: (text: string) => void }) {
  return (
    <Section label="02 · a stale cell · Revit moved under what you staged">
      <p className="t-prose text-ink-2">
        A push refused three LOAD cells: Revit changed them after you reviewed. Each reads what you
        reviewed, what Revit holds now, and yours. Accept keeps yours staged, deny takes
        Revit&apos;s; neither pushes. The aggregate runs the cells&apos; own answers in one write,
        then pushes. r3 is contested: Pea proposed beside it, so it is skipped.
      </p>
      <StaleSpecimen say={say} />
    </Section>
  );
}

const STALE_NOW: Record<string, string> = { "1::2": "120 VA", "2::2": "90 VA", "3::2": "70 VA" };
const STALE_DOC: ScheduleGridDocument = {
  basis: {
    captureId: "specimen",
    stale: [
      { key: "1::2", was: "100 VA" },
      { key: "2::2", was: "80 VA" },
      { key: "3::2", was: "60 VA" },
    ],
  },
  cells: {
    "1::2": { staged: { value: "150 VA" } },
    "2::2": { staged: { value: "95 VA" } },
    "3::2": { staged: { value: "75 VA" }, proposal: { value: "72 VA", note: "panel schedule" } },
  },
  takenAt: null,
} as ScheduleGridDocument;

/** The real review list and `StaleResolve` over a fixture Work; writes land locally, the push is simulated. */
function StaleSpecimen({ say }: { say: (text: string) => void }) {
  const [doc, setDoc] = useState(STALE_DOC);
  const [revision, setRevision] = useState(1);
  const [tab, setTab] = useState<WorkTab | "all">();
  const write = async (patches: RouteStatePatch[]) => {
    setDoc((current) => {
      const keys = patches.map((p) => String(p.path[1]));
      const cells = { ...current.cells };
      for (const { path, value } of patches) {
        const key = String(path[1]);
        const { staged: _, ...rest } = cells[key] ?? {};
        cells[key] = value == null ? rest : { ...rest, staged: value as { value: string } };
      }
      const stale = (current.basis?.stale ?? []).filter((c) => !keys.includes(c.key));
      return {
        ...current,
        cells,
        basis: { captureId: "specimen", ...(stale.length ? { stale } : {}) },
      };
    });
    setRevision((r) => r + 1);
    return null;
  };
  return (
    <div className="flex flex-col gap-2">
      {/* The apply verb's stale question, then the Work lines over the same cells. */}
      <StaleResolve
        doc={doc}
        write={write}
        revision={revision}
        push={async () => say("SIMULATED · push of the re-staged cells")}
        unread={0}
        readAgain={async () => {}}
      />
      <WorkLines
        cells={reviewAddresses(doc.cells).map(([key, cell]) => {
          const value = showCellValue((cell.staged ?? cell.proposal)?.value);
          return {
            key,
            column: "LOAD",
            row: `r${key.split("::")[0]} (Revit now ${STALE_NOW[key] ?? "?"})`,
            value,
            look: cellFromTrichotomy(cell, { value }, showCellValue),
            locate: () => say(`locate ${key}`),
          };
        })}
        store={doc.cells}
        wire={{ segment: "cells", write, revision }}
        tab={tab}
        onTab={setTab}
      />
      <span>
        <Button
          kind="framed"
          label="reset"
          reason="Put the three stale cells back"
          onClick={() => {
            setDoc(STALE_DOC);
            setRevision((r) => r + 1);
          }}
        >
          reset
        </Button>
      </span>
    </div>
  );
}
