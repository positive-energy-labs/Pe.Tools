import type { RecentDocument } from "@pe/host-contracts/pe-revit-contract";
import type { Verdict } from "#/components/master-table/model";
import { sessionKey, type Inventory, useFleet } from "#/readings";
import { Surface } from "#/components/lang/surface";
import { useSessionEvents } from "#/host/world-log";
import { InstancesCluster } from "#/instances/cluster";
import { instancesManifest } from "#/instances/manifest";
import { RouteShell } from "#/route";
import { Ladder } from "#/route/ladder";
import { Situation } from "#/route/situation";
import { SituationCell } from "#/route/situation-marks";
import { useRoute } from "#/route/use-route";

export type InstancesFleet = ReturnType<typeof useFleet>;

export const YEARS = ["24", "25", "26"];

/** What a world is CALLED: the SDK session id when pe-revit knows it, else its own identity. */
export const sessionLabel = (world: Pick<Inventory, "custody" | "id" | "pid" | "session">) =>
  world.session?.sdkSessionId ??
  (world.custody === "observed" ? `Revit ${world.pid ?? world.id}` : world.id);

/** A world's `?target`: the session key the host matches a pin against, else its label. */
export const sessionTarget = (world: Inventory): string =>
  world.session ? sessionKey(world.session) : sessionLabel(world);

export const findSession = (worlds: readonly Inventory[], target: string) =>
  worlds.find((world) => sessionTarget(world) === target);

/**
 * The SDK's `--doc` grammar for one MRU row: the local path, or the exact `cld://` identity when
 * Revit.ini carries it. Never a bare title when identity exists — substring matching refused
 * `…ProjectA_R25` because the title prefixes its detached clones (field, 2026-09-01).
 */
export const docSelectorOf = (recent: RecentDocument): string =>
  !recent.isCloud
    ? recent.path
    : recent.region && recent.projectGuid && recent.modelGuid
      ? `cld://${recent.region}/{${recent.projectGuid}}p/{${recent.modelGuid}}${encodeURIComponent(recent.title)}.rvt`
      : `recent:${recent.title}`;

export function parseUtc(iso: string | null | undefined): number | undefined {
  if (!iso) return undefined;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? undefined : ms;
}

export function sessionSub(world: Inventory): string {
  return [world.lane, world.row?.year, world.pid ? `pid ${world.pid}` : undefined]
    .filter(Boolean)
    .join(" · ");
}

const PHASE_VERDICT = {
  booting: { word: "booting", tone: "ink" },
  failed: { word: "failed", tone: "alarm" },
  unattached: { word: "not attached", tone: "caution" },
  gone: { word: "gone", tone: "mute", dim: true },
  ready: { word: "ready", tone: "done" },
  unresponsive: { word: "unresponsive", tone: "caution" },
} satisfies Record<Inventory["phase"], Omit<Verdict, "note">>;

export function phaseVerdict(world: Inventory): Verdict {
  return {
    ...PHASE_VERDICT[world.phase],
    note:
      world.phase === "ready" && world.session
        ? "The bridge holds an open connection to this world."
        : world.detail,
  };
}

export function custodyVerdict(world: Inventory): Verdict {
  return world.custody === "controlled"
    ? {
        word: "controlled",
        tone: "done",
        note: "pe-revit holds this session's receipt and owns its lifecycle.",
      }
    : {
        word: "observed",
        tone: "mute",
        note: "pe-revit holds no receipt: status and document reads only.",
      };
}

/**
 * /instances: the Situation over the portable `InstancesCluster`. The sentence names the picked
 * session (the same pick a fleet row makes); the refresh verb is the manifest's; the one log is
 * the handle's, where lifecycle receipts, refusals and bridge-observed world events land (N3).
 */
export function InstancesPage({
  target,
  setTarget,
}: {
  target: string;
  setTarget: (target: string) => void;
}) {
  const handle = useRoute(instancesManifest, { work: "instances" });
  // The SDK's default census is the live set; the graveyard (`--all`) is not a picker.
  const fleet = useFleet();
  useSessionEvents(fleet.sessions, (event) =>
    handle.note(event.label, "bridge-observed world event", event.kind === "gap", undefined, {
      at: event.atMs,
    }),
  );
  const picked = findSession(fleet.worlds, target);
  const count = fleet.worlds.length;
  return (
    <Surface
      head={
        <RouteShell
          manifest={instancesManifest}
          handle={handle}
          situation={
            <Situation
              handle={handle}
              target={{ session: picked ? sessionLabel(picked) : null, document: null }}
              sentence={
                <>
                  {count} session{count === 1 ? "" : "s"} in the census; picked{" "}
                  <SituationCell io="r" empty={!picked}>
                    <Ladder
                      levels={[
                        {
                          key: "session",
                          label: picked ? sessionLabel(picked) : null,
                          placeholder: "choose a session",
                          options: fleet.worlds.map((world) => ({
                            id: sessionTarget(world),
                            label: sessionLabel(world),
                            sub: sessionSub(world),
                          })),
                          note: fleet.isLoading ? "reading the fleet" : "no live sessions",
                          picked: (id: string) => id === target,
                          pick: setTarget,
                        },
                      ]}
                    />
                  </SituationCell>
                  .
                </>
              }
            />
          }
        />
      }
    >
      <InstancesCluster handle={handle} target={target} setTarget={setTarget} fleet={fleet} />
    </Surface>
  );
}
