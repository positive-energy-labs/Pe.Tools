import { cn } from "#/lib/utils";
import { token } from "#/lib/token";
import { type ZoneRecord } from "../world";
import { adaptedKnobs, fmtPct, fmtSqft, topRejections, closureText, roomCount } from "./unknown";

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
    ["accepted", (z) => `${roomCount(z)} · ${fmtSqft(z.AcceptedSqft)}`],
    ["held", (z) => `${z.HeldRooms ?? "?"}r · ${fmtSqft(z.HeldSqft)}`],
    ["ink-backed", (z) => fmtPct(z.InkBackedEdgeFraction)],
    ["ink ratio", (z) => z.census?.inkRatio.toFixed(2) ?? "unavailable"],
    ["closure", (z) => closureText(z)],
  ];
  const rejList = (z: ZoneRecord | null | undefined, alignEnd: boolean) =>
    z ? (
      <span className={cn("flex flex-col", alignEnd ? "items-end" : "items-start")}>
        {topRejections(z).map(([k, n]) => (
          <span key={k}>
            {k} ×{n}
          </span>
        ))}
        {Object.keys(z.Rejections).length === 0 && (
          <span>{z.triage.verdict === "error" ? "unavailable" : "none"}</span>
        )}
      </span>
    ) : (
      "—"
    );
  const knobs = adaptedKnobs(b);
  return (
    <div
      className="pointer-events-none absolute bottom-2 left-1/2 w-[30rem] max-w-[calc(100%-1rem)] -translate-x-1/2 p-2"
      style={{ borderRadius: "var(--radius)", backgroundColor: token("page") }}
    >
      <div className="mb-1 flex flex-col items-center">
        <span className="">{props.zoneName}</span>
        {props.highlighted && <span className="">highlighted · esc clears</span>}
      </div>
      {/* DOMAIN (kept hand table): a transient, unfocusable peek laid over the drawing, centred on the plan. */}
      <table className="w-full table-fixed">
        <colgroup>
          {comparing && <col />}
          <col className="w-[84px]" />
          <col />
        </colgroup>
        <tbody>
          {rows.map(([label, f]) => (
            <tr key={label} className="align-top">
              {comparing && <td className="pr-2 text-right">{a ? f(a) : "—"}</td>}
              <td className="text-center">{label}</td>
              <td className={cn("pl-2", comparing ? "text-left" : "text-center")}>{f(b)}</td>
            </tr>
          ))}
          <tr className="align-top">
            {comparing && <td className="pr-2 text-right">{rejList(a, true)}</td>}
            <td className="text-center">rejections</td>
            <td className={cn("pl-2", comparing ? "text-left" : "text-center")}>
              {rejList(b, false)}
            </td>
          </tr>
          {knobs.length > 0 && (
            <tr className="align-top">
              {comparing && <td />}
              <td className="text-center">knobs</td>
              <td className={cn("pl-2", comparing ? "text-left" : "text-center")}>
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
