import { createFileRoute } from "@tanstack/react-router";
import { Check, Eye, RefreshCw, Save } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import type { ParameterLinkProfile } from "@pe/agent-contracts";
import { parameterLinksRouteState } from "@pe/agent-contracts";

import { AddressingBar } from "#/components/lang/addressing-bar";
import { FactChip } from "#/components/lang/chip";
import { HelpTip } from "#/components/lang/help";
import { OutcomeLine, type OutcomeKind } from "#/components/lang/outcome";
import { Verb, VerbGroup } from "#/components/lang/verb";
import { SidePane } from "#/components/ui/side-pane";
import { useHostStatusQuery } from "#/host/queries";
import { EvaluationView, RuntimeStatusBar } from "#/parameter-links/Evaluation";
import { ProfileEditor } from "#/parameter-links/ProfileEditor";
import { canApply, errorIssueCount, isDraftDirty, sameProfile } from "#/parameter-links/model";
import { useRouteState } from "#/workbench/route-state";

/**
 * /parameter-links — the route-native workspace for cross-element parameter links.
 * pea and the engineer co-edit ONE `route:parameter-links` document: a `draftProfile`
 * of link definitions + assignments, evaluated against Revit into projected target
 * writes. The draft is edited locally (plain forms) and saved to the shared document;
 * Preview evaluates it without writing; Apply (human-only, freshness-gated) stores it and
 * reconciles the changed target parameters. Mirrors the /family-types route architecture.
 */
export const Route = createFileRoute("/parameter-links")({ component: ParameterLinksRoute });

type CommandName = "refresh" | "preview" | "apply";

function ParameterLinksRoute() {
  const route = useRouteState(parameterLinksRouteState);
  const document = route.slice;
  const stored = document?.profile ?? null;
  const remoteDraft = document?.draftProfile ?? null;
  const evaluation = document?.evaluation ?? null;
  const status = document?.status ?? null;

  const bridgeConnected = useHostStatusQuery().data?.bridgeIsConnected ?? false;
  const connected = route.connected && bridgeConnected;

  const [rightOpen, setRightOpen] = useState(true);
  const [busy, setBusy] = useState<CommandName | "save" | null>(null);
  const [outcome, setOutcome] = useState<{ kind: OutcomeKind; text: string } | null>(null);
  const [previewed, setPreviewed] = useState<ParameterLinkProfile | null>(null);

  /**
   * The draft is edited locally to keep inputs stable; remote changes (pea, another tab,
   * a refresh) are adopted only when there are no unsaved local edits. `syncedRef` holds
   * the JSON of the remote draft we last reconciled from — the seam that lets both a live
   * co-editor and a stable text cursor coexist. (Friction: there is no shared primitive
   * for this; family-types dodges it by writing discrete cell values, not a nested doc.)
   */
  const [localDraft, setLocalDraft] = useState<ParameterLinkProfile | null>(remoteDraft);
  const syncedRef = useRef<string | null>(null);

  useEffect(() => {
    const remoteJson = JSON.stringify(remoteDraft ?? null);
    if (remoteJson === syncedRef.current) return; // remote unchanged since last reconcile
    const localJson = JSON.stringify(localDraft ?? null);
    const noUnsavedEdits = localJson === syncedRef.current || localJson === remoteJson;
    if (localDraft == null || noUnsavedEdits) {
      if (localJson !== remoteJson) setLocalDraft(remoteDraft ?? null);
      syncedRef.current = remoteJson;
    }
  }, [remoteDraft, localDraft]);

  const editing = localDraft ?? stored;
  const hasUnsavedEdits = !sameProfile(localDraft, remoteDraft) && localDraft != null;
  const errorCount = errorIssueCount(evaluation);
  const reviewed = editing != null && sameProfile(editing, previewed);
  const applyReady = canApply({ editing, previewed, errorCount });
  const draftDirty = isDraftDirty(document);

  // Editing invalidates a prior preview — the freshness gate re-locks Apply.
  const onDraftChange = useCallback((next: ParameterLinkProfile) => {
    setLocalDraft(next);
    setPreviewed((prev) => (sameProfile(prev, next) ? prev : null));
    setOutcome(null);
  }, []);

  /** Persist the local draft to the shared document (human actor, unmasked). */
  const saveDraft = useCallback(
    async (profile: ParameterLinkProfile): Promise<boolean> => {
      const result = await route.apply([{ path: ["draftProfile"], value: profile }]);
      if (!result.ok) {
        setOutcome({
          kind: "error",
          text: result.error ?? result.hint ?? "saving the draft failed",
        });
        return false;
      }
      syncedRef.current = JSON.stringify(profile);
      return true;
    },
    [route.apply],
  );

  const runCommand = useCallback(
    async (name: CommandName) => {
      setBusy(name);
      setOutcome(null);
      try {
        if (name === "refresh") {
          const result = await route.command("refresh", {});
          if (!result.ok)
            setOutcome({ kind: "error", text: result.error ?? result.hint ?? "refresh failed" });
          return;
        }
        // preview/apply need the reviewed profile persisted first (the command guard
        // rejects a profile that doesn't equal the stored draftProfile).
        const profile = name === "apply" ? previewed : editing;
        if (!profile) return;
        if (name === "preview" && hasUnsavedEdits && !(await saveDraft(profile))) return;
        const result = await route.command(name, { profile });
        if (!result.ok) {
          // An op-level rejection is the host refusing the plan, not a broken bridge.
          setOutcome({
            kind: "refused",
            text: result.error ?? result.hint ?? `${name} refused`,
          });
          return;
        }
        if (name === "preview") {
          setPreviewed(profile);
          setOutcome({ kind: "receipt", text: "preview landed — projection is current" });
        } else {
          setPreviewed(null);
          setOutcome({ kind: "receipt", text: "applied — target parameters reconciled" });
        }
      } catch (caught) {
        setOutcome({
          kind: "error",
          text: caught instanceof Error ? caught.message : `${name} failed`,
        });
      } finally {
        setBusy(null);
      }
    },
    [route.command, previewed, editing, hasUnsavedEdits, saveDraft],
  );

  const applyReason = applyReady
    ? "Store the previewed profile and reconcile the changed target parameters in Revit"
    : !editing
      ? "no profile yet — add a definition first"
      : errorCount > 0
        ? `resolve ${errorCount} blocking error${errorCount === 1 ? "" : "s"} first`
        : evaluation != null && !reviewed
          ? "pea's preview is shown — run Preview yourself to verify it and arm Apply"
          : "preview the current draft first — Apply only trusts a preview run from this pane";

  return (
    <main className="flex h-screen flex-col overflow-hidden bg-background">
      <AddressingBar
        name="PARAMETER LINKS"
        sentence={
          <span className="flex items-center gap-2">
            <span
              className="t-value face-mono text-foreground"
              title={
                document?.binding.target
                  ? `bound to ${document.binding.target}`
                  : "no target document bound"
              }
            >
              {document?.binding.target ?? "unbound"}
            </span>
            <HelpTip>
              Cross-element parameter links: pea and you co-edit one draft profile of link
              definitions + assignments. Preview evaluates it against Revit into projected target
              writes without writing anything; Apply is human-only and trusts only a preview run
              from this pane.
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
        verb={
          <Verb
            tone="commit"
            label="apply"
            icon={Check}
            busy={busy === "apply"}
            disabled={busy != null || !applyReady}
            onClick={() => void runCommand("apply")}
            reason={applyReason}
          />
        }
      />

      {(busy || outcome || route.error) && (
        <div className="shrink-0 border-b border-border px-4 py-0.5">
          {busy ? (
            <OutcomeLine kind="busy" label={busy} />
          ) : outcome ? (
            <OutcomeLine kind={outcome.kind} label={outcome.text} />
          ) : route.error ? (
            <OutcomeLine kind="error" label={route.error} />
          ) : null}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 overflow-y-auto px-5 py-4">
          {!route.hydrated ? (
            <OutcomeLine kind="busy" label="hydrating route state" className="py-10" />
          ) : (
            <>
              <VerbGroup title="draft" radius="shared document · revit read" className="mb-4">
                <Verb
                  label="refresh"
                  icon={RefreshCw}
                  busy={busy === "refresh"}
                  disabled={busy != null}
                  onClick={() => void runCommand("refresh")}
                  reason="Re-read the stored profile, shared draft, and evaluation from the host"
                />
                <Verb
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
                <Verb
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
              </VerbGroup>
              <ProfileEditor
                profile={editing}
                disabled={busy != null || route.peaActive}
                target={document?.binding.target ?? undefined}
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
          header={<span className="t-label t-upper text-muted-foreground">Evaluation</span>}
        >
          <div className="flex h-full flex-col gap-4 px-4 py-3">
            <RuntimeStatusBar
              status={status}
              appliedWriteCount={document?.appliedWriteCount ?? 0}
            />
            <div className="min-h-0 flex-1 overflow-y-auto">
              <EvaluationView evaluation={evaluation} />
            </div>
          </div>
        </SidePane>
      </div>
    </main>
  );
}
