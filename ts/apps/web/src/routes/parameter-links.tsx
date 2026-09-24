import { createFileRoute } from "@tanstack/react-router";
import { Save } from "lucide-react";
import { useCallback, useContext, useMemo, useState } from "react";

import type { ParameterLinkProfile } from "@pe/agent-contracts";
import {
  familyCaptureSchema,
  parameterLinksReadingSchema,
  sameValue,
  stagedParameterProfile,
  transitionPatches,
} from "@pe/agent-contracts";

import { ArmingStrip } from "#/components/lang/arming-strip";
import { FactChip } from "#/components/lang/chip";
import { OutcomeLine } from "#/components/lang/outcome";
import { ActionButton } from "#/components/lang/action-button";
import { Pane, PaneSplit } from "#/components/lang/pane";
import { Surface } from "#/components/lang/surface";
import { EvaluationView, RuntimeStatusBar } from "#/parameter-links/Evaluation";
import { ProfileEditor } from "#/parameter-links/ProfileEditor";
import { ActivityDisclosure } from "#/components/lang/activity";
import { Row } from "#/components/lang/row";
import {
  applyRefusal,
  isDraftDirty,
  profileDiff,
  profileSummary,
  sameProfile,
  type ProfileChange,
} from "#/parameter-links/model";
import { ReviewRow, type CellWire } from "#/components/lang/band";
import { previousOf } from "#/readings";
import { RouteShell, useRoute } from "#/route";
import { Situation } from "#/route/situation";
import { LadderPicker, useDocumentLadder } from "#/route/situation-ladder";
import type { Reading } from "@pe/agent-contracts";
import { WorkbenchContext } from "#/workbench/provider/thread-summary";

import { manifest } from "#/parameter-links/manifest";

/**
 * /parameter-links — the route-native workspace for cross-element parameter links.
 * pea and the engineer co-edit ONE `route:parameter-links` document: a `draftProfile`
 * of link definitions + assignments, evaluated against Revit into projected target
 * writes. The draft is edited locally (plain forms) and saved to the shared document;
 * Preview evaluates it without writing; Apply (human-only, freshness-gated) stores it and
 * reconciles the changed target parameters.
 */
export const parameterLinksSearch = (
  search: Record<string, unknown>,
): { thread?: string; demo?: string } => ({
  thread:
    typeof search.thread === "string" && search.thread.trim() ? search.thread.trim() : undefined,
  demo: typeof search.demo === "string" && search.demo.trim() ? search.demo.trim() : undefined,
});

export const Route = createFileRoute("/parameter-links")({
  validateSearch: parameterLinksSearch,
  component: ParameterLinksRoute,
});

/** A short content hash of a profile — the plan identity the arming strip cites, so a refusal
 * and the plan it names can be matched by eye. Djb2 over the canonical JSON; not cryptographic,
 * just stable and short. */
function profileHash(profile: ParameterLinkProfile | null): string {
  const json = JSON.stringify(profile ?? null);
  let hash = 5381;
  for (let index = 0; index < json.length; index += 1) {
    hash = ((hash << 5) + hash + json.charCodeAt(index)) | 0;
  }
  return (hash >>> 0).toString(36);
}

function ParameterLinksRoute() {
  return <ParameterLinksRouteContent />;
}

/** No seeds: `parameter-links` has no demo lane (spec §7). `?demo=` is inert here. */
export function ParameterLinksRouteContent({ thread }: { thread?: string } = {}) {
  const route = useRoute(manifest, { thread });
  const ladder = useDocumentLadder(route);
  const peaActive = useContext(WorkbenchContext)?.isRunning ?? false;
  const resolved = route.resolution.kind === "resolved" ? route.resolution.target : null;
  const optionsFrom = resolved?.kind === "document" ? resolved.ref : null;

  /**
   * Observations arrive on the route's own Reading, exactly where Family keeps its captures.
   * Nothing here is ever written into the authored draft.
   */
  const latest = useMemo(() => {
    const rows = previousOf(route.readings.links as Reading<unknown>);
    if (!rows) return { reading: null, readingId: null };
    const row = familyCaptureSchema
      .array()
      .parse(rows)
      .find((capture) => capture.reading.kind === "parameter-links");
    return row && row.reading.kind === "parameter-links"
      ? { reading: parameterLinksReadingSchema.parse(row.reading.value), readingId: row.id }
      : { reading: null, readingId: null };
  }, [route.readings]);
  const reading = latest.reading;
  const readingId = reading?.evaluated ? latest.readingId : null;

  const document = route.work.doc;
  const savedDraft = document ? stagedParameterProfile(document) : null;
  // Pea's proposed profile, drawn in the band grammar while it differs from what is staged
  // (accepted, it stays as authorship evidence of the staged value: nothing left to review).
  const profileCell = document?.profile ?? {};
  const reviewingProposal =
    profileCell.proposal != null && !sameValue(profileCell.proposal, profileCell.staged);
  const profileWire: CellWire = {
    segment: null,
    write: route.work.write,
    revision: route.work.revision,
  };
  /** The evaluation shown is a labelled preview of Pea's proposal, never the staged profile's. */
  const previewingProposal = reading?.subject === "proposal";
  const evaluation = reading?.evaluated ? (reading.evaluation ?? null) : null;
  const status = reading?.status ?? null;

  const [rightOpen, setRightOpen] = useState(true);
  const busy = route.busy?.key ?? null;
  /** The arming reason — the strip's own gate: apply arms only once a reason is supplied. */
  const [writeReason, setWriteReason] = useState("");

  /**
   * One edit buffer, and it is only ever ahead of the document — never a second copy of it.
   * `editing` falls through to the saved draft, so a pea edit or another tab shows up on its own
   * with no reconcile effect. A buffer that is genuinely ahead stays visible and stays flagged;
   * saving it is an explicit CAS write, so a concurrent edit refuses instead of being clobbered.
   */
  const [buffer, setBuffer] = useState<ParameterLinkProfile | null>(null);
  const editing = buffer ?? savedDraft;
  const hasUnsavedEdits = buffer != null && !sameProfile(buffer, savedDraft);
  const [saveConflict, setSaveConflict] = useState<string | null>(null);
  const [draftBasis, setDraftBasis] = useState<number | null>(null);

  const draftDirty = isDraftDirty(document, reading);
  /** Exactly the server admission gate, plus the buffer the server cannot see yet. */
  const refusal = hasUnsavedEdits
    ? "unsaved local edits — save the draft, then preview exactly what you will apply"
    : applyRefusal(document, reading);
  const applyReady = refusal == null && readingId != null;

  const onDraftChange = useCallback(
    (next: ParameterLinkProfile) => {
      setSaveConflict(null);
      setDraftBasis((previous) => previous ?? route.work.revision);
      setBuffer(next);
    },
    [route.work.revision],
  );

  /** Persist the buffer onto the shared document against the revision it was edited from. */
  const saveDraft = useCallback(
    async (profile: ParameterLinkProfile): Promise<boolean> => {
      const refusal = await route.work.write(
        transitionPatches([], "profile", {}, { kind: "stage", rung: { value: profile } }),
        draftBasis ?? undefined,
      );
      if (refusal) {
        // The edit is kept, not discarded: a refused CAS means someone else wrote first.
        setSaveConflict(refusal.message);
        return false;
      }
      setSaveConflict(null);
      setBuffer(null);
      setDraftBasis(null);
      return true;
    },
    [route.work, draftBasis],
  );

  // Preview evaluates what the document holds, so the buffer lands first: the count the human
  // approves is then an evaluation of exactly the bytes Apply will send.
  const preview = route.actions.preview;
  const handle = useMemo(
    () => ({
      ...route,
      actions: {
        ...route.actions,
        preview: {
          ...preview,
          run: async () =>
            hasUnsavedEdits && editing && !(await saveDraft(editing)) ? null : preview.run(),
        },
      },
    }),
    [route, preview, hasUnsavedEdits, editing, saveDraft],
  );

  const runApply = useCallback(async () => {
    if (!readingId) return;
    const refusal = await route.actions.apply.run({ readingId });
    if (!refusal) setWriteReason(""); // the write landed; the strip disarms
  }, [readingId, route.actions.apply]);

  /**
   * THE ARMING STRIP'S STATE (fit reviews, ruled 2026-08-16): the preview→stale→apply gate IS the
   * arming lifecycle, so it maps onto the strip's own phases instead of hiding in a hover title —
   *   · no fresh preview (never run, pea's run, or the draft moved since) → `refused`, and
   *     re-plan IS preview: the only way forward is a fresh projection from this pane;
   *   · preview verified → `arming`: the reason input arms the one commit;
   *   · the commit = apply.
   */
  const armingState =
    applyReady || editing == null
      ? ({ phase: "arming" } as const)
      : {
          phase: "refused" as const,
          refusal:
            refusal ??
            "apply is unavailable on this surface — open the route against a live document",
          onReplan: () => void handle.actions.preview.run(),
        };

  return (
    <Surface
      head={
        <RouteShell
          manifest={manifest}
          handle={handle}
          situation={
            <Situation
              handle={handle}
              target={{ session: ladder.sessionWord, document: ladder.docWord }}
              // Apply lives on the arming strip in the profile column: its safety model (plan
              // freshness · reason · refusal) is the strip's payload, so the row draws the reads.
              verbs={["refresh", "preview", "previewProposal"]}
              sentence={
                <>
                  links in <LadderPicker ladder={ladder} disabled={route.busy !== null} />
                  {ladder.refusal ? (
                    <span role="status" data-tone="caution">
                      {" "}
                      ({ladder.refusal})
                    </span>
                  ) : null}
                  .
                </>
              }
              work={() => (
                <span className="flex flex-wrap items-center gap-1.5">
                  {editing && (
                    <FactChip title="definitions · assignments in the profile being edited">
                      {editing.definitions.length} def · {editing.assignments.length} asn
                    </FactChip>
                  )}
                  {saveConflict && (
                    <FactChip
                      tone="caution"
                      title={`the shared document moved while you were editing — your edit is kept, not overwritten: ${saveConflict}`}
                    >
                      save conflict
                    </FactChip>
                  )}
                  {hasUnsavedEdits && (
                    <FactChip
                      tone="caution"
                      title="local edits not yet saved to the shared document — save draft (or preview) persists them"
                    >
                      unsaved edits
                    </FactChip>
                  )}
                  {draftDirty && (
                    <FactChip
                      tone="caution"
                      title="the shared draft differs from what Revit stored — apply reconciles them"
                    >
                      draft ≠ stored
                    </FactChip>
                  )}
                  {peaActive && (
                    <FactChip tone="pea" title="pea is editing the shared document right now">
                      pea · working
                    </FactChip>
                  )}
                </span>
              )}
            />
          }
        />
      }
    >
      <PaneSplit
        axis="horizontal"
        grow
        resize={{
          target: "end",
          defaultSize: 520,
          minSize: 340,
          maxSize: 760,
          persist: "pe.parameterLinks.evalPane",
          collapse: {
            collapsed: !rightOpen,
            onCollapsedChange: (collapsed) => setRightOpen(!collapsed),
            collapsedSize: 40,
            collapseBelow: 170,
          },
        }}
        start={
          <Pane kind="content" title="profile" scroll="clip" flush>
            <div className="min-w-0 flex-1 overflow-y-auto">
              {route.work.revision === null ? (
                <OutcomeLine kind="busy" label="hydrating route state" />
              ) : (
                <>
                  {reviewingProposal ? (
                    <ReviewRow
                      wire={profileWire}
                      address="profile"
                      label={<span className="t-small face-mono text-ink-2">pea proposes</span>}
                      cell={profileCell}
                      facts={{
                        value: profileSummary(
                          (profileCell.staged ?? profileCell.proposal)?.value as
                            | ParameterLinkProfile
                            | undefined,
                        ),
                        scale: "row",
                      }}
                      show={(value) => profileSummary(value as ParameterLinkProfile)}
                    />
                  ) : null}
                  {reviewingProposal ? (
                    <ProfileChanges
                      changes={profileDiff(
                        profileCell.staged?.value as ParameterLinkProfile | undefined,
                        profileCell.proposal?.value as ParameterLinkProfile | undefined,
                      )}
                    />
                  ) : null}
                  {/* The preview→stale→apply gate, ON the surface. Refused = the plan is stale
                  (re-plan runs preview); arming = the reason input is the last gate before the
                  one commit. */}
                  {editing != null ? (
                    <ArmingStrip
                      verb="apply"
                      target={ladder.docWord ?? "no document"}
                      count={evaluation?.changedWriteCount ?? 0}
                      planHash={profileHash(savedDraft)}
                      reason={writeReason}
                      onReasonChange={setWriteReason}
                      state={armingState}
                      onCommit={() => {
                        if (busy == null) void runApply();
                      }}
                      onCancel={() => setWriteReason("")}
                    />
                  ) : null}
                  {/* The editor's own save, as the spec editor carries its own: a Work write of the
                  buffer, not a route verb. */}
                  <ActionButton
                    tone="commit"
                    label="save draft"
                    icon={Save}
                    disabled={busy != null || !editing || !hasUnsavedEdits}
                    onClick={() => {
                      if (editing) void saveDraft(editing);
                    }}
                    reason={
                      hasUnsavedEdits
                        ? "Write the local edits onto the shared document, where pea can see them"
                        : "no unsaved local edits — the shared document already matches"
                    }
                  />
                  <ProfileEditor
                    profile={editing}
                    disabled={busy != null || peaActive}
                    target={optionsFrom}
                    onChange={onDraftChange}
                  />
                </>
              )}
            </div>
          </Pane>
        }
        end={
          <Pane
            kind="flank"
            title="evaluation"
            side="right"
            flush
            collapsed={!rightOpen}
            onCollapsedChange={(collapsed) => setRightOpen(!collapsed)}
          >
            <div className="flex h-full flex-col gap-4">
              <RuntimeStatusBar
                status={status}
                appliedWriteCount={reading?.appliedWriteCount ?? 0}
              />
              <div className="min-h-0 flex-1 overflow-y-auto">
                {previewingProposal ? (
                  <OutcomeLine
                    kind="advisory"
                    label="preview of Pea's proposal — not staged"
                    says="accept it to stage it, then preview the staged profile before apply"
                  />
                ) : null}
                <EvaluationView evaluation={evaluation} />
              </div>
            </div>
          </Pane>
        }
      />
    </Surface>
  );
}

/** Pea's proposal against staged, item by item: what accept would change, not just its counts. */
function ProfileChanges({ changes }: { changes: ProfileChange[] }) {
  return (
    <ActivityDisclosure
      label="changes against staged"
      summary={`${changes.length} change${changes.length === 1 ? "" : "s"} against staged`}
    >
      {changes.length
        ? changes.map((change) => (
            <Row
              key={`${change.kind}:${change.id}`}
              data-key={`${change.kind}:${change.id}`}
              label={`${change.kind} ${change.id}`}
              meta={
                change.change === "changed" ? `changed: ${change.fields.join(", ")}` : change.change
              }
            />
          ))
        : null}
    </ActivityDisclosure>
  );
}
