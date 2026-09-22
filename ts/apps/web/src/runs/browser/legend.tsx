import { difference, sumKnown } from "../world";
import { dash, token } from "#/lib/token";
import { type CSSProperties, type ReactNode } from "react";
import { cn } from "#/lib/utils";
import {
  candidateTone,
  CLOSE_M,
  HELD_HATCH,
  INK_M,
  RESIDUE_TREATMENT,
  type ResidueKind,
  SEAL_DOOR,
  ZONE_STROKE,
} from "../palette";
import { Press } from "#/components/lang/press";
import type { LevelData } from "./frame";
import { Delta, HatchPattern, UNKNOWN_TITLE, fmtSqft } from "./unknown";

export function LegendFloater(props: {
  underlay: boolean;
  sliceEvidence?: boolean;
  onClose: () => void;
}) {
  const sw = (bg: string, extra?: CSSProperties) => (
    <span className="inline-block h-2.5 w-4 shrink-0" style={{ backgroundColor: bg, ...extra }} />
  );
  const line = (stroke: string, reference = false) => (
    <svg className="h-0.5 w-4 shrink-0 overflow-visible" viewBox="0 0 16 2" aria-hidden>
      <line
        x1={0}
        y1={1}
        x2={16}
        y2={1}
        stroke={stroke}
        strokeWidth={2}
        strokeDasharray={reference ? dash("reference") : undefined}
      />
    </svg>
  );
  const hatchedSwatch = (
    id: string,
    hatch: { angleDeg: number; color: string; spacingPx: number; widthPx: number },
    fill: string,
    stroke: string,
    strokeWidth: number,
  ) => (
    <svg className="h-2.5 w-4 shrink-0" viewBox="0 0 16 10" aria-hidden>
      <defs>
        <HatchPattern id={id} color={hatch.color} hatch={hatch} />
      </defs>
      <rect
        x={strokeWidth / 2}
        y={strokeWidth / 2}
        width={16 - strokeWidth}
        height={10 - strokeWidth}
        fill={fill}
        stroke={stroke}
        strokeWidth={strokeWidth}
      />
      <rect width="16" height="10" fill={`url(#${id})`} />
    </svg>
  );
  const residueSwatch = (kind: ResidueKind) => {
    const treatment = RESIDUE_TREATMENT[kind];
    return hatchedSwatch(
      `legend-${kind}`,
      treatment.hatch,
      "none",
      treatment.outline.color,
      treatment.outline.widthPx,
    );
  };
  const row = (mark: ReactNode, label: string, meaning: string) => (
    <span className="flex items-center gap-1.5" title={meaning}>
      {mark}
      <span>{label}</span>
    </span>
  );
  return (
    <div
      className="absolute right-2 top-2 flex w-52 flex-col gap-1 px-2 py-1.5"
      style={{ borderRadius: "var(--radius)", backgroundColor: token("page") }}
    >
      <span className="flex items-baseline">
        <span>
          {props.sliceEvidence
            ? "evidence — raw knee/header projection"
            : `evidence — the run's raster${props.underlay ? "" : " (hidden)"}`}
        </span>
        <Press
          type="button"
          tone="quiet"
          size="icon"
          onClick={props.onClose}
          title="Hide the key (the plan header's 'key' button brings it back)."
          style={{ marginLeft: "auto" }}
        >
          ×
        </Press>
      </span>
      <div className={cn("flex flex-col gap-0.5", !props.underlay && "")}>
        {props.sliceEvidence ? (
          row(
            sw(token("ink")),
            "captured geometry",
            "Actual slice pieces; the image contains no inferred closures.",
          )
        ) : (
          <>
            {row(
              sw(`rgba(${INK_M.join(",")})`),
              "received ink (solid)",
              "Wall pixels the solver actually received from the DWG. Solid + dark = drawn; muted so decisions stay readable.",
            )}
            {row(
              sw(`rgba(${SEAL_DOOR.join(",")})`),
              "door-head seal (invented)",
              "Closure the solver INVENTED across door openings. Pale + translucent = synthetic — it can never read as a drawn wall.",
            )}
            {row(
              sw(`rgba(${CLOSE_M.join(",")})`),
              "gap-close (invented)",
              "Closure the solver INVENTED across wall-run gaps. Pale + translucent = synthetic.",
            )}
          </>
        )}
      </div>
      <span className="mt-0.5">decisions — drawn on top</span>
      <div className="flex flex-col gap-0.5">
        {row(
          sw(candidateTone("legend", "R01").fill),
          "accepted room",
          "A room the solver accepted into the takeoff — per the persisted disposition column.",
        )}
        {row(
          hatchedSwatch(
            "legend-held",
            { ...HELD_HATCH, color: candidateTone("legend", "R02").dark },
            candidateTone("legend", "R02").fill,
            "none",
            0,
          ),
          "held residue",
          "Area the solver found but did not trust — held for review, not counted.",
        )}
        {row(residueSwatch("void"), "void / disposition unknown", UNKNOWN_TITLE)}
        {row(
          residueSwatch("excluded"),
          "excluded residue",
          "Area inside the zone the solver deliberately excluded.",
        )}
        {row(
          line(ZONE_STROKE, true),
          "zone authority",
          "Input zone boundary. Always a hairline dash; status never changes its stroke.",
        )}
      </div>
      <span className="mt-0.5 pt-1" style={{ borderColor: token("line-2") }}>
        {props.sliceEvidence ? (
          "Grey = captured input · colours = solver decisions"
        ) : (
          <>
            solid dark = received · pale translucent = invented
            {props.underlay ? "" : " · underlay hidden"}
          </>
        )}
      </span>
    </div>
  );
}

export function LevelStatsFloater(props: {
  level: string;
  cur: LevelData | null;
  prev: LevelData | null;
  onClose: () => void;
}) {
  const { level, cur, prev } = props;
  const agg = (data: LevelData | null) => {
    if (!data || data.zones.length === 0) return null;
    const zones = data.zones;
    const rej = new Map<string, number>();
    for (const z of zones) {
      for (const [k, n] of Object.entries(z.Rejections)) rej.set(k, (rej.get(k) ?? 0) + n);
    }
    return {
      zones: zones.length,
      solved: zones.filter((z) => z.triage.verdict === "solve").length,
      acceptedSqft: sumKnown(zones.map((z) => z.AcceptedSqft)),
      heldSqft: sumKnown(zones.map((z) => z.HeldSqft)),
      rejTop: [...rej.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3),
    };
  };
  const b = agg(cur);
  const a = agg(prev);
  if (!b) return null;
  return (
    <div
      className="absolute bottom-2 right-2 flex w-56 flex-col gap-0.5 px-2 py-1.5"
      style={{ borderRadius: "var(--radius)", backgroundColor: token("page") }}
    >
      <span className="flex items-baseline">
        {level} — this run
        <Press
          type="button"
          tone="quiet"
          size="icon"
          onClick={props.onClose}
          title="Hide the level stats (the plan header's 'stats' button brings them back)."
          style={{ marginLeft: "auto" }}
        >
          ×
        </Press>
      </span>
      <span>
        {b.solved}/{b.zones} zones solve{" "}
        {a ? (
          <>
            (<Delta value={b.solved - a.solved} />)
          </>
        ) : null}
      </span>
      <span>
        accepted {fmtSqft(b.acceptedSqft)}{" "}
        {a ? <Delta value={difference(b.acceptedSqft, a.acceptedSqft)} suffix=" sf" /> : null}
      </span>
      <span>
        held {fmtSqft(b.heldSqft)}{" "}
        {a ? (
          <Delta value={difference(b.heldSqft, a.heldSqft)} goodWhenUp={false} suffix=" sf" />
        ) : null}
      </span>
      {b.rejTop.length > 0 && (
        <span className="mt-0.5 flex flex-col">
          {b.rejTop.map(([k, n]) => (
            <span key={k} title={`${n} rejections of kind ${k} across this level's zones.`}>
              {k} ×{n}
            </span>
          ))}
        </span>
      )}
    </div>
  );
}
