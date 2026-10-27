import type { CSSProperties } from "react";
import "./lang.css";
import { Button } from "./button";
import { Rail } from "./rail";
import { PaneRailTitle } from "./pane-resize";
import type { TeachRect } from "./teach";

/** A page's measured or declared regions; selection operates this map, never the source page. */
export function PageMap({
  picture,
  value,
  onValueChange,
}: {
  picture: {
    width: number;
    height: number;
    regions: readonly (TeachRect & {
      key: string;
      label: string;
      ordinal?: string;
      orientation?: "horizontal" | "vertical";
    })[];
  };
  value: string;
  onValueChange: (key: string) => void;
}) {
  return (
    <div
      className="dl-page-map"
      role="group"
      aria-label="Page regions"
      data-page-map=""
      style={
        {
          aspectRatio: `${picture.width} / ${picture.height}`,
          "--map-aspect": picture.width / picture.height,
        } as CSSProperties
      }
    >
      {picture.regions.map((region, index) => (
        <Button
          key={region.key}
          kind="framed"
          label={`Show ${region.label} controls`}
          pressed={value === region.key}
          data-map-region={region.key}
          data-map-rail={region.orientation}
          onClick={() => onValueChange(region.key)}
          style={{
            left: `${(region.left / picture.width) * 100}%`,
            top: `${(region.top / picture.height) * 100}%`,
            width: `${(region.width / picture.width) * 100}%`,
            height: `${(region.height / picture.height) * 100}%`,
          }}
        >
          {region.orientation ? (
            <PaneRailTitle title={region.label} orientation={region.orientation} />
          ) : (
            <Rail
              lead={
                <h2 data-slot="pane-title">
                  {region.ordinal ?? index + 1} {region.label}
                </h2>
              }
            />
          )}
        </Button>
      ))}
    </div>
  );
}
