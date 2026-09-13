import { createFileRoute } from "@tanstack/react-router";
import { Eye, RefreshCw, Save } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import type { ParameterLinkProfile, ParameterLinksDocument } from "@pe/agent-contracts";
import {
  familyCaptureSchema,
  parameterLinksReadingSchema,
  parameterLinksRouteState,
} from "@pe/agent-contracts";

import { AddressingBar } from "#/components/lang/addressing-bar";
import { ArmingStrip } from "#/components/lang/arming-strip";
import { FactChip } from "#/components/lang/chip";
import { HelpTip } from "#/components/lang/help";
import { OutcomeStrip } from "#/components/lang/outcome-strip";
import { OutcomeLine } from "#/components/lang/outcome";
import { ActionButton, ActionGroup } from "#/components/lang/action-button";
import { SidePane } from "#/components/lang/side-pane";
import { useHostStatusQuery } from "#/readings";
import { EvaluationView, RuntimeStatusBar } from "#/parameter-links/Evaluation";
import { ProfileEditor } from "#/parameter-links/ProfileEditor";
import { applyRefusal, isDraftDirty, sameProfile } from "#/parameter-links/model";
import type { ParameterLinksReading } from "@pe/agent-contracts";
import {
  runSemanticAction,
  actionResult,
  readFamilyCapture,
} from "../../../../packages/mcps/src/shared/takeoff-action-client";
import { previousOf } from "#/readings";
import { useRoute } from "#/route";
import type { Reading, WorkKey } from "@pe/agent-contracts";
import { useRouteState, type RouteStateHandle } from "#/workbench/route-state";

import { manifest as parameterLinksManifest } from "#/parameter-links/manifest";
export const manifest = parameterLinksManifest;


/**
 * /parameter-links — the route-native workspace for cross-element parameter links.
 * pea and the engineer co-edit ONE `route:parameter-links` document: a `draftProfile`
 * of link definitions + assignments, evaluated against Revit into projected target
 * writes. The draft is edited locally (plain forms) and saved to the shared document;
 * Preview evaluates it without writing; Apply (human-only, freshness-gated) stores it and
 * reconciles the changed target parameters. Mirrors the /family-types route architecture.
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

type CommandName = "refresh" | "preview";
/**
 * Reading Revit and applying a draft are host ports, not route commands: the owner supplies
 * the ones that can run against a live document. Neither can write authored Work.
 */
type RouteHostPorts = {
  read: (evaluate: boolean) => Promise<void>;
  apply: (revision: number, readingId: string) => Promise<void>;
  reading: ParameterLinksReading | null;
  readingId: string | null;
};

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
export function ParameterLinksRouteContent() {
  const handle = useRoute(manifest);
  const resolved = handle.resolution.kind === "resolved" ? handle.resolution.target : null;
  const ref = resolved?.kind === "document" ? resolved.ref : null;
  const key: WorkKey = useMemo(
    () => ({ route: "parameter-links", target: null }),
    [],
  );
  const route = useRouteState(parameterLinksRouteState, key);
  const bridgeConnected = useHostStatusQuery().data?.bridgeIsConnected ?? false;

  /**
   * Observations arrive on the route's own Reading, exactly where Family keeps its captures.
   * Nothing here is ever written into the authored draft.
   */
  const latest = useMemo(() => {
    const rows = previousOf(handle.readings.links as Reading<unknown>);
    if (!rows) return { reading: null, readingId: null };
    const row = familyCaptureSchema
      .array()
      .parse(rows)
      .find((capture) => capture.reading.kind === "parameter-links");
    return row && row.reading.kind === "parameter-links"
      ? { reading: parameterLinksReadingSchema.parse(row.reading.value), readingId: row.id }
      : { reading: null, readingId: null };
  }, [handle.readings]);

  const target = useCallback(() => {
    if (!ref) throw Error("Select an exact open document lifetime first");
    return ref;
  }, [ref]);

  const ports = useMemo(
    () => ({
      reading: latest.reading,
      readingId: latest.reading?.evaluated ? latest.readingId : null,
      read: async (evaluate: boolean) => {
        await readFamilyCapture("parameter-links.read", { evaluate }, key, target());
      },
      apply: async (revision: number, readingId: string) => {
        // The reviewed profile is not re-sent: the server reads the draft it already validated
        // and the reading that evaluated it, so approval and effect are one version.
        const row = await runSemanticAction(
          "parameter-links.apply",
          { readingId },
          target(),
          { work: { key, revision } },
          "human",
        );
        actionResult(row);
      },
    }),
    [latest, key, target],
  );

  return (
    <ParameterLinksWorkspace
      documentAddress={(ref?.openId ?? "") as import("@pe/agent-contracts").Address}
      route={route}
      connected={route.connected && bridgeConnected}
      ports={ports}
    />
  );
}

export function ParameterLinksWorkspace({
  documentAddress,
  route,
  connected,
  ports,
  fieldOptionsEnabled = true,
}: {
  documentAddress: import("@pe/agent-contracts").Address;
  route: RouteStateHandle<ParameterLinksDocument>;
  connected: boolean | null;
  ports?: RouteHostPorts;
  fieldOptionsEnabled?: boolean;
}) {
  const document = route.slice;
  const savedDraft = document?.draft ?? null;
  const reading = ports?.reading ?? null;
  const evaluation = reading?.evaluated ? (reading.evaluation ?? null) : null;
  const status = reading?.status ?? null;

  const [rightOpen, setRightOpen] = useState(true);
  const busy = route.busy;
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
  const applyReady = refusal == null && ports != null && ports.readingId != null;

  const onDraftChange = useCallback(
    (next: ParameterLinkProfile) => {
      setSaveConflict(null);
      setDraftBasis((previous) => previous ?? route.revision);
      setBuffer(next);
    },
    [route.revision],
  );

  /** Persist the buffer onto the shared document against the revision it was edited from. */
  const saveDraft = useCallback(
    async (profile: ParameterLinkProfile): Promise<boolean> => {
      const result = await route.apply(
        [{ path: ["draft"], value: profile }],
        draftBasis ?? undefined,
      );
      if (!result.ok) {
        // The edit is kept, not discarded: a refused CAS means someone else wrote first.
        setSaveConflict(result.error);
        return false;
      }
      setSaveConflict(null);
      setBuffer(null);
      setDraftBasis(null);
      return true;
    },
    [route.apply, draftBasis],
  );

  const runCommand = useCallback(
    async (name: CommandName) => {
      if (!ports) return;
      // Preview evaluates what the document holds, so the buffer must land first — the count
      // the human approves is then an evaluation of exactly the bytes Apply will send.
      if (name === "preview" && hasUnsavedEdits && editing && !(await saveDraft(editing))) return;
      await ports.read(name === "preview");
    },
    [ports, editing, hasUnsavedEdits, saveDraft],
  );

  const runApply = useCallback(async () => {
    if (!ports?.readingId || route.revision == null) return;
    await ports.apply(route.revision, ports.readingId);
    setWriteReason(""); // the write landed; the strip disarms
  }, [ports, route.revision]);

  /**
   * THE ARMING STRIP'S STATE (fit reviews, ruled 2026-08-16): the preview→stale→apply gate IS the
   * arming lifecycle, so it maps onto the
   * strip's own phases instead of hiding in a hover title —
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
          onReplan: () => void runCommand("preview"),
        };

  return (
    <main className="flex h-screen flex-col overflow-hidden">
      <AddressingBar
        name="parameter links"
        sentence={
          <span className="flex items-center gap-2">
            <span title="bound Revit document">{documentAddress}</span>
            {/* The write's safety model lives ON the arming strip below (its one home) — this
                tip only orients. */}
            <HelpTip>
              Cross-element parameter links: pea and you co-edit one draft profile of link
              definitions + assignments. Preview projects the draft's target writes; the arming
              strip is where an apply is armed and committed.
            </HelpTip>
          </span>
        }
        facts={
          <>
            <FactChip
              tone={connected ? "meta" : "caution"}
              title={
                connected
                  ? "route document and host bridge are connected"
                  : "route document or host bridge is disconnected — commands will fail until it returns"
              }
            >
              {connected ? "host · connected" : "host · disconnected"}
            </FactChip>
            {editing && (
              <FactChip title="definitions · assignments in the profile being edited">
                {editing.definitions.length} def · {editing.assignments.length} asn
              </FactChip>
            )}
            {saveConflict && (
              <FactChip
                tone="caution"
                title="the shared document moved while you were editing — your edit is kept, not overwritten"
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
            {route.peaActive && (
              <FactChip tone="pea" title="pea is editing the shared document right now">
                pea · working
              </FactChip>
            )}
          </>
        }
        // The page-blast verb slot is deliberately EMPTY: apply lives on the ArmingStrip in
        // the draft column, because the gate's whole safety model (plan freshness · reason ·
        // refusal) is the strip's payload and a second apply here would be a parallel path.
      />

      <OutcomeStrip failure={route.failure} />

      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 overflow-y-auto px-5 py-4">
          {!route.hydrated ? (
            <OutcomeLine kind="busy" label="hydrating route state" />
          ) : (
            <>
              <ActionGroup title="draft" radius="shared document · revit read">
                <ActionButton
                  label="refresh"
                  icon={RefreshCw}
                  busy={busy === "refresh"}
                  disabled={busy != null}
                  onClick={() => void runCommand("refresh")}
                  reason="Re-read the stored profile, shared draft, and evaluation from the host"
                />
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
                <ActionButton
                  label="preview"
                  icon={Eye}
                  busy={busy === "preview"}
                  disabled={busy != null || !editing}
                  onClick={() => void runCommand("preview")}
                  reason={
                    editing
                      ? "Evaluate the draft against Revit and project its target writes — writes nothing"
                      : "no profile to preview — add a definition first"
                  }
                />
              </ActionGroup>
              {/* The preview→stale→apply gate, ON the surface. Refused = the plan is stale
                  (re-plan runs preview); arming =
                  the reason input is the last gate before the one commit. */}
              {editing != null ? (
                <ArmingStrip
                  verb="apply"
                  target={documentAddress}
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
              <ProfileEditor
                profile={editing}
                disabled={busy != null || route.peaActive}
                fieldOptionsEnabled={fieldOptionsEnabled}
                onChange={onDraftChange}
              />
            </>
          )}
        </div>

        <SidePane
          side="right"
          storageKey="pe.parameterLinks.evalPane"
          open={rightOpen}
          onOpenChange={setRightOpen}
          minWidth={340}
          defaultWidth={520}
          maxWidth={760}
          header={<span>Evaluation</span>}
        >
          <div className="flex h-full flex-col gap-4 px-4 py-3">
            <RuntimeStatusBar status={status} appliedWriteCount={reading?.appliedWriteCount ?? 0} />
            <div className="min-h-0 flex-1 overflow-y-auto">
              <EvaluationView evaluation={evaluation} />
            </div>
          </div>
        </SidePane>
      </div>
    </main>
  );
}
