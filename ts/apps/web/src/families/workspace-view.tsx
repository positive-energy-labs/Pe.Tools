import { Pane } from "#/components/lang/pane";
import { FamiliesMatrix } from "#/families/matrix";
import { familiesSpec } from "#/families/manifest";
import { FAMILIES_STAGES } from "#/families/stage";
import { DEMO_FAMILIES_SPEC } from "#/families/seeds";
import {
  FamiliesCaptureBand,
  FamiliesCarryOverLine,
  FamiliesProposalsBand,
  FamiliesReceiptsBand,
  SalvagedExclusions,
} from "#/families/readout-bands";
import { FamiliesFilterBand } from "#/families/scope-band";
import { useFamiliesWorkspace } from "#/families/workspace-context";
import { ChangedInRevit } from "#/route/changed";
import { EntityRouteView } from "#/route/entity";
import { SituationCell } from "#/route/situation-marks";

const noun = (n: number, word: string) =>
  `${n} ${n === 1 ? word : word.endsWith("y") ? `${word.slice(0, -1)}ies` : `${word}s`}`;

/**
 * `/families` on the kernel. The sentence names the applied scope ("families over 12 families");
 * the audit is the scope draft, the last apply's receipts and the matrix with its pick column.
 */
export function FamiliesWorkspaceView({ url }: { url?: boolean }) {
  const {
    store,
    applied,
    plan,
    includedPlanned,
    outsideProfile,
    matrixIssue,
    totalFamilies,
    changed,
    readAgain,
    matrixReading,
  } = useFamiliesWorkspace();
  // An empty familyNames list means every family the categories resolve to: read the resolved count.
  const scoped = applied ? applied.familyNames.length || totalFamilies : 0;
  const scope = (
    <SituationCell io={store.page.stage === "audit" ? "w" : "r"} empty={!applied}>
      <span
        className={applied ? undefined : "border-b seam-border border-current text-ink-2"}
        title={
          applied
            ? `${applied.placementScope} · ${applied.categoryNames.join(", ") || "every category"}; the scope draft changes it`
            : "no scope staged; draft one in the audit and apply it, or accept Pea's"
        }
      >
        {applied ? noun(scoped, "family") : "no staged scope"}
      </span>
    </SituationCell>
  );
  return (
    <EntityRouteView
      def={familiesSpec}
      handle={store.handle as never}
      refreshPods={store.refreshPods}
      fixture={store.demo ? DEMO_FAMILIES_SPEC : undefined}
      url={url}
      stages={FAMILIES_STAGES}
      subject={<>families over {scope}</>}
      health={matrixIssue ? `${matrixIssue.title} · ${matrixIssue.message}` : null}
      startFreshAside={<SalvagedExclusions />}
      onStartedFresh={store.actions.startedFresh}
      hold={(id) => {
        const row = store.plan?.entries.find((entry) => entry.id === id);
        if (row) void store.actions.exclude(row.name);
      }}
      facts={[
        [
          "scope",
          applied
            ? `${applied.placementScope} · ${applied.categoryNames.join(", ") || "every category"} · ${noun(scoped, "family")}`
            : "none staged",
        ],
        [
          "plan",
          plan
            ? `${includedPlanned.length} / ${plan.entries.length} included · ${outsideProfile.length} unclaimed`
            : "none confirmed",
        ],
        ["applied", store.applyData ? store.applyData.appliedAt : "never"],
      ]}
    >
      <div className="flex size-full min-h-0 min-w-0 flex-col">
        <div data-slot="readout-band" className="shrink-0 py-1.5">
          {changed ? (
            <div className="flex items-center gap-2">
              <ChangedInRevit
                what="the loaded families"
                busy={matrixReading}
                onReadAgain={readAgain}
              />
            </div>
          ) : null}
          <FamiliesCarryOverLine />
          <FamiliesFilterBand />
          <FamiliesProposalsBand />
          <FamiliesCaptureBand />
          <FamiliesReceiptsBand />
        </div>
        <Pane
          kind="content"
          title="families"
          help="Families and types in the applied scope. Pick rows to capture them; open a row to inspect its family."
          scroll="clip"
          flush
          headerless
        >
          <FamiliesMatrix />
        </Pane>
      </div>
    </EntityRouteView>
  );
}
