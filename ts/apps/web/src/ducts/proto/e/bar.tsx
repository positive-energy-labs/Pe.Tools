/**
 * THROWAWAY (protoui round 2, E1/E2): the one loss bar both sidebars draw, and its one-line legend.
 * Full width is the group's critical run (Pe's largest fan-to-grille total), so the critical row
 * fills its track and every other row reads as a share of it. Unpriced draws no track: an empty bar
 * would read as zero loss.
 */
import type { Provisional } from "@pe/ducts-domain/losses";
import { tokenRef } from "@pe/kit/lib/token";

export const fmt = (n: number | null | undefined, d = 3) => (n == null ? "—" : n.toFixed(d));

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
          bar = loss from the fan, in-wg · full width = the critical run ◆ {criticalName ?? "—"}{" "}
          <span className="face-mono">{fmt(scale)}</span>
        </>
      )}
    </p>
  );
}

/** The bar for a row's trailing slot: a fixed track (rows align) and the total beside it. */
export function MetaBar({
  value,
  scale,
  provisional = null,
  self,
}: {
  value: number | null;
  scale: number | null;
  provisional?: Provisional;
  /** This row's own loss, drawn after the total when given; "" holds the column empty. */
  self?: number | null | "";
}) {
  const share = value != null && scale ? Math.min(1, value / scale) : null;
  return (
    <span className="inline-flex items-center gap-1.5" data-e-bar={share ?? ""}>
      <span className="relative inline-block h-1.5 w-16" aria-hidden>
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
      <span className="w-10 text-right">{fmt(value)}</span>
      {self !== undefined ? (
        <span className="text-ink-2 w-12 text-right">{self === "" ? "" : self == null ? "—" : `+${fmt(self)}`}</span>
      ) : null}
      <span className="w-1.5" data-tone={provisional ? "caution" : undefined}>
        {provisional ? "~" : ""}
      </span>
    </span>
  );
}
