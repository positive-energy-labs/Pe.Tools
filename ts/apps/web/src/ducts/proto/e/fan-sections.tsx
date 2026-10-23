/**
 * A multi-fan system's sections (ducts-domain `fan-sections.ts`): one row per fan, largest design
 * flow first, each with its own TEL and ESP and where it ends. The largest fan owns the trunk; a
 * smaller fan owns its port to the junction where its air meets a larger fan's. Hovering a row
 * lights the elements that fan owns; pressing it selects its critical grille.
 */
import type { FanResult } from "@pe/ducts-domain/losses";
import { useList } from "@pe/kit/lang/collection";
import { ListView } from "@pe/kit/lang/list-view";
import { observedElements, useNativeObservation } from "#/revit/observation";

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
  const observation = useNativeObservation();
  const list = useList({
    items: fans,
    keyOf: (fan) => `fan:${fan.unit}`,
    search: (fan) => ({ text: [nameOf(fan.unit)], ids: [fan.unit] }),
    select: "single",
    onPick: (fan) => select(fan.critical),
  });
  if (fans.length < 2) return null;
  return (
    <div
      aria-label={title ? `fan sections of ${title}` : "fan sections"}
      className="hairline-b"
      data-e-fans
      onMouseLeave={() => light(null)}
    >
      {title ? <p className="t-small text-ink-2 px-2 pt-1">{title}</p> : null}
      <ListView
        list={list}
        aria-label={title ? `fan sections of ${title}` : "fan sections"}
        bar={false}
        empty={{ message: "no fan sections", exit: "Choose a system with several fans" }}
        row={(f) => {
          const k = fans.indexOf(f);
          const target = observedElements(observation, f.owned);
          const where =
            k === 0
              ? "owns the trunk"
              : f.junction == null
                ? "meets no larger fan"
                : `to ${nameOf(f.junction)}${f.viaJunction ? ", then the trunk" : ""}`;
          const sub = `${f.cfm ?? "no"} cfm · TEL ${fmtFt(f.tel)} ft · ESP ${f.esp.toFixed(3)} in-wg · ${where}`;
          return {
            lines: 2,
            label: nameOf(f.unit),
            title: `${nameOf(f.unit)}: ${sub}`,
            aside: k === 0 ? "largest fan" : "fan",
            sub,
            onMouseEnter: () => light(f.owned),
            revitIds: target.ids,
            revitRefs: target.refs,
          };
        }}
      />
    </div>
  );
}
