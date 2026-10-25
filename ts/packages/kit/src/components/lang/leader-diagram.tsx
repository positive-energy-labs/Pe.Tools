import "./lang.css";
import { useLayoutEffect, useRef, type CSSProperties, type ReactNode } from "react";
import type { TeachRect } from "./teach";

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
  picture?: {
    width: number;
    height: number;
    regions: readonly (TeachRect & { key: string; label: string })[];
  };
  /** Composed rows identify themselves with data-key, as kit Table does. */
  children?: ReactNode;
  width?: number;
  bottom?: boolean;
  right?: boolean;
};
/** One ink connects measured segments or page regions to their composed labels. */
export function LeaderDiagram(props: Props) {
  const { items, track, picture, children, bottom = false, right = false } = props;
  const root = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const box = root.current;
    const source = bar.current;
    if (!box || !source) return;
    const measure = () => {
      const origin = box.getBoundingClientRect();
      if (picture && (!origin.width || !origin.height)) return;
      source
        .querySelectorAll("[data-leader-reference]")
        .forEach((node) => node.setAttribute("visibility", "hidden"));
      const track = source.getBoundingClientRect();
      if (picture) source.style.setProperty("--leader-scale", String(track.width / picture.width));
      const x = track.left - origin.left;
      const y = (bottom ? track.top : track.bottom) - origin.top;
      const targets = [...box.querySelectorAll<HTMLElement>("[data-key]")];
      const sources = [...source.querySelectorAll<HTMLElement>("[data-leader-source]")];
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
        const region = sources
          .find((node) => node.dataset.leaderSource === item.key)
          ?.getBoundingClientRect();
        const end = rect.top + rect.height / 2 - origin.top;
        const facesRight = region && rect.left >= region.right;
        const point = (x: number, y: number) =>
          picture ? `${(x / origin.width) * 1000} ${(y / origin.height) * 1000}` : `${x} ${y}`;
        path.setAttribute(
          "d",
          region
            ? `M${point((facesRight ? region.right : region.left) - origin.left, region.top + region.height / 2 - origin.top)} L${point((facesRight ? rect.left : rect.right) - origin.left, rect.top + Math.min(16, rect.height / 2) - origin.top)}`
            : (item.at ?? [])
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
  }, [items, bottom, right, children, picture]);
  return (
    <div className={picture ? "@container" : "contents"}>
      <div
        ref={root}
        className={
          picture
            ? "relative grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)_minmax(0,1fr)] items-start gap-x-12 gap-y-4 text-ink-2 @max-[60rem]:flex @max-[60rem]:flex-col"
            : "dl-leader-diagram"
        }
        role="group"
        aria-label={props.label}
        data-bottom={bottom || undefined}
        data-right={right || undefined}
        data-picture={picture ? "" : undefined}
        style={{ "--leader-width": `${props.width ?? 120}px` } as CSSProperties}
      >
        <div
          ref={bar}
          className={picture ? "col-start-2 w-full min-w-0 self-center" : "dl-leader-track"}
          style={picture ? { gridRow: `1 / span ${Math.ceil(items.length / 2)}` } : undefined}
        >
          {picture ? (
            <svg
              data-leader-map=""
              className="block w-full overflow-visible"
              aria-label="Page layout"
              viewBox={`0 0 ${picture.width} ${picture.height}`}
            >
              {picture.regions.map((r, i) => (
                <svg
                  key={r.key}
                  className="@max-[60rem]:overflow-visible"
                  aria-label={r.label}
                  x={r.left}
                  y={r.top}
                  width={r.width}
                  height={r.height}
                  overflow="hidden"
                >
                  <rect
                    data-leader-source={r.key}
                    width="100%"
                    height="100%"
                    fill="none"
                    className="stroke-line-2"
                    vectorEffect="non-scaling-stroke"
                  />
                  <text
                    x={4}
                    y={r.height / 2}
                    dy=".35em"
                    fill="currentColor"
                    fontSize="calc(var(--type-small-size) / var(--leader-scale, 1))"
                  >
                    {i + 1}
                    <tspan className="@max-[60rem]:hidden"> {r.label}</tspan>
                  </text>
                </svg>
              ))}
              <g data-leader-reference="" aria-hidden>
                {picture.regions.map((r, i) => {
                  const right = i % 2 === 1;
                  const x = r.left + (right ? r.width : 0);
                  const y = r.top + r.height / 2;
                  const end = x + (right ? 24 : -24);
                  return (
                    <g key={r.key}>
                      <path
                        data-leader-reference-line={r.key}
                        d={`M${x} ${y} H${end}`}
                        fill="none"
                        className="stroke-line-2"
                        vectorEffect="non-scaling-stroke"
                      />
                      <text
                        x={end}
                        y={y}
                        dy="-.35em"
                        textAnchor={right ? "start" : "end"}
                        fill="currentColor"
                      >
                        {i + 1}
                      </text>
                    </g>
                  );
                })}
              </g>
            </svg>
          ) : (
            (track ??
            items.map((item) => (
              <span
                key={item.key}
                className="dl-leader-segment"
                style={{ width: `${(item.size ?? 1 / items.length) * 100}%` }}
              />
            )))
          )}
        </div>
        <div
          className={
            picture
              ? "contents @max-[60rem]:flex @max-[60rem]:w-full @max-[60rem]:flex-col @max-[60rem]:gap-6"
              : "dl-leader-body"
          }
        >
          {children ??
            items.map((item) => (
              <div key={item.key} data-key={item.key} className="dl-leader-label">
                <span>{item.label}</span>
                <span className="face-mono">{item.value}</span>
              </div>
            ))}
        </div>
        <svg
          aria-hidden
          viewBox={picture ? "0 0 1000 1000" : undefined}
          preserveAspectRatio="none"
          className={`dl-leader-lines ${picture ? "@max-[60rem]:hidden" : ""}`}
        >
          {items.map((item) => (
            <path
              key={item.key}
              data-leader-line={item.key}
              data-dashed={item.dashed || undefined}
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>
      </div>
    </div>
  );
}
