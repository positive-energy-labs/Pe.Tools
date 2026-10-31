import { useContext, useState } from "react";
import {
  sameValue,
  stagedParameterProfile,
  type ParameterLinksDocument,
} from "@pe/agent-contracts";
import { ArmingStrip } from "@pe/kit/lang/arming-strip";
import { FactChip } from "@pe/kit/lang/chip";
import { OutcomeLine } from "@pe/kit/lang/outcome";
import { ActivityDisclosure } from "@pe/kit/lang/activity";
import { cellFromDraft, StateCell, type CellTransition } from "@pe/kit/lang/cell";
import { useList } from "@pe/kit/lang/collection";
import { ListView } from "@pe/kit/lang/list-view";
import { Scroll } from "@pe/kit/lang/scroll";
import { NativeObservationScope } from "#/revit/observation";
import { WorkbenchContext } from "#/workbench/provider/thread-summary";
import { mountRoute, routeFromGraph, type MountBody, type RouteAdapters } from "#/shell/mount";
import { EvaluationView, RuntimeStatusBar } from "./Evaluation";
import { ProfileEditor } from "./ProfileEditor";
import {
  latestLinks,
  parameterLinksBinding,
  parameterLinksGraph,
  type ParameterLinksPage,
} from "./graph";
import { isDraftDirty, profileDiff, profileSummary, type ProfileChange } from "./model";
import { parameterLinksSources, type ProfileOptions } from "./sources";

type Body = MountBody<ParameterLinksPage, ParameterLinksDocument>;

function linksOf(owner: Body["owner"]) {
  const state = owner.readings.get("links");
  const capture = latestLinks(state.value ?? state.previous);
  return {
    capture,
    reading: capture?.reading.kind === "parameter-links" ? capture.reading.value : null,
    document: capture?.provenance.kind === "live" ? capture.provenance.target : null,
  };
}

function ProfileBody({ owner }: Body) {
  const work = owner.snapshot().work;
  const profile = work ? stagedParameterProfile(work.doc) : null;
  const cell = work?.doc.profile ?? {};
  const proposal = cell.suggestion != null && !sameValue(cell.suggestion, cell.edit);
  const peaActive = useContext(WorkbenchContext)?.isRunning ?? false;
  const [reason, setReason] = useState("");
  const { capture, reading } = linksOf(owner);
  const apply = owner.control("apply");
  const result = owner.results.get("edit");
  const failed = result && "refusal" in result ? result.refusal.message : null;
  const options = (owner.readings.get("options").value ?? {}) as ProfileOptions;
  const transitions: CellTransition[] = (
    [
      ["take", "take"],
      ["unsuggest", "reject"],
      ["clear", "reopen"],
    ] as const
  ).flatMap(([kind, verb]) => {
    const control = owner.control(`cell:profile.${verb}`, "profile");
    return control.refusal
      ? []
      : [
          {
            kind,
            run: async () => {
              const result = await control.run();
              return "refusal" in result ? result.refusal : null;
            },
          },
        ];
  });

  return (
    <Scroll className="min-w-0 flex-1">
      {!work ? (
        <OutcomeLine kind="busy" label="hydrating route state" />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-1.5">
            {profile && (
              <FactChip title="definitions · assignments in the shared profile">
                {profile.definitions.length} def · {profile.assignments.length} asn
              </FactChip>
            )}
            {isDraftDirty(work.doc, reading) && (
              <FactChip tone="caution" title="Apply reconciles the shared draft with Revit">
                draft ≠ stored
              </FactChip>
            )}
            {peaActive && (
              <FactChip tone="pea" title="Pea is editing the shared document">
                pea · working
              </FactChip>
            )}
          </div>
          {proposal && (
            <>
              <div role="group" aria-label="profile proposal">
                <span>Pea proposes</span>
                <StateCell
                  {...cellFromDraft(
                    cell,
                    { value: profileSummary(profile), scale: "row" },
                    (value) => profileSummary(value as typeof profile),
                  )}
                  scale="row"
                  transitions={transitions}
                />
              </div>
              <ProfileChanges changes={profileDiff(cell.edit?.value, cell.suggestion?.value)} />
            </>
          )}
          {profile && (
            <ArmingStrip
              verb="apply"
              target="shared profile"
              count={reading?.evaluation?.changedWriteCount ?? 0}
              planHash={capture?.id.slice(-8)}
              reason={reason}
              onReasonChange={setReason}
              state={
                apply.refusal
                  ? {
                      phase: "refused",
                      refusal: apply.refusal,
                      onReplan: () => {
                        void owner.control("preview").run();
                      },
                    }
                  : { phase: "arming" }
              }
              onCommit={() => {
                void apply.run().then((result) => {
                  if (result.state === "done") setReason("");
                });
              }}
              onCancel={() => setReason("")}
              refusal={owner.busy() ? "Wait for the current command to finish" : null}
            />
          )}
          {failed && <OutcomeLine kind="error" label="profile edit refused" says={failed} />}
          <ProfileEditor
            profile={profile}
            options={options}
            disabled={owner.busy() !== null || !!owner.snapshot().conflict || peaActive}
            onChange={(next) => {
              void owner
                .control("edit", {
                  profile: next.definitions.length ? next : null,
                  expectedRevision: work.handle.revision,
                })
                .run();
            }}
          />
        </>
      )}
    </Scroll>
  );
}

function EvaluationBody({ owner }: Body) {
  const { reading, document } = linksOf(owner);
  return (
    <div className="flex h-full flex-col gap-4">
      <RuntimeStatusBar
        status={reading?.status ?? null}
        appliedWriteCount={reading?.appliedWriteCount ?? 0}
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {reading?.subject === "suggestion" && (
          <OutcomeLine
            kind="advisory"
            label="preview of Pea's suggestion — not edit"
            says="accept it to stage it, then preview the edit profile before apply"
          />
        )}
        <NativeObservationScope value={{ scope: document ? { document, source: "native" } : null }}>
          <EvaluationView evaluation={reading?.evaluated ? (reading.evaluation ?? null) : null} />
        </NativeObservationScope>
      </div>
    </div>
  );
}

/** Pea's suggestion against edit, item by item. */
function ProfileChanges({ changes }: { changes: ProfileChange[] }) {
  const list = useList({
    items: changes,
    keyOf: (change) => `${change.kind}:${change.id}`,
    search: (change) => ({
      text: [change.kind, change.name, change.id, change.change, ...change.fields],
    }),
  });
  return (
    <ActivityDisclosure
      label="changes against edit"
      summary={`${changes.length} change${changes.length === 1 ? "" : "s"} against edit`}
    >
      <ListView
        list={list}
        aria-label="changes against edit"
        empty={{
          message: "No changes against edit",
          exit: "Propose a profile change to compare it",
        }}
        row={(change) => ({
          label: change.kind === "definition" ? change.name : `assignment · ${change.name}`,
          meta:
            change.change === "changed" ? `changed: ${change.fields.join(", ")}` : change.change,
        })}
      />
    </ActivityDisclosure>
  );
}

export const parameterLinksAdapters: RouteAdapters<ParameterLinksPage, ParameterLinksDocument> = {
  sources: parameterLinksSources(),
  binding: parameterLinksBinding,
  cell: (row, scope) =>
    row === "profile" && scope.work
      ? {
          type: "cell:profile",
          id: "profile",
          path: ["profile"],
          work: scope.work.handle.key,
        }
      : null,
  verbDepends: { apply: ["links"] },
  bodies: { profile: ProfileBody, evaluation: EvaluationBody },
};
export const parameterLinksRoute = routeFromGraph(
  parameterLinksGraph,
  parameterLinksAdapters,
  "/parameter-links",
);
export const ParameterLinksRoute = mountRoute(parameterLinksGraph, parameterLinksAdapters);
