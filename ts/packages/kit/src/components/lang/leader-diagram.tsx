import "./lang.css";
import { useLayoutEffect, useRef, type CSSProperties, type ReactNode } from "react";

export interface LeaderItem {
  key: string;
  /** Segment midpoints, as fractions of the track. Several segments can share one label. */
  at?: readonly number[];
  label?: ReactNode;
  value?: ReactNode;
  dashed?: boolean;
  size?: number;
}

type Props = {
  label: string;
  items: readonly LeaderItem[];
  track?: ReactNode;
  /** Composed rows identify themselves with data-key, as kit Table does. */
  children?: ReactNode;
  width?: number;
  bottom?: boolean;
  right?: boolean;
};
/** One ink connects measured segments to their composed labels. */
export function LeaderDiagram(props: Props) {
  const { items, track, children, bottom = false, right = false } = props;
  const root = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const box = root.current;
    const source = bar.current;
    if (!box || !source) return;
    const measure = () => {
      const origin = box.getBoundingClientRect();
      const track = source.getBoundingClientRect();
      const x = track.left - origin.left;
      const y = (bottom ? track.top : track.bottom) - origin.top;
      const targets = [...box.querySelectorAll<HTMLElement>("[data-key]")];
      const paths = [...box.querySelectorAll<SVGPathElement>("[data-leader-line]")];
      for (const item of items) {
        const target = targets.find((node) => node.dataset.key === item.key);
        const path = paths.find((node) => node.dataset.leaderLine === item.key);
        if (!path) continue;
        if (!target) {
          path.removeAttribute("d");
          continue;
        }
        const rect = target.getBoundingClientRect();
        const end = rect.top + rect.height / 2 - origin.top;
        path.setAttribute(
          "d",
          (item.at ?? [])
            .map(
              (at) =>
                `M${x + Math.max(0, Math.min(1, at)) * track.width} ${y} V${end} H${right ? x : x + track.width}`,
            )
            .join(" "),
        );
      }
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(box);
    observer?.observe(source);
    box.querySelectorAll<HTMLElement>("[data-key]").forEach((node) => observer?.observe(node));
    box.addEventListener("scroll", measure, true);
    return () => {
      observer?.disconnect();
      box.removeEventListener("scroll", measure, true);
    };
  }, [items, bottom, right, children]);
  return (
    <div
      ref={root}
      className="dl-leader-diagram"
      role="group"
      aria-label={props.label}
      data-bottom={bottom || undefined}
      data-right={right || undefined}
      style={{ "--leader-width": `${props.width ?? 120}px` } as CSSProperties}
    >
      <div ref={bar} className="dl-leader-track">
        {track ??
          items.map((item) => (
            <span
              key={item.key}
              className="dl-leader-segment"
              style={{ width: `${(item.size ?? 1 / items.length) * 100}%` }}
            />
          ))}
      </div>
      <div className="dl-leader-body">
        {children ??
          items.map((item) => (
            <div key={item.key} data-key={item.key} className="dl-leader-label">
              <span>{item.label}</span>
              <span className="face-mono">{item.value}</span>
            </div>
          ))}
      </div>
      <svg aria-hidden className="dl-leader-lines">
        {items.map((item) => (
          <path key={item.key} data-leader-line={item.key} data-dashed={item.dashed || undefined} />
        ))}
      </svg>
    </div>
  );
}
