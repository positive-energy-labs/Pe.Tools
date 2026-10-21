/**
 * A multi-fan system's sections (ducts-domain `fan-sections.ts`): one row per fan, largest design
 * flow first, each with its own TEL and ESP and where it ends. The largest fan owns the trunk; a
 * smaller fan owns its port to the junction where its air meets a larger fan's. Hovering a row
 * lights the elements that fan owns; pressing it selects its critical grille.
 */
import type { FanResult } from "@pe/ducts-domain/losses";
import { Row } from "@pe/kit/lang/row";

import { fmtFt } from "./bar";

export function FanSections({
  title = null,
  fans,
  nameOf,
  light,
  select,
}: {
  /** The section these fans root, when the system has several ("SA 19 · FC-17"). */
  title?: string | null;
  fans: readonly FanResult[];
  nameOf: (id: number) => string;
  light: (ids: readonly number[] | null) => void;
  select: (id: number | null) => void;
}) {
  if (fans.length < 2) return null;
  return (
    <div
      role="list"
      aria-label={title ? `fan sections of ${title}` : "fan sections"}
      className="border-line border-b"
      data-e-fans
      onMouseLeave={() => light(null)}
    >
      {title ? <p className="t-small text-ink-2 px-2 pt-1">{title}</p> : null}
      {fans.map((f, k) => {
        const where =
          k === 0
            ? "owns the trunk"
            : f.junction == null
              ? "meets no larger fan"
              : `to ${nameOf(f.junction)}${f.viaJunction ? ", then the trunk" : ""}`;
        const sub = `${f.cfm ?? "no"} cfm · TEL ${fmtFt(f.tel)} ft · ESP ${f.esp.toFixed(3)} in-wg · ${where}`;
        return (
          <Row
            key={f.unit}
            role="listitem"
            lines={2}
            label={nameOf(f.unit)}
            title={`${nameOf(f.unit)}: ${sub}`}
            aside={k === 0 ? "largest fan" : "fan"}
            sub={sub}
            onMouseEnter={() => light(f.owned)}
            onClick={() => select(f.critical)}
            data-key={`fan:${f.unit}`}
          />
        );
      })}
    </div>
  );
}
