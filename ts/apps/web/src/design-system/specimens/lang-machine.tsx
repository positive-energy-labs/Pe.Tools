import { useState } from "react";

import { Accordion } from "#/components/lang/accordion";
import { LegStrip } from "#/components/lang/leg-strip";
import { PidChip, ShapeCells } from "#/components/lang/process";
import { SwitchRow } from "#/components/lang/switch-row";

import { SpecimenFrame } from "./recipe-grid";

const LEGS = [
  { name: "download", status: "ok", observedAtUtc: "2026-10-08T17:20:04Z", detail: null },
  { name: "stop:2501", status: "ok", observedAtUtc: "2026-10-08T17:20:31Z", detail: null },
  { name: "handoff", status: "running", observedAtUtc: "2026-10-08T17:20:41Z", detail: null },
];

/** The machine control plane's marks (design-system ledger 2026-10-09). */
export function LangMachineSpecimens() {
  const [open, setOpen] = useState<string | null>("update");
  const [on, setOn] = useState(false);
  return (
    <>
      <SpecimenFrame name="PidChip · ShapeCells" importPath="#/components/lang/process">
        <span className="flex flex-col gap-2">
          <PidChip pid={2501} />
          <ShapeCells
            shape={{ payload: "checkout", reload: "hot", posture: "foreground", quarantine: false }}
          />
          <ShapeCells
            shape={{
              payload: "installed",
              reload: "none",
              posture: "background",
              quarantine: true,
            }}
          />
        </span>
      </SpecimenFrame>
      <SpecimenFrame name="Accordion" importPath="#/components/lang/accordion">
        <span className="block w-[356px]">
          <Accordion
            label="specimen groups"
            open={open}
            onOpen={setOpen}
            groups={[
              { key: "revit", label: "Revit", state: "3 running · 1 booting", body: "rows" },
              {
                key: "update",
                label: "Update",
                state: "0.7.1 · blocked",
                tone: "caution",
                body: "the plan",
              },
              { key: "share", label: "Share", state: "off", body: "the switch" },
            ]}
          />
        </span>
      </SpecimenFrame>
      <SpecimenFrame name="LegStrip" importPath="#/components/lang/leg-strip">
        <span className="flex flex-col gap-2">
          <LegStrip legs={LEGS} />
          <LegStrip legs={LEGS} unobserved="not observed: the host is down" />
          <LegStrip legs={[{ ...LEGS[0]!, status: "failed", detail: "digest mismatch" }]} />
        </span>
      </SpecimenFrame>
      <SpecimenFrame name="SwitchRow" importPath="#/components/lang/switch-row">
        <span className="flex w-[356px] flex-col gap-2">
          <SwitchRow
            label="Share over tailnet"
            checked={on}
            onCheckedChange={setOn}
            says="serve this host"
          />
          <SwitchRow
            label="Share over tailnet"
            checked={false}
            onCheckedChange={() => {}}
            refusal="Tailscale is not installed on this machine."
            says="serve this host"
          />
        </span>
      </SpecimenFrame>
    </>
  );
}
