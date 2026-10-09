import { DownloadCloud } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useAction, useHostCall } from "#/readings";
import {
  acknowledgeUpdate,
  readInstallStatus,
  readUpdateAvailability,
  waitForVersionChange,
} from "../host/install";
import { ActionButton } from "./lang/action-button";
import { FactChip } from "./lang/chip";
import { OutcomeLine } from "./lang/outcome";

/**
 * The machine's update (host ledger 2026-10-08), read once per app open. Quiet (no Revit, or every
 * one idle with nothing unsaved): apply without asking. Otherwise ask on every open; a dismissal is
 * not remembered. Apply closes every Revit keeping its work, installs, then reopens the documents
 * and this app.
 *
 * Ruled 2026-09-10 (Q3): this is a fact about the MACHINE the app runs on, not about one route,
 * so it lives at the document root and the route shell keeps only the lamp.
 */
export function UpdateButton() {
  const installed = useHostCall(readInstallStatus, ["host-install"]);
  const available = useHostCall(readUpdateAvailability, ["host-update"]);
  const [current, setCurrent] = useState<string | null>(null);
  const update = useAction(async () => {
    const planId = available.data?.planId;
    if (!planId) throw new Error("Read an update plan before applying it.");
    const body = await acknowledgeUpdate(planId);
    if (body.status === 409 && body.reason === "already-current" && body.installedVersion)
      return body.installedVersion;
    if (body.status >= 400 || body.accepted !== true)
      throw new Error(body.error ?? `update failed (${body.status})`);
    // The host exits; its successor (or the reopened app window) proves the new release.
    await waitForVersionChange(available.data?.installedVersion ?? null);
    window.location.reload();
    return null;
  }, setCurrent);
  const offered = available.data?.updateAvailable === true && current === null;
  const quiet = offered && available.data?.quiet === true;
  const started = useRef(false);
  useEffect(() => {
    if (!quiet || started.current) return;
    started.current = true;
    update.mutate(undefined);
  }, [quiet, update]);
  const busy = (available.data?.revits ?? []).filter(
    (revit) => !revit.idle || revit.unknown || revit.documents.some((doc) => doc.isModified),
  );
  return (
    <div className="flex items-center gap-2">
      {installed.data?.releaseVersion && (
        <FactChip title="the release installed on this machine">
          v{installed.data.releaseVersion}
        </FactChip>
      )}
      {available.data?.error && <OutcomeLine kind="advisory" label="update check unavailable" />}
      {current && (
        <OutcomeLine
          kind="advisory"
          label={`already on ${current}`}
          says="the latest release is installed"
        />
      )}
      {update.isPending && (
        <OutcomeLine
          kind="busy"
          label={`updating to ${available.data?.latestVersion}`}
          says="Revit closes with its work saved, then the app and your documents reopen"
        />
      )}
      {update.error && <OutcomeLine kind="error" label={update.error.message} />}
      {offered && !quiet && !update.isPending && (
        <>
          <OutcomeLine
            kind="advisory"
            label={`${available.data?.latestVersion} is ready`}
            says={busy
              .map((revit) => {
                const modified = revit.documents.filter((doc) => doc.isModified);
                return revit.unknown
                  ? `Revit ${revit.year} could not be inspected`
                  : modified.length
                    ? `Revit ${revit.year} saves ${modified.map((doc) => doc.title ?? doc.path ?? "untitled").join(", ")} first`
                    : `Revit ${revit.year} is busy`;
              })
              .concat((available.data?.blockers ?? []).map((blocker) => blocker.detail))
              .join("; ")}
          />
          <ActionButton
            tone="act"
            label="update"
            icon={DownloadCloud}
            onClick={() => update.mutate(undefined)}
            reason="Close every Revit (saving its work), install the new release, then reopen your documents and this app"
          />
        </>
      )}
    </div>
  );
}
