import { useState } from "react";

import { FactChip } from "#/components/lang/chip";
import { CoverageBar } from "#/components/lang/coverage-bar";
import { EmptyState } from "#/components/lang/empty";
import { HelpTip } from "#/components/lang/help";
import { OutcomeLine } from "#/components/lang/outcome";
import { Provenance, Section } from "#/components/lang/section";
import { Switcher } from "#/components/lang/switcher";

const OUTCOMES = [
  ["busy", "applying… 3s"],
  ["receipt", "42 parameters written"],
  ["refused", "refused · plan hash drift"],
  ["dropped", "discarded · write in flight"],
  ["advisory", "2 types would be skipped"],
  ["partial", "38 of 42 written · 4 staged"],
  ["error", "bridge busy"],
] as const;

export function LangStatusSpecimens() {
  const [mode, setMode] = useState<"reported" | "surveyed">("reported");
  return (
    <Section
      label="lang · status"
      help={<HelpTip>Coverage, emptiness, outcomes, provenance, and mode selection.</HelpTip>}
      aside={<FactChip title="Rows currently in scope.">60 rows</FactChip>}
    >
      <div className="flex flex-col gap-5">
        <CoverageBar
          segments={[
            { label: "grounded", count: 34, viz: 2 },
            { label: "staged", count: 11, viz: 1 },
            { label: "unread", count: 6, viz: 6 },
          ]}
          total={60}
        />
        <div className="grid gap-3 lg:grid-cols-2">
          <EmptyState story="scope" exit="run capture on this level">
            no zones on this level
          </EmptyState>
          <EmptyState story="filter" exit="clear the room-state chip">
            0 of 124 rooms match
          </EmptyState>
        </div>
        <div className="flex flex-col gap-1">
          {OUTCOMES.map(([kind, label]) => (
            <OutcomeLine key={kind} kind={kind} label={label} />
          ))}
        </div>
        <Switcher
          ariaLabel="reading source"
          value={mode}
          onChange={setMode}
          options={[
            { value: "reported", label: "reported", title: "Reported by the model" },
            { value: "surveyed", label: "surveyed", title: "Measured in the document" },
          ]}
        />
        <Provenance>read 2026-08-16 14:02 · 3 sessions · fixture data</Provenance>
      </div>
    </Section>
  );
}
