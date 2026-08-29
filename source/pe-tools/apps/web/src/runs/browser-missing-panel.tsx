import { token } from "#/lib/token";
import { type ReactNode } from "react";
import { fb, itemKey, type StagedItem, useFb } from "./feedback/staging";
import { type ZoneRecord } from "./world";
import { Press } from "#/components/lang/press";
import { Delta, fmtPct, fmtSqft, topRejections } from "./browser-unknown-title";

export function MissingPanel(props: { w: number; h: number; label: string }) {
  return (
    <div
      className="face-mono flex shrink-0 items-center justify-center bg-recess t-label text-ink-2"
      style={{
        width: props.w,
        height: props.h,
        borderRadius: "var(--radius)",
      }}
    >
      {props.label}
    </div>
  );
}

export function StageButton(props: {
  name: string;
  runA: string | null;
  runB: string;
  a: ZoneRecord | null;
  b: ZoneRecord | null;
  onSwing: (item: StagedItem) => void;
}) {
  const { items } = useFb();
  const key = itemKey(props.name, props.runA, props.runB);
  const staged = items.some((i) => i.key === key);
  const otherPairs = items.filter((i) => i.zone === props.name && i.key !== key);
  return (
    <>
      {otherPairs.length > 0 && (
        <Press
          type="button"
          onClick={() => props.onSwing(otherPairs[0]!)}
          title={`This zone is staged under ${otherPairs.length} other A/B pair${otherPairs.length === 1 ? "" : "s"} (pinned at stage time; the lens is only a view). Click to swing the lens to the pinned pair.`}
          size="mono-caption"
          style={{ color: token("caution") }}
        >
          ⚑{otherPairs.length}≠
        </Press>
      )}
      <Press
        type="button"
        onClick={() =>
          fb.toggleStage({
            key,
            zone: props.name,
            level: (props.b ?? props.a)?.Level ?? "?",
            runA: props.runA,
            runB: props.runB,
            a: props.a,
            b: props.b,
          })
        }
        title={
          staged
            ? "Staged for export (this exact A/B pair is pinned) — click to unstage. Click rooms/residues on the B panel to flag them."
            : "Stage this zone's current A/B pair for the feedback export. The pair is pinned at stage time; switching the lens afterwards never alters it."
        }
        size="chip-caption"
        tone="bordered-quiet"
        style={{
          borderRadius: "var(--radius)",
          borderColor: staged ? token("alarm") : token("line-2"),
          color: staged ? token("alarm") : token("ink-2"),
        }}
      >
        {staged ? "staged ✓" : "＋ stage"}
      </Press>
    </>
  );
}

// ---------------------------------------------------------------------------
// Zone card — the round-2 rich summary. A|B panels side by side by DEFAULT; with the baseline
// cleared the single panel spans the same footprint (the page grid never shifts). Stats are a
// fixed-row A/B table so the eye can column-scan the whole sheet. The SAME component renders
// the review-staged layout — one card, two layouts (round-2 ruling).
// ---------------------------------------------------------------------------

export type StatRow = {
  label: string;
  value: (z: ZoneRecord) => ReactNode;
  delta?: (a: ZoneRecord, b: ZoneRecord) => ReactNode;
};

export const STAT_ROWS: StatRow[] = [
  {
    label: "verdict",
    value: (z) => (
      <span style={{ color: z.triage.verdict === "solve" ? token("done") : token("caution") }}>
        {z.triage.verdict}
        <span className="text-ink-2"> · {z.triage.reason}</span>
      </span>
    ),
  },
  {
    label: "accepted",
    value: (z) => `${z.AcceptedRooms}/${z.OracleRooms}r · ${fmtSqft(z.AcceptedSqft)}`,
    delta: (a, b) => <Delta value={b.AcceptedSqft - a.AcceptedSqft} suffix=" sf" />,
  },
  {
    label: "held",
    value: (z) => `${z.HeldRooms}r · ${fmtSqft(z.HeldSqft)}`,
    delta: (a, b) => <Delta value={b.HeldSqft - a.HeldSqft} goodWhenUp={false} suffix=" sf" />,
  },
  {
    label: "ink-backed",
    value: (z) => fmtPct(z.InkBackedEdgeFraction),
    delta: (a, b) => (
      <Delta
        value={(b.InkBackedEdgeFraction - a.InkBackedEdgeFraction) * 100}
        digits={1}
        suffix="pp"
      />
    ),
  },
  {
    label: "closure",
    value: (z) =>
      `dh ${Math.round(z.closure.doorHeadSqft)} · wall ${Math.round(z.closure.wallRunGapSqft)} · gap ${Math.round(z.closure.gapCloseSqft)}`,
  },
  {
    label: "rejections",
    value: (z) => {
      const top = topRejections(z, 2);
      return top.length === 0 ? (
        <span className="text-ink-2">none</span>
      ) : (
        top.map(([k, n]) => `${k} ×${n}`).join(" · ")
      );
    },
  },
];
