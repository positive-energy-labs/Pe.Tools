import type { RecentDocument } from "@pe/host-contracts/pe-revit-contract";
import type { Verdict } from "#/components/master-table/model";
import { sessionKey, type Inventory, useFleet } from "#/readings";
import { InstancesWorkspace } from "#/instances/workspace";
import { OutcomeLine } from "#/components/lang/outcome";
import { useRoute } from "#/route/use-route";
import { instancesManifest } from "#/instances/manifest";

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

export function InstancesPage({
  target,
  setTarget,
  shell = true,
}: {
  target: string;
  setTarget: (target: string) => void;
  /** false when another route mounts this page as its empty body: that route already owns the shell. */
  shell?: boolean;
}) {
  const handle = useRoute(instancesManifest, { work: "instances" });
  const fleet = useFleet({ all: true });
  const censusExceptions = fleet.unreadableReceipts
    .map((receipt) => `receipt ${receipt.id} · ${receipt.receiptPath} · ${receipt.detail}`)
    .concat(
      fleet.processReadErrors.map((error) => `process ${error.candidatePid} · ${error.detail}`),
    );
  return (
    <>
      {censusExceptions.length ? (
        <aside aria-label="census exceptions" className="mx-auto mt-4 max-w-6xl px-3 py-2">
          <OutcomeLine
            kind="advisory"
            label={`census exceptions${fleet.registryRoot ? ` · registry ${fleet.registryRoot}` : ""}`}
            says={censusExceptions.join(" · ")}
          />
        </aside>
      ) : null}
      <InstancesWorkspace
        handle={handle}
        target={target}
        setTarget={setTarget}
        fleet={fleet}
        shell={shell}
      />
    </>
  );
}
