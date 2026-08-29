import { cn } from "#/lib/utils";
import { type ZoneRecord } from "./world";
import { adaptedKnobs, fmtPct, fmtSqft, topRejections } from "./browser-unknown-title";

export function ZonePeekFloater(props: {
  zoneName: string;
  b: ZoneRecord;
  a: ZoneRecord | null | undefined;
  comparing: boolean;
  highlighted: boolean;
}) {
  const { a, b, comparing } = props;
  const rows: [string, (z: ZoneRecord) => string][] = [
    ["verdict", (z) => `${z.triage.verdict} (${z.triage.reason})`],
    ["accepted", (z) => `${z.AcceptedRooms}/${z.OracleRooms}r · ${fmtSqft(z.AcceptedSqft)}`],
    ["held", (z) => `${z.HeldRooms}r · ${fmtSqft(z.HeldSqft)}`],
    ["ink-backed", (z) => fmtPct(z.InkBackedEdgeFraction)],
    ["ink ratio", (z) => z.census.inkRatio.toFixed(2)],
    [
      "closure",
      (z) =>
        `dh ${Math.round(z.closure.doorHeadSqft)} · wall ${Math.round(z.closure.wallRunGapSqft)} · gap ${Math.round(z.closure.gapCloseSqft)} sf`,
    ],
  ];
  const rejList = (z: ZoneRecord | null | undefined, alignEnd: boolean) =>
    z ? (
      <span className={cn("flex flex-col", alignEnd ? "items-end" : "items-start")}>
        {topRejections(z).map(([k, n]) => (
          <span key={k}>
            {k} ×{n}
          </span>
        ))}
        {Object.keys(z.Rejections).length === 0 && <span>none</span>}
      </span>
    ) : (
      "—"
    );
  const knobs = adaptedKnobs(b);
  return (
    <div
      className="face-mono pointer-events-none absolute bottom-2 left-1/2 w-[30rem] max-w-[calc(100%-1rem)] -translate-x-1/2 border bg-page/95 p-2 t-label shadow-sm"
      style={{ borderRadius: "var(--radius)" }}
    >
      <div className="mb-1 flex flex-col items-center">
        <span className="text-ink">{props.zoneName}</span>
        {props.highlighted && (
          <span className="t-caption text-ink-2">highlighted · esc clears</span>
        )}
      </div>
      <table className="w-full table-fixed">
        <colgroup>
          {comparing && <col />}
          <col className="w-[84px]" />
          <col />
        </colgroup>
        <tbody>
          {rows.map(([label, f]) => (
            <tr key={label} className="align-top">
              {comparing && <td className="pr-2 text-right text-ink">{a ? f(a) : "—"}</td>}
              <td className="text-center text-ink-2">{label}</td>
              <td className={cn("pl-2 text-ink", comparing ? "text-left" : "text-center")}>
                {f(b)}
              </td>
            </tr>
          ))}
          <tr className="align-top">
            {comparing && <td className="pr-2 text-right text-ink">{rejList(a, true)}</td>}
            <td className="text-center text-ink-2">rejections</td>
            <td className={cn("pl-2 text-ink", comparing ? "text-left" : "text-center")}>
              {rejList(b, false)}
            </td>
          </tr>
          {knobs.length > 0 && (
            <tr className="align-top">
              {comparing && <td />}
              <td className="text-center text-ink-2">knobs</td>
              <td className={cn("pl-2 text-ink", comparing ? "text-left" : "text-center")}>
                {knobs.map(([k, v]) => `${k}=${v}`).join(" · ")}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ---- the dock -------------------------------------------------------------

export type FocusRequest = { zone: ZoneRecord; nonce: number };
