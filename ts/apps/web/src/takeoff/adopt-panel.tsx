import { nameOrFallback } from "@pe/kit/lang/subject-text";
import { Fragment, type ComponentProps } from "react";
import { showAdopt, TakeoffProposalRows } from "#/takeoff/proposals";
import { FactChip } from "@pe/kit/lang/chip";
import { EmptyState } from "@pe/kit/lang/empty";
import { OutcomeLine } from "@pe/kit/lang/outcome";
import { Input } from "@pe/kit/lang/input";
import { fmtNum } from "@pe/kit/table/model";
import { type CandidateRegion } from "#/takeoff/model";
import type { TakeoffStore } from "./store";
import { TooltipHint } from "@pe/kit/lang/tooltip";

export interface AdoptRow {
  region: CandidateRegion;
  view: string;
  checked: boolean;
  name: string;
  systemTag: string;
}

/** A text field that writes Work once, on blur or Enter, never per keystroke (29). */
function CommitInput({
  value,
  onCommit,
  ...props
}: Omit<ComponentProps<typeof Input>, "value" | "defaultValue" | "onChange"> & {
  value: string;
  onCommit: (next: string) => void;
}) {
  return (
    <Input
      {...props}
      // Remounts on a landed value, so Work stays the one source between edits.
      key={value}
      defaultValue={value}
      onBlur={(e) => e.target.value !== value && onCommit(e.target.value)}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
    />
  );
}

export function AdoptRegions({ store }: { store: TakeoffStore }) {
  const views = store.views;
  const zones = store.world.zones;
  const listed = store.adoptRows;
  const patchRow = (view: string, elementId: number, patch: Partial<AdoptRow>) =>
    store.actions.patchAdopt(view, elementId, patch);

  return (
    <section aria-label="Adopt zoning regions" className="p-2 whitespace-normal">
      <p>
        tick the designer-drawn regions that are zones. adoption stamps them in place (role, guid,
        name, system tag) — re-adopt to edit. legends are ignored.
      </p>
      <div className="mt-2 max-h-96 overflow-y-auto">
        {(listed ?? []).map((r) => (
          <Fragment key={`${r.view}:${r.region.elementId}`}>
            <div className="flex items-center gap-2 px-2 py-1">
              <Input
                type="checkbox"
                aria-label={`Select ${r.name} in ${r.view}`}
                checked={r.checked}
                onChange={(e) =>
                  patchRow(r.view, r.region.elementId, { checked: e.target.checked })
                }
              />
              <TooltipHint content={r.view}>
                <span className="w-28">{r.view}</span>
              </TooltipHint>
              <span className="size-2.5" style={{ backgroundColor: `rgb(${r.region.color})` }} />
              <TooltipHint content={r.region.typeName}>
                <span className="w-24">{r.region.typeName}</span>
              </TooltipHint>
              <span className="w-16">{fmtNum(r.region.sqft, 0)} sf</span>
              <div className="min-w-0 flex-1">
                <CommitInput
                  aria-label={`Zone name for ${nameOrFallback(r.name)} in ${r.view}`}
                  value={r.name}
                  placeholder="zone name"
                  onCommit={(name) => patchRow(r.view, r.region.elementId, { name })}
                />
              </div>
              <div className="w-24">
                <CommitInput
                  aria-label={`System tag for ${nameOrFallback(r.name)} in ${r.view}`}
                  value={r.systemTag}
                  placeholder="system tag"
                  onCommit={(systemTag) => patchRow(r.view, r.region.elementId, { systemTag })}
                />
              </div>
              {r.region.role === "zoning-region" && (
                <FactChip
                  tone="done"
                  title="This region is already stamped as a Zoning Region. Re-adopting edits its name and system tag in place."
                >
                  stamped
                </FactChip>
              )}
            </div>
            {/* Pea's proposed choice for this candidate, in the band grammar. */}
            <div className="px-2">
              <TakeoffProposalRows
                cells={store.cells.adopt}
                wire={store.wires.adopt}
                keep={(key) => key === `${r.view}:${r.region.elementId}`}
                label={() => r.name || r.region.typeName}
                show={showAdopt}
              />
            </div>
          </Fragment>
        ))}
        {!views.length ? (
          <div className="px-2 py-3">
            <EmptyState story="scope" exit="choose views in the sentence above">
              no views chosen — candidates are read per plan view
            </EmptyState>
          </div>
        ) : store.candidatesIssue ? (
          <div className="px-2 py-3">
            <OutcomeLine
              kind="error"
              label="candidates unread"
              says={store.candidatesIssue.message}
            />
          </div>
        ) : store.candidatesReading || listed === null ? (
          <div className="px-2 py-3">
            <OutcomeLine kind="busy" label="reading candidates" says={views.join(", ")} />
          </div>
        ) : listed.length === 0 ? (
          <div className="px-2 py-3">
            <EmptyState story="scope" exit="or bind other views">
              no filled regions on this plan: initialize the zoning plan in Revit
            </EmptyState>
          </div>
        ) : null}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <FactChip title="Zoning Regions already stamped anywhere in this document.">
          {zones.length} already adopted
        </FactChip>
      </div>
    </section>
  );
}
