/**
 * THE INSTRUMENT CLUSTER — route-head chrome (ruled 2026-09-01: "I also wanted the instrument
 * cluster there too"). Host lamp · release · theme as three FIELDS of one framed strip, not three
 * loose controls: law 7 — the frame says a machine operates this, and all three fields report
 * machine state. `RouteHead` renders it on every route, so this is targeting-kit chrome and no
 * longer front-door furniture.
 *
 * OWED (standing from the L3 round, raised by the 2026-09-01 ruling): the lamp's private 5s poll
 * duplicates a fact `targeting/world.ts` already reads through `host/fleet`. It collapses into
 * targeting's world facts; until then the poll is the only thing that keeps the lamp from going
 * stale, because canon `usePeInfo` holds `/host/status` at `staleTime: Infinity`.
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import { DownloadCloud } from "lucide-react";

import { ArtifactFrame } from "#/components/lang/artifact-frame";
import { FactChip } from "#/components/lang/chip";
import { OutcomeLine } from "#/components/lang/outcome";
import { ThemeToggle } from "#/components/lang/theme-toggle";
import { Verb } from "#/components/lang/verb";
import { ProtoTutorialButton } from "#/components/proto-tutorial/overlay";
import { StateDot } from "#/components/master-table/cells";
import { fetchPeInfo } from "#/host/info";
import {
  acknowledgeUpdate,
  readInstallStatus,
  readUpdateAvailability,
  waitForVersionChange,
} from "#/targeting/host";
import { resolveWorkbenchConfig } from "#/workbench/config";

/** Acknowledge the update before the versioned host restarts, then poll the receipt until the
 * replacement host proves the new release. The Revit add-in remains staged until Revit restarts. */
function UpdateButton({ enabled }: { enabled: boolean }) {
  const installed = useQuery({
    queryKey: ["host-install"],
    queryFn: readInstallStatus,
    enabled,
  });
  const available = useQuery({
    queryKey: ["host-update"],
    queryFn: readUpdateAvailability,
    enabled,
  });
  const update = useMutation({
    mutationFn: async () => {
      const previousVersion =
        installed.data?.releaseVersion ?? available.data?.installedVersion ?? null;
      if (!previousVersion) throw new Error("Installed version is not available.");
      const body = await acknowledgeUpdate();
      if (body.status === 409 && body.reason === "already-current" && body.installedVersion)
        return { changed: false, releaseVersion: body.installedVersion };
      if (body.status >= 400 || body.accepted !== true)
        throw new Error(body.error ?? `update failed (${body.status})`);
      return { changed: true, releaseVersion: await waitForVersionChange(previousVersion) };
    },
    onSuccess: async () => {
      await Promise.all([installed.refetch(), available.refetch()]);
    },
  });

  return (
    <div className="flex items-center gap-2">
      {installed.data?.releaseVersion && (
        <FactChip title="the host release currently installed as a service">
          v{installed.data.releaseVersion}
        </FactChip>
      )}
      {available.data?.error && <OutcomeLine kind="advisory" label="update check unavailable" />}
      {update.isSuccess &&
        (update.data.changed ? (
          <OutcomeLine
            kind="receipt"
            label={`updated to ${update.data.releaseVersion}`}
            says="staged for the next Revit start; this Revit keeps its loaded version"
          />
        ) : (
          <OutcomeLine
            kind="advisory"
            label={`already on ${update.data.releaseVersion}`}
            says="the latest release is installed"
          />
        ))}
      {update.isError && (
        <OutcomeLine kind="error" label={String(update.error?.message ?? update.error)} />
      )}
      {installed.data?.releaseVersion &&
        (available.data?.updateAvailable || update.isPending) &&
        !update.isSuccess && (
          <Verb
            tone="act"
            label="update"
            icon={DownloadCloud}
            busy={update.isPending}
            disabled={update.isPending}
            onClick={() => update.mutate()}
            reason="Download and install the latest host release — the running Revit keeps its loaded add-in until it restarts"
          />
        )}
    </div>
  );
}

type Lamp = {
  tone: "done" | "alarm" | "mute" | "ink";
  word: string;
  says: string;
  checked: string | null;
};

/**
 * THE SIGNAL: `/host/status` → `bridgeIsConnected` (`host/info.ts`). `capabilities.revit` says
 * whether this Host supports Revit; it does not say whether a bridge is attached. The canon
 * `usePeInfo` holds it at `staleTime: Infinity` — correct for a route gate read once, a LIE for a lamp, which would
 * sit green long after Revit closed. This poll is the lamp's own, at 5s, and it reports the clock
 * time of the answer it is drawing. Unknown is a real state: pending draws `mute`, never green.
 */
function useHostLamp(enabled: boolean): Lamp {
  const info = useQuery({
    queryKey: ["pe-info", resolveWorkbenchConfig().origin],
    queryFn: () => fetchPeInfo(resolveWorkbenchConfig()),
    enabled,
    refetchInterval: 5_000,
    retry: false,
    staleTime: Infinity,
  });
  if (!enabled)
    return {
      tone: "mute",
      word: "fixture",
      says: "literal fixture lane — no host contacted",
      checked: null,
    };
  // A FAILED read is a sounding too, and it carries the same date — `dataUpdatedAt` is 0 while
  // the host is down, which would have left the unreachable lamp with no "as of".
  const at = Math.max(info.dataUpdatedAt, info.errorUpdatedAt);
  const checked = at ? new Date(at).toLocaleTimeString([], { hour12: false }) : null;
  if (info.isPending)
    return { tone: "mute", word: "unknown", says: "asking the host for its capabilities", checked };
  if (info.isError)
    return {
      tone: "alarm",
      word: "unreachable",
      says: `the host did not answer /host/status — ${String(info.error)}`,
      checked,
    };
  if (!info.data.capabilities.revit)
    return {
      tone: "ink",
      word: "no revit",
      says: "the host answers, but it reports no Revit capability — nothing is attached",
      checked,
    };
  if (!info.data.bridgeIsConnected)
    return {
      tone: "ink",
      word: "disconnected",
      says: "the host supports Revit, but no Revit bridge is attached",
      checked,
    };
  return {
    tone: "done",
    word: "connected",
    says: `Revit is attached — host ${info.data.controllerId}`,
    checked,
  };
}

export function InstrumentCluster({ live = true }: { live?: boolean }) {
  const lamp = useHostLamp(live);
  return (
    <ArtifactFrame>
      <span className="flex items-center gap-1.5 px-1">
        <FactChip title={lamp.says}>
          <span className="flex items-center gap-1.5">
            <StateDot tone={lamp.tone} />
            <span>
              host · {lamp.word}
              {lamp.checked ? ` · ${lamp.checked}` : ""}
            </span>
          </span>
        </FactChip>
        <UpdateButton enabled={live} />
        <ProtoTutorialButton />
        <ThemeToggle />
      </span>
    </ArtifactFrame>
  );
}
