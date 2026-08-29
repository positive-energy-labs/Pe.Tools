import { token } from "#/lib/token";
import { useLayoutEffect, useRef, useState } from "react";
import { fmtNum } from "#/components/master-table/model";
import { FactChip as Chip } from "#/components/lang/chip";
import { type StagedItem } from "../feedback/staging";
import { HELD_HATCH, type ResidueKind } from "../palette";
import { type Partiality, type ZoneRecord } from "../world";

// the export must not dress a disposition-unknown room as accepted either (SHIMS.md #3).

export const UNKNOWN_TITLE =
  "Disposition unknown — this package predates the persisted ROOM disposition column. " +
  "Not drawn as accepted; re-run the harness for a package that says which rooms it accepted.";

export const PX_PER_FT = 4;

export const fmtSqft = (v: number) => `${Math.round(v).toLocaleString()} sf`;

export const fmtPct = (v: number) => `${Math.round(v * 100)}%`;

export function fmtTime(utc: string): string {
  const d = new Date(utc);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export const zoneShort = (name: string) => (name.includes("#") ? `#${name.split("#")[1]}` : name);

export function adaptedKnobs(zone: ZoneRecord): [string, string][] {
  return Object.entries(zone.adaptedKnobs ?? {});
}

export function topRejections(zone: ZoneRecord, n = 3): [string, number][] {
  return Object.entries(zone.Rejections)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n);
}

export const partialTitle = (zone: string) =>
  `Partial run — the harness executed under PE_TAKEOFF_ZONE, so this package holds only zones ` +
  `matching "${zone}". Its board and scores cover that slice, not the full baseline scope; ` +
  `pairing it against a full run measures the filter, not the knobs.`;

export const possiblyPartialTitle = (zones: number, modal: number) =>
  `Possibly partial — pre-field package: it predates the persisted zoneFilter field, so it ` +
  `cannot say whether it ran zone-filtered, and it holds ${zones} zones where the pool's modal ` +
  `full run holds ${modal} (run 20260817-161144 lied exactly this way). Trust it as a baseline ` +
  `accordingly.`;

export function PartialityChip(props: {
  part: Partiality | null;
  prefix?: string;
  compact?: boolean;
}) {
  const { part, prefix = "", compact = false } = props;
  if (!part || part.kind === "full") return null;
  if (part.kind === "partial") {
    return (
      <Chip tone="caution" title={partialTitle(part.zone)}>
        {prefix}
        {compact
          ? `partial · ${zoneShort(part.zone)}`
          : `partial run — zone-filtered: ${part.zone}`}
      </Chip>
    );
  }
  return (
    <Chip tone="caution" dashed title={possiblyPartialTitle(part.zones, part.modal)}>
      {prefix}
      {compact
        ? `partial? ${part.zones}/${part.modal}`
        : `possibly partial — pre-field package (${part.zones}/${part.modal} zones)`}
    </Chip>
  );
}

export function pairingCaveat(a: Partiality, b: Partiality): string | null {
  const aFull = a.kind === "full";
  const bFull = b.kind === "full";
  if (aFull && bFull) return null;
  if (a.kind === "partial" && b.kind === "partial") {
    return a.zone === b.zone
      ? null
      : `A and B were filtered to DIFFERENT zones ("${a.zone}" vs "${b.zone}") — this A/B compares different slices of the building.`;
  }
  if (!aFull && !bFull) {
    return "Both sides of this A/B are partial (or possibly partial) packages with no declared common filter — the pairing may compare different slices of the building.";
  }
  if (!aFull) {
    return "The baseline (A) is a partial (or possibly partial) package paired against a full current run — the Δs measure the missing zones, not the knobs.";
  }
  return "The current run (B) is a partial (or possibly partial) package paired against a full baseline — the Δs measure the missing zones, not the knobs.";
}

/** How a STAGED pair was matched. A staged item snapshots the two ZoneRecords, not the pairing
 * that produced them, so this re-derives it: two v4-keyed sides carrying the SAME zoneKey were
 * matched by stable identity; anything else came from the positional-name fallback and must say
 * so on the review card exactly as it does on the sheet (SHIMS.md #2 close). */
export function stagedPairedBy(item: StagedItem): "key" | "name" {
  const key = item.a?.zoneKey;
  return key && item.b?.zoneKey === key ? "key" : "name";
}

export function materiallyChanged(a: ZoneRecord | null, b: ZoneRecord | null): boolean {
  if (!a || !b) return true;
  return (
    a.AcceptedRooms !== b.AcceptedRooms ||
    Math.abs(b.AcceptedSqft - a.AcceptedSqft) > 0.5 ||
    a.triage.verdict !== b.triage.verdict
  );
}

export function useElementWidth(): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) setWidth(entry.contentRect.width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

export function Delta({
  value,
  digits = 0,
  goodWhenUp = true,
  suffix = "",
}: {
  value: number | null;
  digits?: number;
  goodWhenUp?: boolean;
  suffix?: string;
}) {
  if (value === null) return <span className="">—</span>;
  const eps = 0.5 * 10 ** -digits; // half a display unit — matches every precision, incl. scorer's 3

  if (Math.abs(value) < eps) {
    return (
      <span className="" title="No change vs the baseline run.">
        ·
      </span>
    );
  }
  const good = goodWhenUp ? value > 0 : value < 0;
  return (
    <span className="" style={{ color: good ? token("done") : token("caution") }}>
      {value > 0 ? "+" : ""}
      {fmtNum(value, digits)}
      {suffix}
    </span>
  );
}

export type PanelHover = {
  label: string;
  flaggable: boolean;
  flagged: boolean;
  x: number;
  y: number;
};

export function HatchPattern(props: {
  id: string;
  color: string;
  hatch?: { angleDeg: number; spacingPx: number; widthPx: number };
}) {
  const hatch = props.hatch ?? HELD_HATCH;
  return (
    <pattern
      id={props.id}
      width={hatch.spacingPx}
      height={hatch.spacingPx}
      patternUnits="userSpaceOnUse"
      patternTransform={`rotate(${hatch.angleDeg})`}
    >
      <line y2={hatch.spacingPx} stroke={props.color} strokeWidth={hatch.widthPx} />
    </pattern>
  );
}

export const heldPatternId = (runId: string, zone: ZoneRecord, candidateId: string) =>
  `held-${encodeURIComponent(`${runId}/${zone.zoneKey ?? zone.Zone}/${candidateId}`)}`;

export const residuePatternId = (
  runId: string,
  zone: ZoneRecord,
  elementId: string,
  kind: ResidueKind,
) => `residue-${kind}-${encodeURIComponent(`${runId}/${zone.zoneKey ?? zone.Zone}/${elementId}`)}`;

export const residueKind = (reason: string): ResidueKind =>
  reason === "excluded" ? "excluded" : "void";
