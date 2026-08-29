import type { Verdict } from "#/components/master-table/model";
import { type WorldFacts } from "#/host/fleet";
import { type WorldStart } from "#/targeting/world";
import { RouteDocument } from "#/workbench/route-document";
import { AddressedInstancesPage } from "#/instances/workspace";
import { Input } from "#/components/lang/input";

export const YEARS = ["24", "25", "26"];

export function parseUtc(iso: string | null | undefined): number | undefined {
  if (!iso) return undefined;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? undefined : ms;
}

export function yearLabel(year: string | undefined): string | undefined {
  if (!year) return undefined;
  return year.length === 2 ? `20${year}` : year;
}

export function worldSub(world: WorldFacts): string {
  return [world.lane, yearLabel(world.year), world.pid ? `pid ${world.pid}` : undefined]
    .filter(Boolean)
    .join(" · ");
}

export function phaseVerdict(world: WorldFacts): Verdict {
  const state = world.row?.state;
  if (world.phase === "ready")
    return {
      word: state ?? "ready",
      tone: "done",
      note: world.session
        ? "The bridge holds an open connection to this world."
        : (world.row?.detail ?? "pe-revit verified this process identity."),
    };
  if (world.phase === "booting")
    return {
      word: state ?? "booting",
      tone: "ink",
      note: world.row?.detail ?? "The registry says this process is in its boot window.",
    };
  if (world.phase === "unresponsive")
    return {
      word: state ?? "unresponsive",
      tone: "caution",
      note: world.row?.detail ?? "The process exists but stopped answering.",
    };
  return {
    word: state ?? "gone",
    tone: "mute",
    dim: true,
    note: world.row?.detail ?? "pe-revit says this world is gone.",
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

export function InstancesPage() {
  return <RouteDocument>{(at) => <AddressedInstancesPage documentAddress={at} />}</RouteDocument>;
}
