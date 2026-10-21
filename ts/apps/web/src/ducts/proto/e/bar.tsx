/**
 * THROWAWAY (protoui round 3, E2): the loss bar the tree draws, and its one-line legend.
 * Full width is the group's critical run (Pe's largest fan-to-grille total), so the critical row
 * fills its track and every other row reads as a share of it. Unpriced draws no track: an empty bar
 * would read as zero loss.
 */
import type { Provisional } from "@pe/ducts-domain/losses";
import { tokenRef } from "@pe/kit/lib/token";

export const fmt = (n: number | null | undefined, d = 3) => (n == null ? "—" : n.toFixed(d));

/** Equivalent feet as an engineer reads them: whole feet, one place under ten. */
export const fmtFt = (ft: number | null | undefined) =>
  ft == null
    ? "—"
    : Math.abs(ft) < 10
      ? ft.toFixed(1)
      : Math.round(ft).toLocaleString("en-US");

export function LossBar({
  value,
  scale,
  provisional = null,
  label,
}: {
  value: number | null;
  scale: number | null;
  provisional?: Provisional;
  label: string;
}) {
  const share = value != null && scale ? Math.min(1, value / scale) : null;
  return (
    <span className="flex min-w-0 flex-1 items-center gap-2" title={label}>
      <span className="relative block h-1.5 min-w-8 flex-1" aria-hidden>
        {share != null ? (
          <>
            <span className="absolute inset-0" style={{ backgroundColor: tokenRef("line") }} />
            <span
              className="absolute inset-y-0 left-0"
              style={{ width: `${share * 100}%`, backgroundColor: tokenRef("ink-2") }}
            />
          </>
        ) : null}
      </span>
      <span className="face-mono w-12 shrink-0 text-right">{fmt(value)}</span>
      <span
        className="w-2 shrink-0"
        data-tone={provisional ? "caution" : undefined}
        title={
          provisional
            ? `provisional: rests on ${provisional.count} unruled inferred join(s), worst ${provisional.worst}`
            : undefined
        }
      >
        {provisional ? "~" : ""}
      </span>
    </span>
  );
}

export function BarLegend({
  scale,
  criticalName,
}: {
  scale: number | null;
  criticalName: string | null;
}) {
  return (
    <p className="t-small text-ink-2 border-line border-b px-2 py-1" data-e-legend="">
      {scale == null ? (
        "bars: not priced yet (the ASHRAE tables are not read), so no row draws a bar"
      ) : (
        <>
          eq ft = effective length from the fan to the row's far end, each fitting as equivalent feet
          at its duct's own friction rate (small number: in-wg) · bar = in-wg, full width = the
          critical run ◆ {criticalName ?? "—"} <span className="face-mono">{fmt(scale)}</span>
        </>
      )}
    </p>
  );
}

/** The loss columns' precision: a short duct really loses ~0.0001 in-wg, and 3 places would read it as 0. */
const LOSS_PLACES = 4;

/** The loss columns' widths, one recipe for the header and every row so they align. */
const COL = { bar: "w-10", ft: "w-12", wg: "w-12", mark: "w-1.5" } as const;

/**
 * The header over `MetaBar`'s columns: the Tree's `columns.meta`. Feet are the primary unit (ACCA
 * Manual D reads a fitting as equivalent feet of duct); the small in-wg beside each is the pressure.
 */
export function MetaHeader() {
  return (
    <span className="inline-flex items-center gap-1.5" data-e-columns="">
      <span className={COL.bar} aria-hidden />
      <span
        className={`${COL.ft} text-right`}
        title="effective length from the fan to this row's far end, in equivalent feet at each duct's own friction rate; the small number beside it is the loss in in-wg"
      >
        to here, eq ft
      </span>
      <span className={COL.wg} aria-hidden />
      <span
        className={`${COL.ft} border-line border-l pl-1.5 text-right`}
        title="this row's own effective length, in equivalent feet; the small number beside it is its own loss in in-wg"
      >
        own, eq ft
      </span>
      <span className={COL.wg} aria-hidden />
      <span className={COL.mark} aria-hidden />
    </span>
  );
}

/**
 * The bar for a row's trailing slot: a fixed track (rows align), then the effective length to here
 * in feet with its in-wg beside it in smaller ink, then the row's own the same way. The bar's share
 * is the in-wg total against the critical run (the ESP is the budget); the numbers are feet.
 */
export function MetaBar({
  value,
  scale,
  ft,
  provisional = null,
  self,
  selfFt,
  unpriced = null,
}: {
  /** The loss to here, in-wg. */
  value: number | null;
  scale: number | null;
  /** The effective length to here, ft. */
  ft: number | null;
  provisional?: Provisional;
  /** This row's own loss, in-wg, drawn after the total when given; "" holds the column empty. */
  self?: number | null | "";
  /** This row's own effective length, ft. */
  selfFt?: number | null;
  /** A priced path that could not price this row: its word stands where the number would, never 0. */
  unpriced?: { word: string; why: string } | null;
}) {
  const share = value != null && scale ? Math.min(1, value / scale) : null;
  const own = unpriced ? unpriced.word : self === "" ? "" : selfFt == null ? "—" : `+${fmtFt(selfFt)}`;
  return (
    <span className="inline-flex items-center gap-1.5" data-e-bar={share ?? ""}>
      <span className={`relative inline-block h-1.5 ${COL.bar}`} aria-hidden>
        {share != null ? (
          <>
            <span className="absolute inset-0" style={{ backgroundColor: tokenRef("line") }} />
            <span
              className="absolute inset-y-0 left-0"
              style={{ width: `${share * 100}%`, backgroundColor: tokenRef("ink-2") }}
            />
          </>
        ) : null}
      </span>
      <span className={`${COL.ft} text-right`} data-e-ft={ft ?? ""}>
        {fmtFt(ft)}
      </span>
      <span className={`${COL.wg} text-ink-2 t-small`} title="loss to here, in-wg">
        {fmt(value, LOSS_PLACES)}
      </span>
      {self !== undefined ? (
        <>
          <span
            className={`border-line border-l pl-1.5 ${COL.ft} text-right`}
            data-e-own={unpriced ? "unpriced" : ""}
            title={unpriced?.why}
          >
            {own}
          </span>
          <span className={`${COL.wg} text-ink-2 t-small`} title="own loss, in-wg">
            {unpriced || self === "" || self == null ? "" : `+${fmt(self, LOSS_PLACES)}`}
          </span>
        </>
      ) : null}
      <span className={COL.mark} data-tone={provisional ? "caution" : undefined}>
        {provisional ? "~" : ""}
      </span>
    </span>
  );
}
