import type { Verdict } from "#/components/master-table/model";
import { type WorldFacts, useFleet } from "#/host/fleet";
import { type WorldStart } from "#/targeting/world";
import { InstancesWorkspace } from "#/instances/workspace";
import { Input } from "#/components/lang/input";
import { OutcomeLine } from "#/components/lang/outcome";

export const YEARS = ["24", "25", "26"];

export function parseUtc(iso: string | null | undefined): number | undefined {
  if (!iso) return undefined;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? undefined : ms;
}

export function worldSub(world: WorldFacts): string {
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
} satisfies Record<WorldFacts["phase"], Omit<Verdict, "note">>;

export function phaseVerdict(world: WorldFacts): Verdict {
  return {
    ...PHASE_VERDICT[world.phase],
    note:
      world.phase === "ready" && world.session
        ? "The bridge holds an open connection to this world."
        : world.detail,
  };
}

export function custodyVerdict(world: WorldFacts): Verdict {
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

export function StartFields({
  year,
  lane,
  doc,
  disabled,
  setYear,
  setLane,
  setDoc,
}: {
  year: string;
  lane: WorldStart["lane"];
  doc: string;
  disabled: boolean;
  setYear: (year: string) => void;
  setLane: (lane: WorldStart["lane"]) => void;
  setDoc: (doc: string) => void;
}) {
  return (
    <span className="flex items-center gap-2 [&>input]:w-44">
      <select
        aria-label="Revit year"
        value={year}
        onChange={(event) => setYear(event.target.value)}
        disabled={disabled}
        className="px-1 py-0.5"
      >
        {YEARS.map((value) => (
          <option key={value} value={value}>
            20{value}
          </option>
        ))}
      </select>
      <select
        aria-label="payload lane"
        value={lane}
        onChange={(event) => setLane(event.target.value as WorldStart["lane"])}
        disabled={disabled}
        className="px-1 py-0.5"
      >
        <option value="installed">installed</option>
        <option value="dev">dev</option>
      </select>
      <Input
        aria-label="document"
        value={doc}
        onChange={(event) => setDoc(event.target.value)}
        disabled={disabled}
        placeholder="document (optional)"
      />
    </span>
  );
}

export function InstancesPage({
  target,
  setTarget,
}: {
  target: string;
  setTarget: (target: string) => void;
}) {
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
      <InstancesWorkspace target={target} setTarget={setTarget} fleet={fleet} />
    </>
  );
}
