/** THROWAWAY protoui variant 5: the tray as one chronological activity log (no groups). */
import { useState } from "react";
import { Bot, Cpu, FolderKanban, Server, type LucideIcon } from "lucide-react";

import { Button } from "#/components/lang/button";
import { FactChip, Tag } from "#/components/lang/chip";
import { MACHINE_SEEDS } from "#/open/seeds";
import { machineOf, peaState, revitState, updateState } from "#/machine/model";

import type { VariantMeta } from "./lineup";

export const meta: VariantMeta = { id: "5", label: "Activity log", width: 440, height: 680 };

type Source = "Pea" | "Revit" | "Work" | "Machine";
type Tone = "caution" | "alarm" | "done" | "pea" | undefined;
interface Ev {
  id: string;
  at: string;
  source: Source;
  text: string;
  tone?: Tone;
  verbs?: [string, string?];
  /** Entries after the divider are "since you last looked". */
  fresh?: boolean;
}

// Loosely typed fixture; wording from machine/model.ts and BAY_THREADS / chat seeds.
const EVENTS: Ev[] = [
  { id: "e1", at: "08:02", source: "Machine", text: "Pe.Tools 0.7.24 host started · installed" },
  { id: "e2", at: "08:04", source: "Revit", text: "Revit 2025 started (yours)" },
  {
    id: "e3",
    at: "08:31",
    source: "Pea",
    text: "Pea finished Schedule cleanup — 41 rows normalized",
    tone: "done",
  },
  { id: "e4", at: "09:10", source: "Revit", text: "Revit 2026 booting (Pea)" },
  {
    id: "e5",
    at: "09:12",
    source: "Pea",
    text: "Pea failed Export sheets 2026 — file locked",
    tone: "alarm",
    verbs: ["Resume", "Open"],
  },
  {
    id: "e6",
    at: "09:40",
    source: "Work",
    text: "Proposal merged: FDCL-611 family, 9 changes",
    tone: "done",
  },
  { id: "e7", at: "10:05", source: "Machine", text: "Share on · pe-office (tailnet)" },
  { id: "e8", at: "10:21", source: "Revit", text: "Revit 2026 closed · 0 unsaved" },
  {
    id: "e9",
    at: "10:30",
    source: "Pea",
    text: "Pea finished Retag level 2 diffusers — 12 tags written",
    tone: "done",
    verbs: ["Open"],
    fresh: true,
  },
  {
    id: "e10",
    at: "10:34",
    source: "Pea",
    text: "Pea asks: overwrite 3 schedules?",
    tone: "pea",
    verbs: ["Allow", "Deny"],
    fresh: true,
  },
  {
    id: "e11",
    at: "10:41",
    source: "Work",
    text: "Proposal: HCB-48, 22 changes",
    tone: "caution",
    verbs: ["Review"],
    fresh: true,
  },
  {
    id: "e12",
    at: "10:44",
    source: "Machine",
    text: "Update 0.7.25 ready — waits on 1 Revit",
    tone: "caution",
    verbs: ["Install"],
    fresh: true,
  },
  {
    id: "e13",
    at: "10:47",
    source: "Machine",
    text: "Share refused: 443 in use",
    tone: "alarm",
    verbs: ["Retry"],
    fresh: true,
  },
  {
    id: "e14",
    at: "10:52",
    source: "Revit",
    text: "Revit 2025 shows a dialog",
    tone: "caution",
    verbs: ["Look"],
    fresh: true,
  },
];

const GLYPH: Record<Source, LucideIcon> = {
  Pea: Bot,
  Revit: Cpu,
  Work: FolderKanban,
  Machine: Server,
};
const FILTERS = ["All", "Pea", "Revit", "Work", "Machine"] as const;
type Filter = (typeof FILTERS)[number];

export default function Variant() {
  const [filter, setFilter] = useState<Filter>("All");
  const [gone, setGone] = useState<Record<string, string>>({});
  const machine = machineOf(MACHINE_SEEDS["patch-bay"]);
  const rows = EVENTS.filter((e) => filter === "All" || e.source === filter);
  const dividerAt = rows.findIndex((e) => e.fresh);

  return (
    <div data-surface="artifact" className="flex h-full w-full flex-col bg-paper text-ink t-small">
      <header className="hairline-b flex items-center gap-1 px-3 py-2">
        {FILTERS.map((f) => (
          <Button
            key={f}
            label={f}
            kind="framed"
            pressed={filter === f}
            onClick={() => setFilter(f)}
          >
            {f}
          </Button>
        ))}
        <span className="ml-auto face-mono text-ink-2">{rows.length} events</span>
      </header>

      <ol className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-3 py-2">
        {rows.map((e, i) => {
          const Glyph = GLYPH[e.source];
          return (
            <li key={e.id} className="flex flex-col">
              {i === dividerAt && (
                <div className="sticky top-0 z-10 my-1.5 flex items-center gap-2 bg-paper py-0.5">
                  <span className="hairline-t flex-1" />
                  <Tag>since you last looked</Tag>
                  <span className="hairline-t flex-1" />
                </div>
              )}
              <div
                className="flex items-start gap-2 py-1"
                data-tone={e.tone}
                style={e.fresh ? undefined : { opacity: 0.7 }}
              >
                <span className="w-9 shrink-0 pt-px face-mono text-ink-2">{e.at}</span>
                <Glyph className="mt-0.5 size-3.5 shrink-0 text-ink-2" aria-label={e.source} />
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className={e.tone ? "text-ink" : "text-ink-2"}>{e.text}</span>
                  {gone[e.id] ? (
                    <span className="face-mono text-ink-2">{gone[e.id]}</span>
                  ) : e.verbs ? (
                    <span className="flex gap-1">
                      {e.verbs.map((v) =>
                        v ? (
                          <Button
                            key={v}
                            label={v}
                            kind={v === e.verbs![0] ? "commit" : "framed"}
                            onClick={() => setGone((g) => ({ ...g, [e.id]: `${v} · just now` }))}
                          >
                            {v}
                          </Button>
                        ) : null,
                      )}
                    </span>
                  ) : null}
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      <footer className="hairline-t flex items-center gap-1.5 px-3 py-2">
        <FactChip title="Revit sessions">Revit {machine ? revitState(machine).text : "—"}</FactChip>
        <FactChip tone="pea" title="Pea providers">
          Pea {machine ? peaState(machine).text : "—"}
        </FactChip>
        <FactChip title="Update state">{machine ? updateState(machine).text : "—"}</FactChip>
        <span className="ml-auto">
          <Button
            label="Launch Revit"
            kind="framed"
            reason="OWED: year picker; patch-bay compact projection"
          >
            Launch Revit
          </Button>
        </span>
      </footer>
    </div>
  );
}
