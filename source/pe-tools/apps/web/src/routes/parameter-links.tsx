import { createFileRoute } from "@tanstack/react-router";
import { Check, Eye, RefreshCw, Save, Sparkles } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ParameterLinkProfile } from "@pe/agent-contracts";
import { parameterLinksRouteState } from "@pe/agent-contracts";

import { Button } from "#/components/ui/button";
import { SidePane } from "#/components/ui/side-pane";
import { useHostStatusQuery } from "#/host/queries";
import { EvaluationView, RuntimeStatusBar } from "#/parameter-links/Evaluation";
import { ProfileEditor } from "#/parameter-links/ProfileEditor";
import { canApply, errorIssueCount, isDraftDirty, sameProfile } from "#/parameter-links/model";
import { useRouteState } from "#/workbench/route-state";
import { RouteWorkspaceShell } from "#/workbench/route-workspace-shell";

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

  const [rightOpen, setRightOpen] = useState(true);
  const [busy, setBusy] = useState<CommandName | "save" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
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
    setMessage(null);
  }, []);

  /** Persist the local draft to the shared document (human actor, unmasked). */
  const saveDraft = useCallback(
    async (profile: ParameterLinkProfile): Promise<boolean> => {
      const result = await route.apply([{ path: ["draftProfile"], value: profile }]);
      if (!result.ok) {
        setMessage(result.error ?? result.hint ?? "Saving the draft failed.");
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
      setMessage(null);
      try {
        if (name === "refresh") {
          const result = await route.command("refresh", {});
          if (!result.ok) setMessage(result.error ?? result.hint ?? "Refresh failed.");
          return;
        }
        // preview/apply need the reviewed profile persisted first (the command guard
        // rejects a profile that doesn't equal the stored draftProfile).
        const profile = name === "apply" ? previewed : editing;
        if (!profile) return;
        if (name === "preview" && hasUnsavedEdits && !(await saveDraft(profile))) return;
        const result = await route.command(name, { profile });
        if (!result.ok) {
          setMessage(result.error ?? result.hint ?? `${name} failed.`);
          return;
        }
        if (name === "preview") setPreviewed(profile);
        else setPreviewed(null);
      } catch (caught) {
        setMessage(caught instanceof Error ? caught.message : `${name} failed.`);
      } finally {
        setBusy(null);
      }
    },
    [route.command, previewed, editing, hasUnsavedEdits, saveDraft],
  );

  const subline = useMemo(() => {
    if (message) return { text: message, tone: "clay" as const };
    if (errorCount > 0)
      return {
        text: `${errorCount} blocking error${errorCount === 1 ? "" : "s"} — resolve before applying`,
        tone: "fail" as const,
      };
    if (applyReady)
      return { text: "Previewed and clean — ready to apply.", tone: "green" as const };
    if (hasUnsavedEdits) return { text: "Unsaved draft edits.", tone: "clay" as const };
    if (editing && !reviewed)
      return {
        // Apply only trusts a preview run from this pane; an agent's preview renders its
        // evaluation but deliberately does not arm the human's Apply (defense in depth on
        // top of the server-side draft-match guard).
        text:
          evaluation != null
            ? "Pea's preview is shown — run Preview to verify it yourself and enable Apply."
            : "Preview the draft before applying.",
        tone: "lichen" as const,
      };
    return null;
  }, [message, errorCount, applyReady, hasUnsavedEdits, editing, reviewed, evaluation]);

  return (
    <RouteWorkspaceShell
      title="Parameter Links"
      connected={route.connected && bridgeConnected}
      binding={document?.binding}
      subtitle={
        <span className="text-xs text-muted-foreground">
          {editing
            ? `${editing.definitions.length} definition${editing.definitions.length === 1 ? "" : "s"} · ${editing.assignments.length} assignment${editing.assignments.length === 1 ? "" : "s"}`
            : "no profile"}
          {draftDirty ? " · draft differs from stored" : ""}
        </span>
      }
      actions={
        <>
          {route.peaActive && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--pea-tint)] px-2 py-0.5 text-xs font-medium text-[var(--cat-green)]">
              <Sparkles className="size-3 animate-pulse" />
              pea is working…
            </span>
          )}

          <Button
            variant="outline"
            size="sm"
            disabled={busy != null}
            onClick={() => void runCommand("refresh")}
          >
            <RefreshCw className={busy === "refresh" ? "animate-spin" : ""} />
            Refresh
          </Button>

          <Button
            variant="outline"
            size="sm"
            disabled={busy != null || !editing || !hasUnsavedEdits}
            onClick={() => editing && void saveDraft(editing)}
            title="Save draft edits to the shared document"
          >
            <Save />
            Save draft
          </Button>

          <Button
            variant="outline"
            size="sm"
            disabled={busy != null || !editing}
            onClick={() => void runCommand("preview")}
          >
            <Eye className={busy === "preview" ? "animate-pulse" : ""} />
            Preview
          </Button>

          <Button
            size="sm"
            disabled={busy != null || !applyReady}
            onClick={() => void runCommand("apply")}
            title={
              applyReady
                ? undefined
                : errorCount > 0
                  ? "Resolve blocking errors first"
                  : evaluation != null
                    ? "Pea previewed this draft — run Preview yourself to enable Apply"
                    : "Preview the current draft first"
            }
            className="bg-[var(--cat-green)] text-white hover:bg-[var(--cat-green)]/85 disabled:opacity-50"
          >
            <Check className={busy === "apply" ? "animate-pulse" : ""} />
            Apply
          </Button>
        </>
      }
      error={message ? null : route.error}
      subline={
        subline ? (
          <span
            className={
              subline.tone === "fail"
                ? "text-[var(--fail)]"
                : subline.tone === "green"
                  ? "text-[var(--cat-green)]"
                  : subline.tone === "clay"
                    ? "text-[var(--cat-clay)]"
                    : "text-[var(--lichen)]"
            }
          >
            {subline.text}
          </span>
        ) : null
      }
    >
      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 overflow-y-auto px-5 py-4">
          {!route.hydrated ? (
            <p className="py-10 text-center text-xs text-[var(--lichen)]">Loading route state…</p>
          ) : (
            <ProfileEditor
              profile={editing}
              disabled={busy != null || route.peaActive}
              target={document?.binding.target ?? undefined}
              onChange={onDraftChange}
            />
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
          header={<span className="text-sm font-semibold">Evaluation</span>}
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
    </RouteWorkspaceShell>
  );
}
